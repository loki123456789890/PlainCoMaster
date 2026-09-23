// components/shop/ProductCard.js
//
// One product, as Home's rails and the Shop grid show it (the approved
// home/shop preview): a 4:5 photo with the category tag and the heart on
// it, then the name and the price. Sold out is a veil over the photo and a
// struck-through price. Store name is optional — the all-stores views pass
// it, a store's own page doesn't.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';
import AnimatedPressable from '../ui/AnimatedPressable';
import ProductImage from '../ui/ProductImage';

// Same rule as the product page: only a recorded 0 is sold out; a missing
// stock value means "not tracked", not "none left".
export const isSoldOut = (product) => {
  const n = parseInt(product?.stock, 10);
  return !Number.isNaN(n) && n === 0;
};

// Heart on the photo: a dip and a settle on toggle, since favoriting
// changes state and earns more than generic press feedback.
function Heart({ favorited, onToggle, name }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const handlePress = () => {
    if (!reduceMotion) {
      scale.value = withSequence(
        withTiming(0.8, { duration: 130, easing: EASE_OUT_QUINT }),
        withTiming(1.2, { duration: 140, easing: EASE_OUT_QUART }),
        withTiming(1, { duration: 180, easing: EASE_OUT_QUART })
      );
    }
    onToggle();
  };
  return (
    <Pressable
      onPress={handlePress}
      style={styles.heartHit}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={favorited ? `Remove ${name} from favorites` : `Save ${name} to favorites`}
      accessibilityState={{ selected: favorited }}
    >
      <Animated.View style={[styles.heart, animated]}>
        <Ionicons
          name={favorited ? 'heart' : 'heart-outline'}
          size={17}
          color={favorited ? Colors.light.tint : Colors.light.text}
        />
      </Animated.View>
    </Pressable>
  );
}

// `unavailable`: a saved favorite whose product has since been removed —
// shown faded, with a note instead of a price.
export default function ProductCard({ product, favorited, storeName, onPress, onToggleFavorite, style, unavailable }) {
  const [imageFailed, setImageFailed] = useState(false);
  const isUkay = product.type === 'ukay-ukay';
  const soldOut = !unavailable && isSoldOut(product);

  return (
    <AnimatedPressable
      style={style}
      onPress={onPress}
      rippleColor={Colors.light.border}
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${unavailable ? 'no longer available' : `₱${product.price}`}${soldOut ? ', sold out' : ''}`}
    >
      <View style={[styles.photo, unavailable && styles.photoGone]}>
        {imageFailed || !product.imageUrl ? (
          <View style={styles.fallback}>
            <Ionicons name="shirt-outline" size={34} color={Colors.light.icon} />
          </View>
        ) : (
          <ProductImage
            uri={product.imageUrl}
            style={StyleSheet.absoluteFill}
            onError={() => setImageFailed(true)}
            accessibilityLabel={`Photo of ${product.name}`}
          />
        )}
        <View style={[styles.tag, { backgroundColor: isUkay ? Colors.light.secondary : Colors.light.tint }]}>
          <Text style={styles.tagText}>{isUkay ? 'Ukay' : 'RTW'}</Text>
        </View>
        <Heart favorited={favorited} onToggle={onToggleFavorite} name={product.name} />
        {soldOut ? (
          <View style={styles.soldVeil} pointerEvents="none">
            <View style={styles.soldPill}>
              <Text style={styles.soldText}>Sold out</Text>
            </View>
          </View>
        ) : null}
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      {storeName ? (
        <Text style={styles.store} numberOfLines={1}>
          {storeName}
        </Text>
      ) : null}
      {unavailable ? (
        <View style={styles.goneRow}>
          <Ionicons name="ban-outline" size={13} color={Colors.light.icon} />
          <Text style={styles.goneText}>No longer available</Text>
        </View>
      ) : (
        <Text style={[styles.price, soldOut && styles.priceSold]}>₱{Number(product.price).toLocaleString('en-PH')}</Text>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  photo: {
    aspectRatio: 4 / 5,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#EFE6DA',
  },
  photoGone: { opacity: 0.55 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tag: {
    position: 'absolute',
    left: 8,
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: { fontSize: 9.5, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: '#fff' },
  heartHit: { position: 'absolute', right: 6, top: 6 },
  heart: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(250,247,242,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(250,247,242,0.55)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  soldPill: { backgroundColor: Colors.light.text, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  soldText: {
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.light.background,
  },
  name: {
    marginTop: 8,
    marginHorizontal: 2,
    marginBottom: 2,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 17.5,
    color: Colors.light.text,
  },
  store: { marginHorizontal: 2, marginBottom: 2, fontSize: 11.5, color: Colors.light.icon },
  price: { marginHorizontal: 2, fontSize: 14.5, fontWeight: '600', color: Colors.light.highlight },
  goneRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 2, marginTop: 2 },
  goneText: { fontSize: 11.5, color: Colors.light.icon },
  priceSold: { color: '#A89F97', textDecorationLine: 'line-through' },
});
