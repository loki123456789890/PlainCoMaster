// components/shop/TabBar.js
//
// The customer tab bar from the approved home/shop preview: Home, Shop,
// Favorites, Cart and Profile, with Clay marking the current tab and the
// cart count on the cart. Home and Shop draw it; the other three are their
// own screens with a back arrow, as before.
//
// The app is one stack, not a tab navigator, so a tab goes back to its
// screen if that screen is already open (navigate with pop) instead of
// stacking another copy on top.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import { useCart } from '../../context/CartContext';

const TABS = [
  { key: 'Home', label: 'Home', icon: 'home-outline', active: 'home' },
  { key: 'Shop', label: 'Shop', icon: 'bag-handle-outline', active: 'bag-handle' },
  { key: 'Favorites', label: 'Favorites', icon: 'heart-outline', active: 'heart' },
  { key: 'Cart', label: 'Cart', icon: 'cart-outline', active: 'cart' },
  { key: 'Profile', label: 'Profile', icon: 'person-outline', active: 'person' },
];

// Opens a tab from anywhere: back to it if it is already in the stack,
// otherwise pushed. Shop opened as a tab fades in (see App.js), like the
// preview's tab switch, rather than sliding over Home.
export function goToTab(navigation, key, params) {
  const tabParams = key === 'Shop' ? { via: 'tab', ...params } : params;
  navigation.navigate(key, tabParams, { pop: true });
}

export default function TabBar({ navigation, current }) {
  const insets = useSafeAreaInsets();
  const { cartCount } = useCart();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const on = tab.key === current;
        const color = on ? Colors.light.tint : Colors.light.icon;
        const count = tab.key === 'Cart' ? cartCount : 0;
        return (
          <Pressable
            key={tab.key}
            style={styles.tab}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              goToTab(navigation, tab.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={count > 0 ? `${tab.label}, ${count} ${count === 1 ? 'item' : 'items'}` : tab.label}
          >
            {({ pressed }) => (
              <>
                {on ? <View style={styles.dot} /> : null}
                <View style={{ transform: [{ scale: pressed ? 0.88 : 1 }, { translateY: on ? -1 : 0 }] }}>
                  <Ionicons name={on ? tab.active : tab.icon} size={23} color={color} />
                  {count > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.label, { color }, on && styles.labelOn]}>{tab.label}</Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 8,
    paddingHorizontal: 10,
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingBottom: 4, minHeight: 48 },
  // The Clay notch over the current tab.
  dot: {
    position: 'absolute',
    top: -8,
    width: 22,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: Colors.light.tint,
  },
  label: { fontSize: 10.5, fontWeight: '500' },
  labelOn: { fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: -5,
    left: 13,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: Colors.light.tint,
    borderWidth: 2,
    borderColor: Colors.light.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '600', color: '#fff' },
});
