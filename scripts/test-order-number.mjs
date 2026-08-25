/**
 * Tests the order number helpers.
 *
 *     npm run test:order-number
 *
 * No emulator, no credentials — these are pure string functions.
 *
 * WHY THEY GET A SUITE AT ALL, for three small functions: the order number
 * is the one string that crosses every boundary in the product. A customer
 * reads it off the confirmation screen or a receipt email, quotes it to
 * support, and a Store Manager types it into a search box. Four files
 * produce or consume it and one of them lives in a separate package that
 * cannot import the others.
 *
 * The failure mode is silence. Nothing errors, nothing looks broken — the
 * search simply returns no rows, and the story ends with a customer certain
 * their order exists and a manager certain it does not. That already
 * happened once: the search matched the stored bare form against a raw
 * query, while every screen showed the customer the "#" form on a line
 * made selectable specifically so they would copy it.
 */
import {
  orderNumber,
  formatOrderNumber,
  normalizeOrderNumberQuery,
  ORDER_NUMBER_LENGTH,
} from '../utils/orderNumber.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// The real id from the first order placed through the app, and the number
// the customer was shown for it.
const REAL_ID = 'NoMdQMgoiU558ohk8SiF';

console.log(`\nOrder number (${ORDER_NUMBER_LENGTH} characters)`);

test('the bare form is upper-cased and truncated', () => {
  assertEqual(orderNumber(REAL_ID), 'NOMDQMGO', 'orderNumber');
  assertEqual(orderNumber('abcdefgh12345'), 'ABCDEFGH', 'lower-case id');
  assertEqual(orderNumber('short'), 'SHORT', 'an id shorter than the window');
});

test('the display form adds the hash', () => {
  assertEqual(formatOrderNumber(REAL_ID), '#NOMDQMGO', 'formatOrderNumber');
});

test('a missing id gives an em dash for display and nothing for matching', () => {
  // Different placeholders on purpose: the display form is read by a
  // person, the bare form is compared against, and a dash is a value that
  // could match a search.
  for (const empty of [null, undefined, '']) {
    assertEqual(formatOrderNumber(empty), '—', `formatOrderNumber(${JSON.stringify(empty)})`);
    assertEqual(orderNumber(empty), '', `orderNumber(${JSON.stringify(empty)})`);
  }
});

console.log('\nSearch queries — what a human actually pastes');

test('the DISPLAYED form matches the STORED form', () => {
  // The regression. Every screen and the receipt email show "#NOMDQMGO",
  // on a line made selectable so it gets copied verbatim — so this is the
  // single most likely thing to arrive in the search box, and it was the
  // one string that could not match.
  const stored = orderNumber(REAL_ID);
  const pasted = formatOrderNumber(REAL_ID);
  assertEqual(normalizeOrderNumberQuery(pasted), stored, 'a pasted display form');
});

test('surrounding whitespace and repeated hashes are tolerated', () => {
  // A copy-paste routinely brings a trailing space, and a hand-typed
  // number sometimes brings a second hash.
  assertEqual(normalizeOrderNumberQuery('  #NOMDQMGO  '), 'NOMDQMGO', 'padded');
  assertEqual(normalizeOrderNumberQuery('##NOMDQMGO'), 'NOMDQMGO', 'doubled hash');
  assertEqual(normalizeOrderNumberQuery('nomdqmgo'), 'NOMDQMGO', 'lower-case');
});

test('a partial number still matches, since the search is a substring', () => {
  assertEqual(normalizeOrderNumberQuery('#NOMD'), 'NOMD', 'a prefix');
  assertEqual(orderNumber(REAL_ID).includes(normalizeOrderNumberQuery('#NOMD')), true, 'substring');
});

test('an empty query normalises to empty, not to a match-anything token', () => {
  // AdminOrdersScreen guards on length so an empty box still shows every
  // order. This pins the input side of that: nothing is invented from
  // nothing.
  for (const empty of [null, undefined, '', '   ', '#', '  ##  ']) {
    assertEqual(normalizeOrderNumberQuery(empty), '', `normalize(${JSON.stringify(empty)})`);
  }
});

test('a hash inside the string is left alone', () => {
  // Only a LEADING hash is a formatting convention. One in the middle is
  // not, and silently deleting characters from a query would be a
  // different kind of wrong.
  assertEqual(normalizeOrderNumberQuery('NOM#DQMGO'), 'NOM#DQMGO', 'interior hash');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name } of failures) console.error(`FAILED: ${name}`);
  process.exit(1);
}
