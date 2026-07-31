import React from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle, GestureResponderEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';

interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  disabled?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  /** Android ripple tint. Defaults to the app's neutral border color; pass
   * a light/white tint for pressables that sit on photos or dark overlays,
   * or `undefined` explicitly to suppress the ripple entirely. */
  rippleColor?: string;
}

/**
 * One consistent scale-down press across the whole app (customer + admin).
 * Every screen used to copy-paste this with drifting scale values
 * (0.9-0.97) and inconsistent Android ripple coverage — consolidated here
 * so every tap feels like the same product.
 *
 * Never pass an `entering`/`exiting` prop directly — a layout animation and
 * this component's own transform:scale press feedback can't safely share
 * one Animated.View (Reanimated will warn that one may clobber the other).
 * Callers that need a layout animation wrap this component from the
 * outside with their own plain, unstyled <Animated.View entering={...}>.
 */
export default function AnimatedPressable({
  style,
  onPress,
  children,
  disabled,
  rippleColor = Colors.light.border,
  ...rest
}: AnimatedPressableProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (reduceMotion || disabled) return;
    scale.value = withTiming(0.96, { duration: 100, easing: EASE_OUT_QUINT });
  };
  const handlePressOut = () => {
    if (reduceMotion || disabled) return;
    scale.value = withTiming(1, { duration: 150, easing: EASE_OUT_QUART });
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      android_ripple={rippleColor ? { color: rippleColor } : undefined}
      {...rest}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
