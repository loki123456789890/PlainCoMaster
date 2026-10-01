// Full-screen photos for the product page: swipe between them, pinch or
// double-tap to zoom, drag to look around while zoomed. Each photo carries
// the label the seller gave its slot ("Back", "Flaw 2"), so a shopper knows
// what they're looking at — the point of the zoom is checking a seam, a
// tag or a flaw the way they would in a shop.
//
// Built on react-native-gesture-handler and Reanimated, both already in the
// app and in Expo Go, so nothing native is added. A Modal is its own
// window, so it gets its own GestureHandlerRootView and SafeAreaProvider
// (the same reason components/shop/Sheet.js has the latter).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, useWindowDimensions } from 'react-native';
// Gesture handler's FlatList rather than React Native's: it takes part in
// the same gesture system as the pinch, so a pinch that starts while the
// list is still can take over instead of nudging it to the next photo.
import { FlatList, Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import ProductImage from '../ui/ProductImage';
import { Colors } from '../../constants/theme';

const CREAM = Colors.light.background;
const BACKDROP = '#141211';
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

function ZoomablePhoto({ uri, width, height, active, label, onZoomChange }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  // Swiping to another photo and back finds this one unzoomed.
  useEffect(() => {
    if (active) return;
    scale.value = 1;
    savedScale.value = 1;
    x.value = 0;
    y.value = 0;
    savedX.value = 0;
    savedY.value = 0;
    setZoomed(false);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const reportZoom = (next) => {
    setZoomed(next);
    onZoomChange(next);
  };

  const animate = (value) => {
    'worklet';
    return reduceMotion ? value : withTiming(value, { duration: 220 });
  };

  // How far the photo can move at a scale before its edge leaves the
  // screen's edge. The photo is fitted ('contain'), so this is measured on
  // the frame rather than the image, which keeps it right for any shape.
  const settle = (s) => {
    'worklet';
    const maxX = (width * (s - 1)) / 2;
    const maxY = (height * (s - 1)) / 2;
    const nextX = Math.min(Math.max(x.value, -maxX), maxX);
    const nextY = Math.min(Math.max(y.value, -maxY), maxY);
    x.value = animate(nextX);
    y.value = animate(nextY);
    savedX.value = nextX;
    savedY.value = nextY;
  };

  // Zooms about the fingers rather than the middle of the screen: the
  // point under them stays under them, so pinching a cuff enlarges the cuff.
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      focalX.value = e.focalX - width / 2;
      focalY.value = e.focalY - height / 2;
    })
    .onUpdate((e) => {
      const next = Math.min(Math.max(savedScale.value * e.scale, 1), MAX_SCALE);
      const k = next / savedScale.value;
      scale.value = next;
      x.value = focalX.value - (focalX.value - savedX.value) * k;
      y.value = focalY.value - (focalY.value - savedY.value) * k;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = animate(1);
        savedScale.value = 1;
        settle(1);
        runOnJS(reportZoom)(false);
      } else {
        settle(scale.value);
        runOnJS(reportZoom)(true);
      }
    });

  // Only while zoomed. Unzoomed, a drag belongs to the list, which swipes
  // to the next photo.
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .averageTouches(true)
    .onUpdate((e) => {
      x.value = savedX.value + e.translationX;
      y.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
      settle(scale.value);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1.02) {
        scale.value = animate(1);
        savedScale.value = 1;
        x.value = animate(0);
        y.value = animate(0);
        savedX.value = 0;
        savedY.value = 0;
        runOnJS(reportZoom)(false);
        return;
      }
      const fx = e.x - width / 2;
      const fy = e.y - height / 2;
      const maxX = (width * (DOUBLE_TAP_SCALE - 1)) / 2;
      const maxY = (height * (DOUBLE_TAP_SCALE - 1)) / 2;
      const nextX = Math.min(Math.max(fx * (1 - DOUBLE_TAP_SCALE), -maxX), maxX);
      const nextY = Math.min(Math.max(fy * (1 - DOUBLE_TAP_SCALE), -maxY), maxY);
      scale.value = animate(DOUBLE_TAP_SCALE);
      savedScale.value = DOUBLE_TAP_SCALE;
      x.value = animate(nextX);
      y.value = animate(nextY);
      savedX.value = nextX;
      savedY.value = nextY;
      runOnJS(reportZoom)(true);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <View style={{ width, height, overflow: 'hidden' }} collapsable={false}>
        <Animated.View style={[StyleSheet.absoluteFill, style]}>
          <ProductImage
            uri={uri}
            style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}
            contentFit="contain"
            accessibilityLabel={label}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function ViewerFrame({ photos, initialIndex, productName, onClose }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const [zoomed, setZoomed] = useState(false);
  const listRef = useRef(null);
  const current = photos[index];

  const go = (next) => {
    if (next < 0 || next >= photos.length) return;
    Haptics.selectionAsync();
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  };

  return (
    <View style={styles.frame}>
      <FlatList
        ref={listRef}
        data={photos}
        keyExtractor={(photo, i) => `${i}-${photo.url}`}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        // Only the photos either side of the one shown are fetched, not the
        // whole set: the audience is mostly on mobile data.
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        renderItem={({ item, index: i }) => (
          <ZoomablePhoto
            uri={item.url}
            width={width}
            height={height}
            active={i === index}
            label={`${item.label}, photo ${i + 1} of ${photos.length}, of ${productName}. Pinch or double-tap to zoom.`}
            onZoomChange={setZoomed}
          />
        )}
      />

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.round, pressed && { transform: [{ scale: 0.92 }] }]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Close photos"
        >
          <Ionicons name="close" size={22} color={CREAM} />
        </Pressable>
        {photos.length > 1 ? (
          <Text style={styles.count} accessibilityLiveRegion="polite">
            {index + 1} / {photos.length}
          </Text>
        ) : null}
        <View style={{ width: 42 }} />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 18 }]} pointerEvents="box-none">
        <View style={styles.caption}>
          <Text style={[styles.captionText, current?.kind === 'flaw' && styles.captionFlaw]}>{current?.label}</Text>
        </View>
        {photos.length > 1 ? (
          <View style={styles.thumbs}>
            {photos.map((photo, i) => (
              <Pressable
                key={`${i}-${photo.url}`}
                onPress={() => go(i)}
                style={[styles.thumb, i === index && styles.thumbOn]}
                accessibilityRole="button"
                accessibilityLabel={`Show ${photo.label}`}
                accessibilityState={{ selected: i === index }}
              >
                <ProductImage uri={photo.url} style={StyleSheet.absoluteFill} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {!zoomed ? <Text style={styles.hint}>Pinch or double-tap to zoom</Text> : null}
      </View>
    </View>
  );
}

export default function PhotoViewer({ visible, photos, initialIndex = 0, productName, onClose }) {
  if (!visible || !photos?.length) return null;
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['portrait']}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ViewerFrame
            photos={photos}
            initialIndex={Math.min(Math.max(initialIndex, 0), photos.length - 1)}
            productName={productName}
            onClose={onClose}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: BACKDROP },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(250,247,242,0.14)',
  },
  count: { fontSize: 14, fontWeight: '600', color: CREAM },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  caption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(20,18,17,0.7)',
  },
  captionText: { fontSize: 13.5, fontWeight: '600', color: CREAM },
  captionFlaw: { color: '#F1D9A8' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    opacity: 0.6,
  },
  thumbOn: { borderColor: CREAM, opacity: 1 },
  hint: { fontSize: 11.5, color: 'rgba(250,247,242,0.6)' },
});
