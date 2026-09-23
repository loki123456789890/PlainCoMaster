// utils/orderChat.js
//
// Order chat: one conversation per order, between the customer who placed
// it and the Store Manager of the store that sells it. Messages live under
// the order (users/{uid}/orders/{orderId}/messages), so the rules that
// already decide who may read an order decide who may read its chat.
//
// The unread dot needs no query per row: the order itself carries when the
// last message was sent and by which side, and when each side last read.
// Both order lists already load the order documents, so the dot is free.
// See chatMetaIsValid() in firestore.rules for what each side may stamp.
import { collection, doc, serverTimestamp, writeBatch, updateDoc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

// Matches the cap in firestore.rules.
export const CHAT_TEXT_MAX = 1000;

const READ_FIELD = { customer: 'customerReadAt', store: 'storeReadAt' };

export const chatImageFolder = (customerId, orderId) => `chat/${customerId}/${orderId}`;

export const orderRef = (customerId, orderId) => doc(db, 'users', customerId, 'orders', orderId);

export const messagesRef = (customerId, orderId) =>
  collection(db, 'users', customerId, 'orders', orderId, 'messages');

// Accepts a Firestore Timestamp, a Date, a number of millis, or nothing.
// Order lists pass plain objects through navigation, where a Timestamp
// would not survive, so they carry millis instead.
export function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

// The three chat fields off an order document, as millis, for the lists.
export function chatFields(data) {
  return {
    lastMessageAt: toMillis(data.lastMessageAt),
    lastMessageBy: data.lastMessageBy || null,
    customerReadAt: toMillis(data.customerReadAt),
    storeReadAt: toMillis(data.storeReadAt),
  };
}

// Is there a message from the OTHER side that `side` has not opened yet?
export function hasUnread(order, side) {
  if (!order?.lastMessageBy || order.lastMessageBy === side) return false;
  return toMillis(order.lastMessageAt) > toMillis(order[READ_FIELD[side]]);
}

export function markRead(customerId, orderId, side) {
  return updateDoc(orderRef(customerId, orderId), { [READ_FIELD[side]]: serverTimestamp() });
}

// The message and the order's "last message" stamp in one batch, so the
// other side's dot can never light up for a message that failed to save,
// nor a message save without lighting it.
export function sendMessage({ customerId, orderId, side, senderId, text, imageUrl }) {
  const batch = writeBatch(db);
  const message = { senderId, sender: side, text: text.trim(), createdAt: serverTimestamp() };
  if (imageUrl) message.imageUrl = imageUrl;
  batch.set(doc(messagesRef(customerId, orderId)), message);
  batch.update(orderRef(customerId, orderId), {
    lastMessageAt: serverTimestamp(),
    lastMessageBy: side,
  });
  return batch.commit();
}
