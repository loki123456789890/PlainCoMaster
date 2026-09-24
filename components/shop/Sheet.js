// components/shop/Sheet.js
//
// A sheet that rises from the bottom over a dimmed backdrop, with a grab
// bar, as in the approved previews. It stays mounted through its closing
// slide. `locked` stops the backdrop and Android back from closing it (while
// something is being sent, say). `dark` draws it on ink, for the Staff
// Portal. `footer` stays pinned under the scrolling content, where the
// thumb reaches it (the order sheet's "Mark as shipped").
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, Modal, KeyboardAvoidingView, ScrollView, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';

export default function Sheet({ visible, onClose, locked, dark, footer, children }) {
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = reduceMotion ? 1 : withTiming(1, { duration: 450, easing: EASE_OUT_QUINT });
    } else if (mounted) {
      if (reduceMotion) {
        progress.value = 0;
        setMounted(false);
      } else {
        progress.value = withTiming(0, { duration: 300, easing: EASE_OUT_QUINT }, (done) => {
          if (done) runOnJS(setMounted)(false);
        });
      }
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;
  const close = () => !locked && onClose();
  return (
    // Translucent bars: the app is edge-to-edge, so the sheet runs under
    // Android's navigation bar and pads by the inset once. Without these the
    // Modal stops above the bar and the inset padding is added a second time.
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      {/* A Modal is its own window, so it gets its own provider: the app's
          insets are measured for the main window and can read 0 in here,
          which put the last row under the navigation controls. */}
      <SafeAreaProvider>
        <SheetFrame progress={progress} height={height} dark={dark} footer={footer} close={close}>
          {children}
        </SheetFrame>
      </SafeAreaProvider>
    </Modal>
  );
}

// Everything that sits inside the Modal, so its insets come from the
// Modal's provider rather than the app's.
function SheetFrame({ progress, height, dark, footer, close, children }) {
  const insets = useSafeAreaInsets();
  const scrim = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * height }] }));
  // The inset clears the navigation controls; the extra 20 is breathing
  // room above them, so the last line of text never sits on the bar.
  const bottom = insets.bottom + 20;

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, dark && styles.scrimDark, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.wrap} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, dark && styles.sheetDark, { maxHeight: height * 0.9 }, sheet]}>
          <View style={[styles.grab, dark && styles.grabDark]} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: footer ? 16 : bottom }}
          >
            {children}
          </ScrollView>
          {footer ? <View style={[styles.footer, { paddingBottom: bottom }]}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(28,27,26,0.42)' },
  scrimDark: { backgroundColor: 'rgba(10,8,7,0.6)' },
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  sheetDark: { backgroundColor: '#241F1C', borderTopWidth: 1, borderColor: '#3A332E', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22 },
  grabDark: { backgroundColor: '#4A423B', marginBottom: 16 },
  footer: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8CFC4', alignSelf: 'center', marginBottom: 14 },
});
