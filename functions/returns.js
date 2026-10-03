// functions/returns.js
//
// Reporting a problem with a delivered order: the customer's side of a
// return or refund. Phase 1 covers only what is the store's fault — the
// wrong item, an item far from its description, damage nobody disclosed,
// or a size other than the one ordered. A change of mind is not a reason
// here: most of the catalogue is one-of-a-kind ukay-ukay, sold as
// described, and the Help screen says so.
//
// TWO PIECES LIVE HERE.
//
//   1. recordDeliveryDate stamps deliveredAt on an order the moment it
//      becomes 'delivered'. The 7-day window is measured from it, and
//      nothing recorded that moment before. It is a trigger rather than a
//      field the app writes because the survey APK still marks orders
//      delivered with the old code, and firestore.rules lets a manager
//      change `status` and nothing else — a server-side stamp needs
//      neither to change.
//
//   2. requestReturn is how a request comes into being. No client may
//      create one directly (firestore.rules has no create rule for
//      users/{uid}/returnRequests), for the same reason placeOrder writes
//      orders: the refund amount must be computed from the order, not
//      claimed by the caller, and "delivered within the last 7 days" needs
//      arithmetic on a timestamp that is clearer here than in rules.
//
// What happens after — approve, decline, item received, refunded — is the
// Store Manager working the request through ordinary writes that
// firestore.rules constrains to one status step at a time.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Same region as everything else; a v2 Firestore trigger must live in the
// database's region or the deploy is rejected. See index.js.
const REGION = 'asia-southeast1';

// Mirrored in the app's constants/returns.js, which decides whether to
// show the "Report a problem" link at all. This copy is the one that
// counts; the app's only hides a link that would be refused anyway.
const RETURN_WINDOW_DAYS = 7;
const RETURN_WINDOW_MS = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// What each reason reads as, in the emails (emails.js) — and in the app,
// whose constants/returns.js keeps the same four in step by hand.
const RETURN_REASON_LABELS = {
  wrong_item: 'Wrong item sent',
  not_as_described: 'Not as described',
  undisclosed_damage: 'Damage that was not mentioned',
  wrong_size: 'Wrong size sent',
};
const RETURN_REASONS = Object.keys(RETURN_REASON_LABELS);

const MAX_PHOTOS = 3;
const MAX_NOTE_LENGTH = 1000;

// How a Cash on Delivery customer is paid back: there is no card or wallet
// on file to refund to, so the store sends the money and records the
// reference. An order paid online is refunded to where it came from.
const PAYOUT_METHODS = ['gcash', 'bank'];

const db = () => getFirestore();

// Same reasoning as round2 in index.js: money is stored to two places.
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function trimmed(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// A photo must be one the customer uploaded for THIS order, which
// storage.rules only allows under returns/{uid}/{orderId}/ — so a URL
// pointing anywhere else is either a mistake or someone attaching a photo
// that is not theirs. The bucket is checked too, or a lookalike path in
// somebody else's Firebase project would pass.
//
// In the emulator the app talks to the Storage emulator over plain http on
// a LAN address, so both the scheme and host are relaxed there and only
// there.
function isReturnPhotoUrl(url, uid, orderId) {
  if (typeof url !== 'string' || url.length > 1000) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const emulated = process.env.FUNCTIONS_EMULATOR === 'true';
  const hostOk = emulated
    ? parsed.protocol === 'http:' || parsed.protocol === 'https:'
    : parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com';
  const bucket = `${process.env.GCLOUD_PROJECT}.firebasestorage.app`;
  const prefix = `/v0/b/${bucket}/o/returns%2F${uid}%2F${orderId}%2F`;
  const name = parsed.pathname.startsWith(prefix) ? parsed.pathname.slice(prefix.length) : '';
  return hostOk && name.length > 0 && !name.includes('/') && !name.includes('%2F');
}

// Which lines of the order the problem is about, by position. Lines carry
// no id of their own, and the same product may sit on two lines (two
// sizes), so the index is the only unambiguous name for one.
function normaliseLines(rawLines, orderItems) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new HttpsError('invalid-argument', 'Choose the item the problem is about.');
  }
  if (rawLines.length > orderItems.length) {
    throw new HttpsError('invalid-argument', 'That is more items than the order has.');
  }
  const seen = new Set();
  return rawLines.map((line) => {
    const index = Number(line?.index);
    const item = Number.isInteger(index) ? orderItems[index] : undefined;
    if (!item || seen.has(index)) {
      throw new HttpsError('invalid-argument', 'One of the chosen items is not on this order.');
    }
    seen.add(index);
    const ordered = Number(item.quantity) || 0;
    const quantity = line?.quantity === undefined ? ordered : Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > ordered) {
      throw new HttpsError('invalid-argument', `Choose between 1 and ${ordered} of ${item.name || 'that item'}.`);
    }
    return {
      index,
      productId: item.productId || null,
      name: item.name || '',
      size: item.size || null,
      color: item.color || null,
      image: item.image || null,
      price: Number(item.price) || 0,
      quantity,
    };
  });
}

// The order was paid online if the gateway said so. Everything else —
// Cash on Delivery, and orders older than paymentStatus — is paid back by
// hand, so the customer has to say where to.
const wasPaidOnline = (order) => order.paymentMethod !== 'cod' && order.paymentStatus === 'paid';

function normalisePayout(raw) {
  const method = raw?.method;
  if (!PAYOUT_METHODS.includes(method)) {
    throw new HttpsError('invalid-argument', 'Choose how you would like to be refunded.', {
      reason: 'payout-required',
    });
  }
  const accountName = trimmed(raw.accountName, 80);
  const accountNumber = trimmed(raw.accountNumber, 40);
  const bankName = method === 'bank' ? trimmed(raw.bankName, 60) : '';
  if (!accountName || !accountNumber || (method === 'bank' && !bankName)) {
    throw new HttpsError('invalid-argument', 'Fill in the account the refund should go to.', {
      reason: 'payout-required',
    });
  }
  return { method, accountName, accountNumber, bankName: bankName || null };
}

// Named rather than inline so scripts/test-returns.mjs can call it with a
// plain request object, the same arrangement as handlePlaceOrder.
async function handleRequestReturn(request, now = Date.now()) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please sign in.');

  const data = request.data || {};
  const orderId = typeof data.orderId === 'string' ? data.orderId : '';
  if (!/^[A-Za-z0-9]{1,40}$/.test(orderId)) {
    throw new HttpsError('invalid-argument', 'Unknown order.');
  }
  if (!RETURN_REASONS.includes(data.reason)) {
    throw new HttpsError('invalid-argument', 'Choose what went wrong.');
  }
  if (data.note !== undefined && data.note !== null && typeof data.note !== 'string') {
    throw new HttpsError('invalid-argument', 'The note must be text.');
  }
  const note = trimmed(data.note, MAX_NOTE_LENGTH);

  // Photos are the evidence a manager decides on, so at least one is
  // required for every reason. Three is plenty for one problem and keeps
  // the manager's screen readable.
  const photos = Array.isArray(data.photoUrls) ? data.photoUrls : [];
  if (photos.length === 0) {
    throw new HttpsError('invalid-argument', 'Add at least one photo of the problem.', { reason: 'photo-required' });
  }
  if (photos.length > MAX_PHOTOS) {
    throw new HttpsError('invalid-argument', `Add up to ${MAX_PHOTOS} photos.`);
  }
  if (!photos.every((url) => isReturnPhotoUrl(url, uid, orderId))) {
    throw new HttpsError('invalid-argument', 'One of the photos could not be used. Please add it again.');
  }

  const userRef = db().collection('users').doc(uid);
  // Under the caller's own uid, so another customer's order is simply not
  // found — there is no separate ownership check to forget.
  const orderRef = userRef.collection('orders').doc(orderId);
  const requestRef = userRef.collection('returnRequests').doc(orderId);

  return db().runTransaction(async (tx) => {
    const [userSnap, orderSnap, existingSnap] = await tx.getAll(userRef, orderRef, requestRef);

    // Same two account checks placeOrder makes, for the same reason: this
    // writes with admin privileges and firestore.rules never sees it.
    const user = userSnap.exists ? userSnap.data() : {};
    if (user.isActive === false) {
      throw new HttpsError('permission-denied', 'This account has been deactivated.');
    }
    if (user.role === 'seller' || user.role === 'platformAdmin') {
      throw new HttpsError('permission-denied', 'Staff accounts cannot report problems with orders.');
    }

    if (!orderSnap.exists) throw new HttpsError('not-found', 'Unknown order.');
    const order = orderSnap.data();

    if (existingSnap.exists) {
      throw new HttpsError('already-exists', 'You have already reported a problem with this order.', {
        reason: 'already-requested',
      });
    }
    if (order.status !== 'delivered') {
      throw new HttpsError('failed-precondition', 'You can report a problem once the order has been delivered.', {
        reason: 'not-delivered',
      });
    }
    // An order delivered before deliveredAt existed has no date to count
    // from. It is treated as outside the window rather than given a fresh
    // seven days from today; the order chat is still open for it.
    const deliveredAtMs = order.deliveredAt?.toMillis?.();
    if (!deliveredAtMs) {
      throw new HttpsError('failed-precondition', 'This order was delivered before problem reports were available. Message the store from the order instead.', {
        reason: 'no-delivery-date',
      });
    }
    if (now - deliveredAtMs > RETURN_WINDOW_MS) {
      throw new HttpsError('failed-precondition', `Problems can be reported up to ${RETURN_WINDOW_DAYS} days after delivery.`, {
        reason: 'window-closed',
      });
    }

    const items = normaliseLines(data.lines, Array.isArray(order.items) ? order.items : []);
    // Items only. Shipping is free today (SHIPPING_FEE in index.js), and
    // when it is not, whether it comes back is a decision for phase 2.
    const refundAmount = round2(items.reduce((sum, item) => sum + item.price * item.quantity, 0));

    const paidOnline = wasPaidOnline(order);
    const payout = paidOnline ? null : normalisePayout(data.payout);

    const returnRequest = {
      orderId,
      customerId: uid,
      customerEmail: order.customerEmail || null,
      // Rules let only this store's manager read and work the request,
      // exactly as with the order it is about.
      storeId: order.storeId || null,
      storeName: order.storeName || '',
      reason: data.reason,
      note,
      photoUrls: photos,
      items,
      refundAmount,
      refundMethod: paidOnline ? 'original' : payout.method,
      paymentMethod: order.paymentMethod || null,
      payout,
      status: 'requested',
      createdAt: FieldValue.serverTimestamp(),
    };
    tx.create(requestRef, returnRequest);
    logger.info(`return requested for order ${orderId}`, { reason: data.reason, refundAmount });
    return { orderId, status: 'requested', refundAmount, refundMethod: returnRequest.refundMethod };
  });
}

exports.requestReturn = onCall({ region: REGION }, (request) => handleRequestReturn(request));

// Stamps the moment an order became 'delivered'. Each time it does: a
// manager who undoes "delivered" and marks it again restarts the window
// from the second time, which is when the customer was actually told.
//
// Writing to the document this trigger watches fires it once more; the
// status has not changed on that pass, so it returns without writing and
// the loop ends there.
async function handleOrderDelivered(before, after, orderRef) {
  if (!before || !after) return false;
  if (after.status !== 'delivered' || before.status === 'delivered') return false;
  await orderRef.update({ deliveredAt: FieldValue.serverTimestamp() });
  return true;
}

exports.recordDeliveryDate = onDocumentUpdated(
  { document: 'users/{userId}/orders/{orderId}', region: REGION, retry: false },
  async (event) => {
    await handleOrderDelivered(
      event.data?.before?.data(),
      event.data?.after?.data(),
      event.data?.after?.ref
    );
  }
);

exports._handleRequestReturn = handleRequestReturn;
exports._handleOrderDelivered = handleOrderDelivered;
exports._isReturnPhotoUrl = isReturnPhotoUrl;
exports.RETURN_WINDOW_DAYS = RETURN_WINDOW_DAYS;
exports.RETURN_REASONS = RETURN_REASONS;
exports.RETURN_REASON_LABELS = RETURN_REASON_LABELS;
