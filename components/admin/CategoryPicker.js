// What kind of item a product is (Tops, Bottoms, Dresses...), shared by Add
// and Edit Product. Drawn like the Section picker, but wrapping, since
// seven don't fit one row; the line under it says what the chosen one
// covers, so a hoodie or a romper lands where shoppers will look for it.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import { CATEGORY_OPTIONS, categoryOption } from '../../constants/productOptions';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CREAM = Colors.light.background;
const LINE = Colors.light.border;

export default function CategoryPicker({ value, onChange, error }) {
  const chosen = categoryOption(value);
  return (
    <View>
      <View style={styles.wrap} accessibilityRole="radiogroup">
        {CATEGORY_OPTIONS.map((option) => {
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
              accessibilityLabel={`${option.label}. ${option.hint}`}
            >
              <Text style={[styles.text, on && { color: CREAM }]} numberOfLines={1}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{chosen ? chosen.hint : 'Pick the closest fit.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: {
    height: 40,
    paddingHorizontal: 14,
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
  hint: { fontSize: 11.5, lineHeight: 16, color: MUTED, marginTop: 6 },
});
