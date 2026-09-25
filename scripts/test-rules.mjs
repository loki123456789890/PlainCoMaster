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
  writeBatch,
  runTransaction,
  serverTimestamp,
  deleteField,
  query,
  where,
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
    // Two stores, one manager each, so every ownership rule has a real
    // "other store" to be refused against rather than a missing one.
    await setDoc(doc(db, 'stores/store1'), { name: 'Tindahan ni Sam', createdAt: new Date() });
    await setDoc(doc(db, 'stores/store2'), { name: 'Ria RTW', createdAt: new Date() });
    await setDoc(doc(db, 'users/seller1'), {
      uid: 'seller1', name: 'Sam Manager', email: 'sam@example.com',
      role: 'seller', isActive: true, storeId: 'store1',
    });
    await setDoc(doc(db, 'users/seller2'), {
      uid: 'seller2', name: 'Ria Manager', email: 'ria@example.com',
      role: 'seller', isActive: true, storeId: 'store2',
    });
    // Promoted before stores existed: still a seller, assigned to nothing.
    await setDoc(doc(db, 'users/unassignedSeller'), {
      uid: 'unassignedSeller', name: 'Una Assigned', email: 'una@example.com',
      role: 'seller', isActive: true,
    });
    await setDoc(doc(db, 'users/admin1'), {
      uid: 'admin1', name: 'Ada Admin', email: 'ada@example.com',
      role: 'platformAdmin', isActive: true,
    });
    await setDoc(doc(db, 'users/deactivatedSeller'), {
      uid: 'deactivatedSeller', name: 'Gone', email: 'gone@example.com',
      role: 'seller', isActive: false, storeId: 'store1',
    });
    await setDoc(doc(db, 'products/p1'), {
      name: 'Denim Jacket', price: 850, stock: 10, storeId: 'store1',
    });
    // store2's product — what seller1 must NOT be able to touch.
    await setDoc(doc(db, 'products/p4'), {
      name: 'Linen Blouse', price: 450, stock: 6, storeId: 'store2',
    });
    // Written before stores existed, and not yet migrated.
    await setDoc(doc(db, 'products/orphan'), {
      name: 'Old Stock Tee', price: 150, stock: 3,
    });
    // p3, not p2 — SPLIT-3/SPLIT-4 write to products/p2 and would be
    // testing `allow update` instead of `allow create` if the seed put a
    // document there first.
    await setDoc(doc(db, 'products/p3'), {
      name: 'Wool Scarf', price: 200, stock: 4, storeId: 'store1',
    });
    // Two lines, two products, quantity > 1 — so a restore that gives back
    // the wrong amount, or only the first line, is visible in the numbers
    // rather than hidden behind a 1:1 coincidence.
    await setDoc(doc(db, 'users/customer1/orders/o1'), {
      customerId: 'customer1',
      customerEmail: 'cathy@example.com',
      items: [
        { productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 2 },
        { productId: 'p3', name: 'Wool Scarf', price: 200, quantity: 3 },
      ],
      total: 2300, status: 'pending', storeId: 'store1',
    });
    // A DELIVERED order, which is the state the reviews rules gate on.
    // Two products, so "reviewing something that was not on the order" is
    // a real case here rather than a coincidence of a one-line order.
    await setDoc(doc(db, 'users/customer1/orders/delivered1'), {
      customerId: 'customer1',
      customerEmail: 'cathy@example.com',
      items: [
        { productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 1 },
        { productId: 'p3', name: 'Wool Scarf', price: 200, quantity: 1 },
      ],
      productIds: ['p1', 'p3'],
      total: 1050, status: 'delivered', storeId: 'store1',
    });
    // Delivered, but written before productIds existed — REVIEW-16 asserts
    // its lines are unreviewable rather than silently admitted.
    await setDoc(doc(db, 'users/customer1/orders/legacy1'), {
      customerId: 'customer1',
      customerEmail: 'cathy@example.com',
      items: [{ productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 1 }],
      total: 850, status: 'delivered', storeId: 'store1',
    });
    // One line of delivered1 already reviewed, leaving the other (p1) free
    // for the create tests. This one is what the update and delete tests
    // act on.
    await setDoc(doc(db, 'reviews/delivered1_p3'), {
      orderId: 'delivered1', productId: 'p3', productName: 'Wool Scarf',
      userId: 'customer1', userName: 'Cathy C.', rating: 4,
      matchedDescription: true, text: 'Warm and clean.', hidden: false,
      createdAt: new Date(), storeId: 'store1',
    });
    await setDoc(doc(db, 'users/deactivatedCustomer'), {
      uid: 'deactivatedCustomer', name: 'Dee Activated', email: 'dee@example.com',
      isActive: false,
    });
    // Written by functions/mailer.js in production, seeded here so MAIL-1
    // reads a real document rather than a missing one — a permitted read
    // of a document that does not exist succeeds either way, which would
    // make the test pass without proving anything about the shape.
    await setDoc(doc(db, 'mailLog/order-o1'), {
      kind: 'orderConfirmation',
      orderId: 'o1',
      to: 'cathy@example.com',
      subject: 'Your PlainCo order #O1',
      status: 'failed',
      detail: 'Invalid login: 535-5.7.8 Username and Password not accepted',
      recordedAt: serverTimestamp(),
      // A receipt for store1's order, so read by store1's manager only.
      storeId: 'store1',
    });
    await setDoc(doc(db, 'users/deactivatedCustomer/orders/delivered2'), {
      customerId: 'deactivatedCustomer', customerEmail: 'dee@example.com',
      items: [{ productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 1 }],
      productIds: ['p1'], total: 850, status: 'delivered', storeId: 'store1',
    });
  });
}

// Seeds an order in a given status, for the transition tests.
async function seedOrderWithStatus(orderId, status) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/customer1/orders/${orderId}`), {
      customerId: 'customer1',
      customerEmail: 'cathy@example.com',
      items: [{ productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 2 }],
      total: 1700, status, storeId: 'store1',
    });
  });
}

async function readStock(productId) {
  let stock;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), `products/${productId}`));
    stock = snap.data().stock;
  });
  return stock;
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${expected}, got ${actual}`);
  }
}

const asCustomer = () => testEnv.authenticatedContext('customer1').firestore();
const asOtherCustomer = () => testEnv.authenticatedContext('customer2').firestore();
const asSeller = () => testEnv.authenticatedContext('seller1').firestore();
const asOtherSeller = () => testEnv.authenticatedContext('seller2').firestore();
const asUnassignedSeller = () => testEnv.authenticatedContext('unassignedSeller').firestore();
const asAdmin = () => testEnv.authenticatedContext('admin1').firestore();
const asDeactivatedSeller = () => testEnv.authenticatedContext('deactivatedSeller').firestore();
const asDeactivatedCustomer = () => testEnv.authenticatedContext('deactivatedCustomer').firestore();
const asGuest = () => testEnv.unauthenticatedContext().firestore();

// How AdminOrdersScreen and the dashboard read orders: every customer's,
// as one collection group, filtered to one store. Rules are not filters —
// the query has to carry the filter the rule requires.
const storeOrders = (db, storeId) =>
  query(collectionGroup(db, 'orders'), where('storeId', '==', storeId));

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
  // seller1's store. Tests acting as another seller override it.
  storeId: 'store1',
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
  // Promotion now names the store in the same write — see ASSIGN-2 for
  // why a bare role: 'seller' is refused.
  await assertSucceeds(
    updateDoc(doc(asAdmin(), 'users/customer1'), { role: 'seller', storeId: 'store1' })
  );
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

await test('SPLIT-5  a store manager can read their store\'s orders', async () => {
  await assertSucceeds(getDocs(storeOrders(asSeller(), 'store1')));
});

await test('SPLIT-6  a platform admin CANNOT read orders', async () => {
  await assertFails(getDocs(collectionGroup(asAdmin(), 'orders')));
  await assertFails(getDoc(doc(asAdmin(), 'users/customer1/orders/o1')));
});

await test('SPLIT-7  a customer cannot read another customer\'s account', async () => {
  await assertFails(getDoc(doc(asOtherCustomer(), 'users/customer1')));
});

await test('SPLIT-8  a DEACTIVATED account can still read its own document', async () => {
  // Looks like a rule that should be tightened. It must not be, and this
  // test exists to say so before someone "fixes" it.
  //
  // AdminContext subscribes to the signed-in user's own document and signs
  // them out when it sees isActive === false. That subscription belongs to
  // the very account being deactivated, so the read has to keep working at
  // exactly the moment the flag flips — gate it on isActive and the
  // listener gets a permission error instead of a document.
  //
  // Which would fail SILENTLY, and that is the dangerous part: the error
  // path in AdminContext deliberately does NOT revoke, because an error
  // means offline or a backend problem, not a deactivation. So a rules
  // change here would not break the listener loudly. It would just quietly
  // stop revoking anyone, forever.
  //
  // Both roles, because the seller path and the customer path are the two
  // that matter and they reach this rule through different branches.
  await assertSucceeds(getDoc(doc(asDeactivatedCustomer(), 'users/deactivatedCustomer')));
  await assertSucceeds(getDoc(doc(asDeactivatedSeller(), 'users/deactivatedSeller')));

  // Reading is all they get. isActive is a platformAdmin's field, and a
  // deactivated account must not be able to switch itself back on — the
  // self-deactivation shape in the rules requires the new value be false.
  await assertFails(
    updateDoc(doc(asDeactivatedCustomer(), 'users/deactivatedCustomer'), { isActive: true })
  );
});

// ---------------------------------------------------------------------------
console.log('\nProducts and stock');
// ---------------------------------------------------------------------------

await test('SHOP-1  a customer cannot create or edit products', async () => {
  await assertFails(setDoc(doc(asCustomer(), 'products/p9'), productDoc()));
  await assertFails(updateDoc(doc(asCustomer(), 'products/p1'), { price: 1 }));
});

await test('SHOP-2  a customer CANNOT decrement stock — checkout is server-side', async () => {
  // This assertion is the exact inverse of what it asserted before, and
  // the inversion is the point. There used to be a rule branch letting an
  // active signed-in user decrement stock, so that Checkoutscreen's
  // client transaction could work. It has been deleted: checkout now runs
  // in the placeOrder Cloud Function, which writes as Admin and is not
  // governed by this file at all.
  //
  // The write below is the well-formed one — a smaller, non-negative
  // number, stock the only changed key — that the old branch accepted. It
  // must now fail, because "well-formed" was never the same as
  // "legitimate": nothing tied it to an order, so any account could have
  // walked the catalogue decrementing every product to zero.
  await assertFails(updateDoc(doc(asCustomer(), 'products/p1'), { stock: 9 }));
  assertEqual(await readStock('p1'), 10, 'p1 stock after a customer decrement attempt');
});

await test('SHOP-3  no non-seller role can touch stock, in any direction', async () => {
  // Increases and negatives were rejected before too, so those two lines
  // are unchanged in outcome. What is new is the third caller: a
  // platformAdmin. They were always denied here (SPLIT-4 covers products
  // generally), but stock is the field an over-broad "admins can do
  // anything" reading would most likely be handed by mistake, so it is
  // pinned explicitly.
  await assertFails(updateDoc(doc(asCustomer(), 'products/p1'), { stock: 99 }));
  await assertFails(updateDoc(doc(asCustomer(), 'products/p1'), { stock: -1 }));
  await assertFails(updateDoc(doc(asAdmin(), 'products/p1'), { stock: 9 }));
  assertEqual(await readStock('p1'), 10, 'p1 stock after non-seller write attempts');
});

await test('SHOP-4  a seller CAN still adjust stock — the tightening did not overshoot', async () => {
  // The guard against fixing H2 by breaking the store. Removing the
  // customer branch must leave the Store Manager's ordinary inventory
  // edit intact, in both directions, since that is also the write the
  // cancellation restore rides on (see CANCEL-2).
  //
  // Both directions are asserted: down is the manual correction a manager
  // makes after damaging an item, up is what a cancellation writes back.
  await assertSucceeds(updateDoc(doc(asSeller(), 'products/p1'), { stock: 9 }));
  await assertSucceeds(updateDoc(doc(asSeller(), 'products/p1'), { stock: 12 }));
  assertEqual(await readStock('p1'), 12, 'p1 stock after seller adjustments');
});

await test('SHOP-5  a guest cannot read products', async () => {
  await assertFails(getDoc(doc(asGuest(), 'products/p1')));
});

// ---------------------------------------------------------------------------
console.log('\nOrder cancellation — restoring stock');
// ---------------------------------------------------------------------------

// Cancelling is the mirror of checkout: AdminOrdersScreen puts each line's
// quantity back onto its product IN THE SAME TRANSACTION as the status
// change, so the two either both land or neither does.
//
// These tests use writeBatch rather than runTransaction because the two are
// identical in the respect being tested — atomicity and per-write rule
// evaluation — and a batch states the pair of writes literally, without a
// read phase whose retry behaviour would obscure what is being asserted.
// A rejected write anywhere in a batch rejects the whole batch.
const cancelBatch = (db, { orderId = 'o1', restores = {} } = {}) => {
  const batch = writeBatch(db);
  for (const [productId, stock] of Object.entries(restores)) {
    batch.update(doc(db, `products/${productId}`), { stock });
  }
  batch.update(doc(db, `users/customer1/orders/${orderId}`), { status: 'cancelled' });
  return batch.commit();
};

await test('CANCEL-1  a store manager can move an order through ordinary statuses', async () => {
  const db = asSeller();
  await assertSucceeds(updateDoc(doc(db, 'users/customer1/orders/o1'), { status: 'processing' }));
  await assertSucceeds(updateDoc(doc(db, 'users/customer1/orders/o1'), { status: 'shipped' }));
  await assertSucceeds(updateDoc(doc(db, 'users/customer1/orders/o1'), { status: 'delivered' }));
});

await test('CANCEL-2  cancelling a pending order restores stock atomically', async () => {
  // The order took 2 of p1 (10 -> 8 at checkout) and 3 of p3 (4 -> 1).
  // Cancelling gives back exactly that.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), 'products/p1'), { stock: 8 });
    await updateDoc(doc(ctx.firestore(), 'products/p3'), { stock: 1 });
  });
  await assertSucceeds(cancelBatch(asSeller(), { restores: { p1: 10, p3: 4 } }));
  assertEqual(await readStock('p1'), 10, 'p1 stock after cancellation');
  assertEqual(await readStock('p3'), 4, 'p3 stock after cancellation');
});

await test('CANCEL-3  a processing order can also be cancelled', async () => {
  await seedOrderWithStatus('oProcessing', 'processing');
  await assertSucceeds(
    cancelBatch(asSeller(), { orderId: 'oProcessing', restores: { p1: 12 } })
  );
});

await test('CANCEL-4  cancelling an ALREADY-cancelled order does not double-restore', async () => {
  // The idempotency case: a double tap, a stale screen, or a second
  // manager racing the first. The order rule allows a transition to
  // 'cancelled' only FROM pending/processing, so the repeat is denied —
  // and since the stock restore is in the same atomic write, it is rolled
  // back with it rather than landing on its own.
  await seedOrderWithStatus('oCancelled', 'cancelled');
  await assertFails(
    cancelBatch(asSeller(), { orderId: 'oCancelled', restores: { p1: 12 } })
  );
  assertEqual(await readStock('p1'), 10, 'p1 stock after a refused second cancellation');
});

await test('CANCEL-5  cancelling from shipped or delivered is rejected', async () => {
  // The goods have left the shop; restoring stock would invent inventory.
  await seedOrderWithStatus('oShipped', 'shipped');
  await seedOrderWithStatus('oDelivered', 'delivered');
  await assertFails(cancelBatch(asSeller(), { orderId: 'oShipped', restores: { p1: 12 } }));
  await assertFails(cancelBatch(asSeller(), { orderId: 'oDelivered', restores: { p1: 12 } }));
  assertEqual(await readStock('p1'), 10, 'p1 stock after refused cancellations');
  // Denied even on its own, with no stock write attached.
  await assertFails(updateDoc(doc(asSeller(), 'users/customer1/orders/oShipped'), { status: 'cancelled' }));
});

await test('CANCEL-6  an arbitrary stock write cannot ride along on a refused cancellation', async () => {
  // Rules cannot check a product write against the order it travels with
  // (see the products comment in firestore.rules). What they CAN do is
  // refuse the order half — and atomicity does the rest. A manager
  // inflating stock to 9999 alongside a cancellation the rule rejects
  // gets neither write.
  await seedOrderWithStatus('oDone', 'delivered');
  await assertFails(cancelBatch(asSeller(), { orderId: 'oDone', restores: { p1: 9999 } }));
  assertEqual(await readStock('p1'), 10, 'p1 stock after a refused inflation attempt');

  // The same attempt on a VALID cancellation is not stopped by rules —
  // a Store Manager may set stock directly through Edit Product anyway,
  // so this is a granted power of the role, not a hole opened by the
  // cancellation path. The transaction, not the rules, is what computes
  // the amount from the order's own line items. Asserted rather than
  // omitted so the boundary is written down where it can't be misread.
  await assertSucceeds(cancelBatch(asSeller(), { restores: { p1: 9999 } }));
});

await test('CANCEL-7  a status update cannot smuggle other order fields', async () => {
  const db = asSeller();
  // Editing the quantities a cancellation would restore from, the total,
  // or the customer the order belongs to — none are part of working an
  // order, and none survive the affectedKeys() allowlist.
  await assertFails(
    updateDoc(doc(db, 'users/customer1/orders/o1'), {
      status: 'cancelled',
      items: [{ productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 999 }],
    })
  );
  await assertFails(updateDoc(doc(db, 'users/customer1/orders/o1'), { status: 'cancelled', total: 0 }));
  await assertFails(updateDoc(doc(db, 'users/customer1/orders/o1'), { total: 0 }));
  await assertFails(updateDoc(doc(db, 'users/customer1/orders/o1'), { status: 'refunded' }));
});

await test('CANCEL-8  a customer cannot cancel their own order or restore stock', async () => {
  // Order writes stay staff-only, and customers now have no product write
  // access at all — so neither half of a cancellation is reachable. The
  // stock line below used to fail only because 12 is an INCREASE on a
  // seeded 10; since the customer branch was removed it fails for the
  // blunter reason that no such write is permitted in any direction. See
  // SHOP-2.
  const db = asCustomer();
  await assertFails(updateDoc(doc(db, 'users/customer1/orders/o1'), { status: 'cancelled' }));
  await assertFails(updateDoc(doc(db, 'products/p1'), { stock: 12 }));
  await assertFails(cancelBatch(db, { restores: { p1: 12 } }));
  assertEqual(await readStock('p1'), 10, 'p1 stock after a customer cancellation attempt');
});

await test('CANCEL-9  a deactivated store manager cannot cancel an order', async () => {
  await assertFails(cancelBatch(asDeactivatedSeller(), { restores: { p1: 12 } }));
  assertEqual(await readStock('p1'), 10, 'p1 stock after a deactivated manager attempt');
});

await test('CANCEL-10  a restore must leave stock well-typed', async () => {
  // The restore writes a real number, same as the checkout decrement. A
  // string or a negative would leave the product malformed for every
  // reader downstream, so the seller branch's type check rejects it.
  await assertFails(cancelBatch(asSeller(), { restores: { p1: '12' } }));
  await assertFails(cancelBatch(asSeller(), { restores: { p1: -1 } }));
});

// ---------------------------------------------------------------------------
console.log('\nStores');
// ---------------------------------------------------------------------------

const storeDoc = (overrides = {}) => ({
  name: 'Ukay ni Lola',
  createdAt: serverTimestamp(),
  ...overrides,
});

await test('STORE-1  a platform admin can open a store; no one else can', async () => {
  // Deciding who sells on the platform is account administration, so it
  // sits with the Platform Admin — the same role that grants Store Manager.
  // A Store Manager opening a second store for themselves would be vendor
  // self-signup by another route.
  await assertSucceeds(setDoc(doc(asAdmin(), 'stores/new1'), storeDoc()));
  await assertFails(setDoc(doc(asSeller(), 'stores/new2'), storeDoc()));
  await assertFails(setDoc(doc(asCustomer(), 'stores/new3'), storeDoc()));
});

await test('STORE-2  malformed or backdated stores are rejected', async () => {
  const db = asAdmin();
  await assertFails(setDoc(doc(db, 'stores/bad1'), storeDoc({ name: '   ' })));
  await assertFails(setDoc(doc(db, 'stores/bad2'), storeDoc({ name: 'x'.repeat(61) })));
  await assertFails(setDoc(doc(db, 'stores/bad3'), storeDoc({ ownerId: 'seller1' })));
  await assertFails(setDoc(doc(db, 'stores/bad4'), storeDoc({ createdAt: new Date('2020-01-01') })));
});

await test('STORE-3  a platform admin may rename a store, and only rename it', async () => {
  await assertSucceeds(updateDoc(doc(asAdmin(), 'stores/store1'), { name: 'Sam\'s Ukay' }));
  await assertFails(updateDoc(doc(asAdmin(), 'stores/store1'), { createdAt: new Date() }));
  await assertFails(updateDoc(doc(asSeller(), 'stores/store1'), { name: 'Mine Now' }));
});

await test('STORE-4  stores are readable when signed in, and never deletable', async () => {
  await assertSucceeds(getDocs(collection(asCustomer(), 'stores')));
  await assertFails(getDocs(collection(asGuest(), 'stores')));
  // Products and orders point at a store by id; deleting it would leave
  // them pointing at nothing.
  await assertFails(deleteDoc(doc(asAdmin(), 'stores/store1')));
  await assertFails(deleteDoc(doc(asSeller(), 'stores/store1')));
});

// ---------------------------------------------------------------------------
console.log('\nAssigning a Store Manager to a store');
// ---------------------------------------------------------------------------

await test('ASSIGN-1  a platform admin can move a manager to another store', async () => {
  await assertSucceeds(updateDoc(doc(asAdmin(), 'users/seller1'), { storeId: 'store2' }));
});

await test('ASSIGN-2  a manager must be assigned to a store that exists', async () => {
  // A bare role: 'seller' would mint a manager of nothing — harmless
  // under managesStore(), but a staff account that cannot do its job and
  // cannot tell why. Refused at the point of promotion instead.
  await assertFails(updateDoc(doc(asAdmin(), 'users/customer1'), { role: 'seller' }));
  await assertFails(
    updateDoc(doc(asAdmin(), 'users/customer1'), { role: 'seller', storeId: 'noSuchStore' })
  );
  await assertFails(
    updateDoc(doc(asAdmin(), 'users/customer1'), { role: 'seller', storeId: 42 })
  );
});

await test('ASSIGN-3  anyone who is not a manager carries no store', async () => {
  // Demoting must clear the store in the same write, or re-promoting the
  // account later would quietly hand the old store back.
  await assertFails(updateDoc(doc(asAdmin(), 'users/seller1'), { role: 'customer' }));
  await assertSucceeds(
    updateDoc(doc(asAdmin(), 'users/seller1'), { role: 'customer', storeId: deleteField() })
  );
  await assertFails(updateDoc(doc(asAdmin(), 'users/customer2'), { storeId: 'store1' }));
});

await test('ASSIGN-4  deactivating a manager from before stores existed still works', async () => {
  // unassignedSeller has no storeId, which would fail the assignment
  // check — but that check only applies when role or storeId changes.
  // Revoking access must never be blocked by an unrelated field.
  await assertSucceeds(
    updateDoc(doc(asAdmin(), 'users/unassignedSeller'), { isActive: false })
  );
});

await test('ASSIGN-5  a manager cannot choose their own store', async () => {
  await assertFails(updateDoc(doc(asSeller(), 'users/seller1'), { storeId: 'store2' }));
  await assertFails(
    updateDoc(doc(asUnassignedSeller(), 'users/unassignedSeller'), { storeId: 'store1' })
  );
  // Nor slip it into signup, which would skip promotion entirely.
  await assertFails(
    setDoc(doc(testEnv.authenticatedContext('newuser').firestore(), 'users/newuser'),
      signupDoc('newuser', { storeId: 'store1' }))
  );
});

await test('ASSIGN-6  opening a store and assigning its manager can be one write', async () => {
  // How AdminUsersScreen does it, so a store is never left without the
  // manager it was opened for. The store half is still held to /stores:
  // a batch whose new store is malformed is refused as a whole.
  const db = asAdmin();
  const good = writeBatch(db);
  good.set(doc(db, 'stores/fresh'), storeDoc());
  good.update(doc(db, 'users/customer1'), { role: 'seller', storeId: 'fresh' });
  await assertSucceeds(good.commit());

  const bad = writeBatch(db);
  bad.set(doc(db, 'stores/blank'), storeDoc({ name: '  ' }));
  bad.update(doc(db, 'users/customer2'), { role: 'seller', storeId: 'blank' });
  await assertFails(bad.commit());
});

// ---------------------------------------------------------------------------
console.log('\nProduct ownership — each manager runs only their own store');
// ---------------------------------------------------------------------------

await test('OWN-1  a manager can list products only under their own store', async () => {
  await assertSucceeds(setDoc(doc(asSeller(), 'products/mine'), productDoc()));
  await assertFails(
    setDoc(doc(asSeller(), 'products/theirs'), productDoc({ storeId: 'store2' }))
  );
  // A product with no store would have no manager, ever.
  const { storeId: _omitted, ...noStore } = productDoc();
  await assertFails(setDoc(doc(asSeller(), 'products/nowhere'), noStore));
});

await test('OWN-2  a manager cannot edit or delete another store\'s product', async () => {
  const db = asSeller();
  await assertFails(updateDoc(doc(db, 'products/p4'), { price: 1 }));
  await assertFails(updateDoc(doc(db, 'products/p4'), { stock: 0 }));
  await assertFails(deleteDoc(doc(db, 'products/p4')));
  // ...and the owner still can, so the refusal above is about ownership.
  await assertSucceeds(updateDoc(doc(asOtherSeller(), 'products/p4'), { price: 500 }));
});

await test('OWN-3  a product cannot be moved between stores', async () => {
  // Either direction: pushing your own product into another catalogue,
  // or pulling another store's product into yours.
  await assertFails(updateDoc(doc(asSeller(), 'products/p1'), { storeId: 'store2' }));
  await assertFails(updateDoc(doc(asSeller(), 'products/p4'), { storeId: 'store1' }));
  await assertFails(updateDoc(doc(asOtherSeller(), 'products/p4'), { storeId: 'store1' }));
});

await test('OWN-4  a manager with no store assigned can change no products', async () => {
  const db = asUnassignedSeller();
  await assertFails(setDoc(doc(db, 'products/x'), productDoc()));
  await assertFails(updateDoc(doc(db, 'products/p1'), { price: 1 }));
  await assertFails(deleteDoc(doc(db, 'products/p1')));
});

await test('OWN-5  an unmigrated product is frozen for every manager', async () => {
  // The null == null trap: an unassigned manager and a product with no
  // store must not match each other. Frozen until the migration script
  // gives it a store.
  await assertFails(updateDoc(doc(asUnassignedSeller(), 'products/orphan'), { price: 1 }));
  await assertFails(deleteDoc(doc(asUnassignedSeller(), 'products/orphan')));
  await assertFails(updateDoc(doc(asSeller(), 'products/orphan'), { price: 1 }));
  await assertFails(updateDoc(doc(asSeller(), 'products/orphan'), { storeId: 'store1' }));
});

await test('OWN-6  a cancellation cannot restore stock to another store\'s product', async () => {
  // Cancelling restores stock in the same batch as the status change, so
  // "any seller may cancel" used to mean "any seller may increment any
  // product". Now one foreign line sinks the whole batch, status included.
  await assertFails(cancelBatch(asSeller(), { restores: { p1: 12, p4: 99 } }));
  assertEqual(await readStock('p4'), 6, 'p4 stock after a refused cross-store restore');
  assertEqual(await readStock('p1'), 10, 'p1 stock after the batch was refused');
});

await test('OWN-7  only the store that sold an order may move its status', async () => {
  // o1 is store1's. Two managers sharing one status field would mean
  // neither owns it — which is why placeOrder splits carts per store.
  await assertFails(
    updateDoc(doc(asOtherSeller(), 'users/customer1/orders/o1'), { status: 'processing' })
  );
  await assertSucceeds(
    updateDoc(doc(asSeller(), 'users/customer1/orders/o1'), { status: 'processing' })
  );
});

await test('OWN-8  another store cannot cancel an order, even with its own stock', async () => {
  // The restore lines here are store2's own product, so the product half
  // would pass on its own; the ORDER half is what refuses, and the batch
  // dies with it.
  await assertFails(cancelBatch(asOtherSeller(), { restores: { p4: 7 } }));
  assertEqual(await readStock('p4'), 6, 'p4 stock after a refused foreign cancellation');
});

await test('OWN-9  an order from before stores existed is frozen until migrated', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/customer1/orders/unmigrated'), {
      customerId: 'customer1', items: [], total: 0, status: 'pending',
    });
  });
  await assertFails(
    updateDoc(doc(asSeller(), 'users/customer1/orders/unmigrated'), { status: 'processing' })
  );
  await assertFails(
    updateDoc(doc(asUnassignedSeller(), 'users/customer1/orders/unmigrated'), { status: 'processing' })
  );
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
      // Migrated (scripts/migrate-to-stores.mjs) — this test is about
      // unknown fields, and an unmigrated product is frozen regardless;
      // OWN-5 covers that separately.
      storeId: 'store1',
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
  // A general question: present and null, which routes it to the
  // Platform Admin. SUPPORT-2 covers requests about an order.
  storeId: null,
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
      orderId: 'o1', storeId: 'store1',
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
  storeId: 'store1',
  ...overrides,
});
// The account log has no store: same entry, minus storeId.
const accountEntry = (actorId, overrides = {}) => {
  const { storeId: _storeId, ...entry } = logEntry(actorId, overrides);
  return entry;
};
const storeLog = (db, storeId) =>
  query(collection(db, 'activityLogs'), where('storeId', '==', storeId));

await test('LOG-1  a store manager can write and read store activity', async () => {
  const db = asSeller();
  await assertSucceeds(setDoc(doc(db, 'activityLogs/l1'), logEntry('seller1')));
  await assertSucceeds(getDocs(storeLog(db, 'store1')));
});

await test('LOG-2  a platform admin can write and read account activity', async () => {
  const db = asAdmin();
  await assertSucceeds(
    setDoc(doc(db, 'accountLogs/l1'), accountEntry('admin1', { action: 'user.role' }))
  );
  await assertSucceeds(getDocs(collection(db, 'accountLogs')));
});

await test('LOG-3  each role is shut out of the OTHER log', async () => {
  await assertFails(getDocs(collection(asAdmin(), 'activityLogs')));
  await assertFails(getDocs(collection(asSeller(), 'accountLogs')));
  await assertFails(setDoc(doc(asAdmin(), 'activityLogs/x'), logEntry('admin1')));
  await assertFails(setDoc(doc(asSeller(), 'accountLogs/x'), accountEntry('seller1')));
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
      storeId: 'store1',
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
console.log('\nMail delivery log');
// ---------------------------------------------------------------------------

await test('MAIL-1  a store manager can read the mail log, and only read it', async () => {
  // The log records what the mailer did with each receipt and support
  // notification. A Store Manager reads it to answer "did that receipt go
  // out?" — the question the collection existed to answer while nothing
  // could see it.
  await assertSucceeds(getDoc(doc(asSeller(), 'mailLog/order-o1')));

  // No write rule exists for anyone, and that is load-bearing rather than
  // an oversight: this is a record of what the server did. A seller who
  // could edit it could mark a failed send as delivered, and the log stops
  // being evidence.
  await assertFails(setDoc(doc(asSeller(), 'mailLog/order-o1'), { status: 'sent' }));
  await assertFails(updateDoc(doc(asSeller(), 'mailLog/order-o1'), { status: 'sent' }));
  await assertFails(deleteDoc(doc(asSeller(), 'mailLog/order-o1')));
});

await test('MAIL-2  customers and platform admins cannot read a store\'s mail log', async () => {
  // Entries carry recipient email addresses. A customer must not read
  // other people's, and a platformAdmin is excluded on the same principle
  // that keeps them out of orders (SPLIT-6): these entries are store
  // operations, not account management.
  await assertFails(getDoc(doc(asCustomer(), 'mailLog/order-o1')));
  await assertFails(getDoc(doc(asAdmin(), 'mailLog/order-o1')));
  await assertFails(getDocs(collection(asCustomer(), 'mailLog')));

  // Including the customer the entry is actually about — there is no
  // owner-read branch here, deliberately. Nothing in the app shows a
  // shopper their own delivery receipts, so granting it would widen the
  // rule for a reader that does not exist.
  await assertFails(getDoc(doc(asCustomer(), 'mailLog/order-customer1')));
});

// ---------------------------------------------------------------------------
console.log('\nRate limiting');
// ---------------------------------------------------------------------------

await test('RATE-1  nobody can read or write their own rate-limit counter', async () => {
  // placeOrder throttles order attempts per account by counting them in
  // rateLimits/{uid}. The counter is only meaningful if the account it
  // constrains cannot touch it — a customer who could write this document
  // would reset their own quota and the limit would be decorative.
  //
  // No rule grants access to this collection and firestore.rules has no
  // catch-all, so today every line below passes by default. That is
  // exactly why the test is here: it is pinning an ABSENCE, and an absence
  // is what a later "let users see their own status" rule would quietly
  // remove. Reads are asserted too, because the attempt count is a signal
  // about how the throttle behaves and there is no reason to publish it.
  //
  // Staff are included: no role has business here. This is the server's
  // bookkeeping, not an admin surface.
  const db = asCustomer();
  await assertFails(getDoc(doc(db, 'rateLimits/customer1')));
  await assertFails(setDoc(doc(db, 'rateLimits/customer1'), { attempts: 0 }));
  await assertFails(updateDoc(doc(db, 'rateLimits/customer1'), { attempts: 0 }));
  await assertFails(deleteDoc(doc(db, 'rateLimits/customer1')));

  await assertFails(getDoc(doc(asSeller(), 'rateLimits/customer1')));
  await assertFails(setDoc(doc(asAdmin(), 'rateLimits/customer1'), { attempts: 0 }));
});

// ---------------------------------------------------------------------------
console.log('\nOrder creation (server-only)');
// ---------------------------------------------------------------------------

// The exact shape the ORDER rules used to accept from a client — and the
// shape placeOrder now writes server-side. It is kept, unchanged, as the
// control case: if a client can still write THIS, the tightening did not
// take. Everything in this section asserts a denial.
//
// NOTE ON WHAT THESE TESTS CANNOT SEE: the emulator suite exercises
// firestore.rules, and the function bypasses rules entirely. So nothing
// below proves placeOrder writes a correct order — only that no one else
// can write one at all. The function's own behaviour (server-side
// pricing, the stock decrement, status pinned to 'pending') is untested
// here and remains verified only by hand.
const checkoutOrder = (overrides = {}) => ({
  customerId: 'customer1',
  customerEmail: 'cathy@example.com',
  items: [
    {
      productId: 'p1', name: 'Denim Jacket', price: 850,
      quantity: 1, size: 'M', color: 'blue', image: null,
    },
  ],
  productIds: ['p1'],
  subtotal: 850,
  shipping: 0,
  total: 850,
  paymentMethod: 'cod',
  shippingAddress: {
    fullName: 'Cathy Customer', phone: '09171234567', address: '1 Mango Ave',
    city: 'Cebu City', province: 'Cebu', zipCode: '6000',
  },
  status: 'pending',
  createdAt: serverTimestamp(),
  ...overrides,
});

await test('ORDER-1  a customer CANNOT create an order, however well-formed', async () => {
  // The inverse of what this test used to assert. It previously ran the
  // write through runTransaction because that is how Checkoutscreen wrote
  // it; both forms are kept here, because a denial that holds for setDoc
  // but not inside a transaction would be no denial at all — checkout was
  // a transaction.
  //
  // The payload is the one the old rule was written to accept. Nothing
  // about it is malformed. It fails because there is no create rule on
  // this collection for anyone, which is the whole change.
  const db = asCustomer();
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/newOrder'), checkoutOrder())
  );
  await assertFails(
    runTransaction(db, async (tx) => {
      tx.set(doc(db, 'users/customer1/orders/newOrder2'), checkoutOrder());
    })
  );
});

await test('ORDER-2  an order CANNOT be created already delivered', async () => {
  // Unchanged in outcome, and kept even though ORDER-1 now subsumes it,
  // because this is the case that gives the rule its purpose. 'delivered'
  // is what /reviews accepts as proof of purchase: a client able to mint
  // one here could review any product it named without ever buying it.
  // If a create rule is ever reintroduced, this is the test that should
  // fail first.
  const db = asCustomer();
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/faked'), checkoutOrder({ status: 'delivered' }))
  );
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/faked2'), checkoutOrder({ status: 'shipped' }))
  );
});

await test('ORDER-3  no other caller can create an order either', async () => {
  // Into someone else's subcollection, as the account being impersonated,
  // and as staff. The seller case matters most: isSeller() may UPDATE an
  // order's status, and it would be an easy slip to let that same role
  // create one — a seller who can mint a 'delivered' order into a
  // customer's subcollection can manufacture verified-purchase reviews
  // just as effectively as the customer could.
  await assertFails(
    setDoc(doc(asCustomer(), 'users/customer2/orders/o9'), checkoutOrder({ customerId: 'customer2' }))
  );
  await assertFails(
    setDoc(doc(asOtherCustomer(), 'users/customer2/orders/o9'), checkoutOrder({ customerId: 'customer2' }))
  );
  await assertFails(
    setDoc(doc(asSeller(), 'users/customer1/orders/o9'), checkoutOrder({ status: 'delivered' }))
  );
  await assertFails(
    setDoc(doc(asAdmin(), 'users/customer1/orders/o9'), checkoutOrder())
  );
});

await test('ORDER-4  a customer cannot rewrite or delete an order after the fact', async () => {
  // Creation is closed, so the remaining client-side route to a forged
  // 'delivered' order is editing a real one. The order update rule is
  // seller-only and CANCEL-8 covers the status case; what is added here
  // is the money. A customer who could lower the total on a placed order
  // would undo the entire reason placement moved to the server, since
  // server-side pricing only holds if the written figure stays written.
  //
  // Delete is absent for every role by design (SRS §2.4, orders are
  // retained for audit), so it is pinned here too.
  const db = asCustomer();
  await assertFails(updateDoc(doc(db, 'users/customer1/orders/o1'), { total: 1 }));
  await assertFails(updateDoc(doc(db, 'users/customer1/orders/o1'), { status: 'delivered' }));
  await assertFails(deleteDoc(doc(db, 'users/customer1/orders/o1')));
  await assertFails(deleteDoc(doc(asSeller(), 'users/customer1/orders/o1')));
});

// ---------------------------------------------------------------------------
console.log('\nReviews (verified purchase)');
// ---------------------------------------------------------------------------

// The exact shape WriteReviewScreen.js writes, for the free line on the
// seeded delivered order (delivered1 / p1). delivered1 / p3 is already
// reviewed by the seed, and is what the update and delete tests use.
const reviewDoc = (overrides = {}) => ({
  orderId: 'delivered1',
  productId: 'p1',
  productName: 'Denim Jacket',
  userId: 'customer1',
  userName: 'Cathy C.',
  rating: 5,
  matchedDescription: true,
  text: 'Exactly as described — no marks, fits as listed.',
  hidden: false,
  createdAt: serverTimestamp(),
  // delivered1 is store1's order; the rule checks the review names it.
  storeId: 'store1',
  ...overrides,
});

await test('REVIEW-1  a delivered purchase can be reviewed', async () => {
  await assertSucceeds(
    setDoc(doc(asCustomer(), 'reviews/delivered1_p1'), reviewDoc())
  );
});

await test('REVIEW-2  an undelivered order cannot be reviewed', async () => {
  // o1 is seeded 'pending'. This is link 3 of the verified-purchase chain:
  // without it, "verified" would mean nothing more than "has an account".
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/o1_p1'), reviewDoc({ orderId: 'o1' }))
  );
  await seedOrderWithStatus('shippedOrder', 'shipped');
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/shippedOrder_p1'), reviewDoc({ orderId: 'shippedOrder' }))
  );
});

await test('REVIEW-3  a product NOT on the order cannot be reviewed', async () => {
  // delivered1 contains p1 and p3. Reviewing p2 through it would be a
  // review of something never bought, carrying a verified-purchase badge.
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/delivered1_p2'), reviewDoc({ productId: 'p2' }))
  );
});

await test("REVIEW-4  another customer's delivered order cannot be borrowed", async () => {
  // customer2 naming customer1's order. The rule reads the order from the
  // CALLER's own path, so this can never resolve to a real order.
  await assertFails(
    setDoc(doc(asOtherCustomer(), 'reviews/delivered1_p1'), reviewDoc({ userId: 'customer2' }))
  );
});

await test('REVIEW-5  the document id must match the order and product inside', async () => {
  // Without this, one review per order line would be a client convention:
  // the same purchase could be written under any number of random ids.
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/somethingElse'), reviewDoc())
  );
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/delivered1_p3'), reviewDoc({ productId: 'p1' }))
  );
});

await test('REVIEW-6  a line cannot be reviewed twice', async () => {
  // delivered1_p3 is seeded. A second create lands on an existing document
  // and Firestore refuses it — the derived id is what makes that true.
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/delivered1_p3'), reviewDoc({ productId: 'p3' }))
  );
});

await test('REVIEW-7  malformed reviews are rejected', async () => {
  const db = asCustomer();
  await assertFails(setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ rating: 0 })));
  await assertFails(setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ rating: 6 })));
  await assertFails(setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ rating: 4.5 })));
  await assertFails(setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ rating: '5' })));
  await assertFails(
    setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ matchedDescription: 'yes' }))
  );
  await assertFails(
    setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ text: 'x'.repeat(1001) }))
  );
  await assertFails(
    setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ helpfulVotes: 3 }))
  );
});

await test('REVIEW-8  a review cannot be posted as someone else, or backdated', async () => {
  const db = asCustomer();
  await assertFails(
    setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ userId: 'customer2' }))
  );
  await assertFails(
    setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ createdAt: new Date('2020-01-01') }))
  );
});

await test('REVIEW-9  a review cannot arrive already hidden', async () => {
  // Same reasoning as supportRequests having to be created 'open': content
  // that can be created pre-hidden never passes through moderation at all.
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/delivered1_p1'), reviewDoc({ hidden: true }))
  );
});

await test('REVIEW-10  the author may revise their own review', async () => {
  await assertSucceeds(
    updateDoc(doc(asCustomer(), 'reviews/delivered1_p3'), {
      rating: 3,
      matchedDescription: false,
      text: 'Second look: the cuff is frayed.',
      updatedAt: serverTimestamp(),
    })
  );
});

await test('REVIEW-11  a revision cannot re-point a review, or hide it', async () => {
  // The three fields create verified against a real delivered order are
  // exactly the three a revision must not touch — otherwise a review
  // earned on one purchase could be walked onto any other product.
  const db = asCustomer();
  await assertFails(
    updateDoc(doc(db, 'reviews/delivered1_p3'), { productId: 'p2', updatedAt: serverTimestamp() })
  );
  await assertFails(
    updateDoc(doc(db, 'reviews/delivered1_p3'), { orderId: 'o1', updatedAt: serverTimestamp() })
  );
  await assertFails(
    updateDoc(doc(db, 'reviews/delivered1_p3'), { userId: 'customer2', updatedAt: serverTimestamp() })
  );
  // hidden is the seller's field, not the author's.
  await assertFails(
    updateDoc(doc(db, 'reviews/delivered1_p3'), { hidden: true, updatedAt: serverTimestamp() })
  );
  // ...and a revision cannot be backdated either.
  await assertFails(
    updateDoc(doc(db, 'reviews/delivered1_p3'), { rating: 1, updatedAt: new Date('2020-01-01') })
  );
});

await test("REVIEW-12  nobody may edit another person's review", async () => {
  await assertFails(
    updateDoc(doc(asOtherCustomer(), 'reviews/delivered1_p3'), {
      rating: 1, updatedAt: serverTimestamp(),
    })
  );
});

await test('REVIEW-13  a store manager may hide and restore, and nothing else', async () => {
  await assertSucceeds(updateDoc(doc(asSeller(), 'reviews/delivered1_p3'), { hidden: true }));
  await assertSucceeds(updateDoc(doc(asSeller(), 'reviews/delivered1_p3'), { hidden: false }));
  // Moderation means suppressing abuse, not editing opinion: a manager
  // cannot rewrite the rating or the text, alone or smuggled alongside a
  // legitimate hide.
  await assertFails(updateDoc(doc(asSeller(), 'reviews/delivered1_p3'), { rating: 5 }));
  await assertFails(updateDoc(doc(asSeller(), 'reviews/delivered1_p3'), { text: 'Great!' }));
  await assertFails(
    updateDoc(doc(asSeller(), 'reviews/delivered1_p3'), { hidden: true, text: 'Great!' })
  );
});

await test('REVIEW-14  a platform admin has no say over reviews', async () => {
  // Reviews are store content, so they sit on the Store Manager's side of
  // the split — the same side as products, orders and support requests.
  await assertFails(updateDoc(doc(asAdmin(), 'reviews/delivered1_p3'), { hidden: true }));
});

await test('REVIEW-15  reviews cannot be deleted, by anyone', async () => {
  // The property that makes the rest of this worth anything: a store that
  // can erase reviews can erase the unflattering ones, and no reader could
  // tell a clean record from a cleaned one.
  await assertFails(deleteDoc(doc(asCustomer(), 'reviews/delivered1_p3')));
  await assertFails(deleteDoc(doc(asSeller(), 'reviews/delivered1_p3')));
  await assertFails(deleteDoc(doc(asAdmin(), 'reviews/delivered1_p3')));
});

await test('REVIEW-16  a legacy order without productIds cannot be reviewed', async () => {
  // legacy1 is seeded delivered but predates the productIds field, so the
  // rule's .get() default of [] leaves nothing to match. Failing this way
  // is the safe direction — the alternative (admitting a review when the
  // list is missing) would make the check optional for anyone who simply
  // omitted the field.
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/legacy1_p1'), reviewDoc({ orderId: 'legacy1' }))
  );
});

await test('REVIEW-17  a deactivated account cannot write a review', async () => {
  await assertFails(
    setDoc(doc(asDeactivatedCustomer(), 'reviews/delivered2_p1'), reviewDoc({
      orderId: 'delivered2', userId: 'deactivatedCustomer',
    }))
  );
});

await test('REVIEW-18  any signed-in shopper can read reviews; a guest cannot', async () => {
  // A review the next shopper cannot read does not do the one job it has —
  // but the collection is still closed to unauthenticated clients, exactly
  // like /products.
  await assertSucceeds(getDocs(collection(asOtherCustomer(), 'reviews')));
  await assertSucceeds(getDocs(collection(asSeller(), 'reviews')));
  await assertFails(getDocs(collection(asGuest(), 'reviews')));
});

await test('STAFF-1  a customer may fill their own cart and favorites', async () => {
  const db = asCustomer();
  await assertSucceeds(setDoc(doc(db, 'users/customer1/cart/line1'), { productId: 'p1', quantity: 1 }));
  await assertSucceeds(setDoc(doc(db, 'users/customer1/favorites/p1'), { name: 'Denim Jacket' }));
});

await test('STAFF-2  staff accounts cannot add to a cart or favorites, but can read them', async () => {
  // placeOrder refuses staff too; this keeps the cart from filling with
  // an order that could never be placed.
  for (const [db, uid] of [[asSeller(), 'seller1'], [asAdmin(), 'admin1']]) {
    await assertFails(setDoc(doc(db, `users/${uid}/cart/line1`), { productId: 'p1', quantity: 1 }));
    await assertFails(setDoc(doc(db, `users/${uid}/favorites/p1`), { name: 'Denim Jacket' }));
    await assertSucceeds(getDocs(collection(db, `users/${uid}/cart`)));
    await assertSucceeds(getDocs(collection(db, `users/${uid}/favorites`)));
  }
});

await test('REVIEW-19  "Not quite" may say what was different, from the known list', async () => {
  await assertSucceeds(
    setDoc(
      doc(asCustomer(), 'reviews/delivered1_p1'),
      reviewDoc({ matchedDescription: false, mismatchReasons: ['quality', 'photos'] })
    )
  );
  await assertSucceeds(
    updateDoc(doc(asCustomer(), 'reviews/delivered1_p3'), {
      rating: 2,
      matchedDescription: false,
      mismatchReasons: ['colour'],
      text: 'Darker than the photos.',
      updatedAt: serverTimestamp(),
    })
  );
});

await test('REVIEW-20  mismatch reasons must be known keys, and absent when it matched', async () => {
  const db = asCustomer();
  await assertFails(
    setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ matchedDescription: false, mismatchReasons: ['smell'] }))
  );
  await assertFails(
    setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ matchedDescription: false, mismatchReasons: 'quality' }))
  );
  // Matched, yet something was different — contradicts itself.
  await assertFails(
    setDoc(doc(db, 'reviews/delivered1_p1'), reviewDoc({ matchedDescription: true, mismatchReasons: ['size'] }))
  );
  await assertFails(
    updateDoc(doc(db, 'reviews/delivered1_p3'), {
      mismatchReasons: ['size'],
      updatedAt: serverTimestamp(),
    })
  );
});

// ---------------------------------------------------------------------------
console.log('\nStore scoping — each manager sees only their own store');
// ---------------------------------------------------------------------------

await test('SCOPE-1  a manager cannot read another store\'s orders', async () => {
  // o1 is store1's, and carries a customer's name, phone and address.
  await assertFails(getDoc(doc(asOtherSeller(), 'users/customer1/orders/o1')));
  await assertFails(getDocs(storeOrders(asOtherSeller(), 'store1')));
  // Their own store's list is fine, even when it is empty.
  await assertSucceeds(getDocs(storeOrders(asOtherSeller(), 'store2')));
});

await test('SCOPE-2  an unfiltered order query is refused, even for a manager', async () => {
  // Rules are not filters: a query that COULD return another store's
  // order is refused whole. This is why the screens must filter.
  await assertFails(getDocs(collectionGroup(asSeller(), 'orders')));
});

await test('SCOPE-3  the customer still reads their own orders, whichever store', async () => {
  await assertSucceeds(getDocs(collection(asCustomer(), 'users/customer1/orders')));
});

await test('SCOPE-4  a manager with no store reads no orders', async () => {
  await assertFails(getDoc(doc(asUnassignedSeller(), 'users/customer1/orders/o1')));
});

await test('SCOPE-5  a review must name the store that sold the item', async () => {
  // Otherwise a reviewer could file a review into any store's queue.
  await assertFails(
    setDoc(doc(asCustomer(), 'reviews/delivered1_p1'), reviewDoc({ storeId: 'store2' }))
  );
  const { storeId: _storeId, ...noStore } = reviewDoc();
  await assertFails(setDoc(doc(asCustomer(), 'reviews/delivered1_p1'), noStore));
  await assertSucceeds(setDoc(doc(asCustomer(), 'reviews/delivered1_p1'), reviewDoc()));
});

await test('SCOPE-6  another store cannot hide a store\'s reviews', async () => {
  // A competitor suppressing reviews is the abuse moderation must not
  // enable.
  await assertFails(updateDoc(doc(asOtherSeller(), 'reviews/delivered1_p3'), { hidden: true }));
  await assertSucceeds(updateDoc(doc(asSeller(), 'reviews/delivered1_p3'), { hidden: true }));
});

await test('SCOPE-7  a manager logs and reads only their own store\'s activity', async () => {
  await assertFails(
    setDoc(doc(asSeller(), 'activityLogs/wrongStore'), logEntry('seller1', { storeId: 'store2' }))
  );
  const { storeId: _storeId, ...noStore } = logEntry('seller1');
  await assertFails(setDoc(doc(asSeller(), 'activityLogs/noStore'), noStore));
  await assertFails(getDocs(storeLog(asOtherSeller(), 'store1')));
  await assertFails(getDocs(collection(asSeller(), 'activityLogs')));
});

// ---------------------------------------------------------------------------
console.log('\nSupport routing — by order to its store, otherwise to the Platform Admin');
// ---------------------------------------------------------------------------

const supportQueue = (db, storeId) =>
  query(collection(db, 'supportRequests'), where('storeId', '==', storeId));

await test('SUPPORT-1  a general question goes to the Platform Admin, not to any store', async () => {
  await assertSucceeds(setDoc(doc(asCustomer(), 'supportRequests/g1'), supportDoc('customer1')));
  await assertSucceeds(getDocs(supportQueue(asAdmin(), null)));
  await assertSucceeds(updateDoc(doc(asAdmin(), 'supportRequests/g1'), { status: 'resolved' }));
  await assertFails(getDoc(doc(asSeller(), 'supportRequests/g1')));
  await assertFails(getDocs(supportQueue(asSeller(), null)));
});

await test('SUPPORT-2  a question about an order goes to that order\'s store only', async () => {
  await assertSucceeds(
    setDoc(doc(asCustomer(), 'supportRequests/o1q'), supportDoc('customer1', { orderId: 'o1', storeId: 'store1' }))
  );
  await assertSucceeds(getDocs(supportQueue(asSeller(), 'store1')));
  await assertSucceeds(updateDoc(doc(asSeller(), 'supportRequests/o1q'), { status: 'resolved' }));
  await assertFails(getDoc(doc(asOtherSeller(), 'supportRequests/o1q')));
  await assertFails(getDoc(doc(asAdmin(), 'supportRequests/o1q')));
});

await test('SUPPORT-3  routing is checked against the order, not trusted', async () => {
  const db = asCustomer();
  // The right order, the wrong store: a message dropped into any queue.
  await assertFails(setDoc(doc(db, 'supportRequests/x1'), supportDoc('customer1', { orderId: 'o1', storeId: 'store2' })));
  // A store with no order to justify it.
  await assertFails(setDoc(doc(db, 'supportRequests/x2'), supportDoc('customer1', { storeId: 'store1' })));
  // An order with no store: it would land in the Platform Admin's inbox.
  await assertFails(setDoc(doc(db, 'supportRequests/x3'), supportDoc('customer1', { orderId: 'o1' })));
  // Someone else's order.
  await assertFails(
    setDoc(doc(asOtherCustomer(), 'supportRequests/x4'), supportDoc('customer2', { orderId: 'o1', storeId: 'store1' }))
  );
  // No routing field at all.
  const { storeId: _storeId, ...unrouted } = supportDoc('customer1');
  await assertFails(setDoc(doc(db, 'supportRequests/x5'), unrouted));
});

await test('SUPPORT-4  a request cannot be moved into another queue', async () => {
  await assertFails(updateDoc(doc(asSeller(), 'supportRequests/s9'), { storeId: 'store2' }));
  await assertFails(updateDoc(doc(asSeller(), 'supportRequests/s9'), { storeId: null }));
});

await test('SUPPORT-5  the mail log follows the same routing', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'mailLog/support-g1'), {
      kind: 'supportRequest', requestId: 'g1', status: 'failed', storeId: null, recordedAt: new Date(),
    });
  });
  await assertSucceeds(getDoc(doc(asAdmin(), 'mailLog/support-g1')));
  await assertFails(getDoc(doc(asSeller(), 'mailLog/support-g1')));
  await assertFails(getDoc(doc(asOtherSeller(), 'mailLog/order-o1')));
  // A manager's list is their store's entries, and must say so.
  await assertSucceeds(getDocs(query(collection(asSeller(), 'mailLog'), where('storeId', '==', 'store1'))));
  await assertFails(getDocs(collection(asSeller(), 'mailLog')));
});

// ---------------------------------------------------------------------------
// Order chat: the customer and the order's own store, nobody else.
// ---------------------------------------------------------------------------
const chatPath = 'users/customer1/orders/o1/messages';
const chatMessage = (sender, senderId, overrides = {}) => ({
  senderId, sender, text: 'Is the jacket still clean?', createdAt: serverTimestamp(), ...overrides,
});
const seedChatMessage = () =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `${chatPath}/m1`), {
      senderId: 'seller1', sender: 'store', text: 'Photo before it ships', createdAt: new Date(),
    });
  });

await test('CHAT-1  the customer and the order\'s store manager can both send', async () => {
  await assertSucceeds(setDoc(doc(asCustomer(), `${chatPath}/c1`), chatMessage('customer', 'customer1')));
  await assertSucceeds(setDoc(doc(asSeller(), `${chatPath}/s1`), chatMessage('store', 'seller1')));
  // A photo with no words is a message too.
  await assertSucceeds(setDoc(doc(asSeller(), `${chatPath}/s2`), chatMessage('store', 'seller1', {
    text: '', imageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/chat%2Fa.jpg',
  })));
});

await test('CHAT-2  nobody else can read or write the conversation', async () => {
  await seedChatMessage();
  await assertSucceeds(getDoc(doc(asCustomer(), `${chatPath}/m1`)));
  await assertSucceeds(getDocs(collection(asSeller(), chatPath)));
  for (const outsider of [asOtherCustomer, asOtherSeller, asUnassignedSeller, asAdmin, asGuest]) {
    await assertFails(getDoc(doc(outsider(), `${chatPath}/m1`)));
    await assertFails(getDocs(collection(outsider(), chatPath)));
  }
  await assertFails(setDoc(doc(asOtherSeller(), `${chatPath}/x`), chatMessage('store', 'seller2')));
  await assertFails(setDoc(doc(asOtherCustomer(), `${chatPath}/x`), chatMessage('customer', 'customer2')));
  await assertFails(setDoc(doc(asAdmin(), `${chatPath}/x`), chatMessage('store', 'admin1')));
});

await test('CHAT-3  nobody can speak as someone else, or as the other side', async () => {
  await assertFails(setDoc(doc(asCustomer(), `${chatPath}/x`), chatMessage('store', 'customer1')));
  await assertFails(setDoc(doc(asCustomer(), `${chatPath}/x`), chatMessage('customer', 'seller1')));
  await assertFails(setDoc(doc(asSeller(), `${chatPath}/x`), chatMessage('customer', 'seller1')));
});

await test('CHAT-4  a message must be well-formed and stamped by the server', async () => {
  const send = (overrides) => setDoc(doc(asCustomer(), `${chatPath}/x`), chatMessage('customer', 'customer1', overrides));
  await assertFails(send({ text: '   ' }));
  await assertFails(send({ text: 'x'.repeat(1001) }));
  await assertFails(send({ createdAt: new Date('2020-01-01') }));
  await assertFails(send({ imageUrl: '' }));
  await assertFails(send({ extra: true }));
  // An order that does not exist has no conversation to join.
  await assertFails(setDoc(doc(asCustomer(), 'users/customer1/orders/nope/messages/x'),
    chatMessage('customer', 'customer1')));
});

await test('CHAT-5  no one can delete a message outright', async () => {
  await seedChatMessage();
  await assertFails(deleteDoc(doc(asSeller(), `${chatPath}/m1`)));
  await assertFails(deleteDoc(doc(asCustomer(), `${chatPath}/m1`)));
});

const seedMessageAt = (id, createdAt, overrides = {}) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `${chatPath}/${id}`), {
      senderId: 'seller1', sender: 'store', text: 'Walang mantsa po', createdAt, ...overrides,
    });
  });

await test('CHAT-9  the sender can edit their text within 15 minutes, marked as edited', async () => {
  await seedMessageAt('m1', new Date());
  await assertSucceeds(updateDoc(doc(asSeller(), `${chatPath}/m1`), { text: 'Walang mantsa po, promise', editedAt: serverTimestamp() }));
  // Unmarked, emptied, or by anyone else.
  await assertFails(updateDoc(doc(asSeller(), `${chatPath}/m1`), { text: 'sneaky' }));
  await assertFails(updateDoc(doc(asSeller(), `${chatPath}/m1`), { text: '  ', editedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asCustomer(), `${chatPath}/m1`), { text: 'not mine', editedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asSeller(), `${chatPath}/m1`), { sender: 'customer', editedAt: serverTimestamp() }));
});

await test('CHAT-10  editing closes after 15 minutes', async () => {
  await seedMessageAt('old', new Date(Date.now() - 16 * 60 * 1000));
  await assertFails(updateDoc(doc(asSeller(), `${chatPath}/old`), { text: 'too late', editedAt: serverTimestamp() }));
});

await test('CHAT-11  the sender can unsend, and it leaves a placeholder', async () => {
  await seedMessageAt('m1', new Date(Date.now() - 60 * 60 * 1000), {
    imageUrl: 'https://example.com/a.jpg', reactions: { customer1: '❤️' },
  });
  const unsend = { deleted: true, deletedAt: serverTimestamp(), text: '', imageUrl: deleteField(), reactions: deleteField() };
  await assertFails(updateDoc(doc(asCustomer(), `${chatPath}/m1`), unsend));
  // Keeping the photo is not unsending it.
  await assertFails(updateDoc(doc(asSeller(), `${chatPath}/m1`), { ...unsend, imageUrl: 'https://example.com/a.jpg' }));
  await assertSucceeds(updateDoc(doc(asSeller(), `${chatPath}/m1`), unsend));
  // Once unsent, it cannot be brought back or edited.
  await assertFails(updateDoc(doc(asSeller(), `${chatPath}/m1`), { text: 'back', editedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asSeller(), `${chatPath}/m1`), { deleted: false }));
});

await test('CHAT-12  both sides can react, one emoji each, from the set', async () => {
  await seedMessageAt('m1', new Date());
  await assertSucceeds(updateDoc(doc(asCustomer(), `${chatPath}/m1`), { 'reactions.customer1': '❤️' }));
  await assertSucceeds(updateDoc(doc(asSeller(), `${chatPath}/m1`), { 'reactions.seller1': '👍' }));
  await assertSucceeds(updateDoc(doc(asCustomer(), `${chatPath}/m1`), { 'reactions.customer1': deleteField() }));
  // Someone else's reaction, an emoji outside the set, an outsider.
  await assertFails(updateDoc(doc(asCustomer(), `${chatPath}/m1`), { 'reactions.seller1': deleteField() }));
  await assertFails(updateDoc(doc(asCustomer(), `${chatPath}/m1`), { 'reactions.customer1': '💩' }));
  await assertFails(updateDoc(doc(asOtherSeller(), `${chatPath}/m1`), { 'reactions.seller2': '❤️' }));
  // A reaction cannot ride along with a change to the words.
  await assertFails(updateDoc(doc(asCustomer(), `${chatPath}/m1`), { 'reactions.customer1': '❤️', text: 'x' }));
});

await test('CHAT-13  a reply carries a short, well-formed quote', async () => {
  const reply = (replyTo) => setDoc(doc(asCustomer(), `${chatPath}/r`),
    chatMessage('customer', 'customer1', { replyTo }));
  await assertSucceeds(reply({ id: 'm1', text: 'Walang mantsa po', sender: 'store', hasImage: false }));
  await assertFails(reply({ id: 'm1', text: 'x'.repeat(201), sender: 'store', hasImage: false }));
  await assertFails(reply({ id: 'm1', text: 'hi', sender: 'admin', hasImage: false }));
  await assertFails(reply({ id: 'm1', text: 'hi', sender: 'store', hasImage: false, extra: 1 }));
  // Nobody creates a message pre-reacted, pre-edited or pre-unsent.
  await assertFails(setDoc(doc(asCustomer(), `${chatPath}/x`), chatMessage('customer', 'customer1', { reactions: {} })));
  await assertFails(setDoc(doc(asCustomer(), `${chatPath}/x`), chatMessage('customer', 'customer1', { deleted: true })));
});

await test('CHAT-6  a deactivated customer cannot send', async () => {
  await assertFails(setDoc(
    doc(asDeactivatedCustomer(), 'users/deactivatedCustomer/orders/delivered2/messages/x'),
    chatMessage('customer', 'deactivatedCustomer')
  ));
});

await test('CHAT-7  each side stamps its own unread bookkeeping, and only that', async () => {
  const order = (db) => doc(db, 'users/customer1/orders/o1');
  await assertSucceeds(updateDoc(order(asCustomer()), {
    lastMessageAt: serverTimestamp(), lastMessageBy: 'customer',
  }));
  await assertSucceeds(updateDoc(order(asCustomer()), { customerReadAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(order(asSeller()), {
    lastMessageAt: serverTimestamp(), lastMessageBy: 'store',
  }));
  await assertSucceeds(updateDoc(order(asSeller()), { storeReadAt: serverTimestamp() }));
  // The other side's marker, the other side's name, a made-up clock.
  await assertFails(updateDoc(order(asCustomer()), { storeReadAt: serverTimestamp() }));
  await assertFails(updateDoc(order(asCustomer()), { lastMessageAt: serverTimestamp(), lastMessageBy: 'store' }));
  await assertFails(updateDoc(order(asSeller()), { customerReadAt: serverTimestamp() }));
  await assertFails(updateDoc(order(asCustomer()), { customerReadAt: new Date('2099-01-01') }));
  await assertFails(updateDoc(order(asOtherSeller()), { storeReadAt: serverTimestamp() }));
});

await test('CHAT-8  the chat bookkeeping is not a back door into the order', async () => {
  const order = (db) => doc(db, 'users/customer1/orders/o1');
  await assertFails(updateDoc(order(asCustomer()), { customerReadAt: serverTimestamp(), status: 'delivered' }));
  await assertFails(updateDoc(order(asCustomer()), { customerReadAt: serverTimestamp(), total: 1 }));
  await assertFails(updateDoc(order(asSeller()), { storeReadAt: serverTimestamp(), total: 1 }));
  await assertFails(updateDoc(order(asCustomer()), { status: 'cancelled' }));
});

// ---------------------------------------------------------------------------
// Profiles: a customer's photo, a store's logo and description.
// ---------------------------------------------------------------------------
await test('PROFILE-1  a customer can set and remove their own photo, and nothing else rides along', async () => {
  const me = doc(asCustomer(), 'users/customer1');
  await assertSucceeds(updateDoc(me, { photoUrl: 'https://example.com/me.jpg' }));
  await assertSucceeds(updateDoc(me, { photoUrl: deleteField() }));
  await assertFails(updateDoc(me, { photoUrl: '' }));
  await assertFails(updateDoc(me, { photoUrl: 'https://example.com/me.jpg', role: 'seller' }));
  await assertFails(updateDoc(doc(asCustomer(), 'users/customer2'), { photoUrl: 'https://example.com/x.jpg' }));
});

await test('PROFILE-2  a store manager can edit their own store\'s logo and description only', async () => {
  const store1 = (db) => doc(db, 'stores/store1');
  await assertSucceeds(updateDoc(store1(asSeller()), {
    logoUrl: 'https://example.com/logo.png', description: 'Preloved denim, hand-picked.',
  }));
  await assertSucceeds(updateDoc(store1(asSeller()), { logoUrl: deleteField(), description: deleteField() }));
  // Not the name, not too long, not another store, not a customer.
  await assertFails(updateDoc(store1(asSeller()), { name: 'Renamed' }));
  await assertFails(updateDoc(store1(asSeller()), { description: 'x'.repeat(301) }));
  await assertFails(updateDoc(store1(asOtherSeller()), { description: 'Hijacked' }));
  await assertFails(updateDoc(store1(asCustomer()), { description: 'Hi' }));
  await assertFails(updateDoc(store1(asDeactivatedSeller()), { description: 'Gone' }));
  // The Platform Admin still owns the name.
  await assertSucceeds(updateDoc(store1(asAdmin()), { name: 'Tindahan ni Sam 2' }));
});

await test('PROFILE-3  a review may carry the author\'s photo', async () => {
  const review = (overrides) => setDoc(doc(asCustomer(), 'reviews/delivered1_p1'), {
    orderId: 'delivered1', productId: 'p1', productName: 'Denim Jacket',
    userId: 'customer1', userName: 'Cathy C.', rating: 5, matchedDescription: true,
    text: '', hidden: false, createdAt: serverTimestamp(), storeId: 'store1', ...overrides,
  });
  await assertFails(review({ userPhotoUrl: 'x'.repeat(2001) }));
  await assertSucceeds(review({ userPhotoUrl: 'https://example.com/me.jpg' }));
});

// ---------------------------------------------------------------------------
// PayMongo checkouts and the gateway switch. Both are written only by
// functions/index.js; these pin that no client can write either, and that
// a checkout is readable by its own customer alone.

async function seedCheckout() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, 'checkouts/co1'), {
      customerId: 'customer1', status: 'pending', total: 850, gateway: 'paymongo',
    });
    await setDoc(doc(admin, 'config/payments'), { gateway: 'paymongo' });
  });
}

await test('PAY-1  a customer reads their own checkout, and nobody else can', async () => {
  await seedCheckout();
  await assertSucceeds(getDoc(doc(asCustomer(), 'checkouts/co1')));
  await assertFails(getDoc(doc(asOtherCustomer(), 'checkouts/co1')));
  await assertFails(getDoc(doc(asSeller(), 'checkouts/co1')));
  await assertFails(getDoc(doc(asGuest(), 'checkouts/co1')));
  // Get only: there is no screen that lists checkouts.
  await assertFails(getDocs(query(collection(asCustomer(), 'checkouts'), where('customerId', '==', 'customer1'))));
});

await test('PAY-2  no client can mark a checkout paid, release it, or create one', async () => {
  await seedCheckout();
  await assertFails(updateDoc(doc(asCustomer(), 'checkouts/co1'), { status: 'paid' }));
  await assertFails(updateDoc(doc(asCustomer(), 'checkouts/co1'), { status: 'released' }));
  await assertFails(deleteDoc(doc(asCustomer(), 'checkouts/co1')));
  await assertFails(setDoc(doc(asCustomer(), 'checkouts/co2'), { customerId: 'customer1', status: 'paid' }));
  await assertFails(updateDoc(doc(asSeller(), 'checkouts/co1'), { status: 'paid' }));
});

await test('PAY-3  anyone signed in reads the gateway setting; nobody writes it', async () => {
  await seedCheckout();
  await assertSucceeds(getDoc(doc(asCustomer(), 'config/payments')));
  await assertFails(getDoc(doc(asGuest(), 'config/payments')));
  // Flipping it to 'sandbox' would let a customer pay with a pretend bank.
  await assertFails(setDoc(doc(asCustomer(), 'config/payments'), { gateway: 'sandbox' }));
  await assertFails(setDoc(doc(asAdmin(), 'config/payments'), { gateway: 'sandbox' }));
  await assertFails(setDoc(doc(asSeller(), 'config/payments'), { gateway: 'sandbox' }));
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
