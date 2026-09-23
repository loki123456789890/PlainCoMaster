/**
 * One-time split of the migrated catalogue into two stores, by type.
 *
 *     # look, change nothing (default):
 *     node scripts/split-stores.mjs --rtw-manager someone@example.com
 *
 *     # actually write:
 *     node scripts/split-stores.mjs --rtw-manager someone@example.com --apply
 *
 * migrate-to-stores.mjs put everything in one store and named it after the
 * app. The app is not a store, so this renames that store to an ukay-ukay
 * shop and opens a ready-to-wear shop beside it:
 *
 *   - store `plainco` is renamed (its id stays — ids are never shown)
 *   - store `rtw` is opened
 *   - every 'ready-to-wear' product moves to `rtw`
 *   - an order whose items are ALL ready-to-wear moves to `rtw`, and its
 *     reviews and its confirmation's mail log entry follow it. A mixed
 *     order stays where it is: it was one parcel, and splitting it after
 *     the fact would invent two orders the customer never saw.
 *   - --rtw-manager moves that one Store Manager to `rtw`, so the new
 *     store has someone who can work its orders
 *   - every order's storeName snapshot is rewritten to the new names —
 *     the old one was the app's name, which was never true
 *
 * Admin SDK for the same reason as migrate-to-stores.mjs: the rules refuse
 * any change to a product's storeId. Credentials the same way too.
 *
 * Re-running is safe: products and orders already in `rtw` are left alone,
 * and names already correct are not rewritten.
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const argValue = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const APPLY = process.argv.includes('--apply');
const WILL = APPLY ? 'Will' : 'Would';
const UKAY_ID = 'plainco';
const UKAY_NAME = argValue('--ukay-name', 'Ukay-Ukay ni Aling Nena').trim();
const RTW_ID = 'rtw';
const RTW_NAME = argValue('--rtw-name', 'Divisoria RTW Hub').trim();
const RTW_MANAGER = argValue('--rtw-manager', '').trim().toLowerCase();
const RTW_TYPE = 'ready-to-wear';

for (const name of [UKAY_NAME, RTW_NAME]) {
  if (!name || name.length > 60) {
    console.error('\nStore names must be 1 to 60 characters.\n');
    process.exit(1);
  }
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'plainco-c3edc' });
const db = getFirestore();

const target = process.env.FIRESTORE_EMULATOR_HOST
  ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
  : 'PRODUCTION (plainco-c3edc)';
console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'} — ${target}\n`);

const ukaySnap = await db.doc(`stores/${UKAY_ID}`).get();
if (!ukaySnap.exists) {
  console.error(`No store "${UKAY_ID}" — run migrate-to-stores.mjs first.\n`);
  process.exit(1);
}
const rtwSnap = await db.doc(`stores/${RTW_ID}`).get();

const products = (await db.collection('products').where('storeId', '==', UKAY_ID).get()).docs;
const rtwProducts = products.filter((d) => d.data().type === RTW_TYPE);
const rtwProductIds = new Set([
  ...rtwProducts.map((d) => d.id),
  // Already moved on an earlier run — still ready-to-wear for order matching.
  ...(await db.collection('products').where('storeId', '==', RTW_ID).get()).docs.map((d) => d.id),
]);

const orders = (await db.collectionGroup('orders').get()).docs;
const isAllRtw = (order) => {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.length > 0 && items.every((item) => rtwProductIds.has(item.productId));
};
const movingOrders = orders.filter((d) => d.data().storeId === UKAY_ID && isAllRtw(d.data()));
const movingOrderIds = new Set(movingOrders.map((d) => d.id));

const reviews = (await db.collection('reviews').where('storeId', '==', UKAY_ID).get()).docs
  .filter((d) => movingOrderIds.has(d.data().orderId));
const mail = (await Promise.all(
  [...movingOrderIds].map((id) => db.doc(`mailLog/order-${id}`).get())
)).filter((snap) => snap.exists);

let manager = null;
if (RTW_MANAGER) {
  const found = (await db.collection('users').where('email', '==', RTW_MANAGER).get()).docs;
  manager = found.find((d) => d.data().role === 'seller') || null;
  if (!manager) {
    console.error(`No Store Manager with email ${RTW_MANAGER}.\n`);
    process.exit(1);
  }
}
const managerMoves = manager !== null && manager.data().storeId !== RTW_ID;

// Every order's name snapshot, after the moves above.
const storeNameFor = (d) => {
  const storeId = movingOrderIds.has(d.id) ? RTW_ID : d.data().storeId;
  if (storeId === UKAY_ID) return UKAY_NAME;
  if (storeId === RTW_ID) return RTW_NAME;
  return null;
};
const renamedOrders = orders.filter((d) => {
  const name = storeNameFor(d);
  return name !== null && d.data().storeName !== name && !movingOrderIds.has(d.id);
});

console.log(
  ukaySnap.data().name === UKAY_NAME
    ? `Store ${UKAY_ID} is already named "${UKAY_NAME}".`
    : `${WILL} rename store ${UKAY_ID} "${ukaySnap.data().name}" → "${UKAY_NAME}".`
);
console.log(
  rtwSnap.exists
    ? `Store ${RTW_ID} "${rtwSnap.data().name}" already exists — reusing it.`
    : `${WILL} open store ${RTW_ID} "${RTW_NAME}".`
);
console.log(`\nProducts staying in "${UKAY_NAME}":`);
for (const d of products.filter((p) => p.data().type !== RTW_TYPE)) {
  console.log(`  ${d.data().type ?? '(no type)'}  ${d.data().name ?? d.id}`);
}
console.log(`\n${WILL} move ${rtwProducts.length} product(s) to "${RTW_NAME}":`);
for (const d of rtwProducts) console.log(`  ${d.data().type}  ${d.data().name ?? d.id}`);
console.log(`\n${WILL} move ${movingOrders.length} all-ready-to-wear order(s), ` +
  `${reviews.length} review(s) and ${mail.length} mail log entries to "${RTW_NAME}".`);
console.log(`${WILL} rewrite the store name on ${renamedOrders.length} other order(s).`);
console.log(
  !manager
    ? 'No --rtw-manager given: the new store will have no manager to work its orders.'
    : managerMoves
    ? `${WILL} move Store Manager ${RTW_MANAGER} to "${RTW_NAME}".`
    : `Store Manager ${RTW_MANAGER} already runs "${RTW_NAME}".`
);

if (!APPLY) {
  console.log('\nRe-run with --apply to write.\n');
  process.exit(0);
}

const pending = [
  [db.doc(`stores/${UKAY_ID}`), { name: UKAY_NAME }],
  ...rtwProducts.map((d) => [d.ref, { storeId: RTW_ID }]),
  ...movingOrders.map((d) => [d.ref, { storeId: RTW_ID, storeName: RTW_NAME }]),
  ...renamedOrders.map((d) => [d.ref, { storeName: storeNameFor(d) }]),
  ...reviews.map((d) => [d.ref, { storeId: RTW_ID }]),
  ...mail.map((snap) => [snap.ref, { storeId: RTW_ID }]),
  ...(managerMoves ? [[manager.ref, { storeId: RTW_ID }]] : []),
];

// The new store first and on its own: the manager and products point at it.
if (!rtwSnap.exists) {
  await db.doc(`stores/${RTW_ID}`).set({ name: RTW_NAME, createdAt: FieldValue.serverTimestamp() });
}
for (let i = 0; i < pending.length; i += 400) {
  const batch = db.batch();
  for (const [ref, fields] of pending.slice(i, i + 400)) batch.update(ref, fields);
  await batch.commit();
}

console.log(`\nDone. "${UKAY_NAME}" and "${RTW_NAME}" are open.\n`);
process.exit(0);
