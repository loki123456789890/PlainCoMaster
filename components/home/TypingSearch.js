// components/home/TypingSearch.js
//
// Home's search bar, from the approved home preview: not a real field (it
// opens Shop with the search focused), with a placeholder that types out
// things worth searching for — "Search for denim jackets", then deletes it
// and types the next — behind a blinking Clay caret. Reduce Motion shows
// the first suggestion, still, with no caret. Typing pauses while Home is
// covered by another screen.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withDelay,
  withTiming,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Colors } from '../../constants/theme';
import AnimatedPressable from '../ui/AnimatedPressable';

const WORDS = ['denim jackets', 'ukay finds', 'loafers', 'plain white tees'];
const TYPE_MS = 80;
const DELETE_MS = 35;
const HOLD_MS = 1500;
const NEXT_MS = 300;

function useTypedWord(running) {
  const [state, setState] = useState({ word: 0, chars: 0, deleting: false });
  useEffect(() => {
    if (!running) return undefined;
    const full = WORDS[state.word];
    let delay;
    let next;
    if (!state.deleting && state.chars < full.length) {
      delay = TYPE_MS;
      next = { ...state, chars: state.chars + 1 };
    } else if (!state.deleting) {
      delay = HOLD_MS;
      next = { ...state, deleting: true };
    } else if (state.chars > 0) {
      delay = DELETE_MS;
      next = { ...state, chars: state.chars - 1 };
    } else {
      delay = NEXT_MS;
      next = { word: (state.word + 1) % WORDS.length, chars: 0, deleting: false };
    }
    const timer = setTimeout(() => setState(next), delay);
    return () => clearTimeout(timer);
  }, [running, state]);
  return WORDS[state.word].slice(0, state.chars);
}

// Same rhythm as CSS steps(2) over 1s: shown half a second, hidden half.
function Caret() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withDelay(500, withTiming(0, { duration: 0 })), withDelay(500, withTiming(1, { duration: 0 }))),
      -1
    );
    return () => cancelAnimation(opacity);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.caret, animated]} />;
}

export default function TypingSearch({ onPress }) {
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const typed = useTypedWord(focused && !reduceMotion);

  return (
    <AnimatedPressable
      style={styles.search}
      onPress={onPress}
      rippleColor={Colors.light.border}
      accessibilityRole="search"
      accessibilityLabel="Search clothes"
    >
      <Svg width={19} height={19} viewBox="0 0 24 24">
        <Circle cx={11} cy={11} r={7} fill="none" stroke={Colors.light.icon} strokeWidth={2} strokeLinecap="round" />
        <Path d="M20 20l-3.5-3.5" fill="none" stroke={Colors.light.icon} strokeWidth={2} strokeLinecap="round" />
      </Svg>
      <View style={styles.line} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={styles.prompt}>Search for </Text>
        <Text style={styles.typed} numberOfLines={1}>
          {reduceMotion ? WORDS[0] : typed}
        </Text>
        {reduceMotion ? null : <Caret />}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    paddingHorizontal: 14,
  },
  line: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  prompt: { fontSize: 14, color: '#9C938A' },
  typed: { flexShrink: 1, fontSize: 14, color: Colors.light.text },
  caret: { width: 2, height: 18, marginLeft: 2, borderRadius: 1, backgroundColor: Colors.light.tint },
});
