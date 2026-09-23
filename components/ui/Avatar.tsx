import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/theme';

interface AvatarProps {
  /** A photo URL, or nothing for the icon fallback. */
  uri?: string | null;
  size?: number;
  /** What to show without a photo: a person for customers, a storefront for stores. */
  icon?: keyof typeof Ionicons.glyphMap;
}

// A round photo, or a Clay-tinted icon in the same circle when there is
// none — so a customer without a photo and a store without a logo still
// take up the same space and read as "someone", not as a missing image.
export default function Avatar({ uri, size = 40, icon = 'person' }: AvatarProps) {
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, circle]}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.fallback, circle]}>
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={Colors.light.tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: Colors.light.border },
  fallback: {
    backgroundColor: Colors.light.tint + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
