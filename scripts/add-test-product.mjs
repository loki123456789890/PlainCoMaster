/**
 * Adds one clearly-named test listing to check "Just in", the last-piece
 * note and the multi-photo gallery on a phone, and removes it afterwards.
 *
 *     node scripts/add-test-product.mjs           # add it
 *     node scripts/add-test-product.mjs --remove  # delete it again
 *
 * Signs in as a Store Manager, like seed-catalog.mjs, so the write goes
 * through firestore.rules exactly as Add Product's would:
 *
 *     $env:PLAINCO_SELLER_EMAIL = "manager@example.com"
 *     $env:PLAINCO_SELLER_PASSWORD = "..."
 *
 * The listing is an ukay piece with a stock of 1 (so it shows "Just in"
 * and "One of a kind"), every photo slot filled, and one flaw with its
 * photo. The front is a real photo; the other slots are labelled
 * placeholders so each one is easy to tell apart in the gallery.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, collection, getDocs, getDoc, addDoc, deleteDoc, doc, query, where, serverTimestamp,
} from 'firebase/firestore';

const REMOVE = process.argv.includes('--remove');
const NAME = 'TEST · Sand Graphic Tee';

const EMAIL = process.env.PLAINCO_SELLER_EMAIL;
const PASSWORD = process.env.PLAINCO_SELLER_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('\nSet PLAINCO_SELLER_EMAIL and PLAINCO_SELLER_PASSWORD first (see the top of this file).\n');
  process.exit(1);
}

const app = initializeApp({
  apiKey: 'AIzaSyCkJSzPnZOuE64ZjmtM2eTFQKSC85JlLsQ',
  authDomain: 'plainco-c3edc.firebaseapp.com',
  projectId: 'plainco-c3edc',
  storageBucket: 'plainco-c3edc.firebasestorage.app',
  messagingSenderId: '67563837487',
  appId: '1:67563837487:web:eeb4c6bfd4534f3a414eda',
});
const auth = getAuth(app);
const db = getFirestore(app);

if (process.env.PLAINCO_SEED_EMULATOR === '1') {
  const { connectAuthEmulator } = await import('firebase/auth');
  const { connectFirestoreEmulator } = await import('firebase/firestore');
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  console.log('[emulators] localhost — not touching production\n');
}

const placeholder = (bg, fg, text) =>
  `https://placehold.co/900x1125/${bg}/${fg}/png?text=${encodeURIComponent(text).replace(/%20/g, '+')}`;

const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
const me = await getDoc(doc(db, 'users', cred.user.uid));
const STORE_ID = me.exists() ? me.data().storeId : undefined;
if (typeof STORE_ID !== 'string' || !STORE_ID) {
  console.error(`\n${cred.user.email} is not assigned to a store.\n`);
  process.exit(1);
}
const store = await getDoc(doc(db, 'stores', STORE_ID));
console.log(`Signed in as ${cred.user.email} — ${store.exists() ? store.data().name : STORE_ID}`);

const existing = await getDocs(
  query(collection(db, 'products'), where('storeId', '==', STORE_ID), where('name', '==', NAME))
);

if (REMOVE) {
  for (const d of existing.docs) {
    await deleteDoc(d.ref);
    console.log(`Removed ${NAME} (${d.id})`);
  }
  if (existing.empty) console.log('Nothing to remove.');
  process.exit(0);
}

if (!existing.empty) {
  console.log(`${NAME} is already listed (${existing.docs[0].id}). Remove it first to list it fresh.`);
  process.exit(0);
}

// The same keys Add Product writes for an ukay piece with flaws found.
const ref = await addDoc(collection(db, 'products'), {
  name: NAME,
  brand: 'Hanes',
  section: 'unisex',
  category: 'tops',
  condition: 'gently-used',
  flawCheck: 'found',
  flawTags: ['stain'],
  flaws: 'Small faint stain near the left hem, about the size of a coin.',
  price: 249,
  type: 'ukay-ukay',
  stock: 1,
  description:
    'Test listing — not for sale. Thrifted graphic tee in sand with a block print across the chest.',
  imageUrl: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=900&q=80',
  photos: [
    { kind: 'back', url: placeholder('EFE6DA', '1C1B1A', 'Back') },
    { kind: 'label', url: placeholder('E8E1D5', '1C1B1A', 'Label & size tag') },
    { kind: 'fabric', url: placeholder('D9CDBB', '1C1B1A', 'Fabric close-up') },
    { kind: 'flaw', url: placeholder('F3D9CF', 'C4463E', 'Flaw: small stain') },
  ],
  colors: ['Beige'],
  sizes: ['M'],
  storeId: STORE_ID,
  createdAt: serverTimestamp(),
});
console.log(`Added ${NAME} (${ref.id}) — 5 photos, stock 1.`);
console.log('Remove it when you are done: node scripts/add-test-product.mjs --remove');
process.exit(0);
