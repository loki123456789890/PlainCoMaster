// components/shop/SizeGuideSheet.js
//
// The size guide from the approved product-details preview: a sheet with
// the store's measurements for every size the product comes in. Tapping a
// row picks it, and the button below applies that size to the product.
// Columns come from whatever the store actually measured, so an older
// product with no measurementType still shows its numbers. Footwear gets
// the shoe diagram; the other kinds of item have none to show.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import {
  MEASUREMENT_FIELD_LABELS,
  MEASUREMENT_FIELD_ORDER,
  MEASUREMENT_TYPES,
  SIZE_OPTIONS,
} from '../../constants/productOptions';
import Sheet from './Sheet';

const INK = Colors.light.text;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const GOLD = '#8C6D0C';
const LINE = '#EEE7DD';

// Header labels short enough to sit in a narrow column.
const SHORT_LABELS = { heelHeight: 'Heel', strapDrop: 'Drop', circumference: 'Around' };
const labelFor = (key) => SHORT_LABELS[key] || MEASUREMENT_FIELD_LABELS[key];

export const sortSizes = (sizes) =>
  [...sizes].sort((a, b) => {
    const ai = SIZE_OPTIONS.indexOf(a);
    const bi = SIZE_OPTIONS.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

// The measured fields for one size, in column order, for the fit line
// under the size buttons.
export function measuredFields(measurements, size) {
  const entry = measurements?.[size];
  if (!entry) return [];
  return MEASUREMENT_FIELD_ORDER.filter((key) => entry[key]?.trim()).map((key) => ({
    key,
    label: MEASUREMENT_FIELD_LABELS[key],
    value: entry[key].trim(),
  }));
}

export const measurementUnit = (measurementType) =>
  MEASUREMENT_TYPES[measurementType]?.unit === 'cm' ? 'cm' : 'in';

function ShoeDiagram() {
  return (
    <Svg width={130} height={74} viewBox="0 0 130 74">
      <Path
        d="M8 50c0-10 10-22 22-26 8-3 20-4 30 2l18 10c10 5 24 6 36 8 6 1 8 4 8 8v4H8z"
        fill="#F3EEE6"
        stroke={INK}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <Rect x={8} y={56} width={114} height={8} rx={2} fill={INK} />
      <Path d="M8 70h114M8 67v6M122 67v6" stroke={CLAY} strokeWidth={1.6} />
      <Path d="M126 50v14M123 50h6M123 64h6" stroke={MOSS} strokeWidth={1.6} />
      <Path d="M84 30v24" stroke={GOLD} strokeWidth={1.6} strokeDasharray="3 2" />
    </Svg>
  );
}

const SHOE_LEGEND = [
  { key: 'length', color: CLAY, label: 'Length', text: 'heel to toe' },
  { key: 'width', color: GOLD, label: 'Width', text: 'widest part' },
  { key: 'heelHeight', color: MOSS, label: 'Heel', text: 'sole height' },
];

export default function SizeGuideSheet({ visible, onClose, measurements, measurementType, sizes, selectedSize, onChoose }) {
  const [picked, setPicked] = useState(selectedSize || null);
  useEffect(() => {
    if (visible) setPicked(selectedSize || null);
  }, [visible, selectedSize]);

  const orderedSizes = useMemo(() => sortSizes(sizes), [sizes]);
  const fields = useMemo(
    () =>
      MEASUREMENT_FIELD_ORDER.filter((key) => orderedSizes.some((size) => Boolean(measurements?.[size]?.[key]?.trim()))),
    [orderedSizes, measurements]
  );

  const type = MEASUREMENT_TYPES[measurementType];
  const unit = measurementUnit(measurementType);
  const unitWord = unit === 'cm' ? 'centimeters' : 'inches';
  const isFootwear = measurementType === 'footwear';

  const pick = (size) => {
    Haptics.selectionAsync();
    setPicked(size);
  };

  const buttonLabel = !picked
    ? 'Tap a row to choose a size'
    : picked === selectedSize
    ? `Size ${picked} selected · Done`
    : `Choose size ${picked}`;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} accessibilityRole="header">
            Size guide
          </Text>
          <Text style={styles.sub}>{type ? `${type.label} · measured in ${unitWord}` : `Measured in ${unitWord}`}</Text>
        </View>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Close size guide"
        >
          <Ionicons name="close" size={18} color={INK} />
        </Pressable>
      </View>

      {isFootwear ? (
        <View style={styles.diagram}>
          <ShoeDiagram />
          <View style={{ flex: 1, gap: 2 }}>
            {SHOE_LEGEND.filter((l) => fields.includes(l.key)).map((l) => (
              <Text key={l.key} style={styles.legend}>
                <Text style={{ color: l.color }}>● </Text>
                <Text style={styles.legendStrong}>{l.label}</Text> {l.text}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {fields.length === 0 ? (
        <Text style={styles.empty}>{"The store hasn't recorded measurements for this item yet."}</Text>
      ) : (
        <View accessibilityRole="list">
          <View style={styles.row}>
            <Text style={[styles.th, styles.sizeCol]}>Size</Text>
            {fields.map((key) => (
              <View key={key} style={styles.col}>
                <Text style={styles.th}>{labelFor(key)}</Text>
                <Text style={styles.thUnit}>{unit}</Text>
              </View>
            ))}
          </View>
          {orderedSizes.map((size, i) => {
            const on = size === picked;
            return (
              <Pressable
                key={size}
                onPress={() => pick(size)}
                style={[styles.row, styles.tr, on && styles.trOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Size ${size}. ${fields
                  .map((key) => `${MEASUREMENT_FIELD_LABELS[key]} ${measurements?.[size]?.[key]?.trim() || 'not measured'}`)
                  .join(', ')}`}
              >
                {!on && (i === 0 || orderedSizes[i - 1] !== picked) ? <View style={styles.rule} /> : null}
                <Text style={[styles.td, styles.sizeCol, styles.tdSize, on && styles.tdOn]}>{size}</Text>
                {fields.map((key) => (
                  <Text key={key} style={[styles.td, styles.col, on && styles.tdOn]}>
                    {measurements?.[size]?.[key]?.trim() || '—'}
                  </Text>
                ))}
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.disc}>
        <Ionicons name="information-circle-outline" size={15} color={Colors.light.icon} style={{ marginTop: 1 }} />
        <Text style={styles.discText}>
          Measured by the store. Sizes can vary slightly, so use these as a guide, not a guarantee.
        </Text>
      </View>

      <Pressable
        onPress={() => {
          if (!picked) return;
          onChoose(picked);
          onClose();
        }}
        disabled={!picked}
        style={({ pressed }) => [styles.button, !picked && styles.buttonOff, pressed && picked && { transform: [{ scale: 0.97 }] }]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !picked }}
      >
        <Text style={styles.buttonText}>{buttonLabel}</Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: 19, fontWeight: '600', color: INK },
  sub: { fontSize: 12.5, color: Colors.light.icon, marginTop: 3 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(28,27,26,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagram: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: LINE,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  legend: { fontSize: 11.5, color: Colors.light.icon, lineHeight: 19 },
  legendStrong: { color: INK, fontWeight: '600' },
  empty: { fontSize: 13.5, color: Colors.light.icon, marginTop: 16 },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, marginTop: 12 },
  tr: { marginTop: 0, minHeight: 46, borderRadius: 12 },
  trOn: { backgroundColor: INK },
  rule: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: LINE },
  sizeCol: { width: 58, paddingHorizontal: 8 },
  col: { flex: 1, paddingHorizontal: 6 },
  th: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.light.icon },
  thUnit: { fontSize: 11, color: Colors.light.icon },
  td: { fontSize: 13.5, color: INK, fontVariant: ['tabular-nums'] },
  tdSize: { fontWeight: '600' },
  tdOn: { color: Colors.light.background },

  disc: { flexDirection: 'row', gap: 6, marginTop: 14, marginBottom: 14, paddingHorizontal: 2 },
  discText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: Colors.light.icon },
  button: { height: 54, borderRadius: 16, backgroundColor: CLAY, alignItems: 'center', justifyContent: 'center' },
  buttonOff: { backgroundColor: '#E3C3B6' },
  buttonText: { fontSize: 15.5, fontWeight: '600', color: '#fff' },
});
