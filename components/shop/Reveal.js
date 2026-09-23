// components/shop/Reveal.js
//
// The home/shop preview's entrance: a piece fades up 14 pt into place, or
// (for cards in a sideways rail) slides in 28 pt from the right. Runs once,
// when the screen first mounts; Reduce Motion shows everything in place.
import React, { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { EASE_OUT_QUINT } from '../../constants/motion';

export default function Reveal({ delay = 0, from = 'up', style, children }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: from === 'right' ? 700 : 600, easing: EASE_OUT_QUINT })
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => {
    const rest = 1 - progress.value;
    return {
      opacity: progress.value,
      transform: from === 'right' ? [{ translateX: rest * 28 }] : [{ translateY: rest * 14 }],
    };
  });
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
