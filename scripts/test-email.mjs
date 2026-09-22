/**
 * Tests the transactional email triggers against the Firestore emulator.
 *
 *     npm run test:email
 *
 * WHY THIS EXISTS SEPARATELY from scripts/test-rules.mjs: that suite
 * exercises firestore.rules, and these functions run with Admin
 * credentials, which bypass rules entirely. Everything they do is
 * therefore invisible to it. What is asserted here is the logic AROUND the
 * send — which address is used, whether a duplicate trigger delivery sends
 * twice, what is recorded when the mail server refuses — none of which the
 * rules suite can reach and none of which the template preview covers.
 *
 * SMTP IS THE ONLY THING FAKED. Firestore is real (the emulator), so the
 * one-shot claim is exercised as an actual create/ALREADY_EXISTS race
 * rather than a simulated one — that guard is the whole reason a customer
 * does not receive two receipts, and a mock of it would prove nothing.
 * Reaching Gmail, by contrast, proves nothing about any of this and cannot
 * run unattended.
 */
import { createRequire } from 'node:module';

// Must be set BEFORE firebase-admin initialises, which happens as a side
// effect of requiring functions/index.js.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'plainco-email-test';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set — run this through `npm run test:email`.');
  process.exit(1);
}

const require = createRequire(import.meta.url);

// Secrets resolve from process.env (SecretParam.runtimeValue reads it
// directly), which is how the emulator supplies them too. Set to a
// plausible address so mailConfigured() passes; individual tests override
// it to exercise the unconfigured path.
process.env.GMAIL_USER = 'shop@plainco.test';
process.env.GMAIL_APP_PASSWORD = 'test-app-password';

const mailer = require('../functions/mailer.js');
const emails = require('../functions/emails.js');

// Rooted at functions/package.json rather than this file, so
// 'firebase-admin/firestore' resolves through functions/node_modules AND
// through firebase-admin's subpath exports map. Pointing a plain require
// at the directory path instead fails: the package exposes that entry only
// as an export, not as a real file at that location.
const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { getFirestore } = requireFromFunctions('firebase-admin/firestore');

// functions/index.js calls initializeApp() as a side effect; emails.js
// does not, so it is required here for the Admin app to exist.
require('../functions/index.js');
const db = getFirestore();

let passed = 0;
const failures = [];

// Records what would have been sent instead of sending it. `failWith` makes
// the next send throw, which is how the failure path is reached without an
// unreachable mail server.
function fakeTransport() {
  const sent = [];
  let failWith = null;
  return {
    sent,
    failNext(message) { failWith = message; },
    sendMail: async (message) => {
      if (failWith) {
        const error = new Error(failWith);
        failWith = null;
        throw error;
      }
      sent.push(message);
      return { messageId: 'test' };
    },
  };
}

async function clearMailLog() {
  const snapshot = await db.collection('mailLog').get();
  await Promise.all(snapshot.docs.map((d) => d.ref.delete()));
}

async function test(name, fn) {
  await clearMailLog();
  process.env.GMAIL_USER = 'shop@plainco.test';
  const transport = fakeTransport();
  mailer.__setTransportForTests(transport);
  try {
    await fn(transport);
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message.split('\n')[0]}`);
  } finally {
    mailer.__setTransportForTests(null);
  }
}

function assert(condition, what) {
  if (!condition) throw new Error(what);
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

const entry = (key) => db.collection('mailLog').doc(key).get().then((s) => (s.exists ? s.data() : null));

const order = (overrides = {}) => ({
  customerId: 'customer1',
  customerEmail: 'cathy@example.com',
  items: [{ productId: 'p1', name: 'Denim Jacket', price: 850, quantity: 1, size: 'M', color: 'Blue' }],
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
  // One store's order, so its mail is that store's manager's to resend.
  storeId: 'store1',
  storeName: 'Tindahan ni Sam',
  ...overrides,
});

const supportRequest = (overrides = {}) => ({
  userId: 'customer1',
  userEmail: 'cathy@example.com',
  message: 'Can I swap a jacket for the next size up?',
  status: 'open',
  // About an order, so routed to that order's store.
  orderId: 'o1',
  storeId: 'store1',
  ...overrides,
});

console.log('\nOrder confirmation');

await test('ORDER-MAIL-1  a receipt is sent and recorded', async (transport) => {
  await emails._handleOrderCreated(order(), 'aBcDeF1234567890');

  assertEqual(transport.sent.length, 1, 'messages sent');
  assertEqual(transport.sent[0].to, 'cathy@example.com', 'recipient');
  assert(transport.sent[0].subject.includes('#ABCDEF12'), 'subject carries the order number');
  // Both bodies, because some clients show the text one by choice and every
  // client falls back to it when the HTML fails.
  assert(transport.sent[0].html.length > 0, 'html body present');
  assert(transport.sent[0].text.length > 0, 'text body present');

  const logged = await entry('order-aBcDeF1234567890');
  assertEqual(logged.status, 'sent', 'logged status');
  assertEqual(logged.kind, 'orderConfirmation', 'logged kind');
  assert(logged.recordedAt, 'recordedAt must be written');
});

await test('ORDER-MAIL-2  a duplicate trigger delivery sends once', async (transport) => {
  // Firestore triggers are at-least-once: the same write can invoke a
  // function more than once. A customer who receives two identical
  // receipts reasonably wonders whether they were charged twice, so this
  // is the guard that matters most in the whole file. Exercised against
  // the real emulator, so it is a genuine create/ALREADY_EXISTS race.
  await emails._handleOrderCreated(order(), 'dupe1');
  await emails._handleOrderCreated(order(), 'dupe1');

  assertEqual(transport.sent.length, 1, 'messages sent for two deliveries');
});

await test('ORDER-MAIL-3  an order with no usable address sends nothing', async (transport) => {
  // placeOrder writes the literal 'unknown' when it can find no address on
  // the auth token or the user document. Handing that to Gmail would earn
  // a bounce; it is filtered before the send.
  await emails._handleOrderCreated(order({ customerEmail: 'unknown' }), 'noaddr1');
  await emails._handleOrderCreated(order({ customerEmail: null }), 'noaddr2');

  assertEqual(transport.sent.length, 0, 'messages sent');
  assertEqual(await entry('order-noaddr1'), null, 'nothing claimed for an unusable address');
});

await test('ORDER-MAIL-4  a refused send is recorded, not thrown', async (transport) => {
  // A failed email must not fail the trigger. With retry disabled there is
  // nothing useful a thrown error would achieve, and an unhandled
  // rejection in a background function is noise rather than signal — so
  // the outcome goes to mailLog and the handler returns normally.
  transport.failNext('Invalid login: 535-5.7.8 Username and Password not accepted');

  await emails._handleOrderCreated(order(), 'failed1');

  const logged = await entry('order-failed1');
  assertEqual(logged.status, 'failed', 'logged status');
  assert(logged.detail.includes('535-5.7.8'), 'the provider\'s own words are kept');
  assert(logged.recordedAt, 'recordedAt must be written on the failure path too');
});

console.log('\nSupport notification');

await test('SUPPORT-MAIL-1  the store is emailed, with Reply-To set to the customer', async (transport) => {
  await emails._handleSupportCreated(supportRequest(), 'req1');

  assertEqual(transport.sent.length, 1, 'messages sent');
  assertEqual(transport.sent[0].to, 'shop@plainco.test', 'goes to the store inbox');
  // The difference between answering in one tap and copying an address out
  // of the body.
  assertEqual(transport.sent[0].replyTo, 'cathy@example.com', 'Reply-To');
  assert(transport.sent[0].html.includes('swap a jacket'), 'the message is included');
});

await test('SUPPORT-MAIL-2  a request with no email still notifies, without Reply-To', async (transport) => {
  // userEmail is explicitly nullable in firestore.rules. There is nobody to
  // reply to, but the store must still be told a request arrived — Help
  // promises an answer within 24 hours either way.
  await emails._handleSupportCreated(supportRequest({ userEmail: null }), 'req2');

  assertEqual(transport.sent.length, 1, 'the store is still notified');
  assertEqual(transport.sent[0].replyTo, undefined, 'no Reply-To to set');
  assert(
    transport.sent[0].text.includes('No email on the account'),
    'the manager is told there is nobody to reply to'
  );
});

console.log('\nUnconfigured mailbox');

await test('MAILER-1  nothing is sent when credentials are placeholders', async (transport) => {
  process.env.GMAIL_USER = mailer.UNCONFIGURED;

  await emails._handleOrderCreated(order(), 'unconf1');

  assertEqual(transport.sent.length, 0, 'messages sent');
  const logged = await entry('order-unconf1');
  assertEqual(logged.status, 'unconfigured', 'logged status');
  // Recorded with recipient and subject, so the backlog missed while
  // unconfigured is legible rather than a bare status.
  assertEqual(logged.to, 'cathy@example.com', 'recipient recorded');
  assert(logged.recordedAt, 'recordedAt must be written');
});

await test('MAILER-2  an unconfigured attempt does NOT consume the one-shot claim', async (transport) => {
  // The reason the unconfigured path skips claimOnce(). If it claimed,
  // every message missed while credentials were absent would look already
  // handled the moment they arrived — permanently unsendable by anything
  // reading mailLog. This is the test that pins that decision.
  process.env.GMAIL_USER = mailer.UNCONFIGURED;
  await emails._handleOrderCreated(order(), 'later1');
  assertEqual(transport.sent.length, 0, 'nothing sent while unconfigured');

  process.env.GMAIL_USER = 'shop@plainco.test';
  await emails._handleOrderCreated(order(), 'later1');

  assertEqual(transport.sent.length, 1, 'the same message sends once credentials arrive');
  assertEqual((await entry('order-later1')).status, 'sent', 'and is recorded as sent');
});

console.log('\nResending (retryMail)');

// The retry callable reads the SOURCE document rather than replaying a
// stored body, so these tests need the order and support request to
// actually exist — the whole point of the design is that a log entry
// alone is not enough to send anything.
async function seedActors() {
  await db.doc('users/seller1').set({ role: 'seller', isActive: true, email: 'manager@plainco.test', storeId: 'store1' });
  await db.doc('users/seller2').set({ role: 'seller', isActive: true, email: 'other@plainco.test', storeId: 'store2' });
  await db.doc('users/admin1').set({ role: 'platformAdmin', isActive: true, email: 'admin@plainco.test' });
  await db.doc('users/customer1').set({ role: 'customer', isActive: true, email: 'cathy@example.com' });
  await db.doc('users/gone').set({ role: 'seller', isActive: false, email: 'former@plainco.test' });
}
await seedActors();

const asSeller = (key, extra = {}) => ({ auth: { uid: 'seller1' }, data: { key, ...extra } });

async function expectReject(fn, code, what) {
  try {
    await fn();
  } catch (error) {
    assertEqual(error.code, code, `${what} (message: ${error.message})`);
    return error;
  }
  throw new Error(`${what}: expected a rejection, got none`);
}

// Produces a genuinely failed entry the way production would — by letting
// the real handler run against a transport that refuses — rather than by
// hand-writing a mailLog document into the shape the test wants.
async function seedFailedReceipt(transport, orderId, overrides = {}) {
  const data = order(overrides);
  await db.doc(`users/customer1/orders/${orderId}`).set(data);
  transport.failNext('550 mailbox unavailable');
  await emails._handleOrderCreated(data, orderId);
  assertEqual((await entry(`order-${orderId}`)).status, 'failed', 'setup: the receipt failed');
  return data;
}

await test('RETRY-1  a failed receipt sends on a second attempt', async (transport) => {
  await seedFailedReceipt(transport, 'r1');

  const result = await emails._handleRetryMail(asSeller('order-r1'));

  assertEqual(result.status, 'sent', 'the callable reports the real outcome');
  assertEqual(transport.sent.length, 1, 'exactly one message went out');
  assertEqual(transport.sent[0].to, 'cathy@example.com', 'to the customer on the order');
  assertEqual((await entry('order-r1')).status, 'sent', 'and the log agrees');
});

await test('RETRY-2  a message that already sent is never sent twice', async (transport) => {
  // The spam guard as it applies to the recipient. 'sent' is absent from
  // RETRYABLE_STATUSES for exactly this, and it is the assertion that
  // stops a manager turning a receipt into a mailing by tapping a button
  // repeatedly.
  const data = order();
  await db.doc('users/customer1/orders/r2').set(data);
  await emails._handleOrderCreated(data, 'r2');
  assertEqual(transport.sent.length, 1, 'setup: it sent once');

  await expectReject(
    () => emails._handleRetryMail(asSeller('order-r2')),
    'failed-precondition',
    'a sent message is refused'
  );

  assertEqual(transport.sent.length, 1, 'still exactly one message');
});

await test('RETRY-3  only an active Store Manager may resend', async (transport) => {
  await seedFailedReceipt(transport, 'r3');

  await expectReject(
    () => emails._handleRetryMail({ auth: null, data: { key: 'order-r3' } }),
    'unauthenticated',
    'signed out'
  );
  await expectReject(
    () => emails._handleRetryMail({ auth: { uid: 'customer1' }, data: { key: 'order-r3' } }),
    'permission-denied',
    'a customer'
  );
  // The rules already deny a deactivated seller, but this function runs
  // with Admin credentials and bypasses them, so the check has to exist
  // here independently.
  await expectReject(
    () => emails._handleRetryMail({ auth: { uid: 'gone' }, data: { key: 'order-r3' } }),
    'permission-denied',
    'a deactivated Store Manager'
  );

  assertEqual(transport.sent.length, 0, 'none of them sent anything');
});

await test('RETRY-4  the caller cannot choose the recipient', async (transport) => {
  // THE test for this design. The callable takes a log entry id and
  // re-derives everything else, so extra fields in the payload are inert.
  // If this ever fails, the function has become an open relay sending
  // from the store's authenticated Gmail account.
  await seedFailedReceipt(transport, 'r4');

  const result = await emails._handleRetryMail(
    asSeller('order-r4', {
      to: 'attacker@example.com',
      subject: 'Your account is suspended',
      html: '<p>Click here</p>',
      text: 'Click here',
      replyTo: 'attacker@example.com',
    })
  );

  assertEqual(result.status, 'sent', 'it still sends');
  assertEqual(transport.sent.length, 1, 'once');
  assertEqual(transport.sent[0].to, 'cathy@example.com', 'to the order, not the payload');
  assert(
    transport.sent[0].subject.startsWith('Your PlainCo order'),
    'with the real subject, not the payload'
  );
  assert(
    !transport.sent[0].html.includes('Click here'),
    'and the real body, not the payload'
  );
});

await test('RETRY-5  attempts are capped', async (transport) => {
  const data = await seedFailedReceipt(transport, 'r5');

  // Three releases, each of which fails again.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    transport.failNext('550 mailbox unavailable');
    const result = await emails._handleRetryMail(asSeller('order-r5'));
    assertEqual(result.status, 'failed', `attempt ${attempt} failed`);
    assertEqual(result.attempt, attempt, `attempt ${attempt} is counted`);
  }

  await expectReject(
    () => emails._handleRetryMail(asSeller('order-r5')),
    'resource-exhausted',
    'the fourth is refused'
  );
  assertEqual(transport.sent.length, 0, 'nothing ever reached the transport');
  assert(data.customerEmail === 'cathy@example.com', 'the order was untouched');
});

await test('RETRY-6  an unsendable entry does not burn an attempt', async (transport) => {
  // A deleted order can never be rebuilt, so refusing it must not walk it
  // toward the cap — otherwise the entry ends up 'exhausted', which reads
  // as "we tried three times" when nothing was ever attempted.
  await seedFailedReceipt(transport, 'r6');
  await db.doc('users/customer1/orders/r6').delete();

  for (let i = 0; i < 4; i += 1) {
    await expectReject(
      () => emails._handleRetryMail(asSeller('order-r6')),
      'failed-precondition',
      `refusal ${i + 1} names the missing order`
    );
  }

  const after = await entry('order-r6');
  assertEqual(after.status, 'failed', 'the entry is untouched');
  assertEqual(after.retryCount ?? 0, 0, 'and no attempt was counted');
});

await test('RETRY-7  the stuck unconfigured receipt is what this fixes', async (transport) => {
  // The case that motivated the whole feature: a receipt logged while the
  // Gmail placeholders were in place, which nothing could re-send, leaving
  // the dashboard alarm permanently lit.
  process.env.GMAIL_USER = mailer.UNCONFIGURED;
  const data = order();
  await db.doc('users/customer1/orders/r7').set(data);
  await emails._handleOrderCreated(data, 'r7');
  assertEqual((await entry('order-r7')).status, 'unconfigured', 'setup: nothing was sent');

  process.env.GMAIL_USER = 'shop@plainco.test';
  const result = await emails._handleRetryMail(asSeller('order-r7'));

  assertEqual(result.status, 'sent', 'it goes out once credentials exist');
  assertEqual(transport.sent.length, 1, 'exactly once');
});

await test('RETRY-8  a support alert resends to the store, not the customer', async (transport) => {
  const request = supportRequest();
  await db.doc('supportRequests/r8').set(request);
  transport.failNext('Connection timed out');
  await emails._handleSupportCreated(request, 'r8');
  assertEqual((await entry('support-r8')).status, 'failed', 'setup: it failed');

  const result = await emails._handleRetryMail(asSeller('support-r8'));

  assertEqual(result.status, 'sent', 'the retry sent it');
  assertEqual(transport.sent[0].to, 'shop@plainco.test', 'to the store inbox');
  assertEqual(transport.sent[0].replyTo, 'cathy@example.com', 'replying to the customer');
});

await test('RETRY-12  only whoever handles the entry may resend it', async (transport) => {
  // store1's receipt: not store2's manager, not the Platform Admin.
  await seedFailedReceipt(transport, 'r12');
  await expectReject(
    () => emails._handleRetryMail({ auth: { uid: 'seller2' }, data: { key: 'order-r12' } }),
    'permission-denied',
    'another store\'s manager is refused'
  );
  await expectReject(
    () => emails._handleRetryMail({ auth: { uid: 'admin1' }, data: { key: 'order-r12' } }),
    'permission-denied',
    'the Platform Admin is refused a store\'s receipt'
  );
  assertEqual((await entry('order-r12')).status, 'failed', 'neither refusal touched the entry');

  // A general question's notification is the Platform Admin's, and no store's.
  const general = supportRequest({ orderId: undefined, storeId: null });
  delete general.orderId;
  await db.doc('supportRequests/r12').set(general);
  transport.failNext('Connection timed out');
  await emails._handleSupportCreated(general, 'r12');
  assertEqual((await entry('support-r12')).storeId, null, 'the entry is routed to no store');
  await expectReject(
    () => emails._handleRetryMail(asSeller('support-r12')),
    'permission-denied',
    'a store manager is refused a general question'
  );
  const result = await emails._handleRetryMail({ auth: { uid: 'admin1' }, data: { key: 'support-r12' } });
  assertEqual(result.status, 'sent', 'the Platform Admin can resend it');
});

await test('RETRY-9  a key cannot escape mailLog', async () => {
  // key goes to doc(), so a slash would let a caller address any
  // collection in the database.
  for (const key of ['users/seller1', '../users/seller1', 'mailLog/order-x/sub/doc']) {
    await expectReject(
      () => emails._handleRetryMail(asSeller(key)),
      'invalid-argument',
      `${key} is refused`
    );
  }
  await expectReject(
    () => emails._handleRetryMail(asSeller('   ')),
    'invalid-argument',
    'an empty key is refused'
  );
  await expectReject(
    () => emails._handleRetryMail(asSeller('order-nonexistent')),
    'not-found',
    'an unknown entry is refused'
  );
});

console.log('\nCross-package consistency');

await test('DRIFT-1  the mailer formats order numbers identically to the app', async () => {
  // functions/mailer.js keeps its own copy of formatOrderNumber because
  // functions/ is a separate CommonJS package and utils/orderNumber.js is
  // an ESM module in the app package — there is no import that crosses
  // that boundary. A comment there says the two must not drift. This makes
  // that enforceable instead of aspirational.
  //
  // It matters because the two copies meet in one place: a customer reads
  // the number off an EMAIL rendered by the mailer, then quotes it to
  // support, who types it into AdminOrdersScreen's search box, which
  // filters on the app's copy. A one-character divergence looks broken
  // nowhere and simply stops matching.
  const app = await import('../utils/orderNumber.js');

  const ids = [
    'aBcDeF1234567890',
    'ZZZZZZZZZZZZZZZZZZZZ',
    'short',
    '12345678',
    // The falsy cases, where the two could plausibly disagree on the
    // placeholder rather than on the slice.
    '',
    null,
    undefined,
  ];

  for (const id of ids) {
    assertEqual(
      mailer.formatOrderNumber(id),
      app.formatOrderNumber(id),
      `formatOrderNumber(${JSON.stringify(id)})`
    );
  }
});

await test('DRIFT-2  the client and the mailer agree on what can be resent', async () => {
  // constants/mail.js decides which rows get a "Send again" button and
  // which the dashboard counts; functions/mailer.js decides what the
  // server will actually accept. Same package boundary as DRIFT-1, same
  // inability to import across it, same need to make the comment saying
  // "keep these in step" into something that fails.
  //
  // This is not hypothetical. Adding 'retrying' updated one list and not
  // the other, and the result was a dashboard card reading "1 email
  // didn't send" that opened a screen reading "Everything sent".
  const client = await import('../constants/mail.js');

  assertEqual(
    client.MAIL_RESENDABLE_STATUSES.join(','),
    mailer.RETRYABLE_STATUSES.join(','),
    'resendable statuses'
  );
  assertEqual(
    client.MAIL_MAX_RETRY_ATTEMPTS,
    mailer.MAX_RETRY_ATTEMPTS,
    'retry cap'
  );

  // THE INVARIANT THAT MATTERS MOST, and the one neither list states on
  // its own: every status offering a "Send again" button must also count
  // as a problem. Otherwise the button lives on a row the dashboard's
  // filter hides — an action that exists only on a screen you cannot
  // reach from the alarm that should send you there.
  for (const status of client.MAIL_RESENDABLE_STATUSES) {
    assert(
      client.MAIL_PROBLEM_STATUSES.includes(status),
      `${status} is resendable but would not show as a problem`
    );
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name } of failures) console.error(`FAILED: ${name}`);
  process.exit(1);
}
