// components/shop/StaffPreviewDock.js
//
// What a staff account sees at the bottom of a product page instead of the
// buy bar, from the approved staff-preview preview: one floating dark dock
// that reads as a mode ("Shopper preview"), not a warning, with Edit
// listing one tap away for the store that sells the item. Scrolling down
// shrinks it to a pill so it doesn't cover the reviews; scrolling up opens
// it again. Tapping the eye explains, once, why buying is off for staff.
//
// For the selling store's manager, chips above the dock surface what the
// manager should act on — stock, and how many reviews said the item didn't
// match — from data the page has already loaded.
//
// The rule itself lives on the server: placeOrder and the cart/favorites
// rules refuse staff accounts. This only stops the page offering it.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withRepeat,
  withTiming,
  runOnJS,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';
import Sheet from './Sheet';

const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const LINE = Colors.light.border;
const DOCK = '#221C18';
const ON_DOCK = '#F3ECE3';
const ON_DOCK_MUTED = '#A99E94';
const LEAF = '#BFD6B1';

// How the dock reports its full height (strip included) to the page, so the
// page can pad its scroll content by the same amount.
export const DOCK_HEIGHT = 62;
export const STRIP_HEIGHT = 34;

/**
 * mode:
 *   'own'     — the selling store's manager: Edit listing, and the chips
 *   'foreign' — another store's manager: view only, "Not yours"
 *   'admin'   — a Platform Admin, who edits no products: view only
 */
export default function StaffPreviewDock({
  mode,
  scrollY,
  bottom,
  productStoreName,
  ownStoreName,
  stockLabel,
  mismatchCount,
  onEdit,
  onJumpToReviews,
}) {
  const reduceMotion = useReducedMotion();
  const [compact, setCompact] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const own = mode === 'own';

  // Down past the photo shrinks it, any real move up opens it again. The
  // 6pt dead zone stops a resting finger from flickering it.
  const lastY = useSharedValue(0);
  const compactNow = useSharedValue(false);
  useAnimatedReaction(
    () => scrollY.value,
    (y) => {
      const delta = y - lastY.value;
      if (Math.abs(delta) < 6) return;
      lastY.value = y;
      const next = delta > 0 && y > 120;
      // Only a change crosses to JS, not every scroll step.
      if (next !== compactNow.value) {
        compactNow.value = next;
        runOnJS(setCompact)(next);
      }
    }
  );

  // The eye breathes so the mode reads as on purpose. Still under Reduce
  // Motion.
  const breath = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    breath.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 1 - breath.value * 0.8,
    transform: [{ scale: 1 + breath.value * 0.08 }],
  }));

  const openSheet = () => {
    Haptics.selectionAsync();
    setSheetOpen(true);
  };
  // From the sheet, wait out its 300ms slide down first: the Sheet is a
  // Modal, so navigating at once would push the edit screen under a sheet
  // and backdrop that are still closing.
  const edit = () => {
    Haptics.selectionAsync();
    if (!sheetOpen) {
      onEdit?.();
      return;
    }
    setSheetOpen(false);
    setTimeout(() => onEdit?.(), reduceMotion ? 0 : 320);
  };

  const title = mode === 'foreign' ? productStoreName || 'Another store' : 'Shopper preview';
  const caption =
    mode === 'foreign' ? 'Another store · view only' : mode === 'admin' ? 'View only for staff' : 'Buying is off for staff';
  const layout = reduceMotion ? undefined : LinearTransition.duration(320).easing(EASE_OUT_QUINT);
  const showStrip = own && !compact && (stockLabel || mismatchCount > 0);

  return (
    <>
      <View style={[styles.wrap, { bottom }, compact && styles.wrapCompact]} pointerEvents="box-none">
        {showStrip ? (
          <Animated.View
            style={styles.strip}
            entering={reduceMotion ? undefined : FadeIn.duration(200)}
            exiting={reduceMotion ? undefined : FadeOut.duration(150)}
          >
            {stockLabel ? <Chip dot="#9DBE8A" label={stockLabel} /> : null}
            {mismatchCount > 0 ? (
              <Chip
                dot="#E58A66"
                label={`${mismatchCount} mismatch report${mismatchCount === 1 ? '' : 's'}`}
                onPress={onJumpToReviews}
                accessibilityHint="Scrolls to the reviews"
              />
            ) : null}
          </Animated.View>
        ) : null}

        <Animated.View layout={layout} style={[styles.dock, compact && styles.dockCompact]}>
          <Pressable
            onPress={openSheet}
            style={({ pressed }) => [styles.lens, !compact && styles.lensWide, pressed && styles.lensPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${caption}. About this view`}
          >
            <View style={[styles.eye, compact && styles.eyeCompact]}>
              <Animated.View style={[styles.eyeRing, ringStyle]} pointerEvents="none" />
              <Ionicons name="eye-outline" size={17} color={LEAF} />
            </View>
            {compact ? null : (
              <Animated.View style={styles.lensText} entering={reduceMotion ? undefined : FadeIn.duration(200)}>
                <Text style={styles.lensTitle} numberOfLines={1}>{title}</Text>
                <View style={styles.lensCaptionRow}>
                  <Text style={styles.lensCaption} numberOfLines={1}>{caption}</Text>
                  <Ionicons name="information-circle-outline" size={12} color={ON_DOCK_MUTED} />
                </View>
              </Animated.View>
            )}
          </Pressable>

          {own ? (
            <Pressable
              onPress={edit}
              style={({ pressed }) => [styles.edit, compact && styles.editCompact, pressed && { transform: [{ scale: 0.97 }] }]}
              accessibilityRole="button"
              accessibilityLabel="Edit listing"
            >
              <Ionicons name="create-outline" size={16} color="#fff" />
              <Text style={styles.editText}>Edit listing</Text>
            </Pressable>
          ) : (
            <View style={[styles.locked, compact && styles.editCompact]}>
              <Ionicons name="lock-closed-outline" size={13} color="#C9BEB2" />
              <Text style={styles.lockedText}>{mode === 'foreign' ? 'Not yours' : 'View only'}</Text>
            </View>
          )}
        </Animated.View>
      </View>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <View style={styles.sheetHead}>
          <View style={styles.sheetEye}>
            <Ionicons name="eye-outline" size={20} color={MOSS} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {mode === 'foreign' ? 'This listing belongs to another store' : 'You’re seeing what shoppers see'}
            </Text>
            <Text style={styles.sheetSub}>
              {mode === 'own'
                ? `Signed in as Store Manager${ownStoreName ? ` · ${ownStoreName}` : ''}`
                : mode === 'foreign'
                ? 'Managers can only change their own store’s products'
                : 'Signed in as Platform Admin'}
            </Text>
          </View>
        </View>

        <View style={styles.cols}>
          <View style={styles.col}>
            <ColHead icon="checkmark" label="You can" />
            {own ? <Item on label="Edit price, stock & photos" /> : null}
            <Item on label="Read every review" />
            <Item on label="Check sizes & listing copy" />
          </View>
          <View style={styles.col}>
            <ColHead icon="close" label="Turned off" />
            <Item label="Add to cart or buy" />
            <Item label="Save to favorites" />
            <Item label="Write a review" />
            {own ? null : <Item label="Edit listing" />}
          </View>
        </View>

        <View style={styles.why}>
          <Ionicons name="information-circle-outline" size={16} color={MUTED} />
          <Text style={styles.whyText}>
            {"Staff can't buy or save items, so orders, sales numbers and ratings only come from real customers."}
          </Text>
        </View>

        {own ? (
          <Pressable
            onPress={edit}
            style={({ pressed }) => [styles.sheetBtn, styles.sheetBtnPrimary, pressed && { opacity: 0.88 }]}
            accessibilityRole="button"
          >
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={[styles.sheetBtnText, { color: '#fff' }]}>Edit this listing</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setSheetOpen(false)}
          style={({ pressed }) => [styles.sheetBtn, styles.sheetBtnGhost, pressed && { backgroundColor: '#F4EEE6' }]}
          accessibilityRole="button"
        >
          <Text style={styles.sheetBtnText}>Got it</Text>
        </Pressable>
      </Sheet>
    </>
  );
}

function Chip({ dot, label, onPress, accessibilityHint }) {
  const body = (
    <>
      <View style={[styles.chipDot, { backgroundColor: dot }]} />
      <Text style={styles.chipText}>{label}</Text>
    </>
  );
  if (!onPress) return <View style={styles.chip}>{body}</View>;
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.8 }]}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
    >
      {body}
    </Pressable>
  );
}

function ColHead({ icon, label }) {
  return (
    <View style={styles.colHead}>
      <Ionicons name={icon} size={12} color={MUTED} />
      <Text style={styles.colHeadText}>{label.toUpperCase()}</Text>
    </View>
  );
}

function Item({ on, label }) {
  return (
    <View style={styles.item}>
      <Ionicons name={on ? 'checkmark' : 'close'} size={13} color={on ? MOSS : '#C9BEB2'} style={{ marginTop: 2 }} />
      <Text style={[styles.itemText, !on && { color: '#948A82' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, zIndex: 12 },
  wrapCompact: { alignItems: 'flex-end' },

  strip: { flexDirection: 'row', gap: 6, marginHorizontal: 6, marginBottom: 8, height: STRIP_HEIGHT - 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(34,28,24,0.9)',
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 11, fontWeight: '500', color: '#E9E1D6' },

  dock: {
    minHeight: DOCK_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 24,
    backgroundColor: DOCK,
    shadowColor: '#140C08',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  dockCompact: { minHeight: 52, padding: 6, borderRadius: 20 },

  lens: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 4, borderRadius: 17 },
  lensWide: { flex: 1, minWidth: 0 },
  lensPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  eye: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: 'rgba(157,190,138,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyeCompact: { width: 34, height: 34, borderRadius: 12 },
  eyeRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(157,190,138,0.35)',
  },
  lensText: { flex: 1, minWidth: 0 },
  lensTitle: { fontSize: 13, fontWeight: '600', color: ON_DOCK },
  lensCaptionRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  lensCaption: { fontSize: 11, color: ON_DOCK_MUTED, flexShrink: 1 },

  edit: {
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 17,
    backgroundColor: CLAY,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  editCompact: { height: 40, paddingHorizontal: 14 },
  editText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  locked: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lockedText: { fontSize: 12.5, fontWeight: '600', color: '#C9BEB2' },

  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetEye: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#E7ECE1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: { fontSize: 17, fontWeight: '600', color: INK, lineHeight: 22 },
  sheetSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  cols: { flexDirection: 'row', gap: 8, marginTop: 14 },
  col: { flex: 1, padding: 12, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: LINE },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  colHeadText: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1, color: '#948A82' },
  item: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  itemText: { flex: 1, fontSize: 12.5, color: MUTED, lineHeight: 17 },
  why: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#F1EBE2',
  },
  whyText: { flex: 1, fontSize: 12, color: MUTED, lineHeight: 17 },
  sheetBtn: {
    height: 50,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  sheetBtnPrimary: { backgroundColor: CLAY, marginTop: 14 },
  sheetBtnGhost: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2D8CB', marginTop: 8 },
  sheetBtnText: { fontSize: 14.5, fontWeight: '600', color: INK },
});
