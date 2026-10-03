// components/home/ActiveOrderCard.js
//
// The order card on Home, from the approved home preview: the customer's
// newest order that's still on its way (processing or shipped), with a
// three-step tracker — the current step's dot pulses in Clay and the line
// after it carries a light that flows toward the next step. Tapping opens
// that order's details. With no order on its way, or for a guest, there's
// no card at all. Reduce Motion keeps the tracker still.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  interpolate,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect, Path, Circle } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { Colors } from '../../constants/theme';
import { formatOrderNumber } from '../../utils/orderNumber';
import { toOrderRow, statusKey } from '../../utils/orderRow';
import AnimatedPressable from '../ui/AnimatedPressable';

const CLAY = Colors.light.tint;
const TRACK = '#E4DCD1';
const STEPS = ['Processing', 'Shipped', 'Delivered'];

// Same tints as the Processing and Shipped pills on the Orders list.
const ACTIVE = {
  processing: { step: 0, title: 'Your order is being prepared', bg: '#F6EFE3', fg: '#6B5A2E' },
  shipped: { step: 1, title: 'Your order is on its way', bg: '#E6ECF3', fg: '#2F4B6B' },
};

// Only the newest few are looked at: an order still on its way is recent.
const RECENT_ORDERS = 10;

// Subscribes while Home is in view, so a status the store changes shows up
// without leaving the screen, and a sign-in picks up the new account.
export function useActiveOrder() {
  const [order, setOrder] = useState(null);
  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) {
        setOrder(null);
        return undefined;
      }
      const q = query(collection(db, 'users', user.uid, 'orders'), orderBy('createdAt', 'desc'), limit(RECENT_ORDERS));
      return onSnapshot(
        q,
        (snap) => {
          const active = snap.docs.find((d) => ACTIVE[statusKey(d.data().status || 'processing')]);
          setOrder(active ? toOrderRow(active.id, active.data()) : null);
        },
        (err) => {
          // A card that can't load just doesn't show; Orders has the full list.
          console.error('Error fetching active order:', err);
          setOrder(null);
        }
      );
    }, [])
  );
  return order;
}

function TruckIcon({ color }) {
  const stroke = { fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24">
      <Rect x={2} y={7} width={13} height={10} rx={1.5} {...stroke} />
      <Path d="M15 10h3l3 3v4h-6" {...stroke} />
      <Circle cx={7} cy={18.5} r={1.5} {...stroke} />
      <Circle cx={17.5} cy={18.5} r={1.5} {...stroke} />
    </Svg>
  );
}

// The current step: a Clay dot with a soft ring that breathes out and back
// every two seconds (4 pt at 18% → 7 pt at 6%).
function NowDot({ still }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (still) return undefined;
    t.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(t);
  }, [still]); // eslint-disable-line react-hooks/exhaustive-deps
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.18, 0.06]),
    transform: [{ scale: interpolate(t.value, [0, 1], [17 / 23, 1]) }],
  }));
  return (
    <View style={styles.dotBox}>
      <Animated.View style={[styles.ring, ring]} />
      <View style={[styles.dot, { backgroundColor: CLAY }]} />
    </View>
  );
}

// The line out of the current step: a Clay glow sliding across it, left to
// right, every 1.8 s.
function FlowLine({ still }) {
  const [width, setWidth] = useState(0);
  const t = useSharedValue(0);
  useEffect(() => {
    if (still || !width) return undefined;
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [still, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const glow = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-width, width]) }],
  }));
  return (
    <View style={styles.line} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {still || !width ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, glow]}>
          <LinearGradient
            colors={['rgba(196,98,62,0)', CLAY, 'rgba(196,98,62,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

function Tracker({ step, still }) {
  const parts = [];
  STEPS.forEach((label, i) => {
    if (i === step) parts.push(<NowDot key={`d${i}`} still={still} />);
    else parts.push(<View key={`d${i}`} style={[styles.dot, i < step && { backgroundColor: CLAY }]} />);
    if (i < STEPS.length - 1) {
      if (i === step) parts.push(<FlowLine key={`l${i}`} still={still} />);
      else parts.push(<View key={`l${i}`} style={[styles.line, i < step && { backgroundColor: CLAY }]} />);
    }
  });
  return (
    <>
      <View style={styles.track}>{parts}</View>
      <View style={styles.labels}>
        {STEPS.map((label, i) => (
          <Text key={label} style={[styles.label, i <= step && styles.labelDone, i === step && styles.labelNow]}>
            {label}
          </Text>
        ))}
      </View>
    </>
  );
}

export default function ActiveOrderCard({ order, onPress, style }) {
  const reduceMotion = useReducedMotion();
  const meta = ACTIVE[statusKey(order.status)];
  if (!meta) return null;
  const number = formatOrderNumber(order.id);

  return (
    <AnimatedPressable
      style={[styles.card, style]}
      onPress={onPress}
      rippleColor={Colors.light.border}
      accessibilityRole="button"
      accessibilityLabel={`${meta.title}. ${order.displayName}, order ${number}. ${STEPS[meta.step]}.`}
      accessibilityHint="Opens the order's details"
    >
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: meta.bg }]}>
          <TruckIcon color={meta.fg} />
        </View>
        <View style={styles.flex}>
          {/* Two lines for the title on large text sizes; on the line under
              it the item name gives way before the order number does. */}
          <Text style={styles.title} numberOfLines={2}>
            {meta.title}
          </Text>
          <View style={styles.subRow}>
            <Text style={[styles.sub, styles.subName]} numberOfLines={1}>
              {order.displayName}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {' '}
              · Order {number}
            </Text>
          </View>
        </View>
        <Text style={styles.link}>Track ›</Text>
      </View>
      <Tracker step={meta.step} still={reduceMotion} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
  },
  flex: { flex: 1, minWidth: 0 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13.5, fontWeight: '600', color: Colors.light.text },
  subRow: { flexDirection: 'row', marginTop: 1 },
  sub: { fontSize: 11.5, color: Colors.light.icon },
  subName: { flexShrink: 1 },
  link: { fontSize: 12, fontWeight: '600', color: CLAY },

  track: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginHorizontal: 2 },
  dotBox: { width: 9, height: 9, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 23, height: 23, borderRadius: 11.5, backgroundColor: CLAY },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: TRACK },
  line: { flex: 1, height: 2, marginHorizontal: 4, backgroundColor: TRACK, overflow: 'hidden' },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  label: { fontSize: 10.5, color: Colors.light.icon },
  labelDone: { color: Colors.light.text },
  labelNow: { fontWeight: '600' },
});
