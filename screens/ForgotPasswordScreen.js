// screens/ForgotPasswordScreen.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Rect, Path, Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withDelay,
  withSequence,
  useReducedMotion,
} from 'react-native-reanimated';
import {
  AuthScaffold,
  AuthAlert,
  Field,
  FadeUp,
  RiseTitle,
  Subtitle,
  SuccessToast,
  useShakes,
  EMAIL_PATTERN,
} from '../components/auth/AuthKit';
import { EASE_OUT_QUINT } from '../constants/motion';

// --- FIREBASE IMPORTS ---
import { auth } from '../firebaseConfig';
import { sendPasswordResetEmail } from 'firebase/auth';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import Button from '../components/ui/Button';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RESEND_COOLDOWN_S = 60;
const T = { title: 80, sub: 170, email: 240, send: 310 };

// Sends the reset email, treating "no such account" as sent.
//
// The confirmation is deliberately the same whether or not an account
// exists, so this screen can't be used to find out which emails are
// registered. Showing "no account found" would undo that protection.
async function requestReset(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
}

function alertForResetError(code) {
  switch (code) {
    case 'auth/network-request-failed':
      return { kind: 'err', title: 'No internet connection.', body: 'Check your connection and try again.' };
    case 'auth/too-many-requests':
      return { kind: 'err', title: 'Too many requests.', body: 'Please wait a few minutes and try again.' };
    default:
      return { kind: 'err', title: "Couldn't send the link.", body: 'Something went wrong. Please try again.' };
  }
}

// The envelope on the confirmation: the tile pops in, the flap draws
// itself, and a Moss badge with a check lands on the corner.
function SentEnvelope() {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(reduceMotion ? 1 : 0);
  const flap = useSharedValue(reduceMotion ? 0 : 40);
  const badge = useSharedValue(reduceMotion ? 8 : 0);
  const check = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    pop.value = withTiming(1, { duration: 600, easing: EASE_OUT_QUINT });
    flap.value = withDelay(350, withTiming(0, { duration: 600, easing: EASE_OUT_QUINT }));
    badge.value = withDelay(
      750,
      withSequence(
        withTiming(9.2, { duration: 315, easing: EASE_OUT_QUINT }),
        withTiming(8, { duration: 135, easing: EASE_OUT_QUINT })
      )
    );
    check.value = withDelay(950, withTiming(1, { duration: 200 }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tileStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: 0.7 + pop.value * 0.3 }],
  }));
  const flapProps = useAnimatedProps(() => ({ strokeDashoffset: flap.value }));
  const badgeProps = useAnimatedProps(() => ({ r: badge.value }));
  const checkProps = useAnimatedProps(() => ({ opacity: check.value }));

  return (
    <Animated.View style={[styles.envelope, tileStyle]} accessible={false}>
      <Svg width={50} height={50} viewBox="0 0 50 50">
        <Rect x={6} y={13} width={34} height={26} rx={5} fill="none" stroke={Colors.light.tint} strokeWidth={2} />
        <AnimatedPath
          d="M8 16l15 11 15-11"
          fill="none"
          stroke={Colors.light.tint}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[40, 40]}
          animatedProps={flapProps}
        />
        <AnimatedCircle cx={39} cy={13} fill={Colors.light.success} animatedProps={badgeProps} />
        <AnimatedPath
          d="M35.5 13.2l2.4 2.4 4.4-4.6"
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          animatedProps={checkProps}
        />
      </Svg>
    </Animated.View>
  );
}

export default function ForgotPasswordScreen({ navigation, route }) {
  const reduceMotion = useReducedMotion();
  const { isConnected } = useNetworkStatus();

  // Carries over whatever was typed on Log In, as the preview does.
  const [email, setEmail] = useState(route?.params?.email || '');
  const [fieldError, setFieldError] = useState('');
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [toast, setToast] = useState('');
  const [shakes, shake] = useShakes();

  const timers = useRef([]);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Ticks the "Resend link in 42s" countdown.
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // The ask step fades up and away before the confirmation takes its place.
  const askGone = useSharedValue(0);
  const askStyle = useAnimatedStyle(() => ({
    opacity: 1 - askGone.value,
    transform: [{ translateY: askGone.value * -10 }],
  }));

  const handleEmailChange = (text) => {
    setEmail(text);
    if (fieldError) setFieldError('');
    if (alert) setAlert(null);
  };

  const handleSend = async () => {
    if (loading) return;
    setAlert(null);
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setFieldError('Enter a valid email address.');
      shake('email');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!isConnected) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await requestReset(trimmed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLoading(false);
      setCooldown(RESEND_COOLDOWN_S);
      if (reduceMotion) {
        setSentTo(trimmed);
      } else {
        askGone.value = withTiming(1, { duration: 300, easing: EASE_OUT_QUINT });
        later(() => setSentTo(trimmed), 180);
      }
    } catch (error) {
      console.error(error.code, error.message);
      setLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (error.code === 'auth/invalid-email') {
        setFieldError('Enter a valid email address.');
        shake('email');
        return;
      }
      setAlert(alertForResetError(error.code));
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || !sentTo) return;
    Haptics.selectionAsync();
    setCooldown(RESEND_COOLDOWN_S);
    try {
      await requestReset(sentTo);
      setToast('Reset link sent again.');
    } catch (error) {
      console.error(error.code, error.message);
      setCooldown(0);
      setToast(error.code === 'auth/network-request-failed' ? 'No internet connection. Try again.' : "Couldn't resend. Try again.");
    }
    later(() => setToast(''), 1800);
  };

  const skip = reduceMotion;

  return (
    <AuthScaffold
      navigation={navigation}
      isConnected={isConnected}
      offlineText="No internet connection — you can reset your password once you're back online."
      overlay={<SuccessToast text={toast} />}
    >
      {!sentTo ? (
        <Animated.View style={askStyle}>
          <RiseTitle delay={T.title} skip={skip}>Reset your password</RiseTitle>
          <FadeUp delay={T.sub} skip={skip}>
            <Subtitle>
              Enter the email you signed up with and we&apos;ll send you a link to set a new password.
            </Subtitle>
          </FadeUp>

          <AuthAlert alert={alert} />

          <FadeUp delay={T.email} skip={skip}>
            <Field
              label="Email address"
              value={email}
              onChangeText={handleEmailChange}
              status={fieldError ? 'bad' : null}
              message={fieldError}
              shakeKey={shakes.email}
              placeholder="you@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="email"
              autoFocus={!route?.params?.email}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
          </FadeUp>

          <FadeUp delay={T.send} skip={skip} style={styles.sendWrap}>
            <Button
              variant="primary"
              label={!isConnected ? 'No Internet Connection' : 'Send Reset Link'}
              fontSize={16}
              onPress={handleSend}
              disabled={!email.trim() || !isConnected}
              loading={loading}
            />
          </FadeUp>
        </Animated.View>
      ) : (
        <View style={styles.done} accessibilityLiveRegion="polite">
          <SentEnvelope />
          <FadeUp delay={250} skip={skip}>
            <Text style={styles.doneTitle} accessibilityRole="header">
              Check your email
            </Text>
          </FadeUp>
          <FadeUp delay={350} skip={skip} style={styles.doneCopy}>
            <Text style={styles.doneText}>
              If an account exists for <Text style={styles.doneEmail}>{sentTo}</Text>, we&apos;ve sent a link to
              reset your password.
            </Text>
            <Text style={styles.tip}>It can take a few minutes. Check your Spam or Promotions folder too.</Text>
          </FadeUp>
          <FadeUp delay={450} skip={skip} style={styles.actions}>
            <Button variant="primary" label="Back to Log In" fontSize={16} onPress={() => navigation.goBack()} />
            <Pressable
              onPress={handleResend}
              disabled={cooldown > 0}
              style={styles.resend}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityState={{ disabled: cooldown > 0 }}
            >
              <Text style={[styles.resendText, cooldown > 0 && styles.resendWaiting]}>
                {cooldown > 0 ? `Resend link in ${cooldown}s` : 'Resend link'}
              </Text>
            </Pressable>
          </FadeUp>
        </View>
      )}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  sendWrap: { marginTop: 6 },

  done: { alignItems: 'center', paddingTop: 18 },
  envelope: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: '#F3E3DA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  doneTitle: { fontSize: 26, lineHeight: 31, fontWeight: '700', letterSpacing: -0.5, color: Colors.light.text, textAlign: 'center' },
  doneCopy: { alignItems: 'center' },
  doneText: {
    fontSize: 13.5,
    lineHeight: 21,
    color: Colors.light.icon,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 300,
  },
  doneEmail: { color: Colors.light.text, fontWeight: '600' },
  tip: {
    fontSize: 12,
    lineHeight: 18,
    color: '#37412F',
    backgroundColor: '#EEF0EA',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    maxWidth: 320,
    textAlign: 'center',
    overflow: 'hidden',
  },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 28 },
  resend: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 8 },
  resendText: { fontSize: 13, fontWeight: '500', color: Colors.light.text, textDecorationLine: 'underline' },
  resendWaiting: { color: '#A89F97', textDecorationLine: 'none' },
});
