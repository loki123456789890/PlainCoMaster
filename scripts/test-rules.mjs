/**
 * Security-rules test suite for PlainCo.
 *
 * Runs firestore.rules against the Firestore emulator and asserts what each
 * of the three roles can and cannot do. Run it with:
 *
 *     npm run test:rules
 *
 * which wraps this in `firebase emulators:exec`, so the emulator is started
 * and torn down automatically. Requires a JDK on PATH (the Firestore
 * emulator is a Java process) and firebase-tools, both dev-only.
 *
 * Written as a plain Node script rather than a Jest suite on purpose: this
 * is an Expo app with no test runner configured, and adding jest + babel
 * wiring just to assert on rules would be a much larger change than the
 * thing being tested.
 *
 * The headline cases are the escalation ones — CREATE-2 and UPDATE-2 below.
 * Those are the tests that prove a customer cannot make themselves staff,
 * which is the whole basis of the role split.
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  collectionGroup,
  getDocs,
  serverTimestamp,
  setLogLevel,
} from 'firebase/firestore';

// Most of this suite asserts that a write is REFUSED, and the Firestore
// SDK logs every refusal as a multi-line PERMISSION_DENIED error. Those
// lines are the tests succeeding, but they read as a wall of failures to
// anyone watching, which is the opposite of what a suite like this is for.
// Silenced so the output is just the pass/fail list. A genuinely broken
// rule still surfaces: the assertion fails and the harness prints it.
setLogLevel('silent');

const PROJECT_ID = 'plainco-rules-test';

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];

async function test(name, fn) {
  // Every test starts from the same seeded world. Rules read other
  // documents (isSeller() does a get() on the caller's user doc), so state
  // leaking between tests would produce results that depend on ordering.
  await testEnv.clearFirestore();
  await seed();
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

// Seeded with rules bypassed — deliberately. The rules under test forbid
// creating a document that already carries a role, so privileged accounts
// cannot be created through the normal path. That restriction is the point
// (see CREATE-2); provisioning happens by promotion, which UPDATE-4 covers.
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/customer1'), {
      uid: 'customer1', name: 'Cathy Customer', email: 'cathy@example.com',
    });
    await setDoc(doc(db, 'users/customer2'), {
      uid: 'customer2', name: 'Carl Customer', email: 'carl@example.com',
    });
    await setDoc(doc(db, 'users/seller1'), {
      uid: 'seller1', name: 'Sam Manager', email: 'sam@example.com',
      role: 'seller', isActive: true,
    });
    await setDoc(doc(db, 'users/admin1'), {
      uid: 'admin1', name: 'Ada Admin', email: 'ada@example.com',
      role: 'platformAdmin', isActive: true,
    });
    await setDoc(doc(db, 'users/deactivatedSeller'), {
      uid: 'deactivatedSeller', name: 'Gone', email: 'gone@example.com',
      role: 'seller', isActive: false,
    });
    await setDoc(doc(db, 'products/p1'), {
      name: 'Denim Jacket', price: 850, stock: 10,
    });
    await setDoc(doc(db, 'users/customer1/orders/o1'), {
      total: 850, status: 'pending',
    });
  });
}

const asCustomer = () => testEnv.authenticatedContext('customer1').firestore();
const asOtherCustomer = () => testEnv.authenticatedContext('customer2').firestore();
const asSeller = () => testEnv.authenticatedContext('seller1').firestore();
const asAdmin = () => testEnv.authenticatedContext('admin1').firestore();
const asDeactivatedSeller = () => testEnv.authenticatedContext('deactivatedSeller').firestore();
const asGuest = () => testEnv.unauthenticatedContext().firestore();

// The exact shape ProductContext.addProduct writes. Defined up here
// because the role-separation tests need it too: a denial asserted with a
// malformed product would pass whether the role or the shape caused it,
// which would make those tests prove nothing about roles at all.
const productDoc = (overrides = {}) => ({
  name: 'Corduroy Shirt',
  price: 650,
  type: 'Tops',
  stock: 5,
  description: 'Lightly worn.',
  imageUrl: 'https://example.com/shirt.jpg',
  colors: ['brown'],
  sizes: ['M'],
  createdAt: serverTimestamp(),
  ...overrides,
});

// The exact shape Signupscreen.js writes. Any test that varies from this is
// varying from what the real app does.
const signupDoc = (uid, overrides = {}) => ({
  uid,
  name: 'New Person',
  email: 'new@example.com',
  createdAt: new Date().toISOString(),
  privacyConsentAccepted: true,
  privacyConsentTimestamp: serverTimestamp(),
  ...overrides,
});

console.log('\nfirestore.rules — PlainCo role separation\n');

// ---------------------------------------------------------------------------
console.log('Account creation (signup)');
// ---------------------------------------------------------------------------

await test('CREATE-1  a real signup write succeeds', async () => {
  const db = testEnv.authenticatedContext('newuser').firestore();
  await assertSucceeds(setDoc(doc(db, 'users/newuser'), signupDoc('newuser')));
});

await test('CREATE-2  signup CANNOT set role (privilege escalation)', async () => {
  const db = testEnv.authenticatedContext('newuser').firestore();
  await assertFails(
    setDoc(doc(db, 'users/newuser'), signupDoc('newuser', { role: 'platformAdmin' }))
  );
  await assertFails(
    setDoc(doc(db, 'users/newuser'), signupDoc('newuser', { role: 'seller' }))
  );
});

await test('CREATE-3  signup cannot set isActive', async () => {
  const db = testEnv.authenticatedContext('newuser').firestore();
  await assertFails(
    setDoc(doc(db, 'users/newuser'), signupDoc('newuser', { isActive: true }))
  );
});

await test('CREATE-4  cannot create a document for another uid', async () => {
  const db = testEnv.authenticatedContext('newuser').firestore();
  await assertFails(setDoc(doc(db, 'users/someoneelse'), signupDoc('someoneelse')));
});

await test('CREATE-5  uid field must match the caller', async () => {
  const db = testEnv.authenticatedContext('newuser').firestore();
  await assertFails(setDoc(doc(db, 'users/newuser'), signupDoc('impersonated')));
});

await test('CREATE-6  blank or oversized name is rejected', async () => {
  const db = testEnv.authenticatedContext('newuser').firestore();
  await assertFails(setDoc(doc(db, 'users/newuser'), signupDoc('newuser', { name: '   ' })));
  await assertFails(
    setDoc(doc(db, 'users/newuser'), signupDoc('newuser', { name: 'x'.repeat(61) }))
  );
});

await test('CREATE-7  unknown extra fields are rejected', async () => {
  const db = testEnv.authenticatedContext('newuser').firestore();
  await assertFails(
    setDoc(doc(db, 'users/newuser'), signupDoc('newuser', { isAdmin: true }))
  );
});

await test('CREATE-8  a guest cannot create a user document', async () => {
  await assertFails(setDoc(doc(asGuest(), 'users/newuser'), signupDoc('newuser')));
});

// ---------------------------------------------------------------------------
console.log('\nRole changes');
// ---------------------------------------------------------------------------

await test('UPDATE-1  a customer can edit their own name', async () => {
  await assertSucceeds(updateDoc(doc(asCustomer(), 'users/customer1'), { name: 'Cathy C.' }));
});

await test('UPDATE-2  a customer CANNOT promote themselves', async () => {
  await assertFails(updateDoc(doc(asCustomer(), 'users/customer1'), { role: 'platformAdmin' }));
  await assertFails(updateDoc(doc(asCustomer(), 'users/customer1'), { role: 'seller' }));
});

await test('UPDATE-3  a customer cannot promote anyone else', async () => {
  await assertFails(updateDoc(doc(asCustomer(), 'users/customer2'), { role: 'seller' }));
});

await test('UPDATE-4  a platform admin CAN promote a customer to store manager', async () => {
  await assertSucceeds(updateDoc(doc(asAdmin(), 'users/customer1'), { role: 'seller' }));
});

await test('UPDATE-5  a platform admin can deactivate another account', async () => {
  await assertSucceeds(updateDoc(doc(asAdmin(), 'users/customer1'), { isActive: false }));
});

await test('UPDATE-6  a platform admin cannot change their OWN role (lockout guard)', async () => {
  await assertFails(updateDoc(doc(asAdmin(), 'users/admin1'), { role: 'customer' }));
});

await test('UPDATE-7  a platform admin cannot edit unrelated fields', async () => {
  await assertFails(updateDoc(doc(asAdmin(), 'users/customer1'), { email: 'hijack@example.com' }));
});

await test('UPDATE-8  a store manager cannot change roles', async () => {
  await assertFails(updateDoc(doc(asSeller(), 'users/customer1'), { role: 'seller' }));
});

await test('UPDATE-9  a deactivated store manager has no privileges', async () => {
  await assertFails(setDoc(doc(asDeactivatedSeller(), 'products/p2'), productDoc()));
});

// ---------------------------------------------------------------------------
console.log('\nRole separation — store manager vs platform admin');
// ---------------------------------------------------------------------------

await test('SPLIT-1  a platform admin can read user accounts', async () => {
  await assertSucceeds(getDocs(collection(asAdmin(), 'users')));
});

await test('SPLIT-2  a store manager CANNOT read user accounts', async () => {
  await assertFails(getDoc(doc(asSeller(), 'users/customer1')));
});

await test('SPLIT-3  a store manager can manage products', async () => {
  const db = asSeller();
  await assertSucceeds(setDoc(doc(db, 'products/p2'), productDoc()));
  await assertSucceeds(updateDoc(doc(db, 'products/p1'), { price: 900 }));
  await assertSucceeds(deleteDoc(doc(db, 'products/p1')));
});

await test('SPLIT-4  a platform admin CANNOT manage products', async () => {
  const db = asAdmin();
  await assertFails(setDoc(doc(db, 'products/p2'), productDoc()));
  await assertFails(updateDoc(doc(db, 'products/p1'), { price: 900 }));
  await assertFails(deleteDoc(doc(db, 'products/p1')));
});

await test('SPLIT-5  a store manager can read all orders', async () => {
  await assertSucceeds(getDocs(collectionGroup(asSeller(), 'orders')));
});

await test('SPLIT-6  a platform admin CANNOT read orders', async () => {
  await assertFails(getDocs(collectionGroup(asAdmin(), 'orders')));
  await assertFails(getDoc(doc(asAdmin(), 'users/customer1/orders/o1')));
});

await test('SPLIT-7  a customer cannot read another customer\'s account', async () => {
  await assertFails(getDoc(doc(asOtherCustomer(), 'users/customer1')));
});

// ---------------------------------------------------------------------------
console.log('\nProducts and checkout');
// ---------------------------------------------------------------------------

await test('SHOP-1  a customer cannot create or edit products', async () => {
  await assertFails(setDoc(doc(asCustomer(), 'products/p9'), productDoc()));
  await assertFails(updateDoc(doc(asCustomer(), 'products/p1'), { price: 1 }));
});

await test('SHOP-2  a customer may decrement stock at checkout', async () => {
  await assertSucceeds(updateDoc(doc(asCustomer(), 'products/p1'), { stock: 9 }));
});

await test('SHOP-3  a customer cannot increase stock or go negative', async () => {
  await assertFails(updateDoc(doc(asCustomer(), 'products/p1'), { stock: 99 }));
  await assertFails(updateDoc(doc(asCustomer(), 'products/p1'), { stock: -1 }));
});

await test('SHOP-4  stock decrement cannot smuggle a price change', async () => {
  await assertFails(updateDoc(doc(asCustomer(), 'products/p1'), { stock: 9, price: 1 }));
});

await test('SHOP-5  a guest cannot read products', async () => {
  await assertFails(getDoc(doc(asGuest(), 'products/p1')));
});

// ---------------------------------------------------------------------------
console.log('\nField validation (SRS "strict data type enforcement")');
// ---------------------------------------------------------------------------

await test('VALID-1  a real product create succeeds', async () => {
  await assertSucceeds(setDoc(doc(asSeller(), 'products/new1'), productDoc()));
  // The optional size guide must still be accepted.
  await assertSucceeds(
    setDoc(doc(asSeller(), 'products/new2'), productDoc({
      measurements: { M: { chest: 50 } },
      measurementType: 'tops',
    }))
  );
});

await test('VALID-2  wrong types are rejected on product create', async () => {
  const db = asSeller();
  await assertFails(setDoc(doc(db, 'products/bad1'), productDoc({ price: '650' })));
  await assertFails(setDoc(doc(db, 'products/bad2'), productDoc({ stock: '5' })));
  await assertFails(setDoc(doc(db, 'products/bad3'), productDoc({ name: 42 })));
  await assertFails(setDoc(doc(db, 'products/bad4'), productDoc({ colors: 'brown' })));
});

await test('VALID-3  blank name, negative price, and extra fields are rejected', async () => {
  const db = asSeller();
  await assertFails(setDoc(doc(db, 'products/bad5'), productDoc({ name: '   ' })));
  await assertFails(setDoc(doc(db, 'products/bad6'), productDoc({ price: -1 })));
  await assertFails(setDoc(doc(db, 'products/bad7'), productDoc({ isFeatured: true })));
  await assertFails(
    setDoc(doc(db, 'products/bad8'), productDoc({ description: 'x'.repeat(2001) }))
  );
});

await test('VALID-4  a product create cannot backdate createdAt', async () => {
  await assertFails(
    setDoc(doc(asSeller(), 'products/bad9'), productDoc({ createdAt: new Date('2020-01-01') }))
  );
});

await test('VALID-5  a seller edit must leave well-typed data behind', async () => {
  const db = asSeller();
  await assertSucceeds(updateDoc(doc(db, 'products/p1'), { price: 700, stock: 3 }));
  await assertFails(updateDoc(doc(db, 'products/p1'), { price: 'free' }));
  await assertFails(updateDoc(doc(db, 'products/p1'), { stock: 'lots' }));
});

await test('VALID-6  a LEGACY product with unknown fields is still editable', async () => {
  // The risk a strict key allowlist would introduce on update: products
  // written by earlier versions of the app carry fields the current rule
  // never mentions, and locking those out would make them uneditable.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'products/legacy'), {
      name: 'Old Jacket', price: '900', stock: '2', legacyCategory: 'outerwear',
    });
  });
  // Saving it the way AdminEditProductScreen does — full field set, with
  // string price/stock migrated to numbers — must succeed despite the
  // unknown legacyCategory field riding along.
  await assertSucceeds(
    updateDoc(doc(asSeller(), 'products/legacy'), {
      name: 'Old Jacket', price: 900, type: 'Outerwear', stock: 2,
      description: '', imageUrl: 'https://example.com/j.jpg', colors: [], sizes: [],
    })
  );
});

const supportDoc = (uid, overrides = {}) => ({
  message: 'My order has not arrived.',
  userId: uid,
  userEmail: 'cathy@example.com',
  status: 'open',
  createdAt: serverTimestamp(),
  ...overrides,
});

await test('VALID-7  a real support request succeeds', async () => {
  await assertSucceeds(setDoc(doc(asCustomer(), 'supportRequests/s1'), supportDoc('customer1')));
});

await test('VALID-8  malformed support requests are rejected', async () => {
  const db = asCustomer();
  await assertFails(setDoc(doc(db, 'supportRequests/s2'), supportDoc('customer1', { message: '  ' })));
  await assertFails(setDoc(doc(db, 'supportRequests/s3'), supportDoc('customer1', { message: 42 })));
  await assertFails(
    setDoc(doc(db, 'supportRequests/s4'), supportDoc('customer1', { message: 'x'.repeat(2001) }))
  );
  // Filing a request that arrives already resolved would keep it out of
  // the Store Manager's open queue entirely.
  await assertFails(setDoc(doc(db, 'supportRequests/s5'), supportDoc('customer1', { status: 'resolved' })));
  await assertFails(setDoc(doc(db, 'supportRequests/s6'), supportDoc('customer2')));
});

await test('VALID-9  a seller may only move a request between open and resolved', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'supportRequests/s9'), {
      message: 'Where is my order?', userId: 'customer1',
      userEmail: 'cathy@example.com', status: 'open', createdAt: new Date(),
    });
  });
  const db = asSeller();
  await assertSucceeds(updateDoc(doc(db, 'supportRequests/s9'), { status: 'resolved' }));
  // Rewriting the customer's own words is not part of working a request.
  await assertFails(updateDoc(doc(db, 'supportRequests/s9'), { message: 'Never mind' }));
  await assertFails(updateDoc(doc(db, 'supportRequests/s9'), { status: 'deleted' }));
});

// ---------------------------------------------------------------------------
console.log('\nActivity logs');
// ---------------------------------------------------------------------------

// serverTimestamp() is mandatory: the rules require createdAt to equal
// request.time, which is what stops an entry being back- or post-dated.
const logEntry = (actorId, overrides = {}) => ({
  action: 'product.updated',
  actorId,
  actorEmail: 'someone@example.com',
  targetId: 'p1',
  targetLabel: 'Denim Jacket',
  summary: 'Edited "Denim Jacket"',
  createdAt: serverTimestamp(),
  ...overrides,
});

await test('LOG-1  a store manager can write and read store activity', async () => {
  const db = asSeller();
  await assertSucceeds(setDoc(doc(db, 'activityLogs/l1'), logEntry('seller1')));
  await assertSucceeds(getDocs(collection(db, 'activityLogs')));
});

await test('LOG-2  a platform admin can write and read account activity', async () => {
  const db = asAdmin();
  await assertSucceeds(
    setDoc(doc(db, 'accountLogs/l1'), logEntry('admin1', { action: 'user.role' }))
  );
  await assertSucceeds(getDocs(collection(db, 'accountLogs')));
});

await test('LOG-3  each role is shut out of the OTHER log', async () => {
  await assertFails(getDocs(collection(asAdmin(), 'activityLogs')));
  await assertFails(getDocs(collection(asSeller(), 'accountLogs')));
  await assertFails(setDoc(doc(asAdmin(), 'activityLogs/x'), logEntry('admin1')));
  await assertFails(setDoc(doc(asSeller(), 'accountLogs/x'), logEntry('seller1')));
});

await test('LOG-4  entries cannot be attributed to someone else', async () => {
  // seller1 trying to log an action as if admin1 had done it.
  await assertFails(setDoc(doc(asSeller(), 'activityLogs/l2'), logEntry('admin1')));
});

await test('LOG-5  entries cannot be backdated', async () => {
  await assertFails(
    setDoc(
      doc(asSeller(), 'activityLogs/l3'),
      logEntry('seller1', { createdAt: new Date('2020-01-01') })
    )
  );
});

await test('LOG-6  the log is append-only — no edits, no deletes', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'activityLogs/existing'), {
      action: 'product.deleted', actorId: 'seller1', actorEmail: 'sam@example.com',
      targetId: 'p1', targetLabel: 'Denim Jacket', summary: 'Deleted product', createdAt: new Date(),
    });
  });
  // The author of an entry cannot rewrite or erase it afterwards. This is
  // the property that makes the log worth keeping at all.
  await assertFails(updateDoc(doc(asSeller(), 'activityLogs/existing'), { summary: 'Nothing happened' }));
  await assertFails(deleteDoc(doc(asSeller(), 'activityLogs/existing')));
  await assertFails(deleteDoc(doc(asAdmin(), 'activityLogs/existing')));
});

await test('LOG-7  a customer cannot read or write either log', async () => {
  const db = asCustomer();
  await assertFails(getDocs(collection(db, 'activityLogs')));
  await assertFails(getDocs(collection(db, 'accountLogs')));
  await assertFails(setDoc(doc(db, 'activityLogs/l4'), logEntry('customer1')));
});

await test('LOG-8  malformed entries are rejected', async () => {
  const db = asSeller();
  const { summary, ...missingSummary } = logEntry('seller1');
  await assertFails(setDoc(doc(db, 'activityLogs/l5'), missingSummary));
  await assertFails(
    setDoc(doc(db, 'activityLogs/l6'), logEntry('seller1', { note: 'extra field' }))
  );
  await assertFails(
    setDoc(doc(db, 'activityLogs/l7'), logEntry('seller1', { summary: 'x'.repeat(201) }))
  );
});

await test('LOG-9  a deactivated store manager cannot write to the log', async () => {
  await assertFails(
    setDoc(doc(asDeactivatedSeller(), 'activityLogs/l8'), logEntry('deactivatedSeller'))
  );
});

// ---------------------------------------------------------------------------
await testEnv.cleanup();

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const { name, error } of failures) {
    console.log(`FAILED: ${name}\n${error.message}\n`);
  }
  process.exit(1);
}
