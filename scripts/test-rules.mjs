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
    // p3, not p2 — SPLIT-3/SPLIT-4 write to products/p2 and would be
    // testing `allow update` instead of `allow create` if the seed put a
    // document there first.
    await setDoc(doc(db, 'products/p3'), {
      name: 'Wool Scarf', price: 200, stock: 4,
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
      total: 2300, status: 'pending',
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
      total: 1050, status: 'delivered',
    });
    // Delivered, but written before productIds existed — REVIEW-16 asserts
    // its lines are unreviewable rather than silently admitted.
    await setDoc(doc(db, 'users/customer1/orders/legacy1'), {
      customerId: 'customer1',
      customerEmail: 'cathy@example.com',
      items: [{ productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 1 }],
      total: 850, status: 'delivered',
    });
    // One line of delivered1 already reviewed, leaving the other (p1) free
    // for the create tests. This one is what the update and delete tests
    // act on.
    await setDoc(doc(db, 'reviews/delivered1_p3'), {
      orderId: 'delivered1', productId: 'p3', productName: 'Wool Scarf',
      userId: 'customer1', userName: 'Cathy C.', rating: 4,
      matchedDescription: true, text: 'Warm and clean.', hidden: false,
      createdAt: new Date(),
    });
    await setDoc(doc(db, 'users/deactivatedCustomer'), {
      uid: 'deactivatedCustomer', name: 'Dee Activated', email: 'dee@example.com',
      isActive: false,
    });
    await setDoc(doc(db, 'users/deactivatedCustomer/orders/delivered2'), {
      customerId: 'deactivatedCustomer', customerEmail: 'dee@example.com',
      items: [{ productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 1 }],
      productIds: ['p1'], total: 850, status: 'delivered',
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
      total: 1700, status,
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
const asAdmin = () => testEnv.authenticatedContext('admin1').firestore();
const asDeactivatedSeller = () => testEnv.authenticatedContext('deactivatedSeller').firestore();
const asDeactivatedCustomer = () => testEnv.authenticatedContext('deactivatedCustomer').firestore();
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
  // Order writes stay staff-only, and the customer product branch admits
  // decrements only — so neither half of a cancellation is reachable.
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
console.log('\nOrder creation (checkout)');
// ---------------------------------------------------------------------------

// The exact shape Checkoutscreen.js writes. Any test that varies from this
// is varying from what the real app does.
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

await test('ORDER-1  a real checkout write succeeds, inside a transaction', async () => {
  // Run through runTransaction, not setDoc, because that is how
  // Checkoutscreen actually writes — and because the createdAt rule
  // (serverTimestamp() must equal request.time) is the one clause whose
  // behaviour could plausibly differ between a plain write and a
  // transactional commit. Asserting it here means a rule that only works
  // outside transactions cannot pass this suite while breaking checkout.
  const db = asCustomer();
  await assertSucceeds(
    runTransaction(db, async (tx) => {
      tx.set(doc(db, 'users/customer1/orders/newOrder'), checkoutOrder());
    })
  );
});

await test('ORDER-2  an order CANNOT be created already delivered', async () => {
  // The headline case for reviews. 'delivered' is what /reviews accepts as
  // proof of purchase, so a client able to mint one here could review any
  // product it named without ever buying anything.
  const db = asCustomer();
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/faked'), checkoutOrder({ status: 'delivered' }))
  );
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/faked2'), checkoutOrder({ status: 'shipped' }))
  );
});

await test('ORDER-3  an order cannot be attributed to another customer', async () => {
  await assertFails(
    setDoc(doc(asCustomer(), 'users/customer1/orders/o9'), checkoutOrder({ customerId: 'customer2' }))
  );
  // ...nor written into someone else's subcollection.
  await assertFails(
    setDoc(doc(asCustomer(), 'users/customer2/orders/o9'), checkoutOrder({ customerId: 'customer2' }))
  );
});

await test('ORDER-4  malformed orders are rejected', async () => {
  const db = asCustomer();
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/o10'), checkoutOrder({ note: 'extra field' }))
  );
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/o11'), checkoutOrder({ total: -5 }))
  );
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/o12'), checkoutOrder({ productIds: 'p1' }))
  );
  await assertFails(
    setDoc(doc(db, 'users/customer1/orders/o13'), checkoutOrder({ createdAt: new Date('2020-01-01') }))
  );
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

// ---------------------------------------------------------------------------
await testEnv.cleanup();

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) {
  for (const { name, error } of failures) {
    console.log(`FAILED: ${name}\n${error.message}\n`);
  }
  process.exit(1);
}
