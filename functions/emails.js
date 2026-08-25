// functions/emails.js
//
// The two messages PlainCo sends, and the Firestore triggers that decide
// when. Everything about HOW they are sent lives in mailer.js.
//
// BOTH ARE TRIGGERS, NOT INLINE SENDS, and that is the important choice
// here. placeOrder could have sent the receipt itself, at the end of its
// transaction. It must not: an SMTP timeout would then surface to the
// customer as a failed checkout for an order that was, in fact, placed —
// stock decremented, cart cleared, money owed. Splitting the send into a
// trigger means the worst case is a missing email attached to a perfectly
// good order, which is the failure you want when you have to pick one.
//
// retry is left OFF on both. A retried trigger re-runs the whole handler,
// and while claimOnce() in mailer.js would stop a duplicate send, a
// message that failed once because Gmail rejected the recipient will fail
// identically every time. Retries would buy nothing but log noise.

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');

const {
  MAIL_SECRETS,
  sendMail,
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

// Exported for scripts/preview-email.mjs, which renders both templates to
// disk so they can be opened in a browser and eyeballed without deploying
// or sending anything. index.js re-exports only the two triggers, so these
// stay invisible to the Firebase CLI's function discovery.
exports._renderOrderHtml = orderHtml;
exports._renderOrderText = orderText;
exports._renderSupportHtml = supportHtml;
exports._renderSupportText = supportText;

exports.sendOrderConfirmation = onDocumentCreated(
  {
    document: 'users/{userId}/orders/{orderId}',
    region: REGION,
    secrets: MAIL_SECRETS,
    retry: false,
  },
  async (event) => {
    const order = event.data?.data();
    if (!order) return;

    const { orderId } = event.params;

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
      meta: { kind: 'orderConfirmation', orderId, customerId: order.customerId || null },
    });
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
    const request = event.data?.data();
    if (!request) return;

    const { requestId } = event.params;
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
      meta: { kind: 'supportRequest', requestId, userId: request.userId || null },
    });
  }
);
