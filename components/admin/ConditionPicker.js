// The condition scale for an ukay-ukay piece, shared by Add and Edit
// Product: one row per grade, each with what it means, so the manager picks
// against the same words the shopper will read on the product page.
// Moss when chosen, because condition only exists for ukay-ukay and Moss is
// the ukay color.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import { CONDITION_OPTIONS } from '../../constants/productOptions';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const MOSS = Colors.light.secondary;
const CREAM = Colors.light.background;
const LINE = Colors.light.border;

export default function ConditionPicker({ value, onChange, error }) {
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {CONDITION_OPTIONS.map((option) => {
        const on = value === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              onChange(option.key);
            }}
            style={({ pressed }) => [
              styles.row,
              on && styles.rowOn,
              Boolean(error) && !on && styles.rowBad,
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${option.label}. ${option.detail}`}
          >
            <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{option.label}</Text>
              <Text style={styles.detail}>{option.detail}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
  },
  rowOn: { borderColor: MOSS, backgroundColor: '#F3F5EF' },
  rowBad: { borderColor: '#F1CFCB' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#C9C0B6',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: MOSS },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: MOSS },
  label: { fontSize: 13, fontWeight: '600', color: INK },
  detail: { fontSize: 11.5, lineHeight: 16, color: MUTED, marginTop: 1 },
});
