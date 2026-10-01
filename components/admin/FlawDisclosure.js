// "Did you find any flaws?" for an ukay piece, shared by Add and Edit
// Product. There's no default answer: "no flaws" has to be something the
// seller said, not something the form assumed. A "yes" opens the flaw
// types and whatever the screen passes as children (the note and the flaw
// photos), so the disclosure reads as one block.
//
// Styled like ConditionPicker, Moss when chosen, since it belongs to the
// same ukay-only part of the form.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import { FLAW_CHECK_OPTIONS, FLAW_TYPES } from '../../constants/productOptions';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const MOSS = Colors.light.secondary;
const CREAM = Colors.light.background;
const LINE = Colors.light.border;
const ERR = '#B42318';

export default function FlawDisclosure({ value, onChange, tags, onToggleTag, noneBlocked, error, tagsError, children }) {
  return (
    <View>
      <View style={styles.list} accessibilityRole="radiogroup">
        {FLAW_CHECK_OPTIONS.map((option) => {
          const on = value === option.key;
          const blocked = option.key === 'none' && noneBlocked;
          return (
            <Pressable
              key={option.key}
              onPress={() => {
                if (on || blocked) return;
                Haptics.selectionAsync();
                onChange(option.key);
              }}
              disabled={blocked}
              style={({ pressed }) => [
                styles.row,
                on && styles.rowOn,
                Boolean(error) && !on && styles.rowBad,
                blocked && { opacity: 0.45 },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: blocked }}
              accessibilityLabel={`${option.label}. ${blocked ? 'Not available for Well loved.' : option.detail}`}
            >
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{option.label}</Text>
                <Text style={styles.detail}>
                  {blocked ? 'Well loved means it has a flaw, so say what it is.' : option.detail}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {value === 'found' ? (
        <View style={{ marginTop: 14 }}>
          <View style={styles.labelRow}>
            <Text style={styles.tagsLabel}>What kind?</Text>
            <Text style={styles.tagsNote}>Pick all that apply</Text>
          </View>
          <View style={styles.tags}>
            {FLAW_TYPES.map((type) => {
              const on = tags.includes(type.key);
              return (
                <Pressable
                  key={type.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onToggleTag(type.key);
                  }}
                  style={({ pressed }) => [
                    styles.tag,
                    on && styles.tagOn,
                    Boolean(tagsError) && !on && styles.rowBad,
                    pressed && { transform: [{ scale: 0.95 }] },
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={type.label}
                >
                  <Text style={[styles.tagText, on && { color: '#fff' }]}>{type.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {tagsError ? <Text style={styles.error}>{tagsError}</Text> : null}
          {children}
        </View>
      ) : null}
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

  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, marginLeft: 2 },
  tagsLabel: { fontSize: 12.5, fontWeight: '500', color: INK },
  tagsNote: { fontSize: 11.5, color: MUTED },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
    justifyContent: 'center',
  },
  tagOn: { backgroundColor: MOSS, borderColor: MOSS },
  tagText: { fontSize: 12, fontWeight: '500', color: INK },
  error: { fontSize: 11.5, color: ERR, marginTop: 5, marginLeft: 2 },
});
