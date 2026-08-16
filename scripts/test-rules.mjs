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
} from 'firebase/firestore';

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
  await assertFails(setDoc(doc(asDeactivatedSeller(), 'products/p2'), { name: 'X', price: 1, stock: 1 }));
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
  await assertSucceeds(setDoc(doc(db, 'products/p2'), { name: 'Tee', price: 300, stock: 4 }));
  await assertSucceeds(updateDoc(doc(db, 'products/p1'), { price: 900 }));
  await assertSucceeds(deleteDoc(doc(db, 'products/p1')));
});

await test('SPLIT-4  a platform admin CANNOT manage products', async () => {
  const db = asAdmin();
  await assertFails(setDoc(doc(db, 'products/p2'), { name: 'Tee', price: 300, stock: 4 }));
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
  await assertFails(setDoc(doc(asCustomer(), 'products/p9'), { name: 'Free', price: 0, stock: 1 }));
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
await testEnv.cleanup();

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const { name, error } of failures) {
    console.log(`FAILED: ${name}\n${error.message}\n`);
  }
  process.exit(1);
}
