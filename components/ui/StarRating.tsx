import React from 'react';
import { View, Pressable, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors, Spacing } from '../../constants/theme';

interface StarRatingProps {
  /** 0–5. Fractions are honoured in read-only mode (rounded to the nearest
   * half star); in editable mode only whole stars exist, because a tap
   * cannot express a half. */
  rating: number;
  /** Star glyph size in points. The row's touch targets in editable mode
   * are sized independently — see `styles.tapTarget`. */
  size?: number;
  /** Turns the row into an input. `onChange` is required for it to do
   * anything; without one the row stays inert rather than half-working. */
  editable?: boolean;
  onChange?: (rating: number) => void;
  /** Describes what is being rated, for the accessibility label — e.g.
   * "Denim Jacket". Falls back to a generic phrasing. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}

const STARS = [1, 2, 3, 4, 5];

// Gold, and one of the two things it is for. DESIGN.md reserves Gold for
// money; constants/theme.ts widens that by exactly one case — "price/rating
// accents, use sparingly" — which is this. Clay stays the primary-action
// color and is deliberately not used here: a star row is information, not
// something to press (except when it is, and even then it is an input, not
// a call to action).
const STAR_COLOR = Colors.light.highlight;

/**
 * The app's only star row, in both of its modes.
 *
 * Read-only mode renders halves so an average of 4.3 doesn't have to lie in
 * one direction or the other. Editable mode renders whole stars with 44pt
 * touch targets, and reports the tapped value straight through — there is
 * no internal state, so the composer owns the value and this stays a
 * rendering of it.
 */
export default function StarRating({
  rating,
  size = 18,
  editable = false,
  onChange,
  label,
  style,
}: StarRatingProps) {
  const isInteractive = editable && typeof onChange === 'function';

  const handlePress = (value: number) => {
    // Selection haptic on every tap, including a re-tap of the current
    // value — the tap happened, so it gets acknowledged. Matches the size
    // and color swatches on ProductScreen.
    Haptics.selectionAsync();
    onChange?.(value);
  };

  // Nearest half, so 4.3 shows as four and a half rather than rounding to a
  // flat 4 and quietly losing the third of a star that separates a good
  // product from a great one.
  const halfRounded = Math.round(rating * 2) / 2;

  const iconFor = (star: number): keyof typeof Ionicons.glyphMap => {
    if (isInteractive) return star <= rating ? 'star' : 'star-outline';
    if (halfRounded >= star) return 'star';
    if (halfRounded >= star - 0.5) return 'star-half';
    return 'star-outline';
  };

  const subject = label ? ` for ${label}` : '';

  if (!isInteractive) {
    return (
      <View
        style={[styles.row, style]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          rating > 0
            ? `Rated ${halfRounded} out of 5 stars${subject}`
            : `Not yet rated${subject}`
        }
      >
        {STARS.map((star) => (
          <Ionicons key={star} name={iconFor(star)} size={size} color={STAR_COLOR} />
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.row, style]} accessibilityRole="radiogroup">
      {STARS.map((star) => (
        <Pressable
          key={star}
          onPress={() => handlePress(star)}
          style={styles.tapTarget}
          accessibilityRole="radio"
          accessibilityState={{ selected: rating === star }}
          accessibilityLabel={`${star} ${star === 1 ? 'star' : 'stars'}${subject}`}
        >
          <Ionicons name={iconFor(star)} size={size} color={STAR_COLOR} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  // 44pt is the platform minimum on both OSes, and five of them in a row is
  // the one place on this screen where an undersized target would be felt
  // immediately — a mis-tap here submits the wrong rating.
  tapTarget: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.xs,
  },
});
