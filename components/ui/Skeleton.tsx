import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import { Colors } from '../../constants/theme';

interface SkeletonBlockProps {
  style?: StyleProp<ViewStyle>;
  /** Fill color for the placeholder. Defaults to the app's neutral border tone. */
  color?: string;
}

/**
 * Calm opacity "breathing" placeholder (not a shimmer sweep) used for every
 * loading skeleton across the app. Previously copy-pasted per screen;
 * consolidated so loading states read identically everywhere.
 */
export default function SkeletonBlock({ style, color = Colors.light.border }: SkeletonBlockProps) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(reduceMotion ? 0.7 : 0.55);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View style={[style, { backgroundColor: color }, animatedStyle]} />;
}
