/**
 * Seeds the local emulators with just enough to reach checkout.
 *
 *     npm run emulators        # in one terminal
 *     npm run seed:emulator    # in another
 *     npm run start:emulator -- --web
 *
 * One customer who can sign in, one saved delivery address (checkout
 * refuses without it), and two products with known stock — so a decline
 * can be checked by reading the stock back and finding it unmoved. Plus
 * one store, its Store Manager, and a Platform Admin, for the multi-store
 * screens.
 *
 * Talks to the emulators over their REST APIs rather than through
 * firebase-admin, because the Auth emulator needs a signup call and
 * mixing an admin SDK write with an emulator auth account is more setup
 * than this is worth. Idempotent: re-running overwrites.
 */
const PROJECT = 'plainco-c3edc';
const AUTH = 'http://localhost:9099';
const FIRESTORE = 'http://localhost:8080';

const EMAIL = 'cathy@example.com';
const PASSWORD = 'sandbox123';

// Firestore's REST API wants every value tagged with its type.
const val = (v) => {
  if (v === null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
};

const writeDoc = async (path, data) => {
  const url = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, val(v)])) }),
  });
  if (!res.ok) throw new Error(`write ${path} failed: ${res.status} ${await res.text()}`);
};

const ping = async () => {
  try {
    const res = await fetch(`${FIRESTORE}/`);
    return res.status < 500;
  } catch {
    return false;
  }
};

if (!(await ping())) {
  console.error(
    '\nThe Firestore emulator is not answering on :8080.\n' +
    'Start it first, in another terminal:\n\n    npm run emulators\n'
  );
  process.exit(1);
}

// Returns the uid whether the account is new or the password matches an
// existing one, so a second run does not need a delete first.
const ensureAccount = async (email) => {
  const signUp = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  if (signUp.ok) return (await signUp.json()).localId;
  const signIn = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  if (!signIn.ok) throw new Error(`could not create or sign in ${email}: ${await signIn.text()}`);
  return (await signIn.json()).localId;
};

const uid = await ensureAccount(EMAIL);

// One store, its manager, and a Platform Admin — enough to try the store
// picker in Manage Users and the per-store product rules by hand. Written
// with the rules bypassed (Bearer owner), which is the only way a role can
// be set at all; see ROLES.md on bootstrapping.
const STORE_ID = 'sandbox-store';
const MANAGER_EMAIL = 'sam@example.com';
const ADMIN_EMAIL = 'ada@example.com';

await writeDoc(`stores/${STORE_ID}`, { name: 'Sandbox Ukay', createdAt: new Date() });
// A second store with its own manager, so a cart holding both products
// checks out as two orders — one per store — and each manager can be
// seen to get only their own.
const OTHER_STORE_ID = 'sandbox-rtw';
const OTHER_MANAGER_EMAIL = 'ria@example.com';
await writeDoc(`stores/${OTHER_STORE_ID}`, { name: 'Sandbox RTW', createdAt: new Date() });

const managerUid = await ensureAccount(MANAGER_EMAIL);
await writeDoc(`users/${managerUid}`, {
  uid: managerUid, name: 'Sam Manager', email: MANAGER_EMAIL,
  role: 'seller', isActive: true, storeId: STORE_ID,
});

const otherManagerUid = await ensureAccount(OTHER_MANAGER_EMAIL);
await writeDoc(`users/${otherManagerUid}`, {
  uid: otherManagerUid, name: 'Ria Manager', email: OTHER_MANAGER_EMAIL,
  role: 'seller', isActive: true, storeId: OTHER_STORE_ID,
});

const adminUid = await ensureAccount(ADMIN_EMAIL);
await writeDoc(`users/${adminUid}`, {
  uid: adminUid, name: 'Ada Admin', email: ADMIN_EMAIL,
  role: 'platformAdmin', isActive: true,
});

await writeDoc(`users/${uid}`, {
  uid,
  name: 'Cathy Customer',
  email: EMAIL,
  role: 'customer',
  isActive: true,
  shippingAddress: {
    fullName: 'Cathy Customer',
    phone: '09171234567',
    address: '12 Mango Avenue',
    city: 'Cebu City',
    province: 'Cebu',
    zipCode: '6000',
  },
});

const PRODUCTS = [
  { id: 'sandbox-jacket', name: 'Denim Jacket', price: 850, stock: 10, type: 'ukay' },
  { id: 'sandbox-coat', name: 'Wool Overcoat', price: 1200, stock: 4, type: 'ready', storeId: OTHER_STORE_ID },
];

for (const p of PRODUCTS) {
  await writeDoc(`products/${p.id}`, {
    name: p.name,
    price: p.price,
    stock: p.stock,
    type: p.type,
    description: 'Seeded for sandbox payment testing.',
    imageUrl: 'https://placehold.co/600x800/E8E1D5/1C1B1A.png',
    colors: ['Blue'],
    sizes: ['M'],
    // REQUIRED, not decorative. ProductContext queries the catalogue with
    // orderBy('createdAt', 'desc'), and Firestore silently omits any
    // document missing the ordered field — so a product seeded without
    // this one exists, reads fine by id, and never appears in the Shop.
    createdAt: new Date(),
    // Without it the product has no manager and is frozen for everyone —
    // see managesStore() in firestore.rules.
    storeId: p.storeId || STORE_ID,
  });
}

console.log(`\nSeeded the emulators.\n`);
console.log(`  customer   ${EMAIL} / ${PASSWORD}  (uid ${uid})`);
console.log(`  manager    ${MANAGER_EMAIL} / ${PASSWORD}  (runs "Sandbox Ukay")`);
console.log(`  manager    ${OTHER_MANAGER_EMAIL} / ${PASSWORD}  (runs "Sandbox RTW")`);
console.log(`  admin      ${ADMIN_EMAIL} / ${PASSWORD}  (Platform Admin)`);
for (const p of PRODUCTS) console.log(`  product    ${p.name} — P${p.price}, stock ${p.stock}  (${p.storeId || STORE_ID})`);
console.log(`\nStock is the thing to watch: a declined sandbox payment must leave it untouched.\n`);
