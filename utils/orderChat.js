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
import { collection, doc, serverTimestamp, writeBatch, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebaseConfig';

// All three match firestore.rules — the emoji strings byte for byte,
// variation selector included, or the rules refuse the reaction.
export const CHAT_TEXT_MAX = 1000;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const REACTIONS = ['❤️', '😆', '😮', '😢', '😠', '👍'];
const REPLY_QUOTE_MAX = 200;

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
export function sendMessage({ customerId, orderId, side, senderId, text, imageUrl, replyTo }) {
  const batch = writeBatch(db);
  const message = { senderId, sender: side, text: text.trim(), createdAt: serverTimestamp() };
  if (imageUrl) message.imageUrl = imageUrl;
  // A short quote of what this answers, so the bubble can show it without
  // reading the original. The screen prefers the live original when it has
  // it loaded, so an edit or an unsend shows through.
  if (replyTo) {
    message.replyTo = {
      id: replyTo.id,
      text: (replyTo.text || '').slice(0, REPLY_QUOTE_MAX),
      sender: replyTo.sender,
      hasImage: !!replyTo.imageUrl,
    };
  }
  batch.set(doc(messagesRef(customerId, orderId)), message);
  batch.update(orderRef(customerId, orderId), {
    lastMessageAt: serverTimestamp(),
    lastMessageBy: side,
  });
  return batch.commit();
}

const messageDoc = (customerId, orderId, messageId) =>
  doc(messagesRef(customerId, orderId), messageId);

// Own, not unsent, has words to edit, and still inside the window. The
// rules check the same on the server clock; this only decides whether to
// offer "Edit" at all.
export function canEdit(message, side) {
  if (message.sender !== side || message.deleted || !message.text || !message.createdAt) return false;
  return Date.now() - message.createdAt.getTime() < EDIT_WINDOW_MS;
}

export function editMessage(customerId, orderId, messageId, text) {
  return updateDoc(messageDoc(customerId, orderId, messageId), {
    text: text.trim(),
    editedAt: serverTimestamp(),
  });
}

// Leaves the message in place, emptied and marked — see the unsend clause
// in firestore.rules. The photo file itself stays in Storage: the rules
// give no one delete there, so an unsent photo is unlinked, not destroyed.
export function unsendMessage(customerId, orderId, messageId) {
  return updateDoc(messageDoc(customerId, orderId, messageId), {
    deleted: true,
    deletedAt: serverTimestamp(),
    text: '',
    imageUrl: deleteField(),
    replyTo: deleteField(),
    reactions: deleteField(),
  });
}

// Tapping your current reaction again takes it back, like Messenger.
export function setReaction(customerId, orderId, messageId, uid, emoji, current) {
  return updateDoc(messageDoc(customerId, orderId, messageId), {
    [`reactions.${uid}`]: current === emoji ? deleteField() : emoji,
  });
}
