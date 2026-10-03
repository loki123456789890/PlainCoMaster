/**
 * Tests the Shop's and a store's product search.
 *
 *     npm run test:search
 *
 * No emulator, no credentials — these are pure functions.
 *
 * The failure mode is the same silence as the order number's: a search
 * that finds nothing looks exactly like a store that has nothing. These
 * pin down what a shopper's words should and shouldn't find, including the
 * near-misses ("red" in "embroidered", "jeans" widening to every skirt)
 * that a looser matcher would let through.
 */
import { parseSearchQuery, matchesSearch } from '../constants/productOptions.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name });
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const finds = (query, product) => matchesSearch(product, parseSearchQuery(query));

function assertFinds(query, product) {
  if (!finds(query, product)) throw new Error(`"${query}" should find "${product.name}"`);
}

function assertMisses(query, product) {
  if (finds(query, product)) throw new Error(`"${query}" should not find "${product.name}"`);
}

const blackTee = { name: 'Black Oversized Tee', type: 'ukay-ukay', category: 'tops', colors: ['Black'] };
const looseShirt = { name: 'Loose-fit shirt', type: 'ready-to-wear', category: 'tops', colors: ['Black', 'White'] };
const graphicShirt = { name: 'Oversized graphic shirt', type: 'ukay-ukay', category: 'tops', colors: ['White'] };
const graphicShirtBlack = { ...graphicShirt, colors: ['Black'] };
const embroidered = { name: 'Embroidered blouse', type: 'ukay-ukay', category: 'tops', colors: ['White'] };
const skirt = { name: 'Pleated skirt', type: 'ukay-ukay', category: 'bottoms', colors: ['Navy'] };
const jeans = { name: 'Straight denim', brand: "Levi's", type: 'ukay-ukay', category: 'bottoms', colors: ['Blue'] };
const tShirt = { name: 'Plain T-Shirt', type: 'ready-to-wear', category: 'tops', section: 'women', colors: ['Grey'] };
const legacy = { name: 'Vintage jacket' };

test('an empty query finds everything', () => {
  assertFinds('', legacy);
  assertFinds('   ', blackTee);
});

test('words match in any order, across fields', () => {
  assertFinds('black oversized shirt', blackTee);
  assertFinds('shirt oversized black', blackTee);
  assertFinds('black oversized shirt', looseShirt);
  assertFinds('black oversized shirt', graphicShirtBlack);
});

test('every word has to match', () => {
  // A white shirt is not what someone typing "black" wants.
  assertMisses('black oversized shirt', graphicShirt);
  assertMisses('black jacket', legacy);
});

test('a color matches from the product colors, not just the name', () => {
  assertFinds('black', blackTee);
  assertFinds('blue', jeans);
  assertMisses('black', graphicShirt);
});

test('a word matches the start of a word, not the middle', () => {
  assertFinds('over', blackTee);
  assertFinds('emb', embroidered);
  assertMisses('red', embroidered);
  assertMisses('men', tShirt); // a women's piece
});

test('synonyms are the same garment, never a wider net', () => {
  assertFinds('jeans', jeans);
  assertFinds('tee', looseShirt);
  assertFinds('gray', tShirt);
  assertMisses('jeans', skirt);
});

test('hyphens and spaces are the same', () => {
  assertFinds('t-shirt', tShirt);
  assertFinds('tshirt', tShirt);
  assertFinds('loose fit', looseShirt);
  assertFinds('loosefit', looseShirt);
  assertFinds('loose-fit', looseShirt);
});

test('plurals, case and apostrophes', () => {
  assertFinds('SHIRTS', looseShirt);
  assertFinds('skirts', skirt);
  assertFinds('levis', jeans);
  assertFinds("women's", tShirt);
  assertFinds('womens tee', tShirt);
});

test('type, category and its words still match', () => {
  assertFinds('thrift', blackTee);
  assertFinds('preloved', blackTee);
  assertFinds('rtw', looseShirt);
  assertFinds('bottoms', skirt);
  assertMisses('ukay', looseShirt);
});

test('an old product with only a name is still searchable', () => {
  assertFinds('vintage', legacy);
  assertFinds('jacket', legacy);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name } of failures) console.error(`FAILED: ${name}`);
  process.exit(1);
}
