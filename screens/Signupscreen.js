import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import Svg, { Path } from 'react-native-svg';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withDelay,
  withSequence,
  useReducedMotion,
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

import PrivacyPolicyModal from '../components/PrivacyPolicyModal';
import { StaticLockup, headerCenterY } from '../components/BrandLockup';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// --- FIREBASE IMPORTS ---
import { auth, db } from '../firebaseConfig';
import { createUserWithEmailAndPassword, updateProfile, deleteUser } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import Button from '../components/ui/Button';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const PASSWORD_MIN = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FIELDS = ['name', 'email', 'password', 'confirmPassword'];

// The approved sign-up preview's rules and wording. Each returns the
// problem, or '' when the value is fine.
const RULES = {
  name: (v) => (v.trim().length < 2 ? 'Please enter your full name.' : ''),
  email: (v) => (!EMAIL_PATTERN.test(v.trim()) ? 'Enter a valid email address.' : ''),
  password: (v) => (v.length < PASSWORD_MIN ? `Use at least ${PASSWORD_MIN} characters.` : ''),
  confirmPassword: (v, form) =>
    !v ? 'Please confirm your password.' : v !== form.password ? "Passwords don't match." : '',
};
const OK_MESSAGE = {
  name: '',
  email: '',
  password: 'Strong enough to go.',
  confirmPassword: 'Passwords match.',
};

// When each piece arrives, in ms after the screen opens — the preview's
// stagger, which starts as Landing's copy finishes fading away.
const T = {
  title: 120,
  sub: 220,
  name: 280,
  email: 340,
  password: 400,
  confirmPassword: 460,
  agree: 520,
  create: 580,
  foot: 660,
};
const TITLE_LINE_HEIGHT = 31;
const SUCCESS_HOLD_MS = 1400;

// Fades up 12 pt into place.
function FadeUp({ delay, skip, style, children }) {
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
function RiseTitle({ delay, skip, children }) {
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

// Password show/hide control — a proper touch target around a 20 px icon,
// a scale pulse on tap, and an icon crossfade instead of an instant swap.
function PasswordToggle({ visible, onToggle, reduceMotion, accessibilityLabel }) {
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
// line under it that says what's wrong (or, for the passwords, that it's
// fine). The label and border turn Clay while typing, red on a problem.
function Field({
  label,
  status,
  message,
  inputRef,
  shakeX,
  secure,
  reduceMotion,
  toggleLabel,
  onBlur,
  ...inputProps
}) {
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
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

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
            reduceMotion={reduceMotion}
            accessibilityLabel={`${revealed ? 'Hide' : 'Show'} ${toggleLabel}`}
          />
        ) : null}
      </Animated.View>
      <Text style={[styles.message, { color: messageColor }]} accessibilityLiveRegion="polite">
        {message}
      </Text>
    </View>
  );
}

// The Privacy Policy consent box: fills Clay and draws its check.
function AgreeRow({ checked, onToggle, onOpenPolicy, shakeX, reduceMotion }) {
  const draw = useSharedValue(checked ? 0 : 20);
  useEffect(() => {
    const to = checked ? 0 : 20;
    draw.value = reduceMotion ? to : withDelay(50, withTiming(to, { duration: 300, easing: EASE_OUT_QUINT }));
  }, [checked]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawProps = useAnimatedProps(() => ({ strokeDashoffset: draw.value }));
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  return (
    <Animated.View style={shakeStyle}>
      <Pressable
        onPress={onToggle}
        style={styles.agree}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I agree to PlainCo's Privacy Policy"
      >
        <View style={[styles.checkbox, checked && styles.checkboxOn]}>
          <Svg width={13} height={13} viewBox="0 0 14 14">
            <AnimatedPath
              d="M3 7.3l2.6 2.6L11 4.4"
              fill="none"
              stroke="#fff"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[20, 20]}
              animatedProps={drawProps}
            />
          </Svg>
        </View>
        <Text style={styles.agreeText}>
          I agree to PlainCo&apos;s{' '}
          <Text style={styles.agreeLink} onPress={onOpenPolicy} accessibilityRole="link">
            Privacy Policy
          </Text>
          .
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// "Welcome to PlainCo!" — slides up from the bottom once the account exists.
function SuccessToast({ visible, bottom, reduceMotion }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!visible) return;
    progress.value = reduceMotion ? 1 : withTiming(1, { duration: 450, easing: EASE_OUT_QUINT });
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 16 }],
  }));
  return (
    <Animated.View style={[styles.toast, { bottom }, animated]} pointerEvents="none" accessibilityLiveRegion="polite">
      <View style={styles.toastIcon}>
        <Ionicons name="checkmark" size={13} color="#fff" />
      </View>
      <Text style={styles.toastText}>{visible ? 'Welcome to PlainCo! Taking you to Home…' : ''}</Text>
    </Animated.View>
  );
}

export default function SignupScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { isConnected } = useNetworkStatus();
  const [size, setSize] = useState(null);

  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  // A field shows its verdict only once it has been "touched" — left with
  // something in it, or submitted — so nobody is told off mid-word.
  const [touched, setTouched] = useState({});
  const [serverError, setServerError] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const confirmPasswordInputRef = useRef(null);
  const successTimer = useRef(null);
  useEffect(() => () => clearTimeout(successTimer.current), []);

  const shake = {
    name: useSharedValue(0),
    email: useSharedValue(0),
    password: useSharedValue(0),
    confirmPassword: useSharedValue(0),
    agree: useSharedValue(0),
  };
  const triggerShake = (sharedValue) => {
    if (reduceMotion) return;
    sharedValue.value = withSequence(
      withTiming(-6, { duration: 60, easing: Easing.linear }),
      withTiming(5, { duration: 70, easing: Easing.linear }),
      withTiming(-3, { duration: 70, easing: Easing.linear }),
      withTiming(2, { duration: 70, easing: Easing.linear }),
      withTiming(0, { duration: 70, easing: Easing.linear })
    );
  };

  // The back arrow slides in beside the lockup.
  const back = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (!reduceMotion) back.value = withTiming(1, { duration: 400, easing: EASE_OUT_QUINT });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const backStyle = useAnimatedStyle(() => ({
    opacity: back.value,
    transform: [{ translateX: (1 - back.value) * 8 }],
  }));

  const errorFor = (id) => serverError[id] || RULES[id](form[id], form);
  const statusFor = (id) => (touched[id] || serverError[id] ? (errorFor(id) ? 'bad' : 'good') : null);
  const messageFor = (id) => {
    const status = statusFor(id);
    if (!status) return '';
    return status === 'bad' ? errorFor(id) : OK_MESSAGE[id];
  };
  const allValid = FIELDS.every((id) => !errorFor(id)) && agreed;

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
  // when Sign Up is the only screen in the stack.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', handleBack);
      return () => sub.remove();
    }, [handleBack])
  );

  const setField = (id) => (text) => {
    setForm((prev) => ({ ...prev, [id]: text }));
    // The confirmation starts judging itself once it's as long as the
    // password — before that, "don't match" is just "not finished".
    if (id === 'confirmPassword' && text.length > 0 && text.length >= form.password.length) {
      setTouched((t) => (t.confirmPassword ? t : { ...t, confirmPassword: true }));
    }
    if (serverError[id]) setServerError((prev) => ({ ...prev, [id]: '' }));
  };
  const touchOnBlur = (id) => () => {
    if (form[id]) setTouched((t) => (t[id] ? t : { ...t, [id]: true }));
  };

  const handleAgree = () => {
    Haptics.selectionAsync();
    setAgreed((v) => !v);
  };

  const handleSignup = async () => {
    if (loading || done) return;

    const bad = FIELDS.filter((id) => errorFor(id));
    if (bad.length || !agreed) {
      setTouched({ name: true, email: true, password: true, confirmPassword: true });
      bad.forEach((id) => triggerShake(shake[id]));
      if (!agreed) triggerShake(shake.agree);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!isConnected) return;

    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim();
    const { password } = form;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Phase 1: create the Auth account. Nothing exists yet if this fails,
    // so a failure here needs no cleanup — just report it. Problems with a
    // field are shown on that field, like every other check on this form.
    let user = null;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      user = userCredential.user;
    } catch (error) {
      setLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error(error.code, error.message);

      const inline = {
        'auth/email-already-in-use': ['email', 'An account with this email already exists. Try logging in.'],
        'auth/invalid-email': ['email', 'Enter a valid email address.'],
        'auth/weak-password': ['password', 'Choose a stronger password.'],
      }[error.code];
      if (inline) {
        const [id, text] = inline;
        setServerError((prev) => ({ ...prev, [id]: text }));
        triggerShake(shake[id]);
        return;
      }
      showAppAlert(
        'Signup Failed',
        error.code === 'auth/network-request-failed'
          ? 'No internet connection. Please check your connection and try again.'
          : 'Something went wrong. Please try again.'
      );
      return;
    }

    // Phase 2: the Auth account now exists. From here on, any failure must
    // not leave the user signed in with no matching Firestore document —
    // that means no privacyConsentAccepted/privacyConsentTimestamp, which
    // is a Data Privacy Act compliance gap, not just a UX rough edge. So
    // instead of just showing an error like phase 1 does, this rolls the
    // Auth account back.
    try {
      await updateProfile(user, { displayName: trimmedName });

      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        name: trimmedName,
        email: trimmedEmail,
        // serverTimestamp(), like every other createdAt in the app. A
        // client-supplied date is whatever the device's clock says — a
        // wrong timezone, a skewed clock, or a deliberately set one — and
        // it does not sort against the Timestamps every other collection
        // stores.
        createdAt: serverTimestamp(),
        // Auditable consent record for the Philippine Data Privacy Act —
        // the checkbox above is just a UI gate, this is what actually
        // proves consent was given, and when.
        privacyConsentAccepted: true,
        privacyConsentTimestamp: serverTimestamp(),
      });

      setLoading(false);
      setDone(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // reset, not navigate: Sign Up must not sit behind Home where a back
      // gesture could return a signed-in user to it.
      successTimer.current = setTimeout(() => {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }, SUCCESS_HOLD_MS);
    } catch (error) {
      console.error('Error finishing signup, rolling back Auth account:', error.code, error.message);

      try {
        // Deleting the current user also signs them out as a side effect —
        // no separate signOut() needed on this path.
        await deleteUser(user);
      } catch (deleteError) {
        // Couldn't remove the orphaned account either. The Auth account
        // will need manual cleanup, but the user must still not be left
        // signed in with no Firestore document under any failure path —
        // signing out at least stops them from proceeding in that state.
        console.error('Error deleting orphaned Auth account:', deleteError.code, deleteError.message);
        try {
          await auth.signOut();
        } catch (signOutError) {
          console.error('Error signing out after failed rollback:', signOutError.code, signOutError.message);
        }
      }

      setLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Signup Failed', 'Could not complete signup. Please try again.');
    }
  };

  const skip = reduceMotion;
  const headerBottom = headerCenterY(insets.top) + 44;
  const buttonLabel = done ? 'Account created' : !isConnected ? 'No Internet Connection' : 'Create Account';

  return (
    <View style={styles.root} onLayout={(e) => !size && setSize(e.nativeEvent.layout)}>
      <StatusBar barStyle="dark-content" />

      {/* The same lockup, on the same pixels, as Landing's header — so
          going from one to the other, it doesn't move. */}
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

      <KeyboardAvoidingView behavior="padding" style={[styles.flex, { marginTop: headerBottom }]}>
        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
            <Text style={styles.offlineBannerText}>
              No internet connection — you can create your account once you&apos;re back online.
            </Text>
          </View>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}
        >
          <RiseTitle delay={T.title} skip={skip}>Create your account</RiseTitle>
          <FadeUp delay={T.sub} skip={skip}>
            <Text style={styles.sub}>Shop ukay and ready-to-wear from local stores.</Text>
          </FadeUp>

          <FadeUp delay={T.name} skip={skip}>
            <Field
              label="Full name"
              value={form.name}
              onChangeText={setField('name')}
              onBlur={touchOnBlur('name')}
              status={statusFor('name')}
              message={messageFor('name')}
              shakeX={shake.name}
              reduceMotion={reduceMotion}
              placeholder="Juan Dela Cruz"
              textContentType="name"
              autoComplete="name"
              autoCapitalize="words"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => emailInputRef.current?.focus()}
            />
          </FadeUp>

          <FadeUp delay={T.email} skip={skip}>
            <Field
              label="Email address"
              inputRef={emailInputRef}
              value={form.email}
              onChangeText={setField('email')}
              onBlur={touchOnBlur('email')}
              status={statusFor('email')}
              message={messageFor('email')}
              shakeX={shake.email}
              reduceMotion={reduceMotion}
              placeholder="you@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="email"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordInputRef.current?.focus()}
            />
          </FadeUp>

          <FadeUp delay={T.password} skip={skip}>
            <Field
              label="Password"
              inputRef={passwordInputRef}
              secure
              toggleLabel="password"
              value={form.password}
              onChangeText={setField('password')}
              onBlur={touchOnBlur('password')}
              status={statusFor('password')}
              message={messageFor('password')}
              shakeX={shake.password}
              reduceMotion={reduceMotion}
              placeholder={`At least ${PASSWORD_MIN} characters`}
              textContentType="newPassword"
              autoComplete="password-new"
              autoCapitalize="none"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
            />
          </FadeUp>

          <FadeUp delay={T.confirmPassword} skip={skip}>
            <Field
              label="Confirm password"
              inputRef={confirmPasswordInputRef}
              secure
              toggleLabel="confirm password"
              value={form.confirmPassword}
              onChangeText={setField('confirmPassword')}
              onBlur={touchOnBlur('confirmPassword')}
              status={statusFor('confirmPassword')}
              message={messageFor('confirmPassword')}
              shakeX={shake.confirmPassword}
              reduceMotion={reduceMotion}
              placeholder="Re-enter your password"
              textContentType="newPassword"
              autoComplete="password-new"
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleSignup}
            />
          </FadeUp>

          <FadeUp delay={T.agree} skip={skip}>
            <AgreeRow
              checked={agreed}
              onToggle={handleAgree}
              onOpenPolicy={() => setShowPrivacyModal(true)}
              shakeX={shake.agree}
              reduceMotion={reduceMotion}
            />
          </FadeUp>

          {/* Stays disabled until every field is good and the box is
              ticked; turns Moss once the account exists. */}
          <FadeUp delay={T.create} skip={skip}>
            <Button
              variant={done ? 'success' : 'primary'}
              label={buttonLabel}
              fontSize={16}
              onPress={handleSignup}
              disabled={!done && (!allValid || !isConnected)}
              loading={loading}
            />
          </FadeUp>

          <FadeUp delay={T.foot} skip={skip} style={styles.foot}>
            <Text style={styles.footText}>
              Already have an account?{' '}
              <Text
                style={styles.footLink}
                accessibilityRole="link"
                onPress={() => {
                  Haptics.selectionAsync();
                  navigation.navigate('Login');
                }}
              >
                Log In
              </Text>
            </Text>
          </FadeUp>
        </ScrollView>
      </KeyboardAvoidingView>

      <SuccessToast visible={done} bottom={Math.max(insets.bottom, 16) + 12} reduceMotion={reduceMotion} />

      <PrivacyPolicyModal visible={showPrivacyModal} onClose={() => setShowPrivacyModal(false)} />
    </View>
  );
}

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

  agree: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4, marginBottom: 16 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.light.tint, borderColor: Colors.light.tint },
  agreeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: Colors.light.icon, paddingTop: 2 },
  agreeLink: { color: Colors.light.text, fontWeight: '500', textDecorationLine: 'underline' },

  foot: { marginTop: 'auto', paddingTop: 20, alignItems: 'center' },
  footText: { fontSize: 13, color: Colors.light.icon },
  footLink: { color: Colors.light.tint, fontWeight: '600' },

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
