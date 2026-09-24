// components/shop/StoreLogo.js
//
// A store's logo in a rounded square, or a Clay storefront tile when the
// store hasn't uploaded one. Used on the store page and a product's
// "Sold by" card.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/theme';

export default function StoreLogo({ uri, size, radius, style }) {
  if (uri) {
    return <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: radius }, style]} contentFit="cover" transition={150} />;
  }
  return (
    <View style={[{ width: size, height: size, borderRadius: radius }, styles.empty, style]}>
      <Ionicons name="storefront-outline" size={size * 0.45} color={Colors.light.tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { backgroundColor: '#F3E3DA', alignItems: 'center', justifyContent: 'center' },
});
