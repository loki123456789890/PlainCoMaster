import { Easing } from 'react-native-reanimated';

// Shared entrance/press easing curves used across every screen (customer +
// admin) so interactions and staggered reveals read as one motion language
// instead of per-screen copies that drift over time.
export const EASE_OUT_QUINT = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_OUT_QUART = Easing.bezier(0.25, 1, 0.5, 1);
