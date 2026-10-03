/**
 * End-to-end test of requestReturn and the deliveredAt stamp against the
 * Firestore emulator.
 *
 *     npm run test:returns
 *
 * Same arrangement as test-checkout.mjs: the real handlers, called with
 * plain request objects, reading and writing the emulator. What the rules
 * allow AFTER a request exists — a manager approving, declining, marking
 * refunded — is test-rules.mjs's job (the RETURN-* cases there).
 */
import { createRequire } from 'node:module';

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'plainco-returns-test';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set — run this through `npm run test:returns`.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
// index.js first: it is what calls initializeApp().
require('../functions/index.js');
const returns = require('../functions/returns.js');
const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { getFirestore, Timestamp } = requireFromFunctions('firebase-admin/firestore');

const db = getFirestore();
const requestReturn = returns._handleRequestReturn;
const orderDelivered = returns._handleOrderDelivered;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 3, 4, 0, 0);

let passed = 0;
const failures = [];

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

async function expectRefusal(promise, { code, reason } = {}) {
  try {
    await promise;
  } catch (error) {
    if (code && error.code !== code) {
      throw new Error(`expected code "${code}", got "${error.code}" (${error.message})`);
    }
    if (reason && error.details?.reason !== reason) {
      throw new Error(`expected reason "${reason}", got "${error.details?.reason}" (${error.message})`);
    }
    return error;
  }
  throw new Error('expected a refusal, but the request succeeded');
}

const photo = (orderId, { uid = 'customer1', name = 'a.jpg', bucket } = {}) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket || `${process.env.GCLOUD_PROJECT}.firebasestorage.app`}` +
  `/o/returns%2F${uid}%2F${orderId}%2F${name}?alt=media&token=abc-123`;

const PAYOUT = { method: 'gcash', accountName: 'Cathy Customer', accountNumber: '09171234567' };

// A request as the callable hands it over. Note what it does NOT carry
// that the stored document does: the amount, the store, the prices.
const ask = (orderId, overrides = {}, uid = 'customer1') => ({
  auth: { uid, token: { email: `${uid}@example.com` } },
  data: {
    orderId,
    reason: 'wrong_size',
    note: 'Ordered M, the tag says L.',
    lines: [{ index: 0 }],
    photoUrls: [photo(orderId, { uid })],
    payout: PAYOUT,
    ...overrides,
  },
});

const ITEMS = [
  { productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 1, size: 'M', color: 'Blue', image: 'https://example.test/1.jpg', storeId: 'storeA' },
  { productId: 'p2', name: 'Linen Shirt', price: 300, quantity: 3, size: 'S', color: 'White', image: 'https://example.test/2.jpg', storeId: 'storeA' },
];

async function wipe() {
  for (const uid of ['customer1', 'customer2', 'staff1', 'gone1']) {
    for (const sub of ['orders', 'returnRequests']) {
      const snapshot = await db.collection('users').doc(uid).collection(sub).get();
      await Promise.all(snapshot.docs.map((d) => d.ref.delete()));
    }
    await db.collection('users').doc(uid).delete();
  }
}

async function seed() {
  await wipe();
  await db.collection('users').doc('customer1').set({ uid: 'customer1', email: 'cathy@example.com' });
  await db.collection('users').doc('customer2').set({ uid: 'customer2', email: 'carl@example.com' });
  await db.collection('users').doc('staff1').set({ uid: 'staff1', role: 'seller', storeId: 'storeA' });
  await db.collection('users').doc('gone1').set({ uid: 'gone1', isActive: false });

  const order = (overrides) => ({
    customerId: 'customer1',
    customerEmail: 'cathy@example.com',
    storeId: 'storeA',
    storeName: 'Tindahan A',
    items: ITEMS,
    subtotal: 1750,
    shipping: 0,
    total: 1750,
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    status: 'delivered',
    deliveredAt: Timestamp.fromMillis(NOW - 2 * DAY),
    ...overrides,
  });
  const orders = db.collection('users').doc('customer1').collection('orders');
  await orders.doc('cod1').set(order());
  await orders.doc('paid1').set(order({ paymentMethod: 'gcash', paymentStatus: 'paid', paymentProvider: 'paymongo' }));
  await orders.doc('shipped1').set(order({ status: 'shipped', deliveredAt: null }));
  await orders.doc('legacy1').set(order({ deliveredAt: null }));
  for (const uid of ['staff1', 'gone1']) {
    await db.collection('users').doc(uid).collection('orders').doc('own1').set(order({ customerId: uid }));
  }
}

const storedRequest = async (orderId, uid = 'customer1') =>
  (await db.collection('users').doc(uid).collection('returnRequests').doc(orderId).get()).data();

console.log('\nDelivery date');

await test('RET-1  deliveredAt is stamped when an order becomes delivered, and only then', async () => {
  await seed();
  const ref = db.collection('users').doc('customer1').collection('orders').doc('shipped1');

  assertEqual(await orderDelivered({ status: 'processing' }, { status: 'shipped' }, ref), false, 'shipped is not delivered');
  assertEqual((await ref.get()).data().deliveredAt, null, 'nothing written for shipped');

  assertEqual(await orderDelivered({ status: 'shipped' }, { status: 'delivered' }, ref), true, 'delivered stamps');
  assert((await ref.get()).data().deliveredAt instanceof Timestamp, 'deliveredAt is a server timestamp');

  // The trigger's own write fires it again, and order chat writes to a
  // delivered order all the time. Neither moves the date.
  assertEqual(await orderDelivered({ status: 'delivered' }, { status: 'delivered' }, ref), false, 'no re-stamp');
});

console.log('\nReporting a problem — accepted');

await test('RET-2  a COD request stores what the ORDER says, plus where to send the money', async () => {
  await seed();
  const result = await requestReturn(ask('cod1'), NOW);
  assertEqual(result.status, 'requested', 'returned status');

  const stored = await storedRequest('cod1');
  assertEqual(stored.status, 'requested', 'status');
  assertEqual(stored.customerId, 'customer1', 'customerId');
  assertEqual(stored.storeId, 'storeA', 'storeId copied from the order');
  assertEqual(stored.reason, 'wrong_size', 'reason');
  assertEqual(stored.items.length, 1, 'one line');
  assertEqual(stored.items[0].name, 'Denim Jacket', 'line copied from the order');
  assertEqual(stored.items[0].size, 'M', 'size copied');
  assertEqual(stored.refundAmount, 850, 'amount');
  assertEqual(stored.refundMethod, 'gcash', 'refund method');
  assertEqual(stored.payout.accountNumber, '09171234567', 'payout account');
  assertEqual(stored.photoUrls.length, 1, 'photo');
});

await test('RET-3  the client CANNOT set the amount or the prices', async () => {
  await seed();
  await requestReturn(ask('cod1', {
    refundAmount: 99999,
    storeId: 'storeB',
    status: 'refunded',
    lines: [{ index: 0, price: 99999 }],
  }), NOW);
  const stored = await storedRequest('cod1');
  assertEqual(stored.refundAmount, 850, 'amount from the order');
  assertEqual(stored.items[0].price, 850, 'price from the order');
  assertEqual(stored.storeId, 'storeA', 'store from the order');
  assertEqual(stored.status, 'requested', 'status pinned');
});

await test('RET-4  part of a line, and several lines, add up correctly', async () => {
  await seed();
  await requestReturn(ask('cod1', { lines: [{ index: 0 }, { index: 1, quantity: 2 }] }), NOW);
  const stored = await storedRequest('cod1');
  assertEqual(stored.items[1].quantity, 2, 'two of three shirts');
  assertEqual(stored.refundAmount, 850 + 2 * 300, 'amount');
});

await test('RET-5  an order paid online is refunded to where it came from', async () => {
  await seed();
  await requestReturn(ask('paid1', { payout: undefined }), NOW);
  const stored = await storedRequest('paid1');
  assertEqual(stored.refundMethod, 'original', 'refund method');
  assertEqual(stored.payout, null, 'no payout details asked for');

  // Sent anyway, they are not stored: the store has no business holding a
  // bank account it will never pay into.
  await seed();
  await requestReturn(ask('paid1'), NOW);
  assertEqual((await storedRequest('paid1')).payout, null, 'payout ignored');
});

await test('RET-6  the last minute of day 7 is still inside the window', async () => {
  await seed();
  await requestReturn(ask('cod1'), NOW - 2 * DAY + 7 * DAY - 60 * 1000);
  assertEqual((await storedRequest('cod1')).status, 'requested', 'accepted');
});

console.log('\nReporting a problem — refused');

await test('RET-7  one request per order', async () => {
  await seed();
  await requestReturn(ask('cod1'), NOW);
  await expectRefusal(requestReturn(ask('cod1', { reason: 'wrong_item' }), NOW), { reason: 'already-requested' });
  assertEqual((await storedRequest('cod1')).reason, 'wrong_size', 'the first request is untouched');
});

await test('RET-8  after 7 days the window is closed', async () => {
  await seed();
  await expectRefusal(requestReturn(ask('cod1'), NOW - 2 * DAY + 7 * DAY + 60 * 1000), { reason: 'window-closed' });
  assertEqual(await storedRequest('cod1'), undefined, 'nothing written');
});

await test('RET-9  only a delivered order, and only one with a delivery date', async () => {
  await seed();
  await expectRefusal(requestReturn(ask('shipped1'), NOW), { reason: 'not-delivered' });
  await expectRefusal(requestReturn(ask('legacy1'), NOW), { reason: 'no-delivery-date' });
});

await test('RET-10  another customer\'s order does not exist, as far as the caller can tell', async () => {
  await seed();
  // customer2 asks about customer1's order, with photos under their own
  // folder for it — the lookup is under the caller's uid, so it is not found.
  await expectRefusal(requestReturn(ask('cod1', {}, 'customer2'), NOW), { code: 'not-found' });
  await expectRefusal(requestReturn(ask('nope', {}), NOW), { code: 'not-found' });
  await expectRefusal(requestReturn(ask('../orders/cod1', {}), NOW), { code: 'invalid-argument' });
});

await test('RET-11  photos are required, capped, and must be this order\'s', async () => {
  await seed();
  await expectRefusal(requestReturn(ask('cod1', { photoUrls: [] }), NOW), { reason: 'photo-required' });
  await expectRefusal(requestReturn(ask('cod1', { photoUrls: undefined }), NOW), { reason: 'photo-required' });
  const four = ['a', 'b', 'c', 'd'].map((n) => photo('cod1', { name: `${n}.jpg` }));
  await expectRefusal(requestReturn(ask('cod1', { photoUrls: four }), NOW), { code: 'invalid-argument' });
  for (const url of [
    photo('paid1'),
    photo('cod1', { uid: 'customer2' }),
    photo('cod1', { bucket: 'someone-else.firebasestorage.app' }),
    photo('cod1').replace('https:', 'http:'),
    photo('cod1').replace('firebasestorage.googleapis.com', 'example.com'),
    photo('cod1', { name: 'x%2F..%2Fy.jpg' }),
    'not a url',
    42,
  ]) {
    await expectRefusal(requestReturn(ask('cod1', { photoUrls: [url] }), NOW), { code: 'invalid-argument' });
  }
  assertEqual(await storedRequest('cod1'), undefined, 'nothing written');
  const three = ['a', 'b', 'c'].map((n) => photo('cod1', { name: `${n}.jpg` }));
  await requestReturn(ask('cod1', { photoUrls: three }), NOW);
  assertEqual((await storedRequest('cod1')).photoUrls.length, 3, 'three accepted');
});

await test('RET-12  the chosen lines must be on the order, once each, in sensible amounts', async () => {
  await seed();
  for (const lines of [
    [],
    undefined,
    [{ index: 2 }],
    [{ index: -1 }],
    [{ index: '0' }, { index: 0 }],
    [{ index: 0 }, { index: 0 }],
    [{ index: 1, quantity: 0 }],
    [{ index: 1, quantity: 4 }],
    [{ index: 1, quantity: 1.5 }],
    [{ index: 0 }, { index: 1 }, { index: 1 }],
  ]) {
    await expectRefusal(requestReturn(ask('cod1', { lines }), NOW), { code: 'invalid-argument' });
  }
  assertEqual(await storedRequest('cod1'), undefined, 'nothing written');
});

await test('RET-13  a COD request must say where the refund goes', async () => {
  await seed();
  await expectRefusal(requestReturn(ask('cod1', { payout: undefined }), NOW), { reason: 'payout-required' });
  await expectRefusal(requestReturn(ask('cod1', { payout: { method: 'cash' } }), NOW), { reason: 'payout-required' });
  await expectRefusal(requestReturn(ask('cod1', { payout: { ...PAYOUT, accountNumber: '   ' } }), NOW), { reason: 'payout-required' });
  await expectRefusal(requestReturn(ask('cod1', { payout: { method: 'bank', accountName: 'Cathy', accountNumber: '123' } }), NOW), { reason: 'payout-required' });
  await requestReturn(ask('cod1', { payout: { method: 'bank', accountName: 'Cathy', accountNumber: '123', bankName: 'BPI' } }), NOW);
  assertEqual((await storedRequest('cod1')).payout.bankName, 'BPI', 'bank payout');
});

await test('RET-14  a reason from the list, and a note that is text', async () => {
  await seed();
  await expectRefusal(requestReturn(ask('cod1', { reason: 'changed_my_mind' }), NOW), { code: 'invalid-argument' });
  await expectRefusal(requestReturn(ask('cod1', { reason: undefined }), NOW), { code: 'invalid-argument' });
  await expectRefusal(requestReturn(ask('cod1', { note: { text: 'x' } }), NOW), { code: 'invalid-argument' });
  await requestReturn(ask('cod1', { note: 'x'.repeat(5000) }), NOW);
  assertEqual((await storedRequest('cod1')).note.length, 1000, 'note capped');
});

await test('RET-15  signed out, deactivated and staff accounts are refused', async () => {
  await seed();
  await expectRefusal(requestReturn({ data: ask('cod1').data }, NOW), { code: 'unauthenticated' });
  await expectRefusal(requestReturn(ask('own1', {}, 'gone1'), NOW), { code: 'permission-denied' });
  await expectRefusal(requestReturn(ask('own1', {}, 'staff1'), NOW), { code: 'permission-denied' });
});

await wipe();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name } of failures) console.error(`FAILED: ${name}`);
  process.exit(1);
}
