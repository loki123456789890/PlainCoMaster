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

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'plainco-checkout-test';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set — run this through `npm run test:checkout`.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const functions = require('../functions/index.js');
const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { getFirestore } = requireFromFunctions('firebase-admin/firestore');

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
  for (const path of ['products', 'rateLimits', 'mailLog']) {
    const snapshot = await db.collection(path).get();
    await Promise.all(snapshot.docs.map((d) => d.ref.delete()));
  }
  for (const sub of ['orders', 'cart']) {
    const snapshot = await db.collection('users').doc('customer1').collection(sub).get();
    await Promise.all(snapshot.docs.map((d) => d.ref.delete()));
  }
  await db.collection('users').doc('customer1').delete();
}

async function seed({ stock = 10, price = 850, isActive = true, address = ADDRESS } = {}) {
  await wipe();
  const user = { uid: 'customer1', name: 'Cathy Customer', email: 'cathy@example.com' };
  if (address) user.shippingAddress = address;
  if (isActive === false) user.isActive = false;
  await db.collection('users').doc('customer1').set(user);

  await db.collection('products').doc('p1').set({
    name: 'Denim Jacket', price, stock, type: 'ukay',
    description: 'Well loved.', imageUrl: 'https://example.test/1.jpg',
    colors: ['Blue'], sizes: ['M'],
  });
  await db.collection('products').doc('p2').set({
    name: 'Wool Overcoat', price: 1200, stock: 3, type: 'ready',
    description: 'Warm.', imageUrl: 'https://example.test/2.jpg',
    colors: ['Grey'], sizes: ['L'],
  });
}

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
    .collection('orders').doc(placed.orderId).get()).data();
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
    .collection('orders').doc(placed.orderId).get()).data();
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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name } of failures) console.error(`FAILED: ${name}`);
  process.exit(1);
}
