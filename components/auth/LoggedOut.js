// components/auth/LoggedOut.js
//
// What a customer sees after logging out, from the approved logged-out
// preview: the lockup where Landing keeps it, the app icon with a Moss
// tick settling in over widening rings, "See you soon, <first name>", and
// what stays saved with the account — the cart and favorites counts, read
// just before signing out. With nothing saved the counts are left out and
// the message changes, so the screen never says "0 items".
//
// A full-screen Modal over the (now signed-out) Profile, like the goodbye
// after deactivating; both ways out reset the stack.
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withDelay,
  withTiming,
  withSequence,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';
import { StaticLockup } from '../BrandLockup';
import Reveal from '../shop/Reveal';

const APP_ICON = require('../../assets/images/icon.png');
const AnimatedPath = Animated.createAnimatedComponent(Path);
const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const CREAM = Colors.light.background;

// A faint Clay ring that widens out from behind the icon.
function Ring({ size, delay, reduceMotion }) {
  const p = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!reduceMotion) p.value = withDelay(delay, withTiming(1, { duration: 1600, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.6 + p.value * 0.4 }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ring, { width: size, height: size, borderRadius: size / 2, marginLeft: -size / 2, marginTop: -size / 2 }, style]}
    />
  );
}

function Badge({ reduceMotion }) {
  const pop = useSharedValue(reduceMotion ? 1 : 0);
  const ok = useSharedValue(reduceMotion ? 1 : 0);
  const draw = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    pop.value = withDelay(150, withTiming(1, { duration: 700, easing: EASE_OUT_QUINT }));
    ok.value = withDelay(
      750,
      withSequence(withTiming(1.18, { duration: 270, easing: EASE_OUT_QUINT }), withTiming(1, { duration: 180 }))
    );
    draw.value = withDelay(1000, withTiming(1, { duration: 400, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const badge = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.6 + pop.value * 0.4 }] }));
  const okStyle = useAnimatedStyle(() => ({ transform: [{ scale: ok.value }] }));
  const tick = useAnimatedProps(() => ({ strokeDashoffset: 24 * (1 - draw.value) }));

  return (
    <Animated.View style={[styles.badge, badge]}>
      <Ring size={240} delay={100} reduceMotion={reduceMotion} />
      <Ring size={360} delay={250} reduceMotion={reduceMotion} />
      <Ring size={500} delay={400} reduceMotion={reduceMotion} />
      <View style={styles.iconShadow}>
        <Image source={APP_ICON} style={styles.icon} contentFit="cover" accessibilityIgnoresInvertColors />
      </View>
      <Animated.View style={[styles.ok, okStyle]}>
        <Svg width={17} height={17} viewBox="0 0 24 24">
          <AnimatedPath
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="#fff"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={24}
            animatedProps={tick}
          />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

function Saved({ icon, tint, color, value, label }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.chipIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <View>
        <Text style={styles.chipValue}>{value}</Text>
        <Text style={styles.chipLabel}>{label}</Text>
      </View>
    </View>
  );
}

// `info`: { firstName, email, cartCount, favoriteCount } or null.
export default function LoggedOut({ info, onLogBackIn, onStart }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  if (!info) return null;

  const { firstName, cartCount = 0, favoriteCount = 0 } = info;
  const hasSaved = cartCount > 0 || favoriteCount > 0;

  return (
    <Modal visible animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onStart}>
      <View style={[styles.screen, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        <StaticLockup width={width} height={height} topInset={insets.top} />

        <View style={styles.center}>
          <Badge reduceMotion={reduceMotion} />
          <Reveal delay={450}>
            <Text style={styles.eyebrow}>Logged out safely</Text>
          </Reveal>
          <Reveal delay={520}>
            <Text style={styles.title} accessibilityRole="header">
              See you soon{firstName ? ', ' : ''}
              {firstName ? <Text style={styles.name}>{firstName}</Text> : null}
            </Text>
          </Reveal>
          <Reveal delay={600}>
            <Text style={styles.lead}>
              {hasSaved
                ? "Everything you saved stays with your account. It'll be right here when you come back."
                : 'Thanks for stopping by. New pre-loved finds and fresh styles land all the time.'}
            </Text>
          </Reveal>
          {hasSaved ? (
            <Reveal delay={700} style={styles.saved}>
              {cartCount > 0 ? (
                <Saved
                  icon="cart-outline"
                  tint="#F6E6DE"
                  color={CLAY}
                  value={`${cartCount} item${cartCount === 1 ? '' : 's'}`}
                  label="in your cart"
                />
              ) : null}
              {favoriteCount > 0 ? (
                <Saved
                  icon="heart-outline"
                  tint="#EEF0EA"
                  color={MOSS}
                  value={`${favoriteCount} saved`}
                  label={favoriteCount === 1 ? 'favorite' : 'favorites'}
                />
              ) : null}
            </Reveal>
          ) : null}
        </View>

        <Reveal delay={850}>
          <Pressable
            onPress={onLogBackIn}
            style={({ pressed }) => [styles.button, styles.primary, pressed && { transform: [{ scale: 0.97 }] }]}
            accessibilityRole="button"
          >
            <Ionicons name="log-in-outline" size={19} color="#fff" />
            <Text style={[styles.buttonText, { color: '#fff' }]}>Log back in</Text>
          </Pressable>
        </Reveal>
        <Reveal delay={920}>
          <Pressable
            onPress={onStart}
            style={({ pressed }) => [styles.button, styles.secondary, pressed && { transform: [{ scale: 0.97 }] }]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Back to the start</Text>
          </Pressable>
        </Reveal>
        <Reveal delay={1000} style={styles.note}>
          <Ionicons name="lock-closed-outline" size={13} color={MUTED} />
          <Text style={styles.noteText}>You&apos;ll need your password to log back in.</Text>
        </Reveal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM, paddingHorizontal: 24, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },

  badge: { width: 112, height: 112, marginBottom: 26 },
  ring: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    borderWidth: 1.5,
    borderColor: 'rgba(196,98,62,0.12)',
  },
  iconShadow: {
    width: 112,
    height: 112,
    borderRadius: 32,
    backgroundColor: CLAY,
    shadowColor: CLAY,
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  icon: { width: 112, height: 112, borderRadius: 32 },
  ok: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: MOSS,
    borderWidth: 4,
    borderColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },

  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: MOSS,
    textAlign: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '600', letterSpacing: -0.5, lineHeight: 34, color: INK, textAlign: 'center', marginBottom: 8 },
  name: { color: CLAY },
  lead: { fontSize: 14, lineHeight: 22, color: MUTED, textAlign: 'center', maxWidth: 290 },
  saved: { flexDirection: 'row', gap: 10, marginTop: 22 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
  },
  chipIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipValue: { fontSize: 14, fontWeight: '600', color: INK, lineHeight: 16 },
  chipLabel: { fontSize: 12.5, color: MUTED },

  button: { height: 54, borderRadius: 16, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: CLAY },
  secondary: { borderWidth: 1.5, borderColor: Colors.light.border, marginTop: 10 },
  buttonText: { fontSize: 15.5, fontWeight: '600', color: INK },
  note: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 },
  noteText: { fontSize: 11.5, color: MUTED },
});
