// components/admin/Segmented.js
//
// The segmented control from the store-tools preview: equal-width tabs on a
// sand track, each with a count, and a white pill that slides under the
// selected one. Reviews (Reported / All / Hidden) and Support (Open /
// Resolved / All) use it.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';

const PAD = 4;
const GAP = 4;

// items: [{ key, label, count }]
export default function Segmented({ items, value, onChange }) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    items.findIndex((item) => item.key === value)
  );
  const segWidth = width ? (width - PAD * 2 - GAP * (items.length - 1)) / items.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    const target = index * (segWidth + GAP);
    x.value = reduceMotion || !segWidth ? target : withTiming(target, { duration: 350, easing: EASE_OUT_QUINT });
  }, [index, segWidth]); // eslint-disable-line react-hooks/exhaustive-deps

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {segWidth ? <Animated.View style={[styles.pill, { width: segWidth }, pill]} /> : null}
      {items.map((item) => {
        const on = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              onChange(item.key);
            }}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${item.label}, ${item.count}`}
          >
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={styles.count}>
              <Text style={styles.countText}>{item.count}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: GAP,
    padding: PAD,
    borderRadius: 14,
    backgroundColor: '#EFE9E0',
    marginBottom: 12,
  },
  pill: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: Colors.light.text,
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  item: {
    flex: 1,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  label: { fontSize: 12.5, fontWeight: '500', color: Colors.light.icon },
  labelOn: { fontWeight: '600', color: Colors.light.text },
  count: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: 'rgba(28,27,26,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 10.5, fontWeight: '600', color: Colors.light.text },
});
