/**
 * End-to-end test of placeOrder against the Firestore emulator.
 *
 *     npm run test:checkout
 *
 * WHAT THIS COVERS THAT NOTHING ELSE DID. Three suites already existed and
 * each stopped at a boundary:
 *
 *   - test-rules.mjs proves no CLIENT can write orders or stock. It says
 *     nothing about what the server writes instead, because the server
 *     bypasses rules.
 *   - test-rate-limit.mjs proves the window arithmetic is right, in
 *     isolation, with no Firestore at all.
 *   - test-email.mjs starts from an order document that already exists.
 *
 * The seam where those meet — read the catalogue, price it, spend rate-limit
 * quota, decrement stock, write the order, clear the cart, all in one
 * transaction — was the most consequential code in the project and the only
 * part with no coverage. This is that test.
 *
 * NOTHING IS MOCKED. Firestore is the emulator and the handler is the real
 * one, called with a plain request object instead of through a deployed
 * callable. Prices, totals and stock are read and written for real, so an
 * arithmetic or ordering mistake fails here rather than in a customer's
 * cart.
 */
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'plainco-checkout-test';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set — run this through `npm run test:checkout`.');
  process.exit(1);
}

// Read by defineSecret().value() in functions/paymongo.js, which falls back
// to the environment outside a deployed function.
const WEBHOOK_SECRET = 'whsk_test_plainco';
process.env.PAYMONGO_WEBHOOK_SECRET = WEBHOOK_SECRET;

const require = createRequire(import.meta.url);
const functions = require('../functions/index.js');
const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { getFirestore, FieldValue, Timestamp } = requireFromFunctions('firebase-admin/firestore');

const db = getFirestore();
const placeOrder = functions._handlePlaceOrder;

let passed = 0;
const failures = [];

const ADDRESS = {
  fullName: 'Cathy Customer',
  phone: '09171234567',
  address: '12 Mango Avenue',
  city: 'Cebu City',
  province: 'Cebu',
  zipCode: '6000',
};

// A request as the callable would hand it over: auth from the verified
// token, data straight from the client. Note what data does NOT carry —
// no price, no total, no address. That is the whole design.
const request = (items, overrides = {}) => ({
  auth: { uid: 'customer1', token: { email: 'cathy@example.com' } },
  data: { items, paymentMethod: 'cod', ...overrides },
});

async function wipe() {
  for (const path of ['products', 'stores', 'rateLimits', 'mailLog', 'checkouts', 'config']) {
    const snapshot = await db.collection(path).get();
    await Promise.all(snapshot.docs.map((d) => d.ref.delete()));
  }
  for (const sub of ['orders', 'cart']) {
    const snapshot = await db.collection('users').doc('customer1').collection(sub).get();
    await Promise.all(snapshot.docs.map((d) => d.ref.delete()));
  }
  await db.collection('users').doc('customer1').delete();
}

async function seed({ stock = 10, price = 850, isActive = true, address = ADDRESS, role } = {}) {
  await wipe();
  const user = { uid: 'customer1', name: 'Cathy Customer', email: 'cathy@example.com' };
  if (address) user.shippingAddress = address;
  if (isActive === false) user.isActive = false;
  if (role) user.role = role;
  await db.collection('users').doc('customer1').set(user);

  // p1 and p2 share a store, so every test written before multi-store
  // still describes a one-store checkout. p3 is the second store, for the
  // split tests.
  await db.collection('stores').doc('storeA').set({ name: 'Tindahan A' });
  await db.collection('stores').doc('storeB').set({ name: 'RTW B' });
  await db.collection('products').doc('p1').set({
    name: 'Denim Jacket', price, stock, type: 'ukay',
    description: 'Well loved.', imageUrl: 'https://example.test/1.jpg',
    colors: ['Blue'], sizes: ['M'], storeId: 'storeA',
  });
  await db.collection('products').doc('p2').set({
    name: 'Wool Overcoat', price: 1200, stock: 3, type: 'ready',
    description: 'Warm.', imageUrl: 'https://example.test/2.jpg',
    colors: ['Grey'], sizes: ['L'], storeId: 'storeA',
  });
  await db.collection('products').doc('p3').set({
    name: 'Linen Blouse', price: 450, stock: 4, type: 'ready',
    description: 'Crisp.', imageUrl: 'https://example.test/3.jpg',
    colors: ['White'], sizes: ['S'], storeId: 'storeB',
  });
}

const ordersOf = async () =>
  (await db.collection('users').doc('customer1').collection('orders').get()).docs.map((d) => ({
    id: d.id, ...d.data(),
  }));

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message.split('\n')[0]}`);
  }
}

function assert(condition, what) {
  if (!condition) throw new Error(what);
}
function assertEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

async function expectRefusal(promise, reason) {
  try {
    await promise;
  } catch (error) {
    if (reason && error.details?.reason !== reason) {
      throw new Error(`expected reason "${reason}", got "${error.details?.reason}" (${error.message})`);
    }
    return error;
  }
  throw new Error('expected a refusal, but the order succeeded');
}

const stockOf = async (id) => (await db.collection('products').doc(id).get()).data().stock;
const orderCount = async () =>
  (await db.collection('users').doc('customer1').collection('orders').get()).size;

console.log('\nCheckout — the happy path');

await test('CHECKOUT-1  an order is priced, written, and stock decremented', async () => {
  await seed({ stock: 10, price: 850 });

  const placed = await placeOrder(request([{ productId: 'p1', quantity: 2, size: 'M', color: 'Blue' }]));

  assertEqual(placed.total, 1700, 'total');
  assertEqual(placed.subtotal, 1700, 'subtotal');
  assertEqual(await stockOf('p1'), 8, 'stock after buying 2 of 10');

  const stored = (await db.collection('users').doc('customer1')
    .collection('orders').doc(placed.orders[0].orderId).get()).data();
  assertEqual(stored.status, 'pending', 'status is pinned to pending');
  assertEqual(stored.customerId, 'customer1', 'customerId');
  assertEqual(stored.total, 1700, 'stored total');
  // Denormalised for the reviews rule, which cannot read a field out of
  // each map in a list.
  assert(stored.productIds.includes('p1'), 'productIds carries the line');
  assert(stored.shippingAddress.address === ADDRESS.address, 'address copied from the user doc');
});

await test('CHECKOUT-2  the client CANNOT set its own price', async () => {
  // The entire reason this function exists. A modified client sends a
  // price, a subtotal and a total; every one of them is ignored in favour
  // of the catalogue.
  await seed({ stock: 10, price: 850 });

  const placed = await placeOrder(
    request([{ productId: 'p1', quantity: 1, price: 1, name: 'Free Jacket' }], {
      subtotal: 1, total: 1, shipping: -500,
    })
  );

  assertEqual(placed.total, 850, 'total comes from the product, not the request');
  assertEqual(placed.items[0].price, 850, 'line price comes from the product');
  assertEqual(placed.items[0].name, 'Denim Jacket', 'name comes from the product');
  assertEqual(placed.shipping, 0, 'shipping is the server constant');
});

await test('CHECKOUT-3  the cart lines the order consumed are cleared', async () => {
  await seed();
  const cart = db.collection('users').doc('customer1').collection('cart');
  await cart.doc('c1').set({ productId: 'p1', quantity: 1 });
  // A Buy Now line carries no cartItemId and must not clear anything.
  await cart.doc('c2').set({ productId: 'p2', quantity: 1 });

  await placeOrder(request([
    { productId: 'p1', quantity: 1, cartItemId: 'c1' },
    { productId: 'p2', quantity: 1 },
  ]));

  const remaining = await cart.get();
  assertEqual(remaining.size, 1, 'only the line with a cartItemId is removed');
  assertEqual(remaining.docs[0].id, 'c2', 'the Buy Now line survives');
});

await test('CHECKOUT-4  a legacy string-typed product migrates itself on sale', async () => {
  // Products created by older builds stored price and stock as strings.
  // The client-side checkout this replaced had to refuse them outright;
  // this writes a real number back, so the product is repaired by being
  // bought.
  await seed();
  await db.collection('products').doc('p1').set(
    { price: '850', stock: '10' }, { merge: true }
  );

  const placed = await placeOrder(request([{ productId: 'p1', quantity: 2 }]));

  assertEqual(placed.total, 1700, 'a string price is parsed');
  const stock = await stockOf('p1');
  assertEqual(stock, 8, 'stock decremented');
  assertEqual(typeof stock, 'number', 'and written back as a NUMBER, not a string');
});

await test('CHECKOUT-5  one product on two lines shares a single stock budget', async () => {
  // The same shirt in two sizes is two lines and the cart never dedupes.
  // Checked per PRODUCT, or two lines could each pass a check they fail
  // together.
  await seed({ stock: 3 });

  await expectRefusal(
    placeOrder(request([
      { productId: 'p1', quantity: 2, size: 'M' },
      { productId: 'p1', quantity: 2, size: 'L' },
    ])),
    'insufficient-stock'
  );

  assertEqual(await stockOf('p1'), 3, 'nothing decremented by a refused order');
  assertEqual(await orderCount(), 0, 'and no order written');
});

console.log('\nCheckout — refusals');

await test('CHECKOUT-6  an account with no delivery address is refused', async () => {
  await seed({ address: null });
  await expectRefusal(placeOrder(request([{ productId: 'p1', quantity: 1 }])), 'no-address');
  assertEqual(await stockOf('p1'), 10, 'stock untouched');
});

await test('CHECKOUT-7  a missing product is refused as unavailable', async () => {
  await seed();
  await expectRefusal(placeOrder(request([{ productId: 'ghost', quantity: 1 }])), 'unavailable');
});

await test('CHECKOUT-8  insufficient stock names what is short', async () => {
  await seed({ stock: 1 });
  const error = await expectRefusal(
    placeOrder(request([{ productId: 'p1', quantity: 5 }])),
    'insufficient-stock'
  );
  const [item] = error.details.items;
  assertEqual(item.available, 1, 'available');
  assertEqual(item.requested, 5, 'requested');
  assert(item.name === 'Denim Jacket', 'the item is named, not just its id');
});

await test('CHECKOUT-9  a deactivated account cannot place an order', async () => {
  await seed({ isActive: false });
  await expectRefusal(placeOrder(request([{ productId: 'p1', quantity: 1 }])));
  assertEqual(await stockOf('p1'), 10, 'stock untouched');
});

await test('CHECKOUT-10  malformed requests are refused before any write', async () => {
  await seed();
  await expectRefusal(placeOrder(request([])));
  await expectRefusal(placeOrder(request([{ productId: 'p1', quantity: 0 }])));
  await expectRefusal(placeOrder(request([{ productId: 'p1', quantity: 1.5 }])));
  await expectRefusal(placeOrder(request([{ productId: 'p1', quantity: 1 }], { paymentMethod: 'bitcoin' })));
  await expectRefusal(placeOrder({ data: { items: [{ productId: 'p1', quantity: 1 }] } }));

  assertEqual(await stockOf('p1'), 10, 'stock untouched');
  // Shape validation runs before the rate limiter, so junk costs the
  // attacker more than it costs us.
  const limiter = await db.collection('rateLimits').doc('customer1').get();
  assert(!limiter.exists, 'no rate-limit quota spent on malformed input');
});

console.log('\nCheckout — rate limiting, joined up');

await test('CHECKOUT-11  the limit stops the ninth attempt in a window', async () => {
  // test-rate-limit.mjs proves the arithmetic; this proves it is actually
  // wired to the endpoint and backed by Firestore. Stock is generous so
  // nothing else can be the reason a call fails.
  await seed({ stock: 99 });

  const { RATE_LIMIT_MAX_ATTEMPTS: MAX } = functions._RATE_LIMIT;
  for (let i = 0; i < MAX; i += 1) {
    await placeOrder(request([{ productId: 'p1', quantity: 1 }]));
  }

  const error = await expectRefusal(
    placeOrder(request([{ productId: 'p1', quantity: 1 }])),
    'rate-limited'
  );
  assert(error.details.retryAfterSeconds > 0, 'a wait is reported');
  assertEqual(await orderCount(), MAX, 'exactly the allowed number of orders exist');
  assertEqual(await stockOf('p1'), 99 - MAX, 'and no stock beyond them');
});

await test('CHECKOUT-12  a REFUSED order still spends quota', async () => {
  // The decision recorded in functions/index.js: quota is spent on the
  // attempt, whatever becomes of it. Counting only successes would let an
  // attacker loop for free on a deliberately out-of-stock item while every
  // read and write still happened.
  await seed({ stock: 0 });

  await expectRefusal(placeOrder(request([{ productId: 'p1', quantity: 1 }])), 'insufficient-stock');

  const limiter = (await db.collection('rateLimits').doc('customer1').get()).data();
  assertEqual(limiter.attempts, 1, 'the failed attempt was counted');
});

console.log('\nCheckout — the sandbox payment gateway');

await test('CHECKOUT-13  an approved sandbox payment marks the order paid', async () => {
  await seed({ stock: 5, price: 500 });

  const placed = await placeOrder(
    request([{ productId: 'p1', quantity: 1 }], { paymentMethod: 'gcash', sandboxOutcome: 'approved' })
  );

  assertEqual(placed.paymentStatus, 'paid', 'returned paymentStatus');
  assert(placed.paymentSandbox === true, 'the simulated origin is returned to the client');
  assert(/^SBX-/.test(placed.paymentRef), `reference is marked sandbox, got ${placed.paymentRef}`);

  const stored = (await db.collection('users').doc('customer1')
    .collection('orders').doc(placed.orders[0].orderId).get()).data();
  assertEqual(stored.paymentStatus, 'paid', 'stored paymentStatus');
  assertEqual(stored.paymentSandbox, true, 'stored sandbox stamp');
  assertEqual(stored.paymentRef, placed.paymentRef, 'the reference the customer was shown is the one stored');
});

await test('CHECKOUT-14  COD is unpaid, unstamped, and never enters the sandbox', async () => {
  await seed({ stock: 5, price: 500 });

  const placed = await placeOrder(request([{ productId: 'p1', quantity: 1 }]));

  assertEqual(placed.paymentStatus, 'unpaid', 'COD rests at unpaid');
  assertEqual(placed.paymentRef, null, 'no reference — nothing was authorised');
  assertEqual(placed.paymentSandbox, false, 'COD is not a simulated payment, it is a real arrangement');
});

await test('CHECKOUT-15  a declined payment writes NOTHING', async () => {
  // The whole reason the gateway runs inside the transaction. A refusal
  // here must leave no order and no spent stock behind — if it did, every
  // declined demo would quietly sell inventory.
  await seed({ stock: 5, price: 500 });

  for (const outcome of ['declined', 'insufficient_funds', 'timeout']) {
    const error = await expectRefusal(
      placeOrder(request([{ productId: 'p1', quantity: 2 }], { paymentMethod: 'card', sandboxOutcome: outcome })),
      'payment-declined'
    );
    assertEqual(error.details.outcome, outcome, 'the refusal names which scenario produced it');
    assertEqual(error.details.amount, 1000, 'and the amount that was not charged');
  }

  assertEqual(await orderCount(), 0, 'no order survived a decline');
  assertEqual(await stockOf('p1'), 5, 'and no stock was consumed by one');
});

await test('CHECKOUT-16  an online method cannot skip the payment step', async () => {
  // The client-side guard is a navigation flow, not a defence. A caller
  // that goes straight to the callable with no scenario — which is what a
  // modified client would do to get a free "paid" order — is refused.
  await seed({ stock: 5, price: 500 });

  await expectRefusal(
    placeOrder(request([{ productId: 'p1', quantity: 1 }], { paymentMethod: 'maya' }))
  );
  await expectRefusal(
    placeOrder(request([{ productId: 'p1', quantity: 1 }], { paymentMethod: 'maya', sandboxOutcome: 'nope' }))
  );

  assertEqual(await orderCount(), 0, 'neither attempt produced an order');
});

await test('CHECKOUT-17  COD carrying a sandbox outcome is refused, not ignored', async () => {
  await seed({ stock: 5, price: 500 });

  await expectRefusal(
    placeOrder(request([{ productId: 'p1', quantity: 1 }], { paymentMethod: 'cod', sandboxOutcome: 'approved' }))
  );

  assertEqual(await orderCount(), 0, 'a confused client gets no order at all');
});

console.log('\nCheckout — several stores in one cart');

await test('CHECKOUT-18  a two-store cart becomes one order per store', async () => {
  await seed({ stock: 10, price: 850 });

  const placed = await placeOrder(request([
    { productId: 'p1', quantity: 2 },
    { productId: 'p3', quantity: 1 },
    { productId: 'p2', quantity: 1 },
  ]));

  assertEqual(placed.orders.length, 2, 'two stores, two orders');
  const [a, b] = placed.orders;
  // In the order each store first appears in the cart.
  assertEqual(a.storeId, 'storeA', 'first order is the first store in the cart');
  assertEqual(a.storeName, 'Tindahan A', 'store name comes from the store document');
  assertEqual(a.items.length, 2, 'storeA gets both of its lines');
  assertEqual(a.total, 2 * 850 + 1200, 'storeA total is only its own lines');
  assertEqual(b.storeId, 'storeB', 'second order is the other store');
  assertEqual(b.total, 450, 'storeB total is only its own line');
  assertEqual(placed.total, 2 * 850 + 1200 + 450, 'the checkout total is the sum of the two');

  const stored = await ordersOf();
  assertEqual(stored.length, 2, 'two order documents written');
  const storedA = stored.find((o) => o.storeId === 'storeA');
  const storedB = stored.find((o) => o.storeId === 'storeB');
  assertEqual(storedA.total, a.total, 'stored storeA total');
  assertEqual(storedB.productIds.join(), 'p3', 'productIds hold only that store\'s products');
  assert(!storedA.productIds.includes('p3'), 'a review of p3 cannot be earned on storeA\'s order');
  assertEqual(storedA.checkoutId, storedB.checkoutId, 'both orders share one checkoutId');
  assertEqual(storedA.status, 'pending', 'each order starts pending on its own');
  assertEqual(storedB.status, 'pending', 'each order starts pending on its own');
});

await test('CHECKOUT-19  one online payment covers every store\'s order', async () => {
  await seed({ stock: 10, price: 500 });

  const placed = await placeOrder(request(
    [{ productId: 'p1', quantity: 1 }, { productId: 'p3', quantity: 1 }],
    { paymentMethod: 'gcash', sandboxOutcome: 'approved' }
  ));

  const stored = await ordersOf();
  assertEqual(stored.length, 2, 'two orders');
  for (const order of stored) {
    assertEqual(order.paymentRef, placed.paymentRef, 'every order carries the one reference');
    assertEqual(order.paymentStatus, 'paid', 'every order is paid');
  }
});

await test('CHECKOUT-20  a decline on a two-store cart writes nothing for EITHER store', async () => {
  await seed({ stock: 10, price: 500 });

  const error = await expectRefusal(
    placeOrder(request(
      [{ productId: 'p1', quantity: 1 }, { productId: 'p3', quantity: 2 }],
      { paymentMethod: 'card', sandboxOutcome: 'declined' }
    )),
    'payment-declined'
  );
  assertEqual(error.details.amount, 500 + 900, 'the whole checkout was what went unpaid');
  assertEqual(await orderCount(), 0, 'no order for either store');
  assertEqual(await stockOf('p1'), 10, 'storeA stock untouched');
  assertEqual(await stockOf('p3'), 4, 'storeB stock untouched');
});

await test('CHECKOUT-21  one store short on stock sinks the whole checkout', async () => {
  // Not "place what can be placed". A customer who asked for two things
  // together gets both or is told why not — the same all-or-nothing the
  // one-store checkout always had.
  await seed({ stock: 10 });

  await expectRefusal(
    placeOrder(request([{ productId: 'p1', quantity: 1 }, { productId: 'p3', quantity: 99 }])),
    'insufficient-stock'
  );
  assertEqual(await orderCount(), 0, 'no partial order');
  assertEqual(await stockOf('p1'), 10, 'the store that had stock was not decremented');
});

await test('CHECKOUT-22  a product with no store cannot be ordered', async () => {
  // Written before stores existed and not yet migrated. No manager could
  // ever move its order past pending, so it is refused as unavailable.
  await seed();
  await db.collection('products').doc('p1').update({ storeId: FieldValue.delete() });

  const error = await expectRefusal(
    placeOrder(request([{ productId: 'p1', quantity: 1 }])),
    'unavailable'
  );
  assert(error.details.productIds.includes('p1'), 'the unassigned product is named');
  assertEqual(await orderCount(), 0, 'no order');
});

await test('CHECKOUT-23  staff accounts cannot place orders', async () => {
  // A Store Manager buying from their own store would book sales that
  // never happened into the dashboard.
  for (const role of ['seller', 'platformAdmin']) {
    await seed({ role });
    const error = await expectRefusal(placeOrder(request([{ productId: 'p1', quantity: 1 }])));
    assertEqual(error.code, 'permission-denied', `${role} refused as permission-denied`);
    assertEqual(await stockOf('p1'), 10, `stock untouched for ${role}`);
    assertEqual(await orderCount(), 0, `no order for ${role}`);
  }
});

console.log('\nCheckout — the PayMongo gateway (faked, no account needed)');

// Stands in for PayMongo. Sessions live in a Map; each test decides what
// the "customer" did on the hosted page by editing one. Everything on
// PlainCo's side — the transaction, the hold, the release, the webhook
// handler and its signature check — is the real code.
function fakePaymongo({ failCreate = false, failExpire = false } = {}) {
  const sessions = new Map();
  const calls = [];
  return {
    sessions,
    calls,
    async createCheckoutSession(args) {
      calls.push(['create', args]);
      if (failCreate) throw new Error('PayMongo is down');
      const id = `cs_${args.checkoutId}`;
      const amount = args.lines.reduce((sum, l) => sum + Math.round(l.price * 100) * l.quantity, 0)
        + Math.round((args.shipping || 0) * 100);
      sessions.set(id, { id, status: 'active', amount, checkoutId: args.checkoutId, paid: null });
      return { id, checkoutUrl: `https://checkout.paymongo.test/${id}`, livemode: false, status: 'active', paid: null };
    },
    async retrieveCheckoutSession(id) {
      calls.push(['retrieve', id]);
      const s = sessions.get(id);
      return { id, status: s.status, livemode: false, checkoutId: s.checkoutId, paid: s.paid };
    },
    async expireCheckoutSession(id) {
      calls.push(['expire', id]);
      const s = sessions.get(id);
      if (failExpire || s.paid) throw new Error('cannot expire');
      s.status = 'expired';
      return { id, status: 'expired', livemode: false, paid: null };
    },
    // What the customer paying on the hosted page amounts to.
    pay(checkoutId, { amount } = {}) {
      const s = sessions.get(`cs_${checkoutId}`);
      s.paid = { paymentId: `pay_${checkoutId.slice(0, 8)}`, amountCentavos: amount ?? s.amount, source: 'gcash' };
      return s;
    },
  };
}

const RETURN_URL = 'plainco://payment-return';
const payRequest = (items, overrides = {}) =>
  request(items, { paymentMethod: 'gcash', returnUrl: RETURN_URL, ...overrides });

async function usePaymongo(fake) {
  await db.collection('config').doc('payments').set({ gateway: 'paymongo' });
  functions._setGatewayForTests(fake);
}

const checkoutOf = async (id) => (await db.collection('checkouts').doc(id).get()).data();

// A webhook delivery as PayMongo sends it: the event JSON, signed over
// `<t>.<raw body>` with the endpoint's secret.
async function deliverWebhook(session, { secret = WEBHOOK_SECRET, type = 'checkout_session.payment.paid', sessionId } = {}) {
  const body = {
    data: {
      id: 'evt_test',
      type: 'event',
      attributes: {
        type,
        livemode: false,
        data: {
          id: sessionId || session.id,
          type: 'checkout_session',
          attributes: {
            livemode: false,
            status: 'active',
            reference_number: session.checkoutId,
            metadata: { checkoutId: session.checkoutId },
            payments: session.paid
              ? [{ id: session.paid.paymentId, type: 'payment', attributes: { amount: session.paid.amountCentavos, status: 'paid', source: { type: 'gcash' } } }]
              : [],
          },
        },
      },
    },
  };
  const raw = JSON.stringify(body);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');

  const res = { statusCode: null, payload: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; return res; };
  await functions._handlePaymongoWebhook({
    method: 'POST',
    rawBody: Buffer.from(raw),
    body,
    get: (name) => (name.toLowerCase() === 'paymongo-signature' ? `t=${t},te=${sig},li=` : undefined),
  }, res);
  return res;
}

const resolve = (checkoutId, data = {}, uid = 'customer1') =>
  functions._handleResolveCheckout({ auth: { uid }, data: { checkoutId, ...data } });

try {
  await test('PAY-1  an online order HOLDS stock and writes a checkout, not orders', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    await db.collection('users').doc('customer1').collection('cart').doc('c1').set({ productId: 'p1', quantity: 2 });

    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 2, cartItemId: 'c1' }]));

    assert(placed.awaitingPayment === true, 'the app is told to go and pay');
    assert(placed.checkoutUrl.startsWith('https://checkout.paymongo.test/'), 'with PayMongo\'s page to open');
    assertEqual(await orderCount(), 0, 'no order exists before the money does');
    assertEqual(await stockOf('p1'), 3, 'but the pieces are held');
    assertEqual((await db.collection('users').doc('customer1').collection('cart').get()).size, 1, 'and the cart is untouched');

    const checkout = await checkoutOf(placed.checkoutId);
    assertEqual(checkout.status, 'pending', 'checkout status');
    assertEqual(checkout.sessionId, `cs_${placed.checkoutId}`, 'the session is recorded against it');
    assertEqual(checkout.total, 1000, 'the server-priced total');

    const [, args] = fake.calls.find(([name]) => name === 'create');
    assertEqual(args.lines[0].price, 500, 'PayMongo is asked for the catalogue price');
    assert(args.successUrl.includes('/paymentReturn?c='), 'and returns through paymentReturn, not straight to the app');
  });

  await test('PAY-2  a signed webhook turns the checkout into paid orders, once', async () => {
    await seed({ stock: 10, price: 850 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    await db.collection('users').doc('customer1').collection('cart').doc('c1').set({ productId: 'p1', quantity: 1 });

    const placed = await placeOrder(payRequest([
      { productId: 'p1', quantity: 1, cartItemId: 'c1' },
      { productId: 'p3', quantity: 1 },
    ]));
    const session = fake.pay(placed.checkoutId);

    const res = await deliverWebhook(session);
    assertEqual(res.statusCode, 200, 'webhook acknowledged');
    assertEqual(res.payload.outcome, 'paid', 'webhook outcome');

    const orders = await ordersOf();
    assertEqual(orders.length, 2, 'one order per store, as with every other method');
    for (const order of orders) {
      assertEqual(order.paymentStatus, 'paid', 'paid');
      assertEqual(order.paymentProvider, 'paymongo', 'provider');
      assertEqual(order.paymentRef, session.paid.paymentId, 'PayMongo\'s payment id is the reference');
      assertEqual(order.paymentSandbox, true, 'a test-mode payment is still marked as not real money');
      assertEqual(order.checkoutId, placed.checkoutId, 'orders share the checkout');
    }
    assertEqual((await db.collection('users').doc('customer1').collection('cart').get()).size, 0, 'the cart clears on payment');
    assertEqual(await stockOf('p1'), 9, 'the held stock is now sold — not decremented twice');

    const checkout = await checkoutOf(placed.checkoutId);
    assertEqual(checkout.status, 'paid', 'checkout closed');
    assertEqual(checkout.receipt.orders.length, 2, 'with a receipt the app can render');

    // PayMongo retries; a second delivery must change nothing.
    const again = await deliverWebhook(session);
    assertEqual(again.statusCode, 200, 'duplicate acknowledged');
    assertEqual(await orderCount(), 2, 'and writes no second set of orders');
  });

  await test('PAY-3  an unsigned or mis-signed webhook is refused and writes nothing', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));
    const session = fake.pay(placed.checkoutId);

    const res = await deliverWebhook(session, { secret: 'whsk_someone_else' });
    assertEqual(res.statusCode, 401, 'forged signature refused');
    assertEqual(await orderCount(), 0, 'a forged "paid" buys nothing');
    assertEqual((await checkoutOf(placed.checkoutId)).status, 'pending', 'checkout unchanged');
  });

  await test('PAY-4  a webhook for another session cannot pay for this checkout', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));
    const session = fake.pay(placed.checkoutId);

    await deliverWebhook(session, { sessionId: 'cs_somebody_elses' });
    assertEqual(await orderCount(), 0, 'no orders');
  });

  await test('PAY-5  backing out releases the hold at once, and only once', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 2 }]));
    assertEqual(await stockOf('p1'), 3, 'held');

    const result = await resolve(placed.checkoutId, { abandon: true });
    assertEqual(result.status, 'released', 'released');
    assertEqual(await stockOf('p1'), 5, 'stock is back');
    assert(fake.calls.some(([name]) => name === 'expire'), 'PayMongo was told to stop taking payment first');
    assertEqual(await orderCount(), 0, 'no orders');

    await resolve(placed.checkoutId, { abandon: true });
    assertEqual(await stockOf('p1'), 5, 'a second cancel restores nothing twice');
  });

  await test('PAY-6  backing out after actually paying still places the order', async () => {
    // The customer paid, then closed the browser before it came back —
    // the app reads that as a cancel. The payment must win.
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));
    fake.pay(placed.checkoutId);

    const result = await resolve(placed.checkoutId, { abandon: true });
    assertEqual(result.status, 'paid', 'paid, not released');
    assert(result.receipt && result.receipt.paymentStatus === 'paid', 'with the receipt to show');
    assertEqual(await orderCount(), 1, 'order written');
    assertEqual(await stockOf('p1'), 4, 'stock stays sold');
  });

  await test('PAY-7  checking without abandoning leaves an unpaid checkout alone', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));

    const result = await resolve(placed.checkoutId);
    assertEqual(result.status, 'pending', 'still waiting');
    assertEqual(await stockOf('p1'), 4, 'hold kept');
  });

  await test('PAY-8  another customer cannot look up or cancel my checkout', async () => {
    await seed({ stock: 5, price: 500 });
    await usePaymongo(fakePaymongo());
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));

    await expectRefusal(resolve(placed.checkoutId, { abandon: true }, 'customer2'));
    assertEqual(await stockOf('p1'), 4, 'the hold is untouched');
  });

  await test('PAY-9  an expired hold is released by the scheduler; a fresh one is not', async () => {
    await seed({ stock: 10, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    const old = await placeOrder(payRequest([{ productId: 'p1', quantity: 2 }]));
    const fresh = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));
    await db.collection('checkouts').doc(old.checkoutId).update({
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
    });

    await functions._expireUnpaidCheckouts();
    assertEqual((await checkoutOf(old.checkoutId)).status, 'released', 'the lapsed one is released');
    assertEqual((await checkoutOf(old.checkoutId)).releaseReason, 'expired', 'and says why');
    assertEqual((await checkoutOf(fresh.checkoutId)).status, 'pending', 'the fresh one keeps its hold');
    assertEqual(await stockOf('p1'), 9, 'only the lapsed hold came back');
  });

  await test('PAY-10  if PayMongo cannot be told to stop, the hold is kept', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo({ failExpire: true });
    await usePaymongo(fake);
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));

    const result = await resolve(placed.checkoutId, { abandon: true });
    assertEqual(result.status, 'pending', 'not released');
    assertEqual(await stockOf('p1'), 4, 'a payment could still land, so the piece stays held');
  });

  await test('PAY-11  PayMongo down at checkout: refused, and the hold given back', async () => {
    await seed({ stock: 5, price: 500 });
    await usePaymongo(fakePaymongo({ failCreate: true }));

    await expectRefusal(placeOrder(payRequest([{ productId: 'p1', quantity: 1 }])), 'gateway-unavailable');
    assertEqual(await stockOf('p1'), 5, 'stock restored');
    assertEqual(await orderCount(), 0, 'no order');
  });

  await test('PAY-12  a payment that does not match the total ships nothing', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));
    const session = fake.pay(placed.checkoutId, { amount: 100 });

    await deliverWebhook(session);
    assertEqual(await orderCount(), 0, 'no order for a ₱1 payment on a ₱500 checkout');
    assertEqual((await checkoutOf(placed.checkoutId)).status, 'needs-review', 'flagged for a person');
  });

  await test('PAY-13  paid after the hold was released: flagged for refund, no order', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);
    const placed = await placeOrder(payRequest([{ productId: 'p1', quantity: 1 }]));
    await resolve(placed.checkoutId, { abandon: true });
    const session = fake.pay(placed.checkoutId);

    await deliverWebhook(session);
    assertEqual(await orderCount(), 0, 'the stock may be someone else\'s now');
    const checkout = await checkoutOf(placed.checkoutId);
    assertEqual(checkout.status, 'paid-after-release', 'status');
    assertEqual(checkout.needsReview, 'refund-owed', 'marked for refund');
  });

  await test('PAY-14  with PayMongo on, a sandbox "approved" is refused', async () => {
    // Otherwise the sandbox would be a way to get a free "paid" order
    // from production.
    await seed({ stock: 5, price: 500 });
    await usePaymongo(fakePaymongo());

    await expectRefusal(
      placeOrder(request([{ productId: 'p1', quantity: 1 }], { paymentMethod: 'gcash', sandboxOutcome: 'approved' })),
      'gateway-changed'
    );
    assertEqual(await orderCount(), 0, 'no order');
    assertEqual(await stockOf('p1'), 5, 'no hold');
  });

  await test('PAY-15  the return address must lead back into the app', async () => {
    await seed({ stock: 5, price: 500 });
    await usePaymongo(fakePaymongo());

    for (const returnUrl of ['https://evil.example/steal', 'javascript:alert(1)', '', undefined]) {
      await expectRefusal(placeOrder(payRequest([{ productId: 'p1', quantity: 1 }], { returnUrl })));
    }
    assertEqual(await stockOf('p1'), 5, 'nothing held for any of them');
  });

  await test('PAY-16  with the sandbox on, an app expecting PayMongo is told to reload', async () => {
    await seed({ stock: 5, price: 500 });
    functions._setGatewayForTests(fakePaymongo());
    // No config document: the sandbox, as on every emulator.

    await expectRefusal(placeOrder(payRequest([{ productId: 'p1', quantity: 1 }])), 'gateway-changed');
    assertEqual(await orderCount(), 0, 'no order');
  });

  await test('PAY-17  COD is untouched by the gateway setting', async () => {
    await seed({ stock: 5, price: 500 });
    const fake = fakePaymongo();
    await usePaymongo(fake);

    const placed = await placeOrder(request([{ productId: 'p1', quantity: 1 }]));
    assertEqual(placed.paymentStatus, 'unpaid', 'COD still places at once');
    assertEqual(await orderCount(), 1, 'order written');
    assertEqual(fake.calls.length, 0, 'PayMongo never hears about it');
  });
} finally {
  functions._setGatewayForTests(null);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name } of failures) console.error(`FAILED: ${name}`);
  process.exit(1);
}
