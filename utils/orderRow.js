// utils/orderRow.js
//
// One order document, shaped the way the customer's screens use it: the
// Orders list, the order card on Home, and OrderDetails, which receives
// this object as its route param. Kept in one place so a card on Home opens
// exactly the same OrderDetails the Orders list does.
import { chatFields } from './orderChat';

// "Jul 15, 2026", and "July 2026" for the month headings — spelled out
// rather than the device locale's format, so they read the same anywhere.
const formatOrderDate = (date) =>
  date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const formatMonth = (date) => (date ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '');

// "pending" and "processing" are one status: orders are created as
// 'pending', and a customer sees that as Processing everywhere.
export const statusKey = (status = '') => {
  const s = status.toLowerCase();
  return s === 'pending' ? 'processing' : s;
};

export function toOrderRow(id, data) {
  const items = data.items || [];
  const firstItem = items[0] || {};
  const created = data.createdAt?.toDate ? data.createdAt.toDate() : null;
  const productIds = data.productIds || [];

  // Single item shows its name; several show the first + "+N more".
  const displayName =
    items.length > 1 ? `${firstItem.name || 'Item'} +${items.length - 1} more` : firstItem.name || 'Order';

  return {
    id,
    displayName,
    date: formatOrderDate(created),
    month: formatMonth(created),
    total: data.total || 0,
    subtotal: data.subtotal || 0,
    shipping: data.shipping || 0,
    status: data.status || 'processing',
    itemCount: items.length,
    items,
    // Carried through to OrderDetailsScreen so it can offer "Write a
    // review" on exactly the lines firestore.rules will accept one
    // for — the review rule tests membership of this same list. An
    // order placed before the field existed maps to [], and its lines
    // get no button rather than a button that fails on submit.
    productIds,
    // The lines "Write a review" on the card can open.
    reviewableItems: items.filter((item) => item.productId && productIds.includes(item.productId)),
    image: firstItem.image || firstItem.imageUrl || null,
    // Which store is shipping it. Absent on orders from before
    // stores existed and not yet migrated, which just show no name.
    storeName: data.storeName || null,
    // Passed on to a review, which must name the store that sold the
    // item — the rules check it against this order.
    storeId: data.storeId || null,
    shippingAddress: data.shippingAddress || null,
    paymentMethod: data.paymentMethod || null,
    paymentStatus: data.paymentStatus || null,
    // For OrderDetails' PayMongo receipt line (getPaymongoReceipt).
    paymentRef: data.paymentRef || null,
    paymentSandbox: data.paymentSandbox === true,
    paymentProvider: data.paymentProvider || null,
    // For the "New message" line on the Orders list and the chat
    // button on OrderDetails — as millis, since Timestamps don't survive
    // navigation params.
    ...chatFields(data),
  };
}
