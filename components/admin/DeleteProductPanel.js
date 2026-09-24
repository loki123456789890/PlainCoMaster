// The "Delete this product?" content, shared by Edit Product's delete sheet
// and the ⋯ sheet in Manage Products: the product, what deleting it
// affects, the gentler "mark it sold out" option, then press and hold.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Colors } from '../../constants/theme';
import ProductImage from '../ui/ProductImage';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const ERR = '#B42318';
const CARD_LINE = '#EEE7DD';
const HOLD_MS = 1200;

const IMPACT = [
  {
    icon: 'storefront-outline',
    bg: '#FBEDEB',
    color: ERR,
    before: 'It ',
    strong: 'disappears from the shop',
    after: ' right away.',
  },
  {
    icon: 'heart-outline',
    bg: '#F6E6DE',
    color: CLAY,
    before: 'Shoppers who saved it in ',
    strong: 'favorites or a cart',
    after: ' see it as unavailable.',
  },
  {
    icon: 'receipt-outline',
    bg: '#EEF0EA',
    color: MOSS,
    before: '',
    strong: 'Past orders',
    after: ' keep their own copy, so order history stays intact.',
  },
];

// Delete, press and hold: a darker fill sweeps across while it's held,
// and letting go early cancels. A screen reader's double-tap deletes
// directly, since holding isn't something it can do.
function HoldToDelete({ onDelete, deleting }) {
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(0);
  const timer = useRef(null);
  const [holding, setHolding] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!deleting) fill.value = 0;
  }, [deleting, fill]);

  const start = () => {
    if (deleting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHolding(true);
    fill.value = withTiming(1, { duration: reduceMotion ? 0 : HOLD_MS, easing: Easing.linear });
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onDelete();
    }, HOLD_MS);
  };
  const stop = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    cancelAnimation(fill);
    fill.value = withTiming(0, { duration: 200 });
  };
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <Pressable
      onPressIn={start}
      onPressOut={stop}
      disabled={deleting}
      style={styles.hold}
      accessibilityRole="button"
      accessibilityLabel="Hold to delete"
      accessibilityHint="Press and hold to delete this product"
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(event) => event.nativeEvent.actionName === 'activate' && onDelete()}
    >
      <Animated.View style={[styles.holdFill, fillStyle]} />
      <Text style={styles.holdText}>{deleting ? 'Deleting…' : holding ? 'Keep holding…' : 'Hold to delete'}</Text>
    </Pressable>
  );
}

// `onSoldOut` is left out when the product is already at 0 in stock.
export default function DeleteProductPanel({ product, meta, onSoldOut, onDelete, onKeep, deleting }) {
  return (
    <View>
      <View style={styles.product}>
        <ProductImage uri={product.imageUrl || product.image} style={styles.thumb} />
        <View style={{ flex: 1 }}>
          <Text style={styles.productName} numberOfLines={1}>
            {product.name}
          </Text>
          <Text style={styles.productMeta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </View>
      <Text style={styles.title} accessibilityRole="header">
        Delete this product?
      </Text>
      <Text style={styles.text}>Here&apos;s what deleting it affects:</Text>
      <View style={styles.impact}>
        {IMPACT.map((row, i) => (
          <View key={row.icon} style={[styles.impactRow, i === IMPACT.length - 1 && { borderBottomWidth: 0 }]}>
            <View style={[styles.impactIcon, { backgroundColor: row.bg }]}>
              <Ionicons name={row.icon} size={16} color={row.color} />
            </View>
            <Text style={styles.impactText}>
              {row.before}
              <Text style={{ fontWeight: '600', color: INK }}>{row.strong}</Text>
              {row.after}
            </Text>
          </View>
        ))}
      </View>
      {onSoldOut ? (
        <Pressable
          onPress={onSoldOut}
          disabled={deleting}
          style={({ pressed }) => [styles.alt, pressed && { borderColor: '#C9D3BE' }]}
          accessibilityRole="button"
        >
          <Ionicons name="checkmark-circle-outline" size={20} color="#37412F" />
          <View style={{ flex: 1 }}>
            <Text style={styles.altTitle}>Just not selling it right now?</Text>
            <Text style={styles.altText}>Mark it sold out instead. You can restock it later.</Text>
          </View>
          <Text style={styles.altGo}>Sold out →</Text>
        </Pressable>
      ) : null}
      <HoldToDelete onDelete={onDelete} deleting={deleting} />
      <Pressable
        onPress={onKeep}
        disabled={deleting}
        style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
      >
        <Text style={styles.ghostText}>Keep it</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  product: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginBottom: 14,
  },
  thumb: { width: 52, height: 58, borderRadius: 12, backgroundColor: '#EFE6DA' },
  productName: { fontSize: 14, fontWeight: '600', color: INK },
  productMeta: { fontSize: 12, color: MUTED, marginTop: 1 },
  title: { fontSize: 19, fontWeight: '600', color: INK, marginTop: 2 },
  text: { fontSize: 13, lineHeight: 20, color: MUTED, marginTop: 4, marginBottom: 12 },
  impact: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 12,
  },
  impactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1EBE3',
  },
  impactIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  impactText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: MUTED },
  alt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#EEF0EA',
    borderWidth: 1.5,
    borderColor: 'transparent',
    marginBottom: 14,
  },
  altTitle: { fontSize: 13, fontWeight: '600', color: '#37412F' },
  altText: { fontSize: 12, lineHeight: 17, color: '#37412F' },
  altGo: { fontSize: 12.5, fontWeight: '600', color: '#37412F' },
  hold: {
    height: 54,
    borderRadius: 16,
    backgroundColor: ERR,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: '#7E1810' },
  holdText: { fontSize: 15.5, fontWeight: '600', color: '#fff' },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ghostText: { fontSize: 15.5, fontWeight: '600', color: MUTED },
});
