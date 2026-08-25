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
  ...overrides,
});

const supportRequest = (overrides = {}) => ({
  userId: 'customer1',
  userEmail: 'cathy@example.com',
  message: 'Can I swap a jacket for the next size up?',
  status: 'open',
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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name } of failures) console.error(`FAILED: ${name}`);
  process.exit(1);
}
