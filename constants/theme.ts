import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1C1B1A',        // ink
    background: '#FAF7F2',  // canvas
    tint: '#C4623E',        // clay (primary accent, replaces iOS blue)
    secondary: '#5B6B4F',   // moss (Ukay-Ukay tag/badge accent)
    highlight: '#846B1A',   // gold, darkened from #C9A227 for text contrast — same hue/saturation, ~4.8:1 on canvas (was 2.26:1); price/rating accents, use sparingly
    border: '#E8E1D5',      // line
    icon: '#6B655C',
    tabIconDefault: '#6B655C',
    tabIconSelected: '#C4623E',
    danger: '#C4463E',
    success: '#5B6B4F',
  },
  dark: {
    text: '#F5F1EA',
    background: '#1C1B1A',
    tint: '#D97A54',
    secondary: '#7C8F6C',
    highlight: '#D9B84A',
    border: '#3A3733',
    icon: '#B5AEA3',
    tabIconDefault: '#B5AEA3',
    tabIconSelected: '#D97A54',
    danger: '#E0665C',
    success: '#7C8F6C',
  },
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const Radius = {
  sm: 8, md: 12, lg: 16, xl: 24, pill: 999,
};

export const Shadow = {
  card: {
    shadowColor: '#1C1B1A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
};

export const Typography = {
  button: 19,
};

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
