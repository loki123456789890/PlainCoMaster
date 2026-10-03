// constants/returns.js
//
// Reporting a problem with a delivered order — the app's half of what
// functions/returns.js enforces. The server is the authority on every rule
// here; the app keeps a copy only so it can hide a link or a button that
// would be refused anyway.
//
// KEEP IN STEP BY HAND with functions/returns.js: RETURN_WINDOW_DAYS and
// the four reason keys and labels. functions/ is a separate CommonJS
// package and cannot be imported from here (see utils/orderNumber.js for
// the same boundary).

import { doc } from 'firebase/firestore';
import { db } from '../firebaseConfig';

export const RETURN_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const RETURN_PHOTOS_MAX = 3;
export const RETURN_NOTE_MAX = 1000;

// Store-fault reasons only. A change of mind is not one: most of the
// catalogue is one-of-a-kind ukay-ukay, sold as described.
export const RETURN_REASONS = [
  {
    key: 'wrong_item',
    label: 'Wrong item sent',
    hint: 'I got a different piece from the one I ordered.',
    icon: 'swap-horizontal-outline',
    photoHint: 'The piece you got, and anything that shows it isn\'t the one you ordered.',
  },
  {
    key: 'wrong_size',
    label: 'Wrong size sent',
    hint: 'The tag says a different size from the one I ordered.',
    icon: 'resize-outline',
    photoHint: 'Include a clear photo of the size tag.',
  },
  {
    key: 'undisclosed_damage',
    label: 'Damage that was not mentioned',
    hint: 'A stain, tear or flaw the listing didn\'t show.',
    icon: 'bandage-outline',
    photoHint: 'Close-ups of the damage, and one of the whole piece.',
  },
  {
    key: 'not_as_described',
    label: 'Not as described',
    hint: 'The colour, material or condition is far from the listing.',
    icon: 'document-text-outline',
    photoHint: 'Show what is different from the listing photos.',
  },
];

export const reasonLabel = (key) =>
  RETURN_REASONS.find((reason) => reason.key === key)?.label || 'Problem with the order';

export const returnImageFolder = (uid, orderId) => `returns/${uid}/${orderId}`;

// Keyed by the order, under the customer: one report per order, and a get
// of one that does not exist yet is allowed, so "is there one?" is a plain
// read. See users/{uid}/returnRequests in firestore.rules.
export const returnRequestRef = (uid, orderId) => doc(db, 'users', uid, 'returnRequests', orderId);

// When the window closes, from the order's deliveredAt (a Firestore
// Timestamp written by the server). null for an order delivered before
// deliveredAt existed, which cannot be reported — the server says so too.
export function reportDeadline(deliveredAt) {
  const ms = deliveredAt?.toMillis?.();
  return ms ? new Date(ms + RETURN_WINDOW_DAYS * DAY_MS) : null;
}

export function canReportProblem(order, deliveredAt, now = Date.now()) {
  if (!order || order.status !== 'delivered') return false;
  const deadline = reportDeadline(deliveredAt);
  return Boolean(deadline) && now <= deadline.getTime();
}

// An order paid online is refunded to where the money came from; anything
// else (Cash on Delivery) needs the customer to say where to send it.
// Mirrors wasPaidOnline() in functions/returns.js.
export const wasPaidOnline = (order) => order?.paymentMethod !== 'cod' && order?.paymentStatus === 'paid';

export const PAYOUT_METHODS = [
  { key: 'gcash', label: 'GCash' },
  { key: 'bank', label: 'Bank' },
];

// Enough to recognise an account without showing all of it — the same
// rule the emails follow.
export function maskedAccount(payout) {
  if (!payout) return '';
  const digits = String(payout.accountNumber || '').replace(/\s/g, '').slice(-4);
  const where = payout.method === 'bank' ? payout.bankName || 'Bank' : 'GCash';
  return digits ? `${where} ending ${digits}` : where;
}

// How each step reads to the customer. `tone` picks the Badge colour:
// clay while something is still to happen, moss once it went the
// customer's way, ash when it ended without a refund.
export const RETURN_STATUS = {
  requested: { label: 'Under review', tone: 'clay' },
  approved: { label: 'Approved', tone: 'moss' },
  received: { label: 'Item received', tone: 'moss' },
  refunded: { label: 'Refunded', tone: 'moss' },
  declined: { label: 'Not approved', tone: 'ash' },
  withdrawn: { label: 'Withdrawn', tone: 'ash' },
};

export function returnStatusLine(request, storeName) {
  const store = storeName || 'The store';
  switch (request?.status) {
    case 'requested':
      return `${store} is looking at your photos. We'll email you when they decide.`;
    case 'approved':
      return request.resolution === 'return_first'
        ? `Send the item back and ${store} will refund you when it arrives. Message them to arrange it — they pay the shipping.`
        : `${store} will send your refund. You don't need to send anything back.`;
    case 'received':
      return `${store} has the item back and will send your refund next.`;
    case 'refunded':
      return `${store} sent your refund.`;
    case 'declined':
      return `${store} looked at your report and did not approve it.`;
    case 'withdrawn':
      return 'You withdrew this report.';
    default:
      return '';
  }
}
