/**
 * Fills out the live catalogue before a UAT session, and raises stock so a
 * room full of respondents can all reach the confirmation screen.
 *
 *     # look, change nothing (default):
 *     node scripts/seed-catalog.mjs
 *
 *     # actually write:
 *     node scripts/seed-catalog.mjs --apply
 *
 * Credentials come from the environment and are never stored here:
 *
 *     PLAINCO_SELLER_EMAIL=...  PLAINCO_SELLER_PASSWORD=...
 *
 * WHY A STORE MANAGER AND NOT THE ADMIN SDK. firestore.rules is the thing
 * being demonstrated, so the seed goes through it rather than around it:
 * signing in as the Store Manager means every write here is a write the
 * app itself could have made, and a product this script creates is
 * indistinguishable from one typed into AdminAddProductScreen. A service
 * account would bypass the rules and could quietly write a shape the app
 * cannot.
 *
 * WHY STOCK MATTERS MORE THAN IT LOOKS. Every order a respondent places
 * decrements real stock. A catalogue with 3 of each item runs dry halfway
 * through a session, and the respondents who follow are told "Not enough
 * stock" — which they will score against "orders are recorded correctly"
 * and "stock levels are accurate", for an app behaving exactly right.
 *
 * Re-running is safe: products are matched by name, and an existing one is
 * left alone apart from its stock.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, collection, getDocs, getDoc, addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';

const APPLY = process.argv.includes('--apply');
const MIN_STOCK = 60;

const EMAIL = process.env.PLAINCO_SELLER_EMAIL;
const PASSWORD = process.env.PLAINCO_SELLER_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    '\nSet the Store Manager credentials first, e.g. in PowerShell:\n\n' +
    '    $env:PLAINCO_SELLER_EMAIL = "manager@example.com"\n' +
    '    $env:PLAINCO_SELLER_PASSWORD = "..."\n\n' +
    'They are read from the environment so they never end up in a file.\n'
  );
  process.exit(1);
}

const firebaseConfig = {
  apiKey: 'AIzaSyCkJSzPnZOuE64ZjmtM2eTFQKSC85JlLsQ',
  authDomain: 'plainco-c3edc.firebaseapp.com',
  projectId: 'plainco-c3edc',
  storageBucket: 'plainco-c3edc.firebasestorage.app',
  messagingSenderId: '67563837487',
  appId: '1:67563837487:web:eeb4c6bfd4534f3a414eda',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Lets this script be rehearsed against the emulators before it is aimed
// at the live store. The product shape here has to satisfy
// isNewProductShape() and productFieldsAreWellTyped() in firestore.rules
// exactly — a missing key or a string where a number belongs is refused —
// and finding that out against production, at night, before a UAT, is the
// wrong time to find it out.
if (process.env.PLAINCO_SEED_EMULATOR === '1') {
  const { connectAuthEmulator } = await import('firebase/auth');
  const { connectFirestoreEmulator } = await import('firebase/firestore');
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  console.log('[emulators] localhost — not touching production\n');
}

// `type` must be exactly one of these two strings. Shopscreen reads
// `item.type === 'ukay-ukay'` and labels everything else "Ready to Wear",
// so a typo does not fail — it silently files the product in the wrong
// category, which is precisely what Section 1 of the UAT asks about.
const UKAY = 'ukay-ukay';
const RTW = 'ready-to-wear';

// Every image was opened and checked before being written here; each one
// is a photograph of the garment it is named after. Colours are drawn
// from COLOR_PALETTE in constants/productOptions.js, and sizes from
// SIZE_OPTIONS, so the filters have real values to work with.
const CATALOG = [
  {
    name: 'Essential White Tee',
    price: 349,
    type: RTW,
    description: 'Plain cotton crew neck in white. Soft, breathable, and cut straight through the body — the shirt you reach for when nothing else is clean.',
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900&q=80',
    colors: ['White'],
    sizes: ['S', 'M', 'L', 'XL'],
  },
  {
    name: 'Plain Cotton Tee',
    price: 299,
    type: RTW,
    description: 'Everyday cotton tee available in six colours. Pre-shrunk, mid-weight, and honest about what it is — no print, no logo, no fuss.',
    imageUrl: 'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=900&q=80',
    colors: ['Red', 'Black', 'White', 'Navy', 'Yellow'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    name: 'Satin Jogger Pants',
    price: 749,
    type: RTW,
    description: 'High-waisted joggers in blush satin with elasticated cuffs and deep patch pockets. Dresses up with heels, down with sneakers.',
    imageUrl: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=900&q=80',
    colors: ['Pink', 'Beige'],
    sizes: ['S', 'M', 'L'],
  },
  {
    name: 'Rust Bomber Jacket',
    price: 1290,
    type: RTW,
    description: 'Lightweight bomber in rust, with a zip sleeve pocket and ribbed cuffs. Warm enough for an aircon office, light enough for a Manila evening.',
    imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=900&q=80',
    colors: ['Brown'],
    sizes: ['M', 'L', 'XL'],
  },
  {
    name: 'Graphic Print Tee',
    price: 249,
    type: UKAY,
    description: 'Thrifted graphic tee in sand, with a bold block print across the chest. Lightly worn with no marks or holes — the print is still sharp.',
    imageUrl: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=900&q=80',
    colors: ['Beige'],
    sizes: ['M', 'L'],
  },
  {
    name: 'Knit Fringe Poncho',
    price: 459,
    type: UKAY,
    description: 'Cream open-knit poncho with a fringed hem. Preloved and in good condition — one small pull on the back hem, not visible when worn.',
    imageUrl: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=900&q=80',
    colors: ['Beige', 'White'],
    sizes: ['M', 'L'],
  },
  {
    name: 'Leather Biker Jacket',
    price: 1850,
    type: UKAY,
    description: 'Classic black biker jacket with asymmetric zip and snap lapels. Secondhand, well broken in — the leather has softened and the hardware all works.',
    imageUrl: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=900&q=80',
    colors: ['Black'],
    sizes: ['S', 'M', 'L'],
  },
  {
    name: 'Straight-Cut Jeans',
    price: 599,
    type: UKAY,
    description: 'Preloved straight-leg denim in three washes. Sturdy, no stretch, and already softened from wear — check the size guide before choosing.',
    imageUrl: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=900&q=80',
    colors: ['Blue', 'Navy', 'Black'],
    sizes: ['S', 'M', 'L', 'XL'],
  },
];

console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);

const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
console.log(`Signed in as ${cred.user.email}`);

// Seeds the signed-in manager's OWN store, and only that store: the rules
// refuse a product under any other storeId, and restocking another
// store's items is not this manager's call. A manager with no store is
// refused here rather than at the first write.
const me = await getDoc(doc(db, 'users', cred.user.uid));
const STORE_ID = me.exists() ? me.data().storeId : undefined;
if (typeof STORE_ID !== 'string' || !STORE_ID) {
  console.error(
    '\nThis account is not assigned to a store. Have a Platform Admin assign\n' +
    'one in Manage Users (or run scripts/migrate-to-stores.mjs), then re-run.\n'
  );
  process.exit(1);
}
const store = await getDoc(doc(db, 'stores', STORE_ID));
console.log(`Store: ${store.exists() ? store.data().name : STORE_ID}\n`);

const snap = await getDocs(collection(db, 'products'));
const existing = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((p) => p.storeId === STORE_ID);

console.log(`This store's catalogue right now: ${existing.length} product(s)`);
for (const p of existing) {
  const label = p.type === UKAY ? 'Ukay-Ukay    ' : 'Ready-to-Wear';
  console.log(`  ${label}  stock ${String(p.stock).padStart(4)}  ${p.name}`);
}

const byName = new Set(existing.map((p) => (p.name || '').trim().toLowerCase()));
const toAdd = CATALOG.filter((p) => !byName.has(p.name.toLowerCase()));
const lowStock = existing.filter((p) => Number(p.stock) < MIN_STOCK);

console.log(`\nWould add ${toAdd.length} product(s):`);
for (const p of toAdd) {
  console.log(`  ${p.type === UKAY ? 'Ukay-Ukay    ' : 'Ready-to-Wear'}  P${p.price}  ${p.name}`);
}
console.log(`\nWould raise stock to ${MIN_STOCK} on ${lowStock.length} existing product(s).`);

if (!APPLY) {
  console.log('\nRe-run with --apply to write.\n');
  process.exit(0);
}

for (const p of toAdd) {
  // createdAt must be the server's own timestamp: the create rule asserts
  // createdAt == request.time, so a client-side Date is rejected. It is
  // also what ProductContext orders the catalogue by — a product without
  // it is invisible in the app.
  await addDoc(collection(db, 'products'), {
    ...p, stock: MIN_STOCK, storeId: STORE_ID, createdAt: serverTimestamp(),
  });
  console.log(`  added   ${p.name}`);
}

for (const p of lowStock) {
  await updateDoc(doc(db, 'products', p.id), { stock: MIN_STOCK });
  console.log(`  stocked ${p.name}  ${p.stock} -> ${MIN_STOCK}`);
}

const after = await getDocs(collection(db, 'products'));
const all = after.docs.map((d) => d.data()).filter((p) => p.storeId === STORE_ID);
const ukay = all.filter((p) => p.type === UKAY).length;
console.log(`\nDone. ${all.length} products live in this store —${ukay} Ukay-Ukay, ${all.length - ukay} Ready-to-Wear.\n`);
process.exit(0);
