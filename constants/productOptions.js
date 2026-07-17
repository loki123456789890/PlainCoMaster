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
