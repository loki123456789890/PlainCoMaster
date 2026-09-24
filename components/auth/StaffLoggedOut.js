// components/auth/StaffLoggedOut.js
//
// What staff see after logging out of the portal, from the approved
// staff-screens preview: on ink like the rest of the Staff Portal, the
// wordmark and STAFF PORTAL pill up top, a Moss ring that draws itself
// closed around a tick, "You're logged out", and — for a Store Manager — a
// card saying the store stays open without them, when they logged out and
// that it was this device only (a manager on a shared phone can confirm the
// session really ended). One way on: "Sign in again", which uncovers the
// sign-in form underneath.
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withDelay,
  withRepeat,
  withTiming,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/theme';
import Reveal from '../shop/Reveal';
import { LOCKUP_WORDMARK_CREAM, LOCKUP_DOT, WORD, DOT_BOX } from '../BrandLockup';

// The wordmark art has a dotless "i" — the Clay dot is its own image,
// placed over it with the lockup's geometry, scaled to this width.
const WORD_W = 96;
const WORD_SCALE = WORD_W / WORD.w;
const DOT_STYLE = {
  position: 'absolute',
  left: (DOT_BOX.x - WORD.x) * WORD_SCALE,
  top: (DOT_BOX.y - WORD.y) * WORD_SCALE,
  width: DOT_BOX.w * WORD_SCALE,
  height: DOT_BOX.h * WORD_SCALE,
};
const INK = '#211D19';
const PILL_INK = '#E9A283';
const MOSS_LIGHT = '#8FA77C';

const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R;
const TICK_LENGTH = 60;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

function Seal() {
  const reduceMotion = useReducedMotion();
  const ring = useSharedValue(reduceMotion ? 1 : 0);
  const tick = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    ring.value = withDelay(150, withTiming(1, { duration: 900, easing: Easing.bezier(0.6, 0, 0.2, 1) }));
    tick.value = withDelay(850, withTiming(1, { duration: 450, easing: Easing.out(Easing.quad) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING_C * (1 - ring.value) }));
  const tickProps = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - tick.value) }));
  return (
    <Svg width={84} height={84} viewBox="0 0 84 84" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={42} cy={42} r={RING_R} fill="none" stroke="#3A342D" strokeWidth={3} />
      <AnimatedCircle
        cx={42}
        cy={42}
        r={RING_R}
        fill="none"
        stroke={MOSS_LIGHT}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={RING_C}
        animatedProps={ringProps}
        transform="rotate(-90 42 42)"
      />
      <AnimatedPath
        d="M29 43l9 9 18-19"
        fill="none"
        stroke="#CFE0BF"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={TICK_LENGTH}
        animatedProps={tickProps}
      />
    </Svg>
  );
}

// The store is still taking orders: a dot with a ring pulsing out of it.
function OpenDot() {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(1, { duration: 2000, easing: Easing.out(Easing.quad) }), -1, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - pulse.value),
    transform: [{ scale: 0.6 + pulse.value }],
  }));
  return (
    <View style={styles.dot}>
      {!reduceMotion && <Animated.View style={[styles.dotRing, ringStyle]} />}
    </View>
  );
}

// By hand rather than toLocaleTimeString — Hermes builds aren't guaranteed
// to ship the Intl data it needs.
const formatTime = (ms) => {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export default function StaffLoggedOut({ visible, onSignIn, storeName, loggedOutAt }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal visible animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onSignIn}>
      <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.glow} pointerEvents="none" />
        <Reveal delay={40} style={styles.top}>
          <View style={styles.wordmark} accessible accessibilityLabel="PlainCo">
            <Image source={LOCKUP_WORDMARK_CREAM} style={StyleSheet.absoluteFill} contentFit="contain" />
            <Image source={LOCKUP_DOT} style={DOT_STYLE} contentFit="contain" />
          </View>
          <View style={styles.pill}>
            <Ionicons name="shield-outline" size={12} color={PILL_INK} />
            <Text style={styles.pillText}>STAFF PORTAL</Text>
          </View>
        </Reveal>

        <View style={styles.main}>
          <Seal />
          <Reveal delay={500}>
            <Text style={styles.title} accessibilityRole="header">
              You&apos;re logged out
            </Text>
            <Text style={styles.body}>
              Your store keeps running while you&apos;re away. Sign in again any time to pick up where you left off.
            </Text>
          </Reveal>
          {storeName ? (
            <Reveal delay={650} style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.storeName} numberOfLines={1}>
                  {storeName}
                </Text>
                <View style={styles.open}>
                  <OpenDot />
                  <Text style={styles.openText}>Open</Text>
                </View>
              </View>
              <Text style={styles.cardBody}>
                Customers can still browse and place orders. New orders wait in Pending until someone signs in.
              </Text>
              <View style={styles.meta}>
                <Text style={styles.metaText}>Logged out {formatTime(loggedOutAt || Date.now())}</Text>
                <Text style={styles.metaText}>This device only</Text>
              </View>
            </Reveal>
          ) : null}
        </View>

        <Reveal delay={800} style={styles.foot}>
          <Pressable
            onPress={onSignIn}
            style={({ pressed }) => [styles.button, pressed && { transform: [{ scale: 0.97 }] }]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Sign in again</Text>
          </Pressable>
          <Text style={styles.hint}>Staff and store manager accounts only</Text>
        </Reveal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK, paddingHorizontal: 24, overflow: 'hidden' },
  // A soft Clay light behind the top of the screen, as in the preview.
  glow: {
    position: 'absolute',
    top: -160,
    alignSelf: 'center',
    width: 520,
    height: 420,
    borderRadius: 260,
    backgroundColor: 'rgba(196,98,62,0.10)',
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  wordmark: { width: WORD_W, height: WORD.h * WORD_SCALE },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(224,138,102,0.4)',
  },
  pillText: { fontSize: 10, fontWeight: '600', letterSpacing: 1.4, color: PILL_INK },
  main: { flex: 1, justifyContent: 'center', gap: 22 },
  title: { fontSize: 28, lineHeight: 32, fontWeight: '600', color: '#F2EDE4' },
  body: { fontSize: 14, lineHeight: 22, color: '#B8AEA0', marginTop: 6 },
  card: {
    backgroundColor: '#2A2520',
    borderWidth: 1,
    borderColor: '#3A332C',
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  storeName: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#F2EDE4' },
  open: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  openText: { fontSize: 11.5, fontWeight: '600', color: '#B7C9A6' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: MOSS_LIGHT },
  dotRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: MOSS_LIGHT,
  },
  cardBody: { fontSize: 12, lineHeight: 18, color: '#A9A093' },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#3A332C',
    paddingTop: 10,
  },
  metaText: { fontSize: 11, color: '#8A8074', fontVariant: ['tabular-nums'] },
  foot: { gap: 12 },
  button: {
    height: 54,
    borderRadius: 16,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  hint: { textAlign: 'center', fontSize: 11.5, color: '#8A8074' },
});
