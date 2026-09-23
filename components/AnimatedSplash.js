import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  useReducedMotion,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { Colors } from '../constants/theme';
import { EASE_OUT_QUINT } from '../constants/motion';
import { splashHandoff } from '../utils/splashHandoff';
import {
  LOCKUP_MARK,
  LOCKUP_WORDMARK,
  LOCKUP_DOT,
  MARK_SIZE,
  MARK_END_X,
  MARK_END_SCALE,
  WORD,
  DOT_BOX,
  HEADER_SCALE,
  headerCenterY,
} from './BrandLockup';

// Timings (ms), from the approved previews.
const MARK_MS = 450;
const WORD_DELAY = 250;
const WORD_MS = 500;
const DOT_DELAY = 700;
const DOT_MS = 420;
const EXIT_AT = 1350;
const GLIDE_MS = 650;
const FADE_MS = 250;

/**
 * The launch splash, animated: the Clay tile shrinks and steps left,
 * "plaınco" slides out from behind it, and the Clay dot drops onto the
 * dotless i. Then one of two exits:
 *
 *   - Landing is showing: the lockup glides up and becomes Landing's
 *     header while the Canvas behind it dissolves into Landing's own
 *     Canvas — the approved landing preview's hand-off.
 *   - anywhere else (a signed-in user going straight to Home): the whole
 *     thing fades, since there is no header for the lockup to become.
 *
 * Two layers make one splash. The OS shows a still image while the app
 * loads — app.json's expo-splash-screen config draws this component's
 * first frame (the tile, 120 pt, centred on Canvas) — and this overlay
 * takes over on its first layout, so the hand-off is invisible.
 */
export default function AnimatedSplash({ onFinish }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState(null);

  const markX = useSharedValue(0);
  const markScale = useSharedValue(1);
  const wordX = useSharedValue(WORD.slideFrom);
  const wordOpacity = useSharedValue(0);
  const dotY = useSharedValue(DOT_BOX.dropFrom);
  const dotOpacity = useSharedValue(0);
  const lockY = useSharedValue(0);
  const lockScale = useSharedValue(1);
  const backdropOpacity = useSharedValue(1);
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    if (!size) return undefined;
    SplashScreen.hideAsync().catch(() => {});
    splashHandoff.markStarted();

    const done = () => {
      splashHandoff.finish();
      onFinish();
    };
    const doneWorklet = (finished) => {
      'worklet';
      if (finished) runOnJS(done)();
    };

    if (reduceMotion) {
      markX.value = MARK_END_X;
      markScale.value = MARK_END_SCALE;
      wordX.value = 0;
      wordOpacity.value = 1;
      dotY.value = 0;
      dotOpacity.value = 1;
    } else {
      markX.value = withTiming(MARK_END_X, { duration: MARK_MS, easing: EASE_OUT_QUINT });
      markScale.value = withTiming(MARK_END_SCALE, { duration: MARK_MS, easing: EASE_OUT_QUINT });
      wordX.value = withDelay(WORD_DELAY, withTiming(0, { duration: WORD_MS, easing: EASE_OUT_QUINT }));
      wordOpacity.value = withDelay(WORD_DELAY, withTiming(1, { duration: WORD_MS, easing: EASE_OUT_QUINT }));
      // The preview's keyframes: fall to rest at 55%, bounce up 5 pt at
      // 75%, settle at 100%, fading in over the first 30%.
      dotY.value = withDelay(
        DOT_DELAY,
        withSequence(
          withTiming(0, { duration: DOT_MS * 0.55, easing: Easing.linear }),
          withTiming(-5, { duration: DOT_MS * 0.2, easing: Easing.linear }),
          withTiming(0, { duration: DOT_MS * 0.25, easing: Easing.linear })
        )
      );
      dotOpacity.value = withDelay(DOT_DELAY, withTiming(1, { duration: DOT_MS * 0.3, easing: Easing.linear }));
    }

    // Which exit is decided when it is due, not at launch: Landing only
    // knows whether it is showing once the saved session has resolved.
    const timer = setTimeout(() => {
      if (splashHandoff.isLandingReady()) {
        const toY = headerCenterY(insets.top) - size.height / 2;
        const duration = reduceMotion ? 1 : GLIDE_MS;
        backdropOpacity.value = withTiming(0, { duration: reduceMotion ? 1 : FADE_MS });
        lockScale.value = withTiming(HEADER_SCALE, { duration, easing: EASE_OUT_QUINT });
        lockY.value = withTiming(toY, { duration, easing: EASE_OUT_QUINT }, doneWorklet);
      } else {
        overlayOpacity.value = withTiming(0, { duration: FADE_MS, easing: Easing.out(Easing.ease) }, doneWorklet);
      }
    }, reduceMotion ? 700 : EXIT_AT);

    return () => clearTimeout(timer);
    // Runs once, on first layout. Shared values are stable refs, and a
    // splash that restarted when a prop changed would be a bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const lockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lockY.value }, { scale: lockScale.value }],
  }));
  const markStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: markX.value }, { scale: markScale.value }],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ translateX: wordX.value }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
    transform: [{ translateY: dotY.value }],
  }));

  const cx = size ? size.width / 2 : 0;
  const cy = size ? size.height / 2 : 0;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
      pointerEvents="none"
      onLayout={(e) => {
        if (!size) setSize(e.nativeEvent.layout);
      }}
      accessible
      accessibilityLabel="PlainCo"
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      {size ? (
        <Animated.View style={[StyleSheet.absoluteFill, lockStyle]}>
          <Animated.View
            style={[
              styles.abs,
              { left: cx - MARK_SIZE / 2, top: cy - MARK_SIZE / 2, width: MARK_SIZE, height: MARK_SIZE },
              markStyle,
            ]}
          >
            <Image source={LOCKUP_MARK} style={styles.fill} contentFit="contain" />
          </Animated.View>

          {/* The wordmark slides out from behind a clip, so it appears to
              come from the tile rather than fade in beside it. */}
          <View
            style={[
              styles.abs,
              styles.clip,
              { left: cx + WORD.x, top: cy + WORD.y, width: WORD.w, height: WORD.h },
            ]}
          >
            <Animated.View style={[styles.fill, wordStyle]}>
              <Image source={LOCKUP_WORDMARK} style={styles.fill} contentFit="contain" />
            </Animated.View>
          </View>

          <Animated.View
            style={[
              styles.abs,
              { left: cx + DOT_BOX.x, top: cy + DOT_BOX.y, width: DOT_BOX.w, height: DOT_BOX.h },
              dotStyle,
            ]}
          >
            <Image source={LOCKUP_DOT} style={styles.fill} contentFit="contain" />
          </Animated.View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, elevation: 1000 },
  // Canvas, Landing's own background, so dissolving it changes nothing
  // but what shows through.
  backdrop: { backgroundColor: Colors.light.background },
  abs: { position: 'absolute' },
  clip: { overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
});
