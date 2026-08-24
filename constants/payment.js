// constants/payment.js
//
// The payment methods PlainCo offers, and how each one is named and
// iconed, in one place.
//
// This vocabulary was written out three separate times — Checkoutscreen's
// picker, OrderDetailsScreen, and AdminOrdersScreen — with comments in two
// of them noting they mirror the others. Identical today, but that is the
// shape of something about to drift: adding a method, renaming one, or
// changing an icon meant finding every copy and hoping. Adding a fourth
// consumer (the order confirmation screen) is what made consolidating
// worth doing rather than deferring again.
//
// UI-ONLY, matching the SRS constraint that payment options are included
// in the UI design and not yet integrated. Selecting one stores a string
// on the order for the Store Manager to read; nothing is processed and no
// money moves. COD sits alongside the SRS-named options because it is the
// dominant method in Philippine e-commerce and fits ukay-ukay's
// inspect-before-you-pay nature — see Checkoutscreen's trust copy.

// Ordered as the checkout picker renders them.
export const PAYMENT_METHODS = [
  { id: 'gcash', label: 'GCash', icon: 'cash-outline' },
  { id: 'maya', label: 'Maya', icon: 'wallet-outline' },
  { id: 'card', label: 'Card', icon: 'card-outline' },
  { id: 'cod', label: 'Cash on Delivery', icon: 'cube-outline' },
];

const BY_ID = PAYMENT_METHODS.reduce((acc, method) => {
  acc[method.id] = method;
  return acc;
}, {});

// Orders placed before paymentMethod existed carry no value at all. Both
// helpers fall back rather than guessing a method that was never chosen —
// "Not specified" is the honest answer for historical data, and it is what
// every screen already said before this file existed.
export const getPaymentLabel = (method) => BY_ID[method]?.label || 'Not specified';
export const getPaymentIcon = (method) => BY_ID[method]?.icon || 'help-circle-outline';

// Whether this method means the customer pays the rider on arrival. The
// difference is worth stating on any screen that reassures someone about a
// transaction, since it is the whole reason COD carries the trust it does.
export const isPayOnDelivery = (method) => method === 'cod';
