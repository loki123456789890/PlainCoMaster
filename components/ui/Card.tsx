import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Radius, Spacing, Shadow } from '../../constants/theme';

interface CardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 'elevated' (default) keeps the lifted Shadow.card treatment reserved for
   * surfaces that need to separate from a busy background (Cart, Checkout, Shop).
   * 'flat' is the app's actual default card: a 1px border, no shadow. */
  variant?: 'elevated' | 'flat';
}

export default function Card({ children, style, variant = 'elevated' }: CardProps) {
  return (
    <View style={[styles.card, variant === 'flat' ? styles.flat : styles.elevated, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: Spacing.md,
  },
  elevated: {
    borderRadius: Radius.lg,
    ...Shadow.card,
  },
  flat: {
    borderRadius: Radius.md,
  },
});
