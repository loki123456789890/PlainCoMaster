import React, { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Spacing, Typography } from '../../constants/theme';
import Button, { ButtonVariant } from './Button';

interface DialogButtonSpec {
  label: string;
  variant: ButtonVariant;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

interface DialogButtonRowProps {
  /** Rendered left-to-right in the order given — callers decide which side
   * each button lands on; this component only unifies sizing. */
  buttons: [DialogButtonSpec, DialogButtonSpec];
}

const ROW_GAP = 12;

/**
 * The one paired-button row every confirmation dialog in the app renders
 * through (ConfirmDialog, AppAlertHost's two-button alerts, and the Edit
 * User modal's Cancel/Save row). Both buttons are always equal width via
 * flex — that part was never the bug. The actual defect: React Native's
 * adjustsFontSizeToFit (see Button.tsx) shrinks each button's Text
 * independently, so two equal-width buttons with labels of different
 * length (e.g. "Keep Editing" vs. "Discard") rendered at visibly different
 * sizes even though neither box was smaller than the other.
 *
 * This measures both labels' natural (unconstrained) width up front, then
 * — only if one wouldn't fit its half of the row at Typography.button —
 * applies a single shared scale to both buttons. Whichever label needs to
 * shrink more decides the size for both, so they never diverge.
 */
export default function DialogButtonRow({ buttons }: DialogButtonRowProps) {
  const [left, right] = buttons;
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const [leftTextWidth, setLeftTextWidth] = useState<number | null>(null);
  const [rightTextWidth, setRightTextWidth] = useState<number | null>(null);

  const handleRowLayout = useCallback((e: LayoutChangeEvent) => {
    setRowWidth(e.nativeEvent.layout.width);
  }, []);
  const handleLeftTextLayout = useCallback((e: LayoutChangeEvent) => {
    setLeftTextWidth(e.nativeEvent.layout.width);
  }, []);
  const handleRightTextLayout = useCallback((e: LayoutChangeEvent) => {
    setRightTextWidth(e.nativeEvent.layout.width);
  }, []);

  const fontSize = useMemo(() => {
    if (rowWidth == null || leftTextWidth == null || rightTextWidth == null) {
      return Typography.button;
    }
    const perButtonWidth = (rowWidth - ROW_GAP) / 2;
    // Button's horizontal padding, plus its 1pt border on each side and a
    // point of slack for rounding — without them a label that only just
    // needed shrinking still came out a hair too wide and was cut off
    // ("Deactiv…").
    const availableTextWidth = perButtonWidth - Spacing.lg * 2 - 4;
    const longest = Math.max(leftTextWidth, rightTextWidth);
    if (longest <= availableTextWidth) return Typography.button;
    const scale = availableTextWidth / longest;
    return Typography.button * scale;
  }, [rowWidth, leftTextWidth, rightTextWidth]);

  return (
    <View style={styles.row} onLayout={handleRowLayout}>
      {/* Invisible, unconstrained measurement pass — same font weight/size
          as the real buttons below, but outside the flex layout so it
          can't affect it. */}
      <Text style={styles.measure} numberOfLines={1} pointerEvents="none" onLayout={handleLeftTextLayout}>
        {left.label}
      </Text>
      <Text style={styles.measure} numberOfLines={1} pointerEvents="none" onLayout={handleRightTextLayout}>
        {right.label}
      </Text>

      <View style={styles.buttonWrap}>
        <Button
          variant={left.variant}
          label={left.label}
          onPress={left.onPress}
          disabled={left.disabled}
          loading={left.loading}
          fullWidth
          fontSize={fontSize}
        />
      </View>
      <View style={styles.buttonWrap}>
        <Button
          variant={right.variant}
          label={right.label}
          onPress={right.onPress}
          disabled={right.disabled}
          loading={right.loading}
          fullWidth
          fontSize={fontSize}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', width: '100%', gap: ROW_GAP },
  buttonWrap: { flex: 1 },
  measure: {
    position: 'absolute',
    opacity: 0,
    fontSize: Typography.button,
    fontWeight: '600',
    includeFontPadding: false,
  },
});
