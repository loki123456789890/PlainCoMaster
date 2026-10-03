// functions/emails.js
//
// The messages PlainCo sends — the order receipt, order status updates,
// and the support alert — and the Firestore triggers that decide when.
// Everything about HOW they are sent lives in mailer.js.
//
// ALL ARE TRIGGERS, NOT INLINE SENDS, and that is the important choice
// here. placeOrder could have sent the receipt itself, at the end of its
// transaction. It must not: an SMTP timeout would then surface to the
// customer as a failed checkout for an order that was, in fact, placed —
// stock decremented, cart cleared, money owed. Splitting the send into a
// trigger means the worst case is a missing email attached to a perfectly
// good order, which is the failure you want when you have to pick one.
//
// retry is left OFF on all of them. A retried trigger re-runs the whole handler,
// and while claimOnce() in mailer.js would stop a duplicate send, a
// message that failed once because Gmail rejected the recipient will fail
// identically every time. Retries would buy nothing but log noise.

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

const {
  MAIL_SECRETS,
  sendMail,
  releaseForRetry,
  MAX_RETRY_ATTEMPTS,
  storeInbox,
  shell,
  escapeHtml,
  peso,
  formatOrderNumber,
  SANS,
  INK,
  LINE,
  ASH,
  CLAY,
  GOLD,
} = require('./mailer');
const { RETURN_REASON_LABELS, RETURN_WINDOW_DAYS } = require('./returns');

// Mirrors constants/payment.js in the app package, which functions/ cannot
// import across the ESM/CommonJS boundary. getPaymentLabel there falls back
// to "Not specified" for orders written before paymentMethod existed, and
// so does this.
const PAYMENT_LABELS = {
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Card',
  cod: 'Cash on Delivery',
};
const paymentLabel = (method) => PAYMENT_LABELS[method] || 'Not specified';
const isPayOnDelivery = (method) => method === 'cod';

function itemRows(items) {
  return items
    .map((item) => {
      // size and colour are optional per product, so the variant line is
      // dropped rather than rendered as an empty dash pair.
      const variant = [item.size, item.color].filter(Boolean).join(' · ');
      return `<tr>
  <td style="padding:12px 0;border-bottom:1px solid ${LINE};font:400 14px/1.45 ${SANS};color:${INK};">
    ${escapeHtml(item.name)}
    ${variant ? `<div style="font:400 12px/1.4 ${SANS};color:${ASH};padding-top:2px;">${escapeHtml(variant)}</div>` : ''}
    <div style="font:400 12px/1.4 ${SANS};color:${ASH};padding-top:2px;">Qty ${Number(item.quantity || 0)}</div>
  </td>
  <td align="right" style="padding:12px 0;border-bottom:1px solid ${LINE};font:500 14px/1.45 ${SANS};color:${INK};white-space:nowrap;vertical-align:top;">
    ${escapeHtml(peso(Number(item.price || 0) * Number(item.quantity || 0)))}
  </td>
</tr>`;
    })
    .join('');
}

function summaryRow(label, value, emphasis) {
  return `<tr>
  <td style="padding:6px 0;font:${emphasis ? '600' : '400'} ${emphasis ? '15px' : '14px'}/1.45 ${SANS};color:${emphasis ? INK : ASH};">${escapeHtml(label)}</td>
  <td align="right" style="padding:6px 0;font:${emphasis ? '700' : '400'} ${emphasis ? '15px' : '14px'}/1.45 ${SANS};color:${emphasis ? GOLD : INK};white-space:nowrap;">${escapeHtml(value)}</td>
</tr>`;
}

function orderHtml(order, orderId) {
  const items = Array.isArray(order.items) ? order.items : [];
  const address = order.shippingAddress || {};
  const payOnDelivery = isPayOnDelivery(order.paymentMethod);
  const shipping = Number(order.shipping || 0);

  const addressLines = [
    address.fullName,
    address.phone,
    address.address,
    [address.city, address.province].filter(Boolean).join(', '),
    address.zipCode,
  ]
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join('<br>');

  const body = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;padding:16px;margin-bottom:20px;">
  <tr><td style="font:600 11px/1.4 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${ASH};padding-bottom:4px;">Your order number</td></tr>
  <tr><td style="font:700 22px/1.2 ${SANS};color:${CLAY};">${escapeHtml(formatOrderNumber(orderId))}</td></tr>
  ${order.storeName
    ? `<tr><td style="font:400 13px/1.5 ${SANS};color:${INK};padding-top:2px;">from ${escapeHtml(order.storeName)}</td></tr>`
    : ''}
  <tr><td style="font:400 13px/1.5 ${SANS};color:${ASH};padding-top:6px;">Keep this if you need to ask us about the order.</td></tr>
</table>

<p style="margin:0 0 4px 0;font:600 11px/1.4 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${ASH};">What you ordered</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows(items)}</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:12px;">
  ${summaryRow('Subtotal', peso(order.subtotal))}
  ${summaryRow('Shipping', shipping === 0 ? 'Free' : peso(shipping))}
  ${summaryRow(payOnDelivery ? 'To pay on delivery' : 'Total', peso(order.total), true)}
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid ${LINE};padding-top:16px;">
  <tr>
    <td width="50%" style="vertical-align:top;padding-right:8px;">
      <p style="margin:0 0 4px 0;font:600 11px/1.4 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${ASH};">Delivering to</p>
      <p style="margin:0;font:400 13px/1.55 ${SANS};color:${INK};">${addressLines || '—'}</p>
    </td>
    <td width="50%" style="vertical-align:top;padding-left:8px;">
      <p style="margin:0 0 4px 0;font:600 11px/1.4 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${ASH};">Payment</p>
      <p style="margin:0;font:400 13px/1.55 ${SANS};color:${INK};">${escapeHtml(paymentLabel(order.paymentMethod))}</p>
    </td>
  </tr>
</table>

<p style="margin:20px 0 0 0;font:400 13px/1.6 ${SANS};color:${ASH};">
  We pack your order and hand it to a courier.
  ${payOnDelivery
    ? 'You pay the rider when it arrives — nothing is charged now.'
    : 'You can follow the order status under My Orders.'}
</p>`;

  return shell({
    preheader: `Order ${formatOrderNumber(orderId)} — we are getting it ready.`,
    heading: 'Order placed',
    intro: 'Thanks — we are getting it ready for you.',
    body,
  });
}

// The plain-text alternative, which is not a formality: some clients show
// it by choice, some show it because the HTML failed, and a receipt that
// degrades to nothing is worse than one that degrades to a list.
function orderText(order, orderId) {
  const items = Array.isArray(order.items) ? order.items : [];
  const address = order.shippingAddress || {};
  const payOnDelivery = isPayOnDelivery(order.paymentMethod);
  const shipping = Number(order.shipping || 0);

  const lines = [
    'PlainCo — order placed',
    '',
    `Order number: ${formatOrderNumber(orderId)}`,
    // One receipt per order, and a multi-store cart is several orders, so
    // each receipt says which store it is for.
    ...(order.storeName ? [`Sold by: ${order.storeName}`] : []),
    'Keep this if you need to ask us about the order.',
    '',
    'What you ordered:',
  ];

  for (const item of items) {
    const variant = [item.size, item.color].filter(Boolean).join(' / ');
    lines.push(
      `  ${item.name}${variant ? ` (${variant})` : ''} x${item.quantity} — ${peso(
        Number(item.price || 0) * Number(item.quantity || 0)
      )}`
    );
  }

  lines.push(
    '',
    `Subtotal: ${peso(order.subtotal)}`,
    `Shipping: ${shipping === 0 ? 'Free' : peso(shipping)}`,
    `${payOnDelivery ? 'To pay on delivery' : 'Total'}: ${peso(order.total)}`,
    '',
    `Payment: ${paymentLabel(order.paymentMethod)}`,
    '',
    'Delivering to:',
    `  ${[address.fullName, address.phone].filter(Boolean).join(' · ')}`,
    `  ${address.address || ''}`,
    `  ${[address.city, address.province, address.zipCode].filter(Boolean).join(', ')}`,
    '',
    payOnDelivery
      ? 'We pack your order and hand it to a courier. You pay the rider when it arrives — nothing is charged now.'
      : 'We pack your order and hand it to a courier. You can follow the order status under My Orders.'
  );

  return lines.join('\n');
}

// REGION IS NOT OPTIONAL HERE, unlike on a callable. A v2 Firestore
// trigger must be deployed in the same region as the database it listens
// to; anywhere else and the deploy is rejected. PlainCo's Firestore lives
// in asia-southeast1, so both triggers below are pinned there and so is
// placeOrder, which now shares it rather than paying a Pacific round trip
// on every read.
const REGION = 'asia-southeast1';

function supportHtml(request, requestId) {
  const customerEmail = request.userEmail || null;
  const body = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;padding:16px;">
  <tr><td style="font:400 14px/1.6 ${SANS};color:${INK};white-space:pre-wrap;">${escapeHtml(request.message)}</td></tr>
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
  ${summaryRow('From', customerEmail || 'No email on the account')}
  ${summaryRow('Account', request.userId || '—')}
  ${summaryRow('Request', formatOrderNumber(requestId))}
</table>

<p style="margin:20px 0 0 0;font:400 13px/1.6 ${SANS};color:${ASH};">
  ${customerEmail
    ? 'Reply to this email to answer the customer directly.'
    : 'This account has no email address, so a reply has to go through the app.'}
  Help tells them to expect an answer within 24 hours.
</p>`;

  return shell({
    preheader: String(request.message || '').slice(0, 140),
    heading: 'New support request',
    intro: 'Someone asked for help in the app.',
    body,
  });
}

function supportText(request, requestId) {
  return [
    'New PlainCo support request',
    '',
    request.message || '',
    '',
    `From: ${request.userEmail || 'No email on the account'}`,
    `Account: ${request.userId || '—'}`,
    `Request: ${formatOrderNumber(requestId)}`,
    '',
    'Help tells them to expect an answer within 24 hours.',
  ].join('\n');
}

// ---------------------------------------------------------------------
// Order status updates
// ---------------------------------------------------------------------
//
// Without these, a customer learns their order shipped only by opening
// My Orders. Three statuses earn an email and two do not: 'pending' is
// the receipt above, and 'processing' is the store packing — real, but
// not news worth an inbox, and a fourth email per order starts to read
// as noise.
//
// Copy is per status; the order card and item list are shared. Every
// claim below is one the app already makes somewhere: delivery times
// and the 24-hour damage window come from HelpScreen, and "refunds are
// not sent automatically" is what AdminOrdersScreen tells the manager
// when they cancel a paid order.

// The same test AdminOrdersScreen uses before warning about a refund. An
// order with no paymentStatus predates the sandbox and was never charged.
const paidOnline = (order) => order.paymentStatus === 'paid' && !isPayOnDelivery(order.paymentMethod);

const STATUS_EMAILS = {
  shipped: {
    subject: (number) => `Your PlainCo order ${number} is on its way`,
    heading: 'On its way',
    intro: (store) => `${store} has handed your order to the courier.`,
    closing: (order) => [
      'Metro Manila deliveries take 1–3 business days, provincial ones 3–7.',
      isPayOnDelivery(order.paymentMethod)
        ? 'You pay the rider when it arrives, so have the amount above ready.'
        : 'You can follow it under My Orders.',
    ],
  },
  delivered: {
    subject: (number) => `Your PlainCo order ${number} was delivered`,
    heading: 'Delivered',
    intro: () => 'It has arrived. We hope you love it.',
    closing: () => [
      'You can review each item from the order in My Orders.',
      `If the wrong item or size came, or it is damaged or not as described, report it from the order in My Orders within ${RETURN_WINDOW_DAYS} days.`,
    ],
  },
  cancelled: {
    subject: (number) => `Your PlainCo order ${number} was cancelled`,
    heading: 'Order cancelled',
    intro: (store) => `${store} cancelled this order.`,
    closing: (order) => [
      paidOnline(order)
        ? 'You paid online, and refunds are not sent automatically. Message the store from this order in My Orders to arrange yours.'
        : 'Nothing was charged, so there is nothing more you need to do.',
    ],
  },
};

// "To pay on delivery" only while there is still a payment coming. Once a
// COD order is delivered the rider has the money, and once it is cancelled
// nobody is owed anything.
const totalLabel = (order, status) =>
  status === 'shipped' && isPayOnDelivery(order.paymentMethod) ? 'To pay on delivery' : 'Total';

const sendsStatusEmail = (status) => Object.prototype.hasOwnProperty.call(STATUS_EMAILS, status);

function statusHtml(order, orderId, status) {
  const copy = STATUS_EMAILS[status];
  const items = Array.isArray(order.items) ? order.items : [];
  const number = formatOrderNumber(orderId);

  const body = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;padding:16px;margin-bottom:20px;">
  <tr><td style="font:600 11px/1.4 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${ASH};padding-bottom:4px;">Order number</td></tr>
  <tr><td style="font:700 22px/1.2 ${SANS};color:${CLAY};">${escapeHtml(number)}</td></tr>
  ${order.storeName
    ? `<tr><td style="font:400 13px/1.5 ${SANS};color:${INK};padding-top:2px;">from ${escapeHtml(order.storeName)}</td></tr>`
    : ''}
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows(items)}</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:12px;">
  ${summaryRow(totalLabel(order, status), peso(order.total), true)}
</table>

${copy.closing(order)
    .map((line) => `<p style="margin:16px 0 0 0;font:400 13px/1.6 ${SANS};color:${ASH};">${escapeHtml(line)}</p>`)
    .join('\n')}`;

  return shell({
    preheader: `Order ${number} — ${copy.heading.toLowerCase()}.`,
    heading: copy.heading,
    intro: copy.intro(order.storeName || 'The store'),
    body,
  });
}

function statusText(order, orderId, status) {
  const copy = STATUS_EMAILS[status];
  const items = Array.isArray(order.items) ? order.items : [];

  const lines = [
    `PlainCo — ${copy.heading.toLowerCase()}`,
    '',
    copy.intro(order.storeName || 'The store'),
    '',
    `Order number: ${formatOrderNumber(orderId)}`,
    ...(order.storeName ? [`Sold by: ${order.storeName}`] : []),
    '',
  ];

  for (const item of items) {
    const variant = [item.size, item.color].filter(Boolean).join(' / ');
    lines.push(`  ${item.name}${variant ? ` (${variant})` : ''} x${item.quantity}`);
  }

  lines.push(
    '',
    `${totalLabel(order, status)}: ${peso(order.total)}`,
    '',
    ...copy.closing(order)
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------
// Reported problems (returns and refunds)
// ---------------------------------------------------------------------
//
// Two audiences. The store hears once, when the problem is reported, at
// the same inbox support alerts go to, with Reply-To set to the customer.
// The customer hears at every step the store takes, so a decision never
// waits on them opening the app. Withdrawing sends nothing: the customer
// did it, and already knows.
//
// NO ACCOUNT NUMBER GOES IN ANY EMAIL. The manager needs the customer's
// GCash or bank number only at the moment of paying, and reads it in the
// app; an inbox is a worse place to keep it. Both sides see the last four
// digits, which is enough to recognise the account.

const reasonLabel = (reason) => RETURN_REASON_LABELS[reason] || 'Problem with the order';

// Copied from the order by requestReturn, so it carries the same
// 'unknown' marker placeOrder writes when it found no address.
const customerAddress = (request) =>
  request.customerEmail && request.customerEmail !== 'unknown' ? request.customerEmail : null;

function refundDestination(request) {
  if (request.refundMethod === 'original') return `Back to ${paymentLabel(request.paymentMethod)}`;
  const payout = request.payout || {};
  const where = request.refundMethod === 'bank' ? payout.bankName || 'Bank account' : 'GCash';
  const digits = String(payout.accountNumber || '').replace(/\s/g, '').slice(-4);
  return digits ? `${where} ending ${digits}` : where;
}

// Copy per status. Each part takes the request, because "approved" reads
// differently when the item has to go back first.
const RETURN_EMAILS = {
  requested: {
    subject: (number) => `We got your report about order ${number}`,
    heading: () => 'Report received',
    intro: (store) => `${store} will look at your photos and decide what happens next.`,
    closing: () => ['We will email you when they do. You can also follow it from the order in My Orders.'],
  },
  approved: {
    subject: (number) => `Your report about order ${number} was approved`,
    heading: (request) => (request.resolution === 'return_first' ? 'Return approved' : 'Refund approved'),
    intro: (store, request) =>
      request.resolution === 'return_first'
        ? `${store} agreed. Send the item back and they will refund you when it arrives.`
        : `${store} agreed and will refund you. You do not need to send anything back.`,
    closing: (request) =>
      request.resolution === 'return_first'
        ? ['Message the store from the order in My Orders to arrange sending it back. The store pays for the shipping.']
        : ['We will email you again when the refund is sent.'],
  },
  received: {
    subject: (number) => `Your return for order ${number} arrived`,
    heading: () => 'Return received',
    intro: (store) => `${store} has the item back and will send your refund next.`,
    closing: () => ['We will email you again when the refund is sent.'],
  },
  refunded: {
    subject: (number) => `Your refund for order ${number} was sent`,
    heading: () => 'Refund sent',
    intro: (store) => `${store} sent your refund.`,
    closing: () => [
      'If it has not arrived in a few days, message the store from the order in My Orders and quote the reference above.',
    ],
  },
  declined: {
    subject: (number) => `Your report about order ${number} was not approved`,
    heading: () => 'Report not approved',
    intro: (store) => `${store} looked at your report and did not approve it.`,
    closing: () => ['If you think this is a mistake, message the store from the order in My Orders.'],
  },
};

const sendsReturnEmail = (status) => Object.prototype.hasOwnProperty.call(RETURN_EMAILS, status);

const LABEL = `margin:0 0 4px 0;font:600 11px/1.4 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${ASH};`;

function orderCard(orderId, storeName) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;padding:16px;margin-bottom:20px;">
  <tr><td style="font:600 11px/1.4 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${ASH};padding-bottom:4px;">Order number</td></tr>
  <tr><td style="font:700 22px/1.2 ${SANS};color:${CLAY};">${escapeHtml(formatOrderNumber(orderId))}</td></tr>
  ${storeName
    ? `<tr><td style="font:400 13px/1.5 ${SANS};color:${INK};padding-top:2px;">from ${escapeHtml(storeName)}</td></tr>`
    : ''}
</table>`;
}

function quoteBox(label, text) {
  return `
<p style="${LABEL}">${escapeHtml(label)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;padding:16px;margin-bottom:20px;">
  <tr><td style="font:400 14px/1.6 ${SANS};color:${INK};white-space:pre-wrap;">${escapeHtml(text)}</td></tr>
</table>`;
}

const paragraphs = (lines) =>
  lines
    .map((line) => `<p style="margin:16px 0 0 0;font:400 13px/1.6 ${SANS};color:${ASH};">${escapeHtml(line)}</p>`)
    .join('\n');

// The rows under the item list: what is owed and where it goes, plus the
// reference once it has been paid. A declined request owes nothing, so it
// shows none of them.
function refundRows(request, status) {
  if (status === 'declined') return [];
  const rows = [
    [status === 'refunded' ? 'Refunded' : 'Refund', peso(request.refundAmount), true],
    ['Refund to', refundDestination(request)],
  ];
  if (status === 'refunded' && request.refundReference) rows.push(['Reference', request.refundReference]);
  return rows;
}

function returnUpdateHtml(request, orderId, status) {
  const copy = RETURN_EMAILS[status];
  const store = request.storeName || 'The store';
  const items = Array.isArray(request.items) ? request.items : [];

  const body = `${orderCard(orderId, request.storeName)}
${status === 'declined' && request.declineReason ? quoteBox('Their reason', request.declineReason) : ''}
<p style="${LABEL}">You reported: ${escapeHtml(reasonLabel(request.reason))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows(items)}</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:12px;">
  ${refundRows(request, status).map(([label, value, emphasis]) => summaryRow(label, value, emphasis)).join('\n')}
</table>

${paragraphs(copy.closing(request))}`;

  return shell({
    preheader: `Order ${formatOrderNumber(orderId)} — ${copy.heading(request).toLowerCase()}.`,
    heading: copy.heading(request),
    intro: copy.intro(store, request),
    body,
  });
}

function returnUpdateText(request, orderId, status) {
  const copy = RETURN_EMAILS[status];
  const store = request.storeName || 'The store';
  const items = Array.isArray(request.items) ? request.items : [];

  const lines = [
    `PlainCo — ${copy.heading(request).toLowerCase()}`,
    '',
    copy.intro(store, request),
    '',
    `Order number: ${formatOrderNumber(orderId)}`,
    ...(request.storeName ? [`Sold by: ${request.storeName}`] : []),
    '',
  ];
  if (status === 'declined' && request.declineReason) {
    lines.push('Their reason:', request.declineReason, '');
  }
  lines.push(`You reported: ${reasonLabel(request.reason)}`);
  for (const item of items) {
    const variant = [item.size, item.color].filter(Boolean).join(' / ');
    lines.push(`  ${item.name}${variant ? ` (${variant})` : ''} x${item.quantity}`);
  }
  const rows = refundRows(request, status);
  if (rows.length > 0) {
    lines.push('', ...rows.map(([label, value]) => `${label}: ${value}`));
  }
  lines.push('', ...copy.closing(request));
  return lines.join('\n');
}

function returnAlertHtml(request, orderId) {
  const items = Array.isArray(request.items) ? request.items : [];
  const photos = Array.isArray(request.photoUrls) ? request.photoUrls.length : 0;
  const customerEmail = customerAddress(request);

  const body = `${orderCard(orderId, request.storeName)}
${request.note ? quoteBox('What they said', request.note) : ''}
<p style="${LABEL}">Items</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows(items)}</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:12px;">
  ${summaryRow('Refund if approved', peso(request.refundAmount), true)}
  ${summaryRow('Refund to', refundDestination(request))}
  ${summaryRow('Photos', `${photos} in the app`)}
  ${summaryRow('From', customerEmail || 'No email on the account')}
</table>

${paragraphs([
    'Open the report in the app to see the photos, then approve or decline it.',
    customerEmail
      ? 'Reply to this email to answer the customer directly.'
      : 'This account has no email address, so a reply has to go through the order chat.',
  ])}`;

  return shell({
    preheader: `${reasonLabel(request.reason)} — order ${formatOrderNumber(orderId)}.`,
    heading: 'Problem reported',
    intro: `A customer reported: ${reasonLabel(request.reason)}.`,
    body,
  });
}

function returnAlertText(request, orderId) {
  const items = Array.isArray(request.items) ? request.items : [];
  const photos = Array.isArray(request.photoUrls) ? request.photoUrls.length : 0;
  const lines = [
    'PlainCo — problem reported',
    '',
    `A customer reported: ${reasonLabel(request.reason)}.`,
    '',
    `Order number: ${formatOrderNumber(orderId)}`,
    ...(request.storeName ? [`Sold by: ${request.storeName}`] : []),
    '',
  ];
  if (request.note) lines.push('What they said:', request.note, '');
  lines.push('Items:');
  for (const item of items) {
    const variant = [item.size, item.color].filter(Boolean).join(' / ');
    lines.push(`  ${item.name}${variant ? ` (${variant})` : ''} x${item.quantity}`);
  }
  lines.push(
    '',
    `Refund if approved: ${peso(request.refundAmount)}`,
    `Refund to: ${refundDestination(request)}`,
    `Photos: ${photos} in the app`,
    `From: ${customerAddress(request) || 'No email on the account'}`,
    '',
    'Open the report in the app to see the photos, then approve or decline it.'
  );
  return lines.join('\n');
}

// Exported for scripts/preview-email.mjs, which renders every template to
// disk so they can be opened in a browser and eyeballed without deploying
// or sending anything. index.js re-exports only the triggers, so these
// stay invisible to the Firebase CLI's function discovery.
exports._renderOrderHtml = orderHtml;
exports._renderOrderText = orderText;
exports._renderSupportHtml = supportHtml;
exports._renderSupportText = supportText;
exports._renderStatusHtml = statusHtml;
exports._renderStatusText = statusText;
exports._renderReturnUpdateHtml = returnUpdateHtml;
exports._renderReturnUpdateText = returnUpdateText;
exports._renderReturnAlertHtml = returnAlertHtml;
exports._renderReturnAlertText = returnAlertText;

// The handlers are named functions rather than inline closures so
// scripts/test-email.mjs can call them with a plain object instead of
// constructing a CloudEvent. What they decide — which address to use,
// whether there is one at all, what goes in Reply-To — is ordinary logic
// that should not require a Cloud Functions harness to exercise.
async function handleOrderCreated(order, orderId) {
  if (!order) return;

  // placeOrder writes the literal 'unknown' when it can find no address
  // for the account — from the auth token, then the user document. There
  // is nowhere to send in that case, and "unknown" is not an address, so
  // it is filtered here rather than handed to Gmail to reject.
  const to = order.customerEmail && order.customerEmail !== 'unknown'
    ? order.customerEmail
    : null;
  if (!to) {
    logger.warn(`order ${orderId} has no usable customerEmail, no receipt sent`);
    return;
  }

  await sendMail({
    key: `order-${orderId}`,
    to,
    subject: `Your PlainCo order ${formatOrderNumber(orderId)}`,
    html: orderHtml(order, orderId),
    text: orderText(order, orderId),
    // storeId decides who may read this entry and press Send again — the
    // store's own manager (firestore.rules, handleRetryMail).
    meta: {
      kind: 'orderConfirmation', orderId, customerId: order.customerId || null,
      storeId: order.storeId || null,
    },
  });
}

async function handleSupportCreated(request, requestId) {
  if (!request) return;

  // HelpScreen writes auth.currentUser?.email, which can legitimately be
  // null for a provider that supplied none — the rules allow that
  // explicitly. Without it there is nobody to reply to, so the manager
  // is told so rather than being left to wonder.
  const customerEmail = request.userEmail || null;

  await sendMail({
    key: `support-${requestId}`,
    to: storeInbox(),
    // Reply goes to the customer, not to the store's own inbox, so
    // answering is one tap. Omitted when there is no address to use.
    replyTo: customerEmail || undefined,
    subject: `Support request from ${customerEmail || 'a PlainCo customer'}`,
    html: supportHtml(request, requestId),
    text: supportText(request, requestId),
    // Same routing as the request itself: its store, or null for a
    // general question, which the Platform Admin handles.
    meta: {
      kind: 'supportRequest', requestId, userId: request.userId || null,
      storeId: request.storeId || null,
    },
  });
}

// Sends the email for one status. Split from the trigger handler below so
// retryMail can rebuild a failed update from the order alone.
//
// ONE KEY PER ORDER AND STATUS, so each update goes out at most once.
// That is what keeps Undo quiet: a manager who marks an order shipped,
// undoes it and marks it shipped again produces one email, not two. The
// cost is the other half of the same fact — the first email has already
// gone by the time Undo is tapped, and nothing calls it back.
async function sendStatusUpdate(order, orderId, status) {
  if (!order || !sendsStatusEmail(status)) return;

  // Same filter as the receipt: 'unknown' is placeOrder's marker for "no
  // address found", not an address.
  const to = order.customerEmail && order.customerEmail !== 'unknown'
    ? order.customerEmail
    : null;
  if (!to) {
    logger.warn(`order ${orderId} has no usable customerEmail, no ${status} update sent`);
    return;
  }

  await sendMail({
    key: `status-${orderId}-${status}`,
    to,
    subject: STATUS_EMAILS[status].subject(formatOrderNumber(orderId)),
    html: statusHtml(order, orderId, status),
    text: statusText(order, orderId, status),
    // orderStatus, never `status`: that field on a mailLog entry is the
    // email's own state (sending, sent, failed), and a meta field of the
    // same name would be overwritten by it.
    meta: {
      kind: 'orderStatus', orderId, orderStatus: status, customerId: order.customerId || null,
      storeId: order.storeId || null,
    },
  });
}

// The order document changes for more than its status — order chat
// stamps read markers and the last message on it, and the PayMongo
// webhook writes paymentStatus. Only a change to status itself is an
// update the customer is told about.
async function handleOrderUpdated(before, after, orderId) {
  if (!before || !after) return;
  const previous = before.status || 'pending';
  const current = after.status || 'pending';
  if (previous === current) return;
  await sendStatusUpdate(after, orderId, current);
}

// The store's alert about a new report. Out of date once the store has
// acted on it, which retryMail checks before resending.
async function sendReturnAlert(request, orderId) {
  const customerEmail = customerAddress(request);
  await sendMail({
    key: `return-${orderId}-store`,
    to: storeInbox(),
    replyTo: customerEmail || undefined,
    subject: `Problem reported: order ${formatOrderNumber(orderId)} — ${reasonLabel(request.reason)}`,
    html: returnAlertHtml(request, orderId),
    text: returnAlertText(request, orderId),
    meta: {
      kind: 'returnAlert', orderId, customerId: request.customerId || null,
      storeId: request.storeId || null,
    },
  });
}

// The customer's email for one step. One key per report and status, the
// same arrangement as order status updates, so each goes out at most once.
async function sendReturnUpdate(request, orderId, status) {
  if (!request || !sendsReturnEmail(status)) return;
  const to = customerAddress(request);
  if (!to) {
    logger.warn(`return ${orderId} has no usable customerEmail, no ${status} update sent`);
    return;
  }
  await sendMail({
    key: `return-${orderId}-${status}`,
    to,
    subject: RETURN_EMAILS[status].subject(formatOrderNumber(orderId)),
    html: returnUpdateHtml(request, orderId, status),
    text: returnUpdateText(request, orderId, status),
    // returnStatus, never `status`, for the reason orderStatus is named
    // as it is above.
    meta: {
      kind: 'returnUpdate', orderId, returnStatus: status, customerId: request.customerId || null,
      storeId: request.storeId || null,
    },
  });
}

async function handleReturnCreated(request, orderId) {
  if (!request) return;
  await sendReturnAlert(request, orderId);
  await sendReturnUpdate(request, orderId, 'requested');
}

async function handleReturnUpdated(before, after, orderId) {
  if (!before || !after) return;
  if ((before.status || '') === (after.status || '')) return;
  await sendReturnUpdate(after, orderId, after.status);
}

exports._handleOrderCreated = handleOrderCreated;
exports._handleSupportCreated = handleSupportCreated;
exports._handleOrderUpdated = handleOrderUpdated;
exports._handleReturnCreated = handleReturnCreated;
exports._handleReturnUpdated = handleReturnUpdated;

exports.sendOrderConfirmation = onDocumentCreated(
  {
    document: 'users/{userId}/orders/{orderId}',
    region: REGION,
    secrets: MAIL_SECRETS,
    retry: false,
  },
  async (event) => {
    await handleOrderCreated(event.data?.data(), event.params.orderId);
  }
);

exports.sendOrderStatusUpdate = onDocumentUpdated(
  {
    document: 'users/{userId}/orders/{orderId}',
    region: REGION,
    secrets: MAIL_SECRETS,
    retry: false,
  },
  async (event) => {
    await handleOrderUpdated(
      event.data?.before?.data(),
      event.data?.after?.data(),
      event.params.orderId
    );
  }
);

exports.notifySupportRequest = onDocumentCreated(
  {
    document: 'supportRequests/{requestId}',
    region: REGION,
    secrets: MAIL_SECRETS,
    retry: false,
  },
  async (event) => {
    await handleSupportCreated(event.data?.data(), event.params.requestId);
  }
);

exports.notifyReturnRequest = onDocumentCreated(
  {
    document: 'users/{userId}/returnRequests/{orderId}',
    region: REGION,
    secrets: MAIL_SECRETS,
    retry: false,
  },
  async (event) => {
    await handleReturnCreated(event.data?.data(), event.params.orderId);
  }
);

exports.sendReturnRequestUpdate = onDocumentUpdated(
  {
    document: 'users/{userId}/returnRequests/{orderId}',
    region: REGION,
    secrets: MAIL_SECRETS,
    retry: false,
  },
  async (event) => {
    await handleReturnUpdated(
      event.data?.before?.data(),
      event.data?.after?.data(),
      event.params.orderId
    );
  }
);

// ---------------------------------------------------------------------
// Resending a message that did not go out
// ---------------------------------------------------------------------
//
// WHY THIS TAKES A LOG ENTRY ID AND NEVER AN ADDRESS, WHICH IS THE WHOLE
// SECURITY ARGUMENT: the obvious shape for this function would accept a
// recipient and a body, and that shape is an open relay wearing a Firebase
// badge. Anyone who could call it could send mail from the store's own
// authenticated Gmail account to anywhere, with the store's name on the
// From line.
//
// So the caller supplies one thing — WHICH logged message to try again —
// and every other input is re-derived here from the source document that
// produced it in the first place. The recipient, the subject and the body
// all come back out of the order or the support request. There is no
// argument that changes where the mail goes, which means there is nothing
// to point at a stranger. The seller check below limits who may press the
// button; this limits what pressing it can possibly do, which is the
// stronger of the two.
//
// The second consequence of re-deriving is correctness rather than
// safety: the retried message is rendered by the same handler the trigger
// uses, so it cannot drift from what the trigger would have sent. Storing
// the rendered body in mailLog and replaying it would have been simpler
// and would have frozen a copy of every template in the database.

// reason -> [HttpsError code, message the Store Manager reads]. Kept as
// data next to the callable rather than thrown from mailer.js, so that
// file stays free of HTTP concepts and remains testable without a harness.
const RETRY_REFUSALS = {
  'not-found': ['not-found', 'That email is no longer in the delivery log.'],
  'already-sent': [
    'failed-precondition',
    'That email already went out. It will not be sent a second time.',
  ],
  'in-flight': ['failed-precondition', 'That email is being sent right now. Give it a moment.'],
  exhausted: [
    'resource-exhausted',
    `That email has already been retried ${MAX_RETRY_ATTEMPTS} times. Something about it is not going to fix itself — check the reason on the entry.`,
  ],
};

// Finds the document a logged message was rendered from and returns a
// function that re-runs the original handler over it.
//
// Runs BEFORE the entry is released, so an entry that can never be sent
// again — a deleted order, an order with no address — refuses without
// consuming one of its three attempts. Burning a retry on something
// permanently unfixable would just be a slower way to reach 'exhausted'.
async function resendAction(db, key, entry) {
  // kind comes from the meta every send writes. Falling back to the key
  // prefix covers entries written before kind existed; the key format is
  // set in one place each, just above.
  const kind =
    entry.kind ||
    (key.startsWith('order-') ? 'orderConfirmation' : null) ||
    (key.startsWith('support-') ? 'supportRequest' : null);

  if (kind === 'orderConfirmation') {
    const orderId = entry.orderId || key.slice('order-'.length);
    // Orders live under the customer, so the id alone does not locate one.
    const customerId = entry.customerId;
    if (!customerId) {
      throw new HttpsError(
        'failed-precondition',
        'This entry does not record which customer the order belongs to, so it cannot be rebuilt.'
      );
    }

    const snapshot = await db.doc(`users/${customerId}/orders/${orderId}`).get();
    if (!snapshot.exists) {
      throw new HttpsError('failed-precondition', 'That order no longer exists.');
    }

    // The same test handleOrderCreated applies. Checked here too so a
    // receipt with nowhere to go is refused out loud, rather than being
    // released and then silently dropped — which would leave the entry
    // sitting at 'retrying' with no explanation of why nothing happened.
    const order = snapshot.data();
    if (!order.customerEmail || order.customerEmail === 'unknown') {
      throw new HttpsError(
        'failed-precondition',
        'That order has no email address on it, so there is nowhere to send the receipt.'
      );
    }

    return () => handleOrderCreated(order, orderId);
  }

  if (kind === 'orderStatus') {
    const { orderId, customerId, orderStatus: status } = entry;
    if (!orderId || !customerId || !sendsStatusEmail(status)) {
      throw new HttpsError(
        'failed-precondition',
        'This entry does not record which order update it was, so it cannot be rebuilt.'
      );
    }

    const snapshot = await db.doc(`users/${customerId}/orders/${orderId}`).get();
    if (!snapshot.exists) {
      throw new HttpsError('failed-precondition', 'That order no longer exists.');
    }

    const order = snapshot.data();
    if (!order.customerEmail || order.customerEmail === 'unknown') {
      throw new HttpsError(
        'failed-precondition',
        'That order has no email address on it, so there is nowhere to send the update.'
      );
    }
    // A "shipped" email for an order that has since been delivered would
    // tell the customer something that is no longer true. The newer
    // status sent its own email; this one is simply out of date.
    if ((order.status || 'pending') !== status) {
      throw new HttpsError(
        'failed-precondition',
        'That order has changed status since, so this update is out of date and will not be sent.'
      );
    }

    return () => sendStatusUpdate(order, orderId, status);
  }

  if (kind === 'supportRequest') {
    const requestId = entry.requestId || key.slice('support-'.length);
    const snapshot = await db.doc(`supportRequests/${requestId}`).get();
    if (!snapshot.exists) {
      throw new HttpsError('failed-precondition', 'That support request has been deleted.');
    }
    return () => handleSupportCreated(snapshot.data(), requestId);
  }

  // Both rebuilt from the report as it is NOW, and refused once it has
  // moved on: an alert asking the store to decide on a report it already
  // decided, or "approved" after it was refunded, would be out of date in
  // the same way a stale order update is.
  if (kind === 'returnAlert' || kind === 'returnUpdate') {
    const { orderId, customerId } = entry;
    const status = kind === 'returnAlert' ? 'requested' : entry.returnStatus;
    if (!orderId || !customerId || !sendsReturnEmail(status)) {
      throw new HttpsError(
        'failed-precondition',
        'This entry does not record which problem report it was, so it cannot be rebuilt.'
      );
    }

    const snapshot = await db.doc(`users/${customerId}/returnRequests/${orderId}`).get();
    if (!snapshot.exists) {
      throw new HttpsError('failed-precondition', 'That problem report no longer exists.');
    }
    const request = snapshot.data();
    if (request.status !== status) {
      throw new HttpsError(
        'failed-precondition',
        'That report has moved on since, so this email is out of date and will not be sent.'
      );
    }
    if (kind === 'returnAlert') return () => sendReturnAlert(request, orderId);

    if (!customerAddress(request)) {
      throw new HttpsError(
        'failed-precondition',
        'That report has no email address on it, so there is nowhere to send the update.'
      );
    }
    return () => sendReturnUpdate(request, orderId, status);
  }

  throw new HttpsError('failed-precondition', 'This kind of email cannot be resent.');
}

async function handleRetryMail(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Please sign in.');

  const key = typeof request.data?.key === 'string' ? request.data.key.trim() : '';
  if (!key) {
    throw new HttpsError('invalid-argument', 'Which email should be sent again?');
  }
  // A document id, not a path. Without this a caller could walk out of
  // mailLog and hand any collection to doc().
  if (key.includes('/') || key.length > 200) {
    throw new HttpsError('invalid-argument', 'That is not a delivery log entry.');
  }

  const db = getFirestore();

  // Mirrors isSeller() in firestore.rules, deliberately including the
  // isActive test. The rules already stop a deactivated seller reading
  // mailLog at all, but this function runs with Admin SDK credentials and
  // bypasses that file entirely, so the check has to be repeated here or
  // it is not a check.
  //
  // MULTI-STORE: whoever may READ the entry may resend it, and nobody
  // else — handlesSupport() in firestore.rules, repeated here because the
  // Admin SDK bypasses that file. A store's mail belongs to its own
  // manager; a general question's notification (storeId null) to the
  // Platform Admin.
  const actor = await db.doc(`users/${uid}`).get();
  const actorData = actor.exists ? actor.data() : null;
  if (!actorData || actorData.isActive === false ||
      !['seller', 'platformAdmin'].includes(actorData.role)) {
    throw new HttpsError(
      'permission-denied',
      'Only an active Store Manager can send email again.'
    );
  }

  const entrySnapshot = await db.collection('mailLog').doc(key).get();
  if (!entrySnapshot.exists) {
    throw new HttpsError(...RETRY_REFUSALS['not-found']);
  }

  const entryStoreId = entrySnapshot.data().storeId || null;
  const handlesEntry = entryStoreId
    ? actorData.role === 'seller' && actorData.storeId === entryStoreId
    : actorData.role === 'platformAdmin';
  if (!handlesEntry) {
    throw new HttpsError(
      'permission-denied',
      'That email belongs to another store, or to the Platform Admin.'
    );
  }

  const send = await resendAction(db, key, entrySnapshot.data());

  const released = await releaseForRetry(key);
  if (!released.ok) {
    const refusal = RETRY_REFUSALS[released.reason];
    throw refusal
      ? new HttpsError(...refusal)
      : new HttpsError('failed-precondition', 'That email cannot be sent again.');
  }

  logger.info(`mail ${key} released for retry ${released.attempts} by ${uid}`);

  // sendMail never throws; the outcome is in the document. So this reads
  // the entry back rather than assuming success, and hands the real status
  // to the caller — including 'unconfigured', which is what a retry
  // attempted with the credentials missing again would produce.
  await send();

  const after = await db.collection('mailLog').doc(key).get();
  const result = after.exists ? after.data() : {};
  return {
    status: result.status || 'unknown',
    detail: result.detail || null,
    to: result.to || null,
    attempt: released.attempts,
    attemptsLeft: Math.max(0, MAX_RETRY_ATTEMPTS - released.attempts),
  };
}

exports._handleRetryMail = handleRetryMail;
exports._resendAction = resendAction;

exports.retryMail = onCall(
  { region: REGION, secrets: MAIL_SECRETS },
  handleRetryMail
);
