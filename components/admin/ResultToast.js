// components/admin/ResultToast.js
//
// Reports the result of an action the admin already confirmed, so it never
// asks for a tap: it closes on its own after `duration`, the bar along its
// bottom shows how long is left, and a swipe sideways or down closes it
// early. One action (Undo) at most. Three tones, from the approved
// feedback preview:
//   ok    moss tile   something was given back (account reactivated)
//   off   dark tile   something was taken away (account deactivated)
//   role  clay tile   something changed; `diff` shows before → after
//
// `toast` is { id, tone, title, detail, diff?: [from, to, store?], onUndo? }.
// A new `id` restarts the timer, so a second action replaces the first
// toast instead of queueing behind it.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, PanResponder } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';

const TONES = {
  ok: { tile: '#9DBE8A', icon: '#1F2A18', name: 'checkmark', bar: '#9DBE8A' },
  off: { tile: '#3A2A25', icon: '#F2A597', name: 'person-remove-outline', bar: '#F2A597', border: '#57392F' },
  role: { tile: Colors.light.tint, icon: '#fff', name: 'swap-horizontal', bar: '#E58A66' },
};
const ON_INK_MUTED = '#BDB3A9';

export default function ResultToast({ toast, onDismiss, duration = 6000 }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  // Kept through the exit slide, like Sheet's content.
  const [shown, setShown] = useState(toast);
  if (toast && toast !== shown) setShown(toast);
  const visible = useSharedValue(0);
  const drag = useSharedValue(0);
  const left = useSharedValue(1);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!toast) {
      visible.value = reduceMotion
        ? 0
        : withTiming(0, { duration: 220 }, (done) => {
            if (done) runOnJS(setShown)(null);
          });
      if (reduceMotion) setShown(null);
      return undefined;
    }
    drag.value = 0;
    visible.value = reduceMotion ? 1 : withTiming(1, { duration: 380, easing: EASE_OUT_QUINT });
    left.value = 1;
    left.value = withTiming(0, { duration, easing: Easing.linear });
    const timer = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(timer);
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sideways or downward, past a short distance, closes it; anything less
  // springs back.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 || g.dy > 8,
      onPanResponderMove: (_, g) => {
        drag.value = Math.abs(g.dx) > g.dy ? g.dx : 0;
      },
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 80 || g.dy > 40 || Math.abs(g.vx) > 0.8) {
          dismissRef.current();
        } else {
          drag.value = withTiming(0, { duration: 180 });
        }
      },
    })
  ).current;

  const box = useAnimatedStyle(() => ({
    opacity: visible.value * (1 - Math.min(Math.abs(drag.value) / 240, 0.6)),
    transform: [
      { translateY: (1 - visible.value) * 40 },
      { translateX: drag.value },
      { scale: 0.96 + visible.value * 0.04 },
    ],
  }));
  const bar = useAnimatedStyle(() => ({ width: `${left.value * 100}%` }));

  if (!shown) return null;
  const tone = TONES[shown.tone] || TONES.role;
  return (
    <Animated.View
      {...pan.panHandlers}
      style={[styles.toast, { bottom: Math.max(insets.bottom, 12) + 12 }, box]}
      pointerEvents={toast ? 'auto' : 'none'}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${shown.title}. ${shown.detail}`}
    >
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: tone.tile }, tone.border && { borderWidth: 1, borderColor: tone.border }]}>
          <Ionicons name={tone.name} size={19} color={tone.icon} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{shown.title}</Text>
          <Text style={styles.detail} numberOfLines={1}>{shown.detail}</Text>
        </View>
        {shown.onUndo ? (
          <Pressable
            onPress={shown.onUndo}
            disabled={!toast}
            style={({ pressed }) => [
              styles.undo,
              shown.tone === 'role' && styles.undoWarm,
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Undo: ${shown.title}`}
          >
            <Ionicons name="arrow-undo" size={13} color={shown.tone === 'role' ? '#F6C3AE' : '#fff'} />
            <Text style={[styles.undoText, shown.tone === 'role' && { color: '#F6C3AE' }]}>Undo</Text>
          </Pressable>
        ) : null}
      </View>
      {shown.diff ? (
        <View style={styles.diff}>
          <View style={styles.diffLine}>
            <Text style={styles.diffFrom} numberOfLines={1}>{shown.diff[0]}</Text>
            <Ionicons name="chevron-forward" size={12} color={ON_INK_MUTED} />
            <Text style={styles.diffTo} numberOfLines={1}>{shown.diff[1]}</Text>
          </View>
          {shown.diff[2] ? (
            <View style={styles.diffLine}>
              <Ionicons name="storefront-outline" size={12} color={ON_INK_MUTED} />
              <Text style={styles.diffStore} numberOfLines={1}>{shown.diff[2]}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: tone.bar }, bar]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 12,
    right: 12,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderRadius: 22,
    backgroundColor: '#221C18',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13.5, fontWeight: '600', color: '#F7F1E8' },
  detail: { fontSize: 11.5, color: ON_INK_MUTED, marginTop: 1 },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  undoWarm: { backgroundColor: 'rgba(196,98,62,0.25)' },
  undoText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  diff: {
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.06)',
    gap: 3,
  },
  diffLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  diffFrom: { flexShrink: 1, fontSize: 11.5, color: '#948A82', textDecorationLine: 'line-through' },
  diffTo: { flexShrink: 1, fontSize: 11.5, fontWeight: '600', color: '#fff' },
  diffStore: { flexShrink: 1, fontSize: 11, color: '#C9BEB2' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.12)' },
  fill: { height: '100%' },
});
