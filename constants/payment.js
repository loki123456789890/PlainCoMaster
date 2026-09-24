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

import { Colors } from './theme';

// Ordered as the checkout picker renders them.
export const PAYMENT_METHODS = [
  { id: 'gcash', label: 'GCash', icon: 'cash-outline' },
  { id: 'maya', label: 'Maya', icon: 'wallet-outline' },
  { id: 'card', label: 'Card', icon: 'card-outline' },
  { id: 'cod', label: 'Cash on Delivery', icon: 'cube-outline' },
];

// How each method is shown in the list: a colored letter or icon tile and
// a line under its name, on Checkout and the Payment screen.
export const PAYMENT_LOOK = {
  gcash: { tile: '#1E6FEB', letter: 'G', name: 'GCash', line: 'Pay with your GCash wallet' },
  maya: { tile: '#1A1A1A', letter: 'M', name: 'Maya', line: 'Pay with your Maya wallet' },
  card: { tile: Colors.light.secondary, icon: 'card-outline', name: 'Credit / debit card', line: 'Visa, Mastercard' },
  cod: { tile: Colors.light.tint, icon: 'cube-outline', name: 'Cash on Delivery', line: 'Pay the rider when it arrives' },
};

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

// ---------------------------------------------------------------------------
// THE SANDBOX GATEWAY
//
// Selecting GCash/Maya/Card used to store a string and stop there — the
// note above ("nothing is processed and no money moves") described a
// picker, not a payment. It still describes one; what changed is that the
// picker now runs a simulated authorisation that the SERVER decides, so
// the order carries a payment outcome instead of an intention.
//
// NO REAL MONEY MOVES AND NO REAL GATEWAY IS CONTACTED. There is no
// PayMongo account, no card number is collected anywhere in this app, and
// nothing here talks to a network. The claim in HelpScreen's FAQ and on
// Landing — "No Card Info Stored" — stays literally true, which is why
// the sandbox screen asks for a scenario rather than a card.
//
// WHY THE CLIENT CHOOSES THE OUTCOME. It looks like a hole and is not the
// one it resembles. Real sandboxes work this way: Stripe and PayMongo
// both let the caller force a decline by sending a designated test card.
// The outcome is an INPUT to a test gateway, not a claim about money. The
// boundary that matters is elsewhere and is unchanged — the client cannot
// write an order document at all (firestore.rules has no create rule for
// anyone), so it cannot mark itself paid. It asks for a scenario; the
// server decides what that scenario costs it, and a declined one is
// refused before a single write.

// Ordered as the sandbox screen renders them.
//
// LABELLED AS ANSWERS, NOT ACTIONS, and that distinction is the whole
// point of the wording. These were first written as commands — "Approve
// payment", "Decline payment" — which collided head-on with the screen's
// own buttons: "Approve payment" reads exactly like the Pay button, and
// "Decline payment" reads exactly like Cancel. A tester could not tell
// whether picking one BOUGHT the order, refused it, or merely set
// something up, because the same two verbs appeared twice on one screen.
//
// Phrasing each option as what the pretend bank REPLIES removes the
// collision: the list is a setting, the button is the action. `message`
// is what the server hands back on refusal, kept here so the customer
// wording lives with the vocabulary rather than being assembled
// server-side.
export const SANDBOX_SCENARIOS = [
  {
    id: 'approved',
    label: 'Payment succeeds',
    detail: 'The order goes through and is marked Paid.',
    icon: 'checkmark-circle-outline',
    approves: true,
  },
  {
    id: 'declined',
    label: 'Declined by the bank',
    detail: 'See what the app does when a payment is refused.',
    icon: 'close-circle-outline',
    approves: false,
    message: 'Your payment was declined. Try another payment method.',
  },
  {
    id: 'insufficient_funds',
    label: 'Not enough balance',
    detail: 'The wallet or card is short of the amount.',
    icon: 'wallet-outline',
    approves: false,
    message: 'There was not enough balance to cover this order.',
  },
  {
    id: 'timeout',
    label: 'No response at all',
    detail: 'The gateway never answers — the case an app usually gets wrong.',
    icon: 'time-outline',
    approves: false,
    message: 'The payment gateway did not respond. Your order was not placed and you were not charged.',
  },
];

export const SANDBOX_SCENARIO_IDS = SANDBOX_SCENARIOS.map((scenario) => scenario.id);

const SCENARIO_BY_ID = SANDBOX_SCENARIOS.reduce((acc, scenario) => {
  acc[scenario.id] = scenario;
  return acc;
}, {});

export const getSandboxScenario = (id) => SCENARIO_BY_ID[id] || null;

// Whether choosing this method sends the customer through the sandbox at
// all. COD does not: there is nothing to authorise until a rider arrives,
// which is the entire reason it carries the trust it does.
export const requiresOnlinePayment = (method) =>
  PAYMENT_METHODS.some((m) => m.id === method) && !isPayOnDelivery(method);

// What the order document records once placed. Deliberately three values
// and not more — 'unpaid' is COD's resting state and NOT a failure, so the
// two must never share a colour or a label.
//
// 'failed' is still unreachable by design, now with PayMongo too: an
// online checkout that is never paid becomes a released CHECKOUT
// (functions/index.js), and its orders are never written at all. The
// word stays so the screens already know it if that ever changes.
export const PAYMENT_STATUSES = {
  paid: { label: 'Paid', tone: 'success', icon: 'checkmark-circle' },
  unpaid: { label: 'Unpaid', tone: 'neutral', icon: 'cube-outline' },
  failed: { label: 'Payment failed', tone: 'danger', icon: 'alert-circle' },
};

// Orders placed before the sandbox existed carry no paymentStatus. Rather
// than guess, infer from the method that WAS recorded: a COD order was
// always pay-on-delivery, and an online order that predates the sandbox
// was never actually charged — so it reads as unpaid too, which is the
// honest answer and matches what those screens said before this existed.
export const getPaymentStatus = (order) => {
  const stored = order?.paymentStatus;
  if (stored && PAYMENT_STATUSES[stored]) return stored;
  return 'unpaid';
};

// COD's 'unpaid' is a plan, not a debt, and labelling it "Unpaid" reads as
// something gone wrong. Only that one case is reworded — an online order
// sitting at 'unpaid' genuinely is unpaid and should say so.
export const getPaymentStatusLabel = (order) => {
  const status = getPaymentStatus(order);
  if (status === 'unpaid' && isPayOnDelivery(order?.paymentMethod)) return 'Pay on delivery';
  return PAYMENT_STATUSES[status].label;
};

// The line under an online order's payment status: which gateway took it,
// its reference, and — whenever it is true — that no real money moved.
// A Store Manager reads this before packing, so a test payment must never
// look like a real one.
//
// paymentProvider is absent on orders from before PayMongo existed; those
// are all sandbox orders, and paymentSandbox already says so.
export const getPaymentNote = (order) => {
  if (!order || isPayOnDelivery(order.paymentMethod)) return '';
  const ref = order.paymentRef ? ` · ${order.paymentRef}` : '';
  if (order.paymentProvider === 'paymongo') {
    return order.paymentSandbox
      ? `PayMongo test payment${ref} — test mode, no real money moved`
      : `Paid through PayMongo${ref}`;
  }
  if (order.paymentSandbox) return `Sandbox payment${ref} — simulated, no real money moved`;
  return '';
};

// The PayMongo receipt for an order it took: its payment id, and whether
// it went through PayMongo's test mode (livemode false). Null for COD and
// for orders from before PayMongo, which the order screens show only as
// their payment method.
export const getPaymongoReceipt = (order) => {
  if (!order || isPayOnDelivery(order.paymentMethod) || order.paymentProvider !== 'paymongo') return null;
  return { ref: order.paymentRef || null, test: order.paymentSandbox === true };
};

// Which gateway the online methods use, from config/payments — the same
// document placeOrder reads. A missing document, or one this version of the
// app does not recognise, means the sandbox, as it does on the server.
export const GATEWAYS = ['sandbox', 'paymongo'];
export const readGateway = (data) => (GATEWAYS.includes(data?.gateway) ? data.gateway : 'sandbox');

export const getPaymentStatusTone = (order) => PAYMENT_STATUSES[getPaymentStatus(order)].tone;
export const getPaymentStatusIcon = (order) => PAYMENT_STATUSES[getPaymentStatus(order)].icon;
