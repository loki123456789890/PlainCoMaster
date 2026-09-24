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

// Chip/pill options for the "What kind of item is this?" selector — same
// { key, label } shape AdminAddProductScreen's TYPE_OPTIONS already uses.
export const MEASUREMENT_TYPE_OPTIONS = Object.keys(MEASUREMENT_TYPES).map((key) => ({
  key,
  label: MEASUREMENT_TYPES[key].label,
}));

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
