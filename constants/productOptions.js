// constants/productOptions.js
export const COLOR_PALETTE = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Black', hex: '#000000' },
  { name: 'Gray', hex: '#808080' },
  { name: 'Beige', hex: '#E8DCC4' },
  { name: 'Brown', hex: '#6B4E31' },
  { name: 'Blue', hex: '#2563EB' },
  { name: 'Navy', hex: '#1E3A5F' },
  { name: 'Red', hex: '#DC2626' },
  { name: 'Green', hex: '#16A34A' },
  { name: 'Yellow', hex: '#EAB308' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Purple', hex: '#7C3AED' },
];

export const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL'];

// Who a piece is for. Required on every new product, of either type, so the
// Shop's Section filter has something to work with; products listed before
// it existed have none and appear under "All" only. The keys are also
// listed in firestore.rules (productFieldsAreWellTyped); keep the two in
// step.
//
// `label` is the picker and filter wording; `tag` is the product page's.
export const SECTION_OPTIONS = [
  { key: 'women', label: 'Women', tag: "Women's" },
  { key: 'men', label: 'Men', tag: "Men's" },
  { key: 'unisex', label: 'Unisex', tag: 'Unisex' },
  { key: 'kids', label: 'Kids', tag: "Kids'" },
];

export const sectionOption = (key) => SECTION_OPTIONS.find((option) => option.key === key) || null;

// The Shop's filter. Unisex isn't a filter of its own: a unisex piece is
// one a woman or a man could buy, so it appears under both.
export const SECTION_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'women', label: 'Women' },
  { key: 'men', label: 'Men' },
  { key: 'kids', label: 'Kids' },
];

export const matchesSection = (product, filterKey) => {
  if (filterKey === 'all') return true;
  if (product.section === filterKey) return true;
  return product.section === 'unisex' && (filterKey === 'women' || filterKey === 'men');
};

// What kind of item it is. Required on every new product, like Section, so
// a store's page can have a tab for each kind it sells; products listed
// before it existed have none and appear under "All" only. The keys are
// also listed in firestore.rules (productFieldsAreWellTyped); keep the two
// in step.
//
// `label` is the picker, tab and product page wording; `hint` says what
// goes where, for the manager picking one. `measurementType` is how it's
// measured (MEASUREMENT_TYPES below): the category decides which
// measurements Add and Edit Product ask for, and that type is saved with
// them, as before, for the size guide and older builds to read.
export const CATEGORY_OPTIONS = [
  { key: 'tops', label: 'Tops', hint: 'Shirts, blouses, polos, sweaters', measurementType: 'tops' },
  { key: 'outerwear', label: 'Outerwear', hint: 'Jackets, coats, hoodies, blazers', measurementType: 'tops' },
  { key: 'bottoms', label: 'Bottoms', hint: 'Pants, jeans, shorts, skirts', measurementType: 'bottoms' },
  { key: 'dresses', label: 'Dresses', hint: 'Dresses, jumpsuits, rompers', measurementType: 'onepiece' },
  { key: 'footwear', label: 'Footwear', hint: 'Shoes, sandals, boots', measurementType: 'footwear' },
  { key: 'bags', label: 'Bags', hint: 'Bags, backpacks, wallets', measurementType: 'bags' },
  { key: 'accessories', label: 'Accessories', hint: 'Hats, belts, scarves, jewelry', measurementType: 'accessories' },
];

export const categoryOption = (key) => CATEGORY_OPTIONS.find((option) => option.key === key) || null;

// The Shop's and a store's search. Sellers name the same piece different
// ways ("Black Oversized Tee", "Loose-fit shirt, black"), so a query is
// matched word by word rather than as one phrase: every word has to find
// a home somewhere in the product, in any order. A word matches the start
// of a word in the product, so "over" finds "oversized" as it's typed, but
// "red" doesn't find "embroidered".
//
// The product's words are its name, brand, colors, type, category and
// section. A category matches on its own name only, so "dress" or "tops"
// finds the pieces filed under it; "jeans" should find jeans, not every
// skirt filed as Bottoms.
//
// Synonyms are for the same garment named differently, never for a wider
// net. Keep each group to words a shopper would accept any of; written
// without spaces or hyphens, which a query and a product are both read
// without (so "t-shirt", "t shirt" and "tshirt" are one word).
const SEARCH_SYNONYMS = [
  ['shirt', 'tee', 'tshirt'],
  ['oversized', 'oversize', 'loose', 'loosefit', 'baggy', 'relaxed', 'relaxedfit'],
  ['pants', 'trousers', 'slacks'],
  ['jeans', 'denim'],
  ['hoodie', 'hoody', 'hooded'],
  ['sweater', 'pullover', 'jumper'],
  ['sneakers', 'trainers', 'rubbershoes'],
  ['slippers', 'tsinelas', 'flipflops'],
  ['sleeveless', 'sando', 'tank', 'tanktop'],
  ['longsleeve', 'longsleeves', 'longsleeved'],
  ['gray', 'grey'],
];

// Words a shopper might type for a type, beyond its stored name.
const TYPE_WORDS = {
  'ukay-ukay': 'ukay-ukay secondhand second-hand pre-loved thrift',
  'ready-to-wear': 'ready-to-wear rtw brand new',
};

// Lowercase words, with apostrophes dropped ("Men's" is "mens") and any
// other punctuation splitting words.
const searchWords = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// Every word, and every two neighbors joined, so a product's "T-Shirt" or
// "loose fit" meets a query's "tshirt" or "loose-fit".
const productSearchWords = (product) => {
  const words = searchWords(
    [
      product.name,
      product.brand,
      ...(Array.isArray(product.colors) ? product.colors : []),
      TYPE_WORDS[product.type],
      categoryOption(product.category)?.label,
      sectionOption(product.section)?.label,
      sectionOption(product.section)?.tag,
    ].join(' ')
  );
  return [...words, ...words.slice(1).map((word, i) => words[i] + word)];
};

// What a query word may match: itself, its synonyms, and without a
// plural "s" ("shirts" is "shirt").
const queryAlternatives = (word) => {
  const singular = word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : null;
  const group = SEARCH_SYNONYMS.find((g) => g.includes(word) || (singular && g.includes(singular)));
  return [word, ...(singular ? [singular] : []), ...(group || [])];
};

// The query split into words, each with what it may match. Built once per
// query, not once per product.
export const parseSearchQuery = (query) =>
  String(query || '')
    .split(/\s+/)
    .map((word) => searchWords(word).join(''))
    .filter(Boolean)
    .map(queryAlternatives);

// True for an empty query.
export const matchesSearch = (product, parsedQuery) => {
  if (parsedQuery.length === 0) return true;
  const words = productSearchWords(product);
  return parsedQuery.every((alternatives) =>
    alternatives.some((alt) => words.some((word) => word.startsWith(alt)))
  );
};

// How worn an ukay-ukay piece is. Ready-to-wear has no condition: the type
// already says it's brand-new. One fixed scale rather than free text, so
// "Gently used" means the same thing from every store, and a shopper can
// hold a review's "did it match the description?" against it. The keys
// are also listed in firestore.rules (productFieldsAreWellTyped); keep the
// two in step.
//
// `detail` is shown to shoppers on the product page and to the manager
// when picking one, so it's worded for both.
export const CONDITION_OPTIONS = [
  { key: 'new-with-tags', label: 'New with tags', detail: 'Never worn. The original tags are still on.' },
  { key: 'like-new', label: 'Like new', detail: 'Worn once or twice. No signs of wear.' },
  { key: 'gently-used', label: 'Gently used', detail: 'Light signs of wear, nothing that stands out.' },
  { key: 'well-loved', label: 'Well loved', detail: 'Visible wear or a small flaw, described and shown by the seller.' },
];

export const conditionOption = (key) => CONDITION_OPTIONS.find((option) => option.key === key) || null;

// "Well loved" is defined as having a flaw, so it can't be saved with a
// "no flaws found" answer.
export const CONDITION_NEEDS_FLAWS = 'well-loved';

export const BRAND_MAX = 40;
export const FLAWS_MAX = 300;

// Whether the seller checked an ukay piece for flaws, and what they found.
// Asked on every ukay listing with no default answer, so "no flaws" is
// something a seller said rather than something the form assumed. 'found'
// needs at least one FLAW_TYPES key, a note (`flaws`) and a photo.
export const FLAW_CHECK_OPTIONS = [
  { key: 'none', label: 'No flaws found', detail: 'I checked for stains, holes, fading and damage. Nothing to point out.' },
  { key: 'found', label: 'Yes, it has flaws', detail: "I'll say what they are and show them." },
];

// One fixed list rather than free text, for the same reason as the
// condition scale. The keys are also listed in firestore.rules
// (productFieldsAreWellTyped); keep the two in step.
export const FLAW_TYPES = [
  { key: 'stain', label: 'Stain' },
  { key: 'hole', label: 'Hole or tear' },
  { key: 'fading', label: 'Fading' },
  { key: 'pilling', label: 'Pilling' },
  { key: 'stretched', label: 'Stretched' },
  { key: 'hardware', label: 'Zipper or button' },
  { key: 'other', label: 'Other' },
];

export const flawTypeLabel = (key) => FLAW_TYPES.find((option) => option.key === key)?.label || null;

// The photos a listing can have besides its flaws. The front is stored in
// `imageUrl`, as it always was, so the catalog grid, cart, orders and
// older builds keep reading the one field they know. The rest go in
// `photos`, a list of { kind, url }, with any flaw photos as kind 'flaw'.
//
// Ukay needs the back and the label too: a secondhand shopper can't hold
// the piece, so the back and the size tag are what they'd check first.
// Ready-to-wear is new and the same across its stock, so only the front
// is required there.
export const PHOTO_SLOTS = [
  { key: 'front', label: 'Front', hint: 'The whole piece from the front, laid flat or on a hanger.' },
  { key: 'back', label: 'Back', hint: 'The whole piece from the back.' },
  { key: 'label', label: 'Label & size tag', hint: 'The brand label and the size tag, close enough to read.' },
  { key: 'fabric', label: 'Fabric close-up', hint: 'Up close, so shoppers can see the weave and texture.' },
];

export const FLAW_PHOTOS_MAX = 3;

export const requiredPhotoSlots = (type) => (type === 'ukay-ukay' ? ['front', 'back', 'label'] : ['front']);

export const EMPTY_PHOTOS = { front: '', back: '', label: '', fabric: '' };

// The photo slots and flaw photos as the forms hold them, from a product.
export const photosFromProduct = (product) => {
  const stored = Array.isArray(product?.photos) ? product.photos : [];
  const urlOf = (kind) => stored.find((photo) => photo?.kind === kind && typeof photo.url === 'string')?.url || '';
  return {
    photos: { front: product?.imageUrl || '', back: urlOf('back'), label: urlOf('label'), fabric: urlOf('fabric') },
    flawPhotos: stored
      .filter((photo) => photo?.kind === 'flaw' && typeof photo.url === 'string' && photo.url)
      .map((photo) => photo.url),
  };
};

// What a save writes to `photos`: every filled slot but the front, in
// slot order, then the flaw photos. Flaw photos only travel with a
// "found" answer on an ukay piece.
export const buildPhotosPayload = (photos, flawPhotos, withFlaws) => [
  ...PHOTO_SLOTS.filter((slot) => slot.key !== 'front' && photos[slot.key]?.trim()).map((slot) => ({
    kind: slot.key,
    url: photos[slot.key].trim(),
  })),
  ...(withFlaws ? flawPhotos.filter(Boolean).map((url) => ({ kind: 'flaw', url })) : []),
];

// Every photo a shopper sees, in order, each with the label shown under
// it. A product listed before `photos` existed has just its front.
// Defensive about the stored list, which the rules can only bound in size.
export const productGallery = (product) => {
  const { photos, flawPhotos } = photosFromProduct(product);
  const showFlaws = product?.type === 'ukay-ukay' && product?.flawCheck === 'found';
  return [
    ...PHOTO_SLOTS.filter((slot) => photos[slot.key]).map((slot) => ({
      kind: slot.key,
      url: photos[slot.key],
      label: slot.label,
    })),
    ...(showFlaws
      ? flawPhotos.map((url, i) => ({ kind: 'flaw', url, label: flawPhotos.length > 1 ? `Flaw ${i + 1}` : 'Flaw' }))
      : []),
  ];
};

// Fallback only, for products saved before per-product colors/sizes
// existed — not used by the admin forms themselves, which require a real
// selection on every save.
export const DEFAULT_COLORS = ['White', 'Black'];
export const DEFAULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];

// The measurement field set is not the same for every item a Store Manager
// might list — a loafer has no chest measurement. `measurementType` picks
// which group of fields applies to a given product, and this config is the
// single source of truth for that mapping. Shared by AdminAddProductScreen,
// AdminEditProductScreen, and SizeGuideSheet so the field set/order/labels
// can't drift between the form that writes it and the modal that reads it.
export const MEASUREMENT_TYPES = {
  tops: {
    label: 'Tops & Outerwear',
    unit: 'in',
    helper: 'Shirts, tees, blouses, sweaters, jackets, hoodies. Measured flat in inches — leave blank if not applicable.',
    fields: [
      { key: 'chest', label: 'Chest' },
      { key: 'length', label: 'Length' },
      { key: 'shoulder', label: 'Shoulder' },
      { key: 'sleeve', label: 'Sleeve' },
    ],
  },
  bottoms: {
    label: 'Bottoms',
    unit: 'in',
    helper: 'Pants, jeans, shorts, skirts. Measured flat in inches — leave blank if not applicable.',
    fields: [
      { key: 'waist', label: 'Waist' },
      { key: 'hip', label: 'Hip' },
      { key: 'inseam', label: 'Inseam' },
      { key: 'rise', label: 'Rise' },
      { key: 'length', label: 'Length' },
    ],
  },
  onepiece: {
    label: 'Dresses & One-Piece',
    unit: 'in',
    helper: 'Dresses, jumpsuits, rompers, one-piece swimwear. Measured flat in inches — leave blank if not applicable.',
    fields: [
      { key: 'bust', label: 'Bust' },
      { key: 'waist', label: 'Waist' },
      { key: 'hip', label: 'Hip' },
      { key: 'length', label: 'Length' },
      { key: 'shoulder', label: 'Shoulder' },
    ],
  },
  footwear: {
    label: 'Footwear',
    unit: 'cm',
    helper: 'Measured flat, heel to toe, in centimeters — leave blank if not applicable.',
    fields: [
      { key: 'length', label: 'Length' },
      { key: 'width', label: 'Width' },
      { key: 'heelHeight', label: 'Heel Height' },
    ],
  },
  bags: {
    label: 'Bags',
    unit: 'in',
    helper: 'Strap drop is the distance from strap top to bag opening. Measured in inches — leave blank if not applicable.',
    fields: [
      { key: 'width', label: 'Width' },
      { key: 'height', label: 'Height' },
      { key: 'depth', label: 'Depth' },
      { key: 'strapDrop', label: 'Strap Drop' },
    ],
  },
  accessories: {
    label: 'Accessories',
    unit: 'in',
    helper: 'Belts, hats, scarves, jewelry. Measured in inches — leave blank if not applicable.',
    fields: [
      { key: 'length', label: 'Length' },
      { key: 'width', label: 'Width' },
      { key: 'circumference', label: 'Circumference' },
    ],
  },
};

// Flat key -> label map covering every field key across every type, for
// SizeGuideSheet, which renders whatever keys are actually present on a
// product's `measurements` map without knowing (or caring) about
// measurementType. Keys shared across types (e.g. `waist` in bottoms and
// onepiece) always carry the same label, so a plain merge can't collide.
export const MEASUREMENT_FIELD_LABELS = Object.values(MEASUREMENT_TYPES).reduce(
  (acc, type) => {
    type.fields.forEach((field) => {
      if (!(field.key in acc)) acc[field.key] = field.label;
    });
    return acc;
  },
  {}
);

// Stable column order for SizeGuideSheet — first-seen order across the
// MEASUREMENT_TYPES definitions above, so legacy products (tops-shaped)
// render in the same chest/length/shoulder/sleeve order they always have.
export const MEASUREMENT_FIELD_ORDER = Object.keys(MEASUREMENT_FIELD_LABELS);

export const emptyMeasurementEntry = (measurementType) => {
  const fields = MEASUREMENT_TYPES[measurementType]?.fields || [];
  return fields.reduce((acc, field) => {
    acc[field.key] = '';
    return acc;
  }, {});
};

// Type-aware: reads the field list for `measurementType` rather than a
// hardcoded five. Drops any size whose values for that type are all blank,
// then drops the whole thing if nothing remains — "never write empty
// objects." Returns null when there's nothing left to save (including when
// no measurementType is selected at all), so callers can strip
// `measurementType` alongside `measurements` in one check rather than two.
export const buildMeasurementsPayload = (measurements, measurementType) => {
  const fields = MEASUREMENT_TYPES[measurementType]?.fields;
  if (!measurements || !fields) return null;
  const cleaned = {};
  Object.keys(measurements).forEach((size) => {
    const entry = measurements[size] || {};
    const hasValue = fields.some((field) => (entry[field.key] || '').trim() !== '');
    if (!hasValue) return;
    const cleanedEntry = {};
    fields.forEach((field) => {
      cleanedEntry[field.key] = entry[field.key] || '';
    });
    cleaned[size] = cleanedEntry;
  });
  if (Object.keys(cleaned).length === 0) return null;
  return { measurements: cleaned, measurementType };
};
