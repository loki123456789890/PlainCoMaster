// Who a product is for (Women, Men, Unisex, Kids), shared by Add and Edit
// Product: four equal buttons, one choice, drawn like the size picker so
// the form reads as one set of controls.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import { SECTION_OPTIONS } from '../../constants/productOptions';

const INK = Colors.light.text;
const CREAM = Colors.light.background;
const LINE = Colors.light.border;

export default function SectionPicker({ value, onChange, error }) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {SECTION_OPTIONS.map((option) => {
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
              styles.option,
              on && styles.optionOn,
              Boolean(error) && !on && styles.optionBad,
              pressed && { transform: [{ scale: 0.95 }] },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option.label}
          >
            <Text style={[styles.text, on && { color: CREAM }]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  option: {
    flex: 1,
    height: 44,
    paddingHorizontal: 4,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionOn: { backgroundColor: INK, borderColor: INK },
  optionBad: { borderColor: '#F1CFCB' },
  text: { fontSize: 13, fontWeight: '600', color: INK },
});
