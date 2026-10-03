/**
 * Renders every transactional email to disk so it can be opened in a
 * browser and looked at, without deploying anything, sending anything, or
 * needing SMTP credentials.
 *
 *     npm run preview:email
 *
 * Writes into .email-preview/ (gitignored). Open the .html files; the
 * matching .txt files are the plain-text alternative, which is what some
 * clients show by choice and what every client falls back to when the HTML
 * fails to render.
 *
 * WHY THIS EXISTS rather than a test: email templates fail visually, not
 * logically. An assertion can tell you the total appears somewhere in the
 * string; it cannot tell you the summary table collapsed, or that the
 * order number is the same colour as the background. The fixtures below
 * are chosen to cover the cases most likely to break the layout rather
 * than the happy path:
 *
 *   - a product name containing markup and an apostrophe, to prove the
 *     escaping in mailer.js holds
 *   - a line with no size or colour, whose variant row must disappear
 *     rather than render an empty separator
 *   - a four-figure total, which is where thousands separators show up
 *   - COD versus a prepaid method, which changes the wording of the
 *     total line and the closing paragraph
 *   - a support request with no email on the account, the null case
 *     firestore.rules explicitly permits
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// functions/ is a separate CommonJS package with its own node_modules, so
// it is reached through createRequire rather than an import. Run
// `npm install` inside functions/ first or this throws on nodemailer.
const require = createRequire(import.meta.url);
const emails = require('../functions/emails.js');

const OUT = '.email-preview';
mkdirSync(OUT, { recursive: true });

const address = {
  fullName: 'Cathy Customer',
  phone: '0917 123 4567',
  address: '12 Mango Avenue, Barangay Luz',
  city: 'Cebu City',
  province: 'Cebu',
  zipCode: '6000',
};

const codOrder = {
  customerId: 'customer1',
  customerEmail: 'cathy@example.com',
  items: [
    {
      productId: 'p1',
      name: "Levi's 501 <selvedge>",
      price: 1250,
      quantity: 2,
      size: 'M',
      color: 'Indigo',
    },
    // No size, no colour — the variant line must vanish entirely.
    { productId: 'p2', name: 'Wool Overcoat', price: 1899.5, quantity: 1, size: null, color: null },
  ],
  subtotal: 4399.5,
  shipping: 0,
  total: 4399.5,
  paymentMethod: 'cod',
  shippingAddress: address,
  status: 'pending',
};

// Same order, prepaid. The total line and the closing paragraph both
// change wording, which is the only difference worth eyeballing.
const paidOrder = { ...codOrder, paymentMethod: 'gcash' };

// Prepaid and actually charged, which is what a cancellation email checks
// before telling the customer a refund has to be arranged.
const paidAndCharged = { ...paidOrder, paymentStatus: 'paid', storeName: 'Tindahan ni Sam' };

const supportRequest = {
  userId: 'customer1',
  userEmail: 'cathy@example.com',
  message:
    'Hi! I ordered a denim jacket last week and the size runs a little small.\n\nCan I swap it for the next size up, or is that not something you do for ukay items?',
  status: 'open',
};

// userEmail is nullable in firestore.rules, so the manager has to be told
// there is nobody to reply to rather than being handed a blank From line.
const supportNoEmail = { ...supportRequest, userEmail: null };

// A reported problem, as requestReturn writes it. COD, so the refund goes
// to the customer's GCash — which the emails show by its last four digits
// only. The note carries markup to prove it is escaped like everything else.
const report = {
  customerId: 'customer1',
  customerEmail: 'cathy@example.com',
  storeId: 'store1',
  storeName: 'Tindahan ni Sam',
  reason: 'wrong_size',
  note: 'I ordered a Medium but the tag says <Large>.\nPhotos of the tag attached.',
  photoUrls: ['a', 'b'],
  items: [{ index: 0, productId: 'p1', name: "Levi's 501 <selvedge>", price: 1250, quantity: 1, size: 'M', color: 'Indigo' }],
  refundAmount: 1250,
  refundMethod: 'gcash',
  paymentMethod: 'cod',
  payout: { method: 'gcash', accountName: 'Cathy Customer', accountNumber: '0917 123 4567', bankName: null },
  status: 'requested',
};
const reportPaid = { ...report, refundMethod: 'original', paymentMethod: 'gcash', payout: null, resolution: 'return_first' };
const reportBank = {
  ...report,
  refundMethod: 'bank',
  payout: { method: 'bank', accountName: 'Cathy Customer', accountNumber: '001234567890', bankName: 'BPI' },
  resolution: 'refund_only',
  refundReference: 'BPI-20261005-7788',
};
const reportDeclined = { ...report, declineReason: 'The tag in your second photo says Medium, which is the size you ordered.' };

const files = [
  ['order-cod.html', emails._renderOrderHtml(codOrder, 'aBcDeF1234567890')],
  ['order-cod.txt', emails._renderOrderText(codOrder, 'aBcDeF1234567890')],
  ['order-prepaid.html', emails._renderOrderHtml(paidOrder, 'zZyYxX9876543210')],
  ['order-prepaid.txt', emails._renderOrderText(paidOrder, 'zZyYxX9876543210')],
  // Status updates. Shipped is shown both ways because COD adds the
  // "have the cash ready" line; cancelled both ways because a paid online
  // order gets the refund line instead of "nothing was charged".
  ['status-shipped-cod.html', emails._renderStatusHtml(codOrder, 'aBcDeF1234567890', 'shipped')],
  ['status-shipped-cod.txt', emails._renderStatusText(codOrder, 'aBcDeF1234567890', 'shipped')],
  ['status-shipped-prepaid.html', emails._renderStatusHtml(paidOrder, 'zZyYxX9876543210', 'shipped')],
  ['status-delivered.html', emails._renderStatusHtml(codOrder, 'aBcDeF1234567890', 'delivered')],
  ['status-delivered.txt', emails._renderStatusText(codOrder, 'aBcDeF1234567890', 'delivered')],
  ['status-cancelled-cod.html', emails._renderStatusHtml(codOrder, 'aBcDeF1234567890', 'cancelled')],
  ['status-cancelled-paid.html', emails._renderStatusHtml(paidAndCharged, 'zZyYxX9876543210', 'cancelled')],
  ['status-cancelled-paid.txt', emails._renderStatusText(paidAndCharged, 'zZyYxX9876543210', 'cancelled')],
  ['support.html', emails._renderSupportHtml(supportRequest, 'req0001abcdef')],
  ['support.txt', emails._renderSupportText(supportRequest, 'req0001abcdef')],
  ['support-no-email.html', emails._renderSupportHtml(supportNoEmail, 'req0002abcdef')],
  // Reported problems: the store's alert, then each customer step.
  ['return-alert.html', emails._renderReturnAlertHtml(report, 'aBcDeF1234567890')],
  ['return-alert.txt', emails._renderReturnAlertText(report, 'aBcDeF1234567890')],
  ['return-requested.html', emails._renderReturnUpdateHtml(report, 'aBcDeF1234567890', 'requested')],
  ['return-approved-refund-only.html', emails._renderReturnUpdateHtml(reportBank, 'aBcDeF1234567890', 'approved')],
  ['return-approved-return-first.html', emails._renderReturnUpdateHtml(reportPaid, 'zZyYxX9876543210', 'approved')],
  ['return-received.html', emails._renderReturnUpdateHtml(reportPaid, 'zZyYxX9876543210', 'received')],
  ['return-refunded.html', emails._renderReturnUpdateHtml(reportBank, 'aBcDeF1234567890', 'refunded')],
  ['return-refunded.txt', emails._renderReturnUpdateText(reportBank, 'aBcDeF1234567890', 'refunded')],
  ['return-declined.html', emails._renderReturnUpdateHtml(reportDeclined, 'aBcDeF1234567890', 'declined')],
  ['return-declined.txt', emails._renderReturnUpdateText(reportDeclined, 'aBcDeF1234567890', 'declined')],
];

for (const [name, contents] of files) {
  writeFileSync(join(OUT, name), contents);
  console.log(`  ${join(OUT, name)}`);
}

// A rendered template containing either of these means a field was read
// off a fixture that does not have it — the sort of thing that reaches a
// customer as "Total: ₱NaN" and is invisible in a diff.
const suspicious = files.filter(([, contents]) =>
  /undefined|NaN|\[object Object\]/.test(contents)
);
if (suspicious.length > 0) {
  console.error('\nPlaceholder leaked into:', suspicious.map(([name]) => name).join(', '));
  process.exit(1);
}

console.log(`\n${files.length} files written to ${OUT}/`);
