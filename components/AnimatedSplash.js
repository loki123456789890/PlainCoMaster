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
import * as SplashScreen from 'expo-splash-screen';
import { Colors } from '../constants/theme';
import { EASE_OUT_QUINT } from '../constants/motion';

const MARK = require('../assets/images/splash-mark.png');
const WORDMARK = require('../assets/images/splash-wordmark.png');
const DOT = require('../assets/images/splash-dot.png');

// Geometry, in points from the centre of the screen, taken from the
// approved splash-preview.html so the two stay frame-for-frame identical.
const MARK_SIZE = 120;
const MARK_END_X = -107.7;
const MARK_END_SCALE = 0.6;
const WORD = { x: -57.7, y: -22.3, w: 201.3, h: 56.3, slideFrom: -24 };
const DOT_BOX = { x: 29.6, y: -25.0, w: 10.0, h: 9.7, dropFrom: -22 };

// Timings (ms), also from the preview.
const MARK_MS = 450;
const WORD_DELAY = 250;
const WORD_MS = 500;
const DOT_DELAY = 700;
const DOT_MS = 420;
const FADE_DELAY = 1350;
const FADE_MS = 250;

/**
 * The launch splash, animated: the Clay tile shrinks and steps left,
 * "plaınco" slides out from behind it, and the Clay dot drops onto the
 * dotless i. Then the whole thing fades into the app beneath.
 *
 * Two layers make one splash. The OS shows a still image while the app
 * loads — app.json's expo-splash-screen config draws this component's
 * first frame (the tile, 120 pt, centred on Canvas) — and this overlay
 * takes over on its first layout, so the hand-off is invisible and the
 * animation starts from exactly what was already on screen.
 */
export default function AnimatedSplash({ onFinish }) {
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState(null);

  const markX = useSharedValue(0);
  const markScale = useSharedValue(1);
  const wordX = useSharedValue(WORD.slideFrom);
  const wordOpacity = useSharedValue(0);
  const dotY = useSharedValue(DOT_BOX.dropFrom);
  const dotOpacity = useSharedValue(0);
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    if (!size) return;
    SplashScreen.hideAsync().catch(() => {});

    const finish = (done) => {
      'worklet';
      if (done) runOnJS(onFinish)();
    };

    // Reduce Motion: the finished lockup, held briefly, then the fade.
    if (reduceMotion) {
      markX.value = MARK_END_X;
      markScale.value = MARK_END_SCALE;
      wordX.value = 0;
      wordOpacity.value = 1;
      dotY.value = 0;
      dotOpacity.value = 1;
      overlayOpacity.value = withDelay(700, withTiming(0, { duration: FADE_MS }, finish));
      return;
    }

    markX.value = withTiming(MARK_END_X, { duration: MARK_MS, easing: EASE_OUT_QUINT });
    markScale.value = withTiming(MARK_END_SCALE, { duration: MARK_MS, easing: EASE_OUT_QUINT });

    wordX.value = withDelay(WORD_DELAY, withTiming(0, { duration: WORD_MS, easing: EASE_OUT_QUINT }));
    wordOpacity.value = withDelay(WORD_DELAY, withTiming(1, { duration: WORD_MS, easing: EASE_OUT_QUINT }));

    // The preview's keyframes: fall to rest at 55%, bounce up 5 pt at 75%,
    // settle at 100%, fading in over the first 30%. Linear between them.
    dotY.value = withDelay(
      DOT_DELAY,
      withSequence(
        withTiming(0, { duration: DOT_MS * 0.55, easing: Easing.linear }),
        withTiming(-5, { duration: DOT_MS * 0.2, easing: Easing.linear }),
        withTiming(0, { duration: DOT_MS * 0.25, easing: Easing.linear })
      )
    );
    dotOpacity.value = withDelay(DOT_DELAY, withTiming(1, { duration: DOT_MS * 0.3, easing: Easing.linear }));

    overlayOpacity.value = withDelay(
      FADE_DELAY,
      withTiming(0, { duration: FADE_MS, easing: Easing.out(Easing.ease) }, finish)
    );
    // Runs once, on first layout. Shared values are stable refs, and a
    // splash that restarted when a prop changed would be a bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
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
      {size ? (
        <>
          <Animated.View
            style={[
              styles.abs,
              { left: cx - MARK_SIZE / 2, top: cy - MARK_SIZE / 2, width: MARK_SIZE, height: MARK_SIZE },
              markStyle,
            ]}
          >
            <Image source={MARK} style={styles.fill} contentFit="contain" />
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
              <Image source={WORDMARK} style={styles.fill} contentFit="contain" />
            </Animated.View>
          </View>

          <Animated.View
            style={[
              styles.abs,
              { left: cx + DOT_BOX.x, top: cy + DOT_BOX.y, width: DOT_BOX.w, height: DOT_BOX.h },
              dotStyle,
            ]}
          >
            <Image source={DOT} style={styles.fill} contentFit="contain" />
          </Animated.View>
        </>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Canvas, the app's own background, so the fade reveals the Landing
  // screen without a colour change.
  overlay: { backgroundColor: Colors.light.background, zIndex: 1000, elevation: 1000 },
  abs: { position: 'absolute' },
  clip: { overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
});
