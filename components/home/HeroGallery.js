// components/home/HeroGallery.js
//
// The photo gallery at the top of Home, from the approved home preview: a
// few real listings, one at a time, story-style. Each slide is the product
// photo slowly settling from a slight zoom, under a dark fade, with a small
// note ("Just in", "One of a kind", "New at <store>"), the name, a line
// about it, the price and a View button. Slides change by themselves every
// 4.5 s; bars along the top show how far along each one is.
//
// Touch, as in the preview: tap the left third to go back and anywhere else
// to go forward, swipe either way, tap a bar to jump to that slide, and
// press and hold to pause. Reduce Motion keeps it still: no auto-advance,
// zoom or fades, though tapping and swiping still change slides. It also
// pauses while Home is covered by another screen.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  cancelAnimation,
  runOnJS,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { useIsFocused } from '@react-navigation/native';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';
import ProductImage from '../ui/ProductImage';
import { isJustIn, isSoldOut } from '../shop/ProductCard';

export const HERO_HEIGHT = 300;
const SLIDES = 3;
const SLIDE_MS = 4500;
const FADE_MS = 700;
const ZOOM_MS = 6000;
const SWIPE_PX = 40;
const TAP_MS = 250;

// "S", "S and M", "S, M and L".
const listOf = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

const aboutLine = (product, store) => {
  if (product.type === 'ukay-ukay') return store ? `Pre-loved, from ${store}` : 'Pre-loved';
  const sizes = Array.isArray(product.sizes) ? product.sizes.filter((s) => typeof s === 'string' && s) : [];
  if (sizes.length && sizes.length <= 4) {
    return `Brand-new, in ${sizes.length === 1 ? 'size' : 'sizes'} ${listOf(sizes)}`;
  }
  return store ? `Brand-new, from ${store}` : 'Brand-new';
};

// Three listings worth a look, each one only once: the newest; a one-of-a-
// kind ukay piece; a ready-to-wear piece, named by its store; then the next
// newest to fill any gap. Only in-stock listings with a photo — the slide is
// the photo.
export function pickSlides(products, storeNameOf) {
  const pool = products.filter((p) => p.imageUrl && !isSoldOut(p));
  const picked = [];
  const used = new Set();
  const take = (product, kicker, line) => {
    if (!product || used.has(product.id) || picked.length >= SLIDES) return;
    used.add(product.id);
    picked.push({ product, kicker, line });
  };
  const fresh = (p) => (isJustIn(p) ? 'Just in' : 'New arrival');
  const unused = (test) => pool.find((p) => !used.has(p.id) && test(p));

  const newest = pool[0];
  if (newest) take(newest, fresh(newest), aboutLine(newest, storeNameOf(newest)));
  const oneOff = unused((p) => p.type === 'ukay-ukay' && parseInt(p.stock, 10) === 1);
  if (oneOff) {
    const store = storeNameOf(oneOff);
    take(oneOff, 'One of a kind', store ? `Only one, from ${store}` : 'Only one in stock');
  }
  const rtw = unused((p) => p.type === 'ready-to-wear');
  if (rtw) {
    const store = storeNameOf(rtw);
    take(rtw, store ? `New at ${store}` : 'Ready-to-wear', aboutLine(rtw, store));
  }
  pool.forEach((p) => take(p, fresh(p), aboutLine(p, storeNameOf(p))));
  return picked;
}

function ArrowIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24">
      <Path
        d="M5 12h14M13 6l6 6-6 6"
        fill="none"
        stroke={Colors.light.text}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// One caption line rising into place, a beat after the slide arrives.
function useRise(active, still, delay) {
  const t = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (still) {
      t.value = active ? 1 : 0;
    } else if (active) {
      t.value = 0;
      t.value = withDelay(delay, withTiming(1, { duration: 600, easing: EASE_OUT_QUINT }));
    } else {
      t.value = withTiming(0, { duration: 300 });
    }
  }, [active, still]); // eslint-disable-line react-hooks/exhaustive-deps
  return useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateY: (1 - t.value) * 14 }] }));
}

function Slide({ slide, active, still, onView }) {
  const { product, kicker, line } = slide;
  const shown = useSharedValue(active ? 1 : 0);
  const zoom = useSharedValue(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (still) {
      cancelAnimation(zoom);
      shown.value = active ? 1 : 0;
      zoom.value = 1;
      return;
    }
    shown.value = withTiming(active ? 1 : 0, { duration: FADE_MS, easing: EASE_OUT_QUINT });
    if (active) {
      zoom.value = 1.12;
      zoom.value = withTiming(1, { duration: ZOOM_MS, easing: Easing.linear });
    }
  }, [active, still]); // eslint-disable-line react-hooks/exhaustive-deps

  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  const kenBurns = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));
  const title = useRise(active, still, 150);
  const about = useRise(active, still, 220);
  const row = useRise(active, still, 300);
  const price = `₱${Number(product.price).toLocaleString('en-PH')}`;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, fade]} pointerEvents={active ? 'box-none' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, kenBurns]} pointerEvents="none">
        {failed ? null : (
          <ProductImage
            uri={product.imageUrl}
            style={StyleSheet.absoluteFill}
            onError={() => setFailed(true)}
            accessibilityLabel={`Photo of ${product.name}`}
          />
        )}
      </Animated.View>
      <LinearGradient
        colors={['rgba(20,16,14,0.15)', 'rgba(20,16,14,0.35)', 'rgba(20,16,14,0.88)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.caption} pointerEvents="box-none">
        <View style={styles.kicker} pointerEvents="none">
          <View style={styles.kickerDot} />
          <Text style={styles.kickerText} numberOfLines={1}>
            {kicker}
          </Text>
        </View>
        <Animated.Text style={[styles.title, title]} numberOfLines={2} pointerEvents="none">
          {product.name}
        </Animated.Text>
        <Animated.Text style={[styles.about, about]} numberOfLines={1} pointerEvents="none">
          {line}
        </Animated.Text>
        <Animated.View style={[styles.row, row]} pointerEvents="box-none">
          <Text style={styles.price}>{price}</Text>
          <Pressable
            onPress={() => onView(product)}
            style={({ pressed }) => [styles.view, pressed && styles.viewPressed]}
            accessibilityRole="button"
            accessibilityLabel={`View ${product.name}, ${price}`}
          >
            <Text style={styles.viewText}>View</Text>
            <ArrowIcon />
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function Bar({ state, progress, onPress, label }) {
  const fill = useAnimatedStyle(() => ({
    width: `${(state === 'done' ? 1 : state === 'run' ? progress.value : 0) * 100}%`,
  }));
  return (
    <Pressable
      style={styles.barHit}
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 12 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: state === 'run' }}
    >
      <View style={styles.bar}>
        <Animated.View style={[styles.barFill, fill]} />
      </View>
    </Pressable>
  );
}

export default function HeroGallery({ slides, onView, style }) {
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  // Bumped on every jump, so jumping to the slide already showing (its own
  // bar) still restarts it.
  const [turn, setTurn] = useState(0);
  const progress = useSharedValue(0);
  const heroRef = useRef(null);
  const frame = useRef({ x: 0, width: 0 });
  const touch = useRef(null);

  // Fewer slides after a catalogue update: stay on a slide that exists.
  const current = count ? index % count : 0;
  const running = focused && !reduceMotion && !held && count > 1;

  const advance = useCallback(() => {
    progress.value = 0;
    setIndex((i) => i + 1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fills the current bar from wherever it is now, so a hold resumes where it
  // paused; a full bar moves on to the next slide.
  useEffect(() => {
    if (!running) {
      cancelAnimation(progress);
      return undefined;
    }
    progress.value = withTiming(
      1,
      { duration: SLIDE_MS * (1 - progress.value), easing: Easing.linear },
      (done) => {
        if (done) runOnJS(advance)();
      }
    );
    return () => cancelAnimation(progress);
  }, [running, current, turn, advance]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (i) => {
    cancelAnimation(progress);
    progress.value = 0;
    setIndex(((i % count) + count) % count);
    setTurn((t) => t + 1);
  };

  const measure = () => {
    heroRef.current?.measureInWindow((x, y, width) => {
      frame.current = { x, width };
    });
  };

  const onGrant = (e) => {
    touch.current = { x: e.nativeEvent.pageX, at: Date.now() };
    setHeld(true);
  };
  const onRelease = (e) => {
    const start = touch.current;
    touch.current = null;
    setHeld(false);
    if (!start || count < 2) return;
    const dx = e.nativeEvent.pageX - start.x;
    if (Math.abs(dx) > SWIPE_PX) {
      goTo(current + (dx < 0 ? 1 : -1));
    } else if (Date.now() - start.at < TAP_MS) {
      const { x, width } = frame.current;
      const back = width > 0 && e.nativeEvent.pageX - x < width * 0.3;
      goTo(current + (back ? -1 : 1));
    }
  };
  // The page scrolled instead: just let go of the pause.
  const onTerminate = () => {
    touch.current = null;
    setHeld(false);
  };

  if (!count) return null;

  return (
    <View
      ref={heroRef}
      onLayout={measure}
      style={[styles.hero, style]}
      onStartShouldSetResponder={() => true}
      onResponderGrant={onGrant}
      onResponderRelease={onRelease}
      onResponderTerminate={onTerminate}
      onResponderTerminationRequest={() => true}
    >
      {slides.map((slide, i) => (
        <Slide
          key={slide.product.id}
          slide={slide}
          active={i === current}
          still={reduceMotion}
          onView={onView}
        />
      ))}
      {count > 1 ? (
        <View style={styles.bars}>
          {slides.map((slide, i) => (
            <Bar
              key={slide.product.id}
              state={i < current ? 'done' : i === current ? (reduceMotion ? 'done' : 'run') : 'idle'}
              progress={progress}
              onPress={() => goTo(i)}
              label={`Show ${slide.product.name}, ${i + 1} of ${count}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: HERO_HEIGHT, borderRadius: 28, overflow: 'hidden', backgroundColor: '#2B2622' },

  bars: { position: 'absolute', top: 12, left: 14, right: 14, flexDirection: 'row', gap: 5 },
  barHit: { flex: 1 },
  bar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2, backgroundColor: '#FFFFFF' },

  caption: { position: 'absolute', left: 18, right: 18, bottom: 16 },
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginBottom: 8,
  },
  kickerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F0B79E' },
  kickerText: {
    flexShrink: 1,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#FFFFFF',
  },
  title: { fontSize: 25, fontWeight: '600', letterSpacing: -0.5, lineHeight: 29, color: '#FFFFFF' },
  about: { marginTop: 4, marginBottom: 12, fontSize: 12.5, color: 'rgba(255,255,255,0.85)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  price: { fontSize: 19, fontWeight: '600', color: '#F1D98A' },
  view: {
    marginLeft: 'auto',
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  viewText: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
});
