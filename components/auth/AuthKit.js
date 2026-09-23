// components/auth/AuthKit.js
//
// The pieces Log In and Sign Up share, from the approved previews: the
// plainco lockup sitting where Landing left it, a back arrow beside it,
// fields that turn Clay while typing and red on a problem, the stagger the
// copy rises in with, and the toast that confirms success.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  StatusBar,
  Platform,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  useReducedMotion,
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { StaticLockup, headerCenterY } from '../BrandLockup';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';
import { Colors } from '../../constants/theme';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TITLE_LINE_HEIGHT = 31;

// Fades up 12 pt into place.
export function FadeUp({ delay, skip, style, children }) {
  const progress = useSharedValue(skip ? 1 : 0);
  useEffect(() => {
    if (skip) return;
    progress.value = withDelay(delay, withTiming(1, { duration: 560, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

// The title rises out of its own clip, like Landing's headline.
export function RiseTitle({ delay, skip, children }) {
  const progress = useSharedValue(skip ? 1 : 0);
  useEffect(() => {
    if (skip) return;
    progress.value = withDelay(delay, withTiming(1, { duration: 650, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * TITLE_LINE_HEIGHT * 1.05 }],
  }));
  return (
    <View style={styles.titleClip} accessible accessibilityRole="header">
      <Animated.Text style={[styles.title, animated]}>{children}</Animated.Text>
    </View>
  );
}

export function Subtitle({ children }) {
  return <Text style={styles.sub}>{children}</Text>;
}

// A shake, run each time `trigger` goes up — so a screen asks a field to
// shake by bumping a counter, without holding one shared value per field.
export function useShakeOn(trigger) {
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(0);
  useEffect(() => {
    if (!trigger || reduceMotion) return;
    x.value = withSequence(
      withTiming(-6, { duration: 60, easing: Easing.linear }),
      withTiming(5, { duration: 70, easing: Easing.linear }),
      withTiming(-3, { duration: 70, easing: Easing.linear }),
      withTiming(2, { duration: 70, easing: Easing.linear }),
      withTiming(0, { duration: 70, easing: Easing.linear })
    );
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps
  return useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
}

// Counters for useShakeOn, one per id: shake('email') makes the email
// field shake.
export function useShakes() {
  const [counts, setCounts] = useState({});
  const shake = useCallback((id) => setCounts((c) => ({ ...c, [id]: (c[id] || 0) + 1 })), []);
  return [counts, shake];
}

// Password show/hide control — a proper touch target around a 20 px icon,
// a scale pulse on tap, and an icon crossfade instead of an instant swap.
function PasswordToggle({ visible, onToggle, accessibilityLabel }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    Haptics.selectionAsync();
    if (!reduceMotion) {
      scale.value = withSequence(
        withTiming(0.8, { duration: 80, easing: EASE_OUT_QUINT }),
        withTiming(1, { duration: 140, easing: EASE_OUT_QUART })
      );
    }
    onToggle();
  };

  return (
    <Pressable
      onPress={handlePress}
      style={styles.eye}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Toggles whether your password is visible"
    >
      <Animated.View style={animatedStyle}>
        <Animated.View
          key={visible ? 'shown' : 'hidden'}
          entering={reduceMotion ? undefined : FadeIn.duration(120)}
          exiting={reduceMotion ? undefined : FadeOut.duration(100)}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={Colors.light.icon} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

// One form field: label, input, a Moss tick once the value is good, and a
// line under it that says what's wrong (or, for passwords on Sign Up, that
// it's fine). The label and border turn Clay while typing, red on a problem.
export function Field({ label, status, message, inputRef, shakeKey, secure, toggleLabel, onBlur, ...inputProps }) {
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const good = status === 'good';
  const bad = status === 'bad';

  const tick = useSharedValue(0);
  useEffect(() => {
    tick.value = reduceMotion ? (good ? 1 : 0) : withTiming(good ? 1 : 0, { duration: 300, easing: EASE_OUT_QUINT });
  }, [good]); // eslint-disable-line react-hooks/exhaustive-deps
  const tickStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: 0.4 + tick.value * 0.6 }],
  }));
  const shakeStyle = useShakeOn(shakeKey);

  const labelColor = bad ? Colors.light.danger : focused ? Colors.light.tint : Colors.light.text;
  const borderColor = bad ? Colors.light.danger : focused ? Colors.light.tint : Colors.light.border;
  const messageColor = bad ? Colors.light.danger : good ? Colors.light.success : Colors.light.icon;

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
      <Animated.View style={[styles.box, shakeStyle]}>
        {focused || bad ? <View style={[styles.ring, bad ? styles.ringBad : styles.ringFocus]} /> : null}
        <TextInput
          {...inputProps}
          ref={inputRef}
          style={[styles.input, { borderColor }, secure && styles.inputSecure]}
          placeholderTextColor="#B3AAA0"
          secureTextEntry={secure && !revealed}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          accessibilityLabel={label}
        />
        <Animated.View style={[styles.tick, secure && styles.tickSecure, tickStyle]} pointerEvents="none">
          <Ionicons name="checkmark" size={13} color="#fff" />
        </Animated.View>
        {secure ? (
          <PasswordToggle
            visible={revealed}
            onToggle={() => setRevealed((v) => !v)}
            accessibilityLabel={`${revealed ? 'Hide' : 'Show'} ${toggleLabel || 'password'}`}
          />
        ) : null}
      </Animated.View>
      <Text style={[styles.message, { color: messageColor }]} accessibilityLiveRegion="polite">
        {message}
      </Text>
    </View>
  );
}

// A boxed notice above the form, for what isn't any one field's fault:
// red for a problem, Moss for "you're in the wrong place".
export function AuthAlert({ alert }) {
  const reduceMotion = useReducedMotion();
  if (!alert) return null;
  const info = alert.kind === 'info';
  return (
    <Animated.View
      key={alert.title}
      entering={reduceMotion ? undefined : FadeIn.duration(400).easing(EASE_OUT_QUINT)}
      style={[styles.alert, info ? styles.alertInfo : styles.alertErr]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Ionicons name="alert-circle-outline" size={18} color={info ? INFO_INK : ERR_INK} style={styles.alertIcon} />
      <View style={styles.flex}>
        <Text style={[styles.alertText, { color: info ? INFO_INK : ERR_INK }]}>
          <Text style={styles.alertTitle}>{alert.title}</Text>
          {alert.body ? `\n${alert.body}` : ''}
        </Text>
        {alert.action ? (
          <Text
            style={[styles.alertAction, { color: info ? INFO_INK : ERR_INK }]}
            onPress={alert.action.onPress}
            accessibilityRole="link"
            suppressHighlighting
          >
            {alert.action.label} →
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}
const ERR_INK = '#7A1B12';
const INFO_INK = '#37412F';

// "Welcome to PlainCo!" — slides up from the bottom once it has worked,
// and back down when `text` is cleared (the last text stays on it while
// it goes, rather than blanking mid-slide).
export function SuccessToast({ text }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (text) setShown(text);
    const to = text ? 1 : 0;
    progress.value = reduceMotion ? to : withTiming(to, { duration: 450, easing: EASE_OUT_QUINT });
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));
  return (
    <Animated.View
      style={[styles.toast, { bottom: Math.max(insets.bottom, 16) + 12 }, animated]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.toastIcon}>
        <Ionicons name="checkmark" size={13} color="#fff" />
      </View>
      <Text style={styles.toastText}>{shown || ''}</Text>
    </Animated.View>
  );
}

// A text link in the footer or under a field.
export function AuthLink({ onPress, children, accent, style }) {
  return (
    <Text
      style={[accent ? styles.linkAccent : styles.linkPlain, style]}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="link"
      suppressHighlighting
    >
      {children}
    </Text>
  );
}

// The screen around a form: lockup where Landing left it, back arrow,
// offline notice, and a scroll area that clears the header and the
// keyboard. `overlay` renders above everything (toast, modals).
export function AuthScaffold({ navigation, offlineText, isConnected, overlay, children }) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState(null);

  const back = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!reduceMotion) back.value = withTiming(1, { duration: 400, easing: EASE_OUT_QUINT });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const backStyle = useAnimatedStyle(() => ({
    opacity: back.value,
    transform: [{ translateX: (1 - back.value) * 8 }],
  }));

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // Opened from Landing with replace(), so there is nothing to go back
      // to. Landing comes back as the preview does: its copy fades in under
      // the lockup, no replay.
      navigation.replace('Landing', { returning: true });
    }
    return true;
  }, [navigation]);

  // Android's back button follows the arrow, instead of closing the app
  // when this is the only screen in the stack.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', handleBack);
      return () => sub.remove();
    }, [handleBack])
  );

  return (
    <View style={styles.root} onLayout={(e) => !size && setSize(e.nativeEvent.layout)}>
      <StatusBar barStyle="dark-content" />

      {/* The same lockup, on the same pixels, as Landing's header — so
          moving between them, it doesn't move. */}
      {size ? <StaticLockup width={size.width} height={size.height} topInset={insets.top} /> : null}

      <Animated.View style={[styles.backWrap, { top: headerCenterY(insets.top) - 22 }, backStyle]}>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.light.text} />
        </Pressable>
      </Animated.View>

      <KeyboardAvoidingView behavior="padding" style={[styles.flex, { marginTop: headerCenterY(insets.top) + 44 }]}>
        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
            <Text style={styles.offlineBannerText}>{offlineText}</Text>
          </View>
        )}
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>

      {overlay}
    </View>
  );
}

export const authStyles = StyleSheet.create({
  foot: { marginTop: 'auto', paddingTop: 20, alignItems: 'center' },
  footText: { fontSize: 13, color: Colors.light.icon, textAlign: 'center' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },

  backWrap: { position: 'absolute', left: 16, zIndex: 2 },
  back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  backPressed: { backgroundColor: 'rgba(28,27,26,0.06)' },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 12,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  offlineBannerText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: Colors.light.danger },

  titleClip: { overflow: 'hidden' },
  // DESIGN.md's Display step, one size down from Landing's headline.
  title: {
    fontSize: 26,
    lineHeight: TITLE_LINE_HEIGHT,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: Colors.light.text,
  },
  sub: { fontSize: 13.5, lineHeight: 20, color: Colors.light.icon, marginTop: 6, marginBottom: 20 },

  field: { marginBottom: 12 },
  label: { fontSize: 12.5, fontWeight: '500', marginBottom: 6, marginLeft: 2 },
  box: { position: 'relative' },
  // The preview's 4 pt focus halo, drawn as a tinted shape behind the
  // input since React Native has no box-shadow spread.
  ring: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 18 },
  ringFocus: { backgroundColor: 'rgba(196,98,62,0.12)' },
  ringBad: { backgroundColor: 'rgba(196,70,62,0.08)' },
  input: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    paddingLeft: 15,
    paddingRight: 44,
    fontSize: 15,
    color: Colors.light.text,
    // Above the halo: on web an absolutely positioned sibling would
    // otherwise paint over the field.
    zIndex: 1,
    // The Clay border is the focus indicator; the browser's own outline
    // would cover it.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  inputSecure: { paddingRight: 78 },
  tick: {
    position: 'absolute',
    right: 14,
    top: 15,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.light.success,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  tickSecure: { right: 44 },
  eye: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  message: { fontSize: 11.5, lineHeight: 15, minHeight: 15, marginTop: 6, marginLeft: 2 },

  alert: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  alertErr: { backgroundColor: '#FBEDEB', borderColor: '#F1CFCB' },
  alertInfo: { backgroundColor: '#EEF0EA', borderColor: '#D6DCCF' },
  alertIcon: { marginTop: 1 },
  alertText: { fontSize: 12.5, lineHeight: 18 },
  alertTitle: { fontWeight: '600' },
  alertAction: { fontSize: 12.5, fontWeight: '600', textDecorationLine: 'underline', marginTop: 6 },

  linkPlain: { color: Colors.light.text, fontWeight: '500', textDecorationLine: 'underline' },
  linkAccent: { color: Colors.light.tint, fontWeight: '600' },

  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.light.text,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    zIndex: 5,
  },
  toastIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.light.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: { flex: 1, fontSize: 13.5, color: Colors.light.background },
});
