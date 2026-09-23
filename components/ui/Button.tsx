import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  GestureResponderEvent,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Colors, Spacing, Radius, Typography } from '../../constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'success';

interface ButtonProps {
  label: string;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Explicitly stretch the button to fill its parent's width instead of
   * relying on ambient flex context (a column parent's default
   * alignItems:'stretch' vs. a centered EmptyState wrapper, vs. a `flex:1`
   * wrapper for side-by-side dialog buttons). Default `false` preserves
   * every existing screen's current layout untouched — this is purely
   * opt-in for call sites that want width to stop depending on whatever
   * View happens to wrap them. */
  fullWidth?: boolean;
  /** Override the label's font size (defaults to Typography.button). Only
   * meant for DialogButtonRow, which measures a paired label and passes
   * down a shared shrink so two side-by-side dialog buttons never render
   * their text at two different sizes. */
  fontSize?: number;
  /** Escape hatch for one-off layout needs (width, flex, margin) on the
   * button's own root, without a wrapping View. Merged in after the
   * variant style, so it can override layout/sizing — it isn't meant for
   * overriding variant colors; add a variant for that instead. */
  style?: StyleProp<ViewStyle>;
}

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  primary: {
    backgroundColor: Colors.light.tint,
  },
  secondary: {
    backgroundColor: Colors.light.background,
    borderColor: Colors.light.border,
  },
  danger: {
    backgroundColor: Colors.light.danger,
  },
  // Moss: a finished action ("Account created"), never a call to act.
  success: {
    backgroundColor: Colors.light.success,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: Colors.light.tint,
  },
};

const textColors: Record<ButtonVariant, string> = {
  primary: '#fff',
  secondary: Colors.light.text,
  danger: '#fff',
  success: '#fff',
  outline: Colors.light.tint,
};

export default function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
  fontSize,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const textColor = textColors[variant];

  return (
    <TouchableOpacity
      style={[
        styles.base,
        variantStyles[variant],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text
          style={[styles.label, { color: textColor, fontSize: fontSize ?? Typography.button }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
    textAlign: 'center',
  },
});