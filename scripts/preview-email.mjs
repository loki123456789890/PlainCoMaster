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

const files = [
  ['order-cod.html', emails._renderOrderHtml(codOrder, 'aBcDeF1234567890')],
  ['order-cod.txt', emails._renderOrderText(codOrder, 'aBcDeF1234567890')],
  ['order-prepaid.html', emails._renderOrderHtml(paidOrder, 'zZyYxX9876543210')],
  ['order-prepaid.txt', emails._renderOrderText(paidOrder, 'zZyYxX9876543210')],
  ['support.html', emails._renderSupportHtml(supportRequest, 'req0001abcdef')],
  ['support.txt', emails._renderSupportText(supportRequest, 'req0001abcdef')],
  ['support-no-email.html', emails._renderSupportHtml(supportNoEmail, 'req0002abcdef')],
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
