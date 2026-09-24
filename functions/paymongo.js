// functions/paymongo.js
//
// Everything PlainCo says to PayMongo, and the one check it makes on what
// PayMongo says back. Nothing in here touches Firestore: index.js decides
// what a payment MEANS for an order, this file only moves requests.
//
// HOSTED CHECKOUT, NOT A CARD FORM. PayMongo draws the payment page — GCash
// login, Maya login, card fields — on its own domain, and the app opens it
// in a browser. PlainCo never receives a card number or a wallet password,
// which keeps "No Card Info Stored" (Landing, HelpScreen's FAQ) literally
// true and keeps the app out of PCI scope. The sandbox screen refused to
// draw card fields for the same reason; this is the real version of that
// decision.
//
// THE KEYS ARE SECRETS, NOT CONFIG. Both live in Secret Manager:
//
//   firebase functions:secrets:set PAYMONGO_SECRET_KEY      (sk_test_… / sk_live_…)
//   firebase functions:secrets:set PAYMONGO_WEBHOOK_SECRET  (whsk_…, shown once when
//                                                           the webhook is created)
//
// The public key (pk_…) is not needed at all: hosted checkout collects the
// payment method on PayMongo's page, so the app never talks to PayMongo.

const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { defineSecret } = require('firebase-functions/params');

const PAYMONGO_SECRET_KEY = defineSecret('PAYMONGO_SECRET_KEY');
const PAYMONGO_WEBHOOK_SECRET = defineSecret('PAYMONGO_WEBHOOK_SECRET');

const API = 'https://api.paymongo.com/v1';

// PlainCo's method ids → PayMongo's payment_method_types. One each, so the
// hosted page opens on the method the customer already picked at checkout
// instead of asking them to choose again. Maya is still 'paymaya' on
// PayMongo's side.
const METHOD_TYPES = {
  gcash: ['gcash'],
  maya: ['paymaya'],
  card: ['card'],
};

// Peso amounts are stored to two decimals (round2 in index.js); PayMongo
// counts in centavos, as integers. Rounded rather than truncated so
// 849.99 * 100 = 84998.99999… becomes 84999 and not 84998.
const toCentavos = (pesos) => Math.round(pesos * 100);

class GatewayError extends Error {
  constructor(message, { status = null, detail = null } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.detail = detail;
  }
}

async function request(method, path, body, { idempotencyKey } = {}) {
  const key = PAYMONGO_SECRET_KEY.value();
  if (!key) {
    throw new GatewayError('PAYMONGO_SECRET_KEY is not set.');
  }

  const headers = {
    // Basic auth with the secret key as the username and no password —
    // hence the trailing colon.
    Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
    Accept: 'application/json',
  };
  if (body) headers['Content-Type'] = 'application/json';
  // A retried create returns the first session instead of opening a second
  // one for the same checkout.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      // Well inside the callable's own 60s, so a hung gateway surfaces as
      // a refusal the customer can act on rather than a client timeout.
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new GatewayError(`PayMongo did not respond: ${error.message}`);
  }

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    // PayMongo's `detail` can carry internals; it goes to the log, never
    // to the customer. index.js maps a GatewayError to its own wording.
    const detail = json?.errors?.map((e) => e.detail).join('; ') || null;
    throw new GatewayError(`PayMongo ${method} ${path} failed (${response.status})`, {
      status: response.status,
      detail,
    });
  }
  return json;
}

// What index.js needs to know about a session, whichever endpoint it came
// from (create, retrieve, expire, or a webhook's embedded copy).
function summariseSession(session) {
  const attributes = session?.attributes || {};
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
  const paid = payments.find((p) => p?.attributes?.status === 'paid') || null;
  return {
    id: session?.id || null,
    status: attributes.status || null, // 'active' | 'expired'
    checkoutUrl: attributes.checkout_url || null,
    livemode: attributes.livemode === true,
    referenceNumber: attributes.reference_number || null,
    checkoutId: attributes.metadata?.checkoutId || attributes.reference_number || null,
    paid: paid
      ? {
          paymentId: paid.id,
          amountCentavos: paid.attributes.amount,
          // gcash / paymaya / card, as PayMongo recorded it.
          source: paid.attributes.source?.type || null,
        }
      : null,
  };
}

// Opens a hosted checkout for ONE PlainCo checkout — every store's share of
// it, as line items, charged once.
//
// `lines` are the items as priced by placeOrder (pesos, per unit). The sum
// PayMongo charges is therefore the sum placeOrder computed, and the
// webhook handler checks it again before fulfilling anything.
async function createCheckoutSession({ checkoutId, paymentMethod, lines, shipping, successUrl, cancelUrl, customerEmail }) {
  const paymentMethodTypes = METHOD_TYPES[paymentMethod];
  if (!paymentMethodTypes) {
    throw new GatewayError(`No PayMongo method for "${paymentMethod}".`);
  }

  const lineItems = lines.map((line) => ({
    name: [line.name || 'Item', [line.size, line.color].filter(Boolean).join(' · ')]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 255),
    amount: toCentavos(line.price),
    currency: 'PHP',
    quantity: line.quantity,
  }));
  if (shipping > 0) {
    lineItems.push({ name: 'Shipping', amount: toCentavos(shipping), currency: 'PHP', quantity: 1 });
  }

  const json = await request(
    'POST',
    '/checkout_sessions',
    {
      data: {
        attributes: {
          line_items: lineItems,
          payment_method_types: paymentMethodTypes,
          success_url: successUrl,
          cancel_url: cancelUrl,
          // Both carry the checkout id: reference_number shows on
          // PayMongo's dashboard for a person reconciling by hand,
          // metadata is what the webhook handler reads.
          reference_number: checkoutId,
          metadata: { checkoutId },
          description: `PlainCo order ${checkoutId.slice(0, 10).toUpperCase()}`,
          send_email_receipt: Boolean(customerEmail),
          show_line_items: true,
          ...(customerEmail ? { billing: { email: customerEmail } } : {}),
        },
      },
    },
    { idempotencyKey: `plainco-checkout-${checkoutId}` }
  );
  return summariseSession(json?.data);
}

async function retrieveCheckoutSession(sessionId) {
  const json = await request('GET', `/checkout_sessions/${encodeURIComponent(sessionId)}`);
  return summariseSession(json?.data);
}

// Stops a session from taking a payment. PayMongo cancels the session's
// payment intent unless it already succeeded, in which case this fails —
// which is exactly the case the caller re-checks for.
async function expireCheckoutSession(sessionId) {
  const json = await request('POST', `/checkout_sessions/${encodeURIComponent(sessionId)}/expire`);
  return summariseSession(json?.data);
}

// The Paymongo-Signature header: `t=<unix seconds>,te=<hex>,li=<hex>`.
// te is the signature in test mode, li in live mode; only one is filled.
// Both are HMAC-SHA256, keyed with the webhook's secret, over
// `<t>.<raw request body>`.
function parseSignatureHeader(header) {
  const parts = {};
  for (const piece of String(header || '').split(',')) {
    const index = piece.indexOf('=');
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  return parts;
}

// Verified against the RAW bytes. Re-serialising the parsed JSON would
// change whitespace and key order and fail every genuine request.
//
// No timestamp tolerance. PayMongo retries a failed delivery up to twelve
// times with the original signature, and a replay of a genuine event is
// harmless anyway: applying a payment is idempotent (index.js checks the
// checkout's status before writing), so the worst a replay can do is
// nothing.
function verifyWebhookSignature(rawBody, header, secret) {
  if (!secret || !rawBody) return false;
  const { t, te, li } = parseSignatureHeader(header);
  if (!t) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody}`)
    .digest('hex');

  const matches = (candidate) => {
    if (!candidate || candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
  };
  return matches(te) || matches(li);
}

module.exports = {
  PAYMONGO_SECRET_KEY,
  PAYMONGO_WEBHOOK_SECRET,
  GatewayError,
  toCentavos,
  summariseSession,
  verifyWebhookSignature,
  // The live gateway. index.js calls through an object rather than these
  // functions directly, so scripts/test-checkout.mjs can swap in a fake
  // and exercise every path without a PayMongo account.
  gateway: {
    createCheckoutSession,
    retrieveCheckoutSession,
    expireCheckoutSession,
  },
};
