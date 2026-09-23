// components/shop/TabScreen.js
//
// The pieces Favorites, Cart and Profile share, from the approved
// favorites/cart/profile preview: the big page title with a count beside
// it, the Clay-tiled empty state, the dark Undo toast, and the offline
// notice.
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';
import Reveal from './Reveal';

// "Favorites   3 items". A back arrow only when the screen was pushed from
// somewhere other than the tab bar (a product's cart button, say), so there
// is something to go back to that the tab bar doesn't already offer.
export function PageHead({ title, meta, onBack, right }) {
  return (
    <Reveal delay={30} style={styles.head}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.light.text} />
        </Pressable>
      ) : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {right}
    </Reveal>
  );
}

// A big empty state: a Clay-tinted tile with an icon, a line, a sentence
// and one action.
export function BigEmpty({ icon, title, text, actionLabel, onAction }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View style={styles.empty} entering={reduceMotion ? undefined : FadeIn.duration(450).easing(EASE_OUT_QUINT)}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={38} color={Colors.light.tint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {actionLabel ? (
        <Pressable
          style={({ pressed }) => [styles.emptyButton, pressed && { transform: [{ scale: 0.97 }] }]}
          onPress={onAction}
          accessibilityRole="button"
        >
          <Text style={styles.emptyButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

// The tab bar's height above the safe-area inset (see TabBar).
export const TAB_BAR_HEIGHT = 64;

// "Removed from Cart   Undo" — ink, floating `lift` points above the tab bar.
export function UndoToast({ text, onUndo, lift = 0, undoLabel }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  if (!text) return null;
  const bottom = TAB_BAR_HEIGHT + Math.max(insets.bottom, 8) + 12 + lift;
  return (
    <Animated.View
      style={[styles.toast, { bottom }]}
      entering={reduceMotion ? undefined : FadeIn.duration(300).easing(EASE_OUT_QUINT)}
      exiting={reduceMotion ? undefined : FadeOut.duration(200)}
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.toastText} numberOfLines={1}>
        {text}
      </Text>
      {onUndo ? (
        <Pressable onPress={onUndo} hitSlop={10} accessibilityRole="button" accessibilityLabel={undoLabel || 'Undo'}>
          <Text style={styles.toastUndo}>Undo</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

// Clears `text` after `ms`, for the toasts above.
export function useAutoClear(value, clear, ms = 4000) {
  useEffect(() => {
    if (!value) return undefined;
    const t = setTimeout(clear, ms);
    return () => clearTimeout(t);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function OfflineNotice({ children }) {
  return (
    <View style={styles.offline} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={18} color={ERR_INK} />
      <Text style={styles.offlineText}>{children}</Text>
    </View>
  );
}
const ERR_INK = '#7A1B12';

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 20, paddingTop: 12, marginBottom: 16 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 12,
    marginLeft: -10,
    marginRight: -4,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: { backgroundColor: 'rgba(28,27,26,0.06)' },
  title: { flex: 1, fontSize: 26, fontWeight: '600', letterSpacing: -0.5, color: Colors.light.text },
  meta: { fontSize: 12.5, color: Colors.light.icon },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 36 },
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 26,
    backgroundColor: '#F3E3DA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text, textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 19.5, color: Colors.light.icon, textAlign: 'center', marginTop: 6 },
  emptyButton: {
    marginTop: 18,
    height: 48,
    paddingHorizontal: 26,
    borderRadius: 16,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center',
  },
  emptyButtonText: { fontSize: 14.5, fontWeight: '600', color: '#fff' },

  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.light.text,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    zIndex: 12,
  },
  toastText: { flex: 1, fontSize: 13, color: Colors.light.background },
  toastUndo: { fontSize: 13, fontWeight: '600', color: '#E9A385' },

  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FBEDEB',
    borderWidth: 1,
    borderColor: '#F1CFCB',
  },
  offlineText: { flex: 1, fontSize: 12.5, lineHeight: 17.5, color: ERR_INK },
});
