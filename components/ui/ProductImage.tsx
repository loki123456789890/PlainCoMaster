import React from 'react';
import { StyleProp, ImageStyle } from 'react-native';
import { Image } from 'expo-image';
import { useReducedMotion } from 'react-native-reanimated';
import { Colors } from '../../constants/theme';

interface ProductImageProps {
  /** Remote image URL. Renders the neutral placeholder block when absent. */
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  /** 'cover' (default) crops to fill; 'contain' fits the whole image in. */
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  onLoad?: () => void;
  onError?: () => void;
  accessibilityLabel?: string;
}

/**
 * Every product photograph in the app, on one component.
 *
 * WHY THIS EXISTS. Four screens — Home, Shop, Product and Favorites — each
 * carried their own near-identical `FadingImage`: a React Native Image
 * wrapped in a Reanimated opacity that faded in on load. They had drifted
 * already (different durations, two of them forwarding onError and two
 * not), and every other screen showing a thumbnail used a bare Image with
 * no fade at all.
 *
 * WHAT CHANGES BESIDES THE DEDUPLICATION, and the real reason for the
 * swap: React Native's Image has no persistent cache, so the same product
 * photo was re-downloaded every time it appeared — the catalog grid, the
 * product page, favorites, the cart, the order list. That was already
 * wasteful for an audience PRODUCT.md describes as mostly on mobile data,
 * and it got worse when product photos moved into our own Storage bucket
 * in US-EAST1 rather than sitting behind a CDN. expo-image caches to disk,
 * so a photo is fetched once and read locally afterwards.
 *
 * The fade is now expo-image's own `transition`, which runs natively
 * rather than through a shared value per image — cheaper, and it removes
 * four hand-rolled animations. It is still gated on Reduce Motion, which
 * the native transition does not check on its own.
 */
export default function ProductImage({
  uri,
  style,
  contentFit = 'cover',
  onLoad,
  onError,
  accessibilityLabel,
}: ProductImageProps) {
  const reduceMotion = useReducedMotion();

  return (
    <Image
      source={uri || undefined}
      style={[{ backgroundColor: Colors.light.border }, style]}
      contentFit={contentFit}
      // Matches the 220ms the hand-rolled fades settled on. Zero rather
      // than a shorter duration under Reduce Motion: the point is no
      // movement at all, not less of it.
      transition={reduceMotion ? 0 : 220}
      // Disk as well as memory, which is the whole point — a memory-only
      // cache is emptied every time the app is killed, and this audience
      // opens the app in short sessions rather than leaving it running.
      cachePolicy="memory-disk"
      onLoad={onLoad}
      onError={onError}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
