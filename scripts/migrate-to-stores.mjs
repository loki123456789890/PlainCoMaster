/**
 * One-time move from a single store to multi-store.
 *
 *     # look, change nothing (default):
 *     node scripts/migrate-to-stores.mjs
 *
 *     # actually write:
 *     node scripts/migrate-to-stores.mjs --apply
 *
 *     # name the store the existing catalogue belongs to:
 *     node scripts/migrate-to-stores.mjs --name "PlainCo Ukay" --apply
 *
 * Opens one store (id `plainco` unless --id says otherwise) and assigns it
 * everything written before stores existed: every product, Store Manager
 * and order with no storeId. Until that happens, firestore.rules freezes
 * those products and orders for everyone, leaves those managers able to
 * change nothing, and placeOrder refuses the products as unavailable —
 * see managesStore().
 *
 * WHY THE ADMIN SDK, when seed-catalog.mjs deliberately goes through the
 * rules: no client may give an existing product a store. The rules refuse
 * any update that changes storeId, and they refuse every write to a
 * product that has none. That is correct for the app (a manager claiming
 * unowned stock would be picking which store gets it), and it means this
 * migration is exactly the kind of write the rules exist to prevent. So
 * it runs as Admin, once, by a person who has decided where the existing
 * catalogue belongs.
 *
 * Credentials: Application Default Credentials. Run
 * `gcloud auth application-default login` first, or set
 * GOOGLE_APPLICATION_CREDENTIALS to a service-account key. With
 * FIRESTORE_EMULATOR_HOST set, it talks to the emulator instead and needs
 * no credentials; rehearse there first.
 *
 * DO NOT RUN AGAINST PRODUCTION BEFORE THE UAT SESSION. The live app does
 * not know about stores yet, and the questionnaire describes one store.
 *
 * Re-running is safe: anything that already has a storeId is left alone.
 */
import { createRequire } from 'node:module';

// firebase-admin is a dependency of functions/, not of the app, and it
// should stay that way: the app bundle has no business shipping it.
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const argValue = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const APPLY = process.argv.includes('--apply');
const WILL = APPLY ? 'Will' : 'Would';
const STORE_ID = argValue('--id', 'plainco');
const STORE_NAME = argValue('--name', 'PlainCo').trim();

// Mirrors the /stores create rule, so the store this opens is one the app
// itself could have opened.
if (!STORE_NAME || STORE_NAME.length > 60) {
  console.error('\n--name must be 1 to 60 characters.\n');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,64}$/.test(STORE_ID)) {
  console.error('\n--id may use only letters, digits, - and _.\n');
  process.exit(1);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'plainco-c3edc' });
const db = getFirestore();

const target = process.env.FIRESTORE_EMULATOR_HOST
  ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
  : 'PRODUCTION (plainco-c3edc)';
console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'} — ${target}\n`);

const hasStore = (data) => typeof data.storeId === 'string' && data.storeId !== '';

const storeRef = db.doc(`stores/${STORE_ID}`);
const storeSnap = await storeRef.get();

const products = (await db.collection('products').get()).docs.filter((d) => !hasStore(d.data()));
const managers = (await db.collection('users').where('role', '==', 'seller').get()).docs
  .filter((d) => !hasStore(d.data()));
// Every order placed before stores existed came from the one store there
// was. Without a storeId no manager may move it past its current status.
const orders = (await db.collectionGroup('orders').get()).docs.filter((d) => !hasStore(d.data()));
// Reviews and store-activity entries are read per store too: without a
// storeId they would vanish from every manager's moderation queue and log.
const reviews = (await db.collection('reviews').get()).docs.filter((d) => !hasStore(d.data()));
const activity = (await db.collection('activityLogs').get()).docs.filter((d) => !hasStore(d.data()));

console.log(
  storeSnap.exists
    ? `Store "${storeSnap.data().name}" (${STORE_ID}) already exists — reusing it.`
    : `${WILL} open store "${STORE_NAME}" (${STORE_ID}).`
);
console.log(`${WILL} assign ${products.length} product(s) with no store:`);
for (const d of products) console.log(`  product  ${d.data().name ?? d.id}`);
console.log(`${WILL} assign ${managers.length} Store Manager(s) with no store:`);
for (const d of managers) console.log(`  manager  ${d.data().email ?? d.id}`);
// Counted, not listed: a live store can have hundreds.
console.log(`${WILL} assign ${orders.length} order(s) with no store.`);
console.log(`${WILL} assign ${reviews.length} review(s) and ${activity.length} activity entries with no store.`);

if (!APPLY) {
  console.log('\nRe-run with --apply to write.\n');
  process.exit(0);
}

if (!storeSnap.exists) {
  await storeRef.set({ name: STORE_NAME, createdAt: FieldValue.serverTimestamp() });
}

// Orders get the name too, as placeOrder writes it: a snapshot of who sold
// it, so order lists need no read per row.
const storeName = storeSnap.exists ? storeSnap.data().name : STORE_NAME;
const pending = [
  ...[...products, ...managers, ...reviews, ...activity].map((d) => [d.ref, { storeId: STORE_ID }]),
  ...orders.map((d) => [d.ref, { storeId: STORE_ID, storeName }]),
];

// Firestore caps a batch at 500 writes; 400 leaves room.
for (let i = 0; i < pending.length; i += 400) {
  const batch = db.batch();
  for (const [ref, fields] of pending.slice(i, i + 400)) batch.update(ref, fields);
  await batch.commit();
}

console.log(
  `\nDone. ${products.length} product(s), ${managers.length} manager(s), ` +
  `${orders.length} order(s), ${reviews.length} review(s) and ` +
  `${activity.length} activity entries now belong to ${STORE_ID}.\n`
);
process.exit(0);
