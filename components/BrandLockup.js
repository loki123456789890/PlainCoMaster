import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

export const LOCKUP_MARK = require('../assets/images/splash-mark.png');
export const LOCKUP_WORDMARK = require('../assets/images/splash-wordmark.png');
export const LOCKUP_DOT = require('../assets/images/splash-dot.png');

// Geometry of the lockup, in points from the centre of the screen, taken
// from the approved splash/landing previews. The splash animates these;
// Landing draws their end state. One set of numbers, so the two can't
// drift apart and the hand-off lands on the same pixels.
export const MARK_SIZE = 120;
export const MARK_END_X = -107.7;
export const MARK_END_SCALE = 0.6;
export const WORD = { x: -57.7, y: -22.3, w: 201.3, h: 56.3, slideFrom: -24 };
export const DOT_BOX = { x: 29.6, y: -25.0, w: 10.0, h: 9.7, dropFrom: -22 };

// The lockup's size in Landing's header, and where its centre sits: just
// under the status bar, whatever the phone. (The preview's fixed "-330 px"
// only fits one phone height.)
export const HEADER_SCALE = 0.55;
export const headerCenterY = (topInset) => topInset + 44;

// The lockup at rest, as Landing's header. Laid out exactly like the
// splash's final frame — a full-screen layer, scaled about the screen's
// centre and moved up — rather than as a separately sized header, so the
// two are the same picture by construction.
export function StaticLockup({ width, height, topInset, style }) {
  const cx = width / 2;
  const cy = height / 2;
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { transform: [{ translateY: headerCenterY(topInset) - cy }, { scale: HEADER_SCALE }] },
        style,
      ]}
      accessible
      accessibilityRole="header"
      accessibilityLabel="PlainCo"
    >
      <View
        style={[
          styles.abs,
          {
            left: cx - MARK_SIZE / 2,
            top: cy - MARK_SIZE / 2,
            width: MARK_SIZE,
            height: MARK_SIZE,
            transform: [{ translateX: MARK_END_X }, { scale: MARK_END_SCALE }],
          },
        ]}
      >
        <Image source={LOCKUP_MARK} style={styles.fill} contentFit="contain" />
      </View>
      <View style={[styles.abs, { left: cx + WORD.x, top: cy + WORD.y, width: WORD.w, height: WORD.h }]}>
        <Image source={LOCKUP_WORDMARK} style={styles.fill} contentFit="contain" />
      </View>
      <View style={[styles.abs, { left: cx + DOT_BOX.x, top: cy + DOT_BOX.y, width: DOT_BOX.w, height: DOT_BOX.h }]}>
        <Image source={LOCKUP_DOT} style={styles.fill} contentFit="contain" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  fill: { width: '100%', height: '100%' },
});
