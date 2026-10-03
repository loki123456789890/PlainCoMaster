// components/home/CompactHeader.js
//
// The slim bar that slides down over Home once the greeting and search have
// scrolled away, from the approved home preview: the PlainCo icon and a
// small search bar (it opens Shop with the search focused, like the big
// one), so searching never means scrolling back to the top. It slides away
// again near the top. Reduce Motion shows and hides it without the slide.
//
// Home passes its scroll offset as a shared value; the bar only re-renders
// when it crosses the threshold, not on every scroll.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';
import AnimatedPressable from '../ui/AnimatedPressable';

const APP_ICON = require('../../assets/images/icon.png');
// Past the greeting, delivery line and search bar.
export const SHOW_AFTER = 170;
const BAR_HEIGHT = 52;

export default function CompactHeader({ scrollY, onSearch }) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(false);
  const slide = useSharedValue(0);

  useAnimatedReaction(
    () => scrollY.value > SHOW_AFTER,
    (now, before) => {
      if (now !== before) runOnJS(setShown)(now);
    }
  );

  useEffect(() => {
    slide.value = reduceMotion ? (shown ? 1 : 0) : withTiming(shown ? 1 : 0, { duration: 350, easing: EASE_OUT_QUINT });
  }, [shown, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const height = insets.top + BAR_HEIGHT;
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: (slide.value - 1) * (height + 2) }],
  }));

  return (
    <Animated.View
      style={[styles.bar, { height, paddingTop: insets.top }, animated]}
      pointerEvents={shown ? 'box-none' : 'none'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
    >
      <Image source={APP_ICON} style={styles.icon} accessibilityLabel="PlainCo" />
      {/* AnimatedPressable styles an inner view, so the stretching happens
          on this wrapper. */}
      <View style={styles.searchWrap}>
        <AnimatedPressable
          style={styles.search}
          onPress={onSearch}
          rippleColor={Colors.light.border}
          accessibilityRole="search"
          accessibilityLabel="Search clothes"
        >
          <Svg width={16} height={16} viewBox="0 0 24 24">
            <Circle
              cx={11}
              cy={11}
              r={7}
              fill="none"
              stroke={Colors.light.icon}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <Path d="M20 20l-3.5-3.5" fill="none" stroke={Colors.light.icon} strokeWidth={2} strokeLinecap="round" />
          </Svg>
          <Text style={styles.searchText} numberOfLines={1}>
            Search clothes
          </Text>
        </AnimatedPressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: Colors.light.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  icon: { width: 26, height: 26, borderRadius: 8 },
  searchWrap: { flex: 1 },
  search: {
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  searchText: { fontSize: 12.5, color: '#9C938A' },
});
