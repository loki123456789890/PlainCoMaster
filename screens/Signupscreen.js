import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  useReducedMotion,
} from 'react-native-reanimated';
import { showAppAlert } from '../utils/appAlert';

import PrivacyPolicyModal from '../components/PrivacyPolicyModal';
import {
  AuthScaffold,
  AuthLink,
  Field,
  FadeUp,
  RiseTitle,
  Subtitle,
  SuccessToast,
  useShakeOn,
  useShakes,
  authStyles,
  EMAIL_PATTERN,
} from '../components/auth/AuthKit';
import { EASE_OUT_QUINT } from '../constants/motion';

// --- FIREBASE IMPORTS ---
import { auth, db } from '../firebaseConfig';
import { createUserWithEmailAndPassword, updateProfile, deleteUser } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import Button from '../components/ui/Button';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const PASSWORD_MIN = 8;
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
const SUCCESS_HOLD_MS = 1400;

// The Privacy Policy consent box: fills Clay and draws its check.
function AgreeRow({ checked, onToggle, onOpenPolicy, shakeKey }) {
  const reduceMotion = useReducedMotion();
  const draw = useSharedValue(checked ? 0 : 20);
  useEffect(() => {
    const to = checked ? 0 : 20;
    draw.value = reduceMotion ? to : withDelay(50, withTiming(to, { duration: 300, easing: EASE_OUT_QUINT }));
  }, [checked]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawProps = useAnimatedProps(() => ({ strokeDashoffset: draw.value }));
  const shakeStyle = useShakeOn(shakeKey);

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

export default function SignupScreen({ navigation }) {
  const reduceMotion = useReducedMotion();
  const { isConnected } = useNetworkStatus();

  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  // A field shows its verdict only once it has been "touched" — left with
  // something in it, or submitted — so nobody is told off mid-word.
  const [touched, setTouched] = useState({});
  const [serverError, setServerError] = useState({});
  const [agreed, setAgreed] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [shakes, shake] = useShakes();

  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const confirmPasswordInputRef = useRef(null);
  const successTimer = useRef(null);
  useEffect(() => () => clearTimeout(successTimer.current), []);

  const errorFor = (id) => serverError[id] || RULES[id](form[id], form);
  const statusFor = (id) => (touched[id] || serverError[id] ? (errorFor(id) ? 'bad' : 'good') : null);
  const messageFor = (id) => {
    const status = statusFor(id);
    if (!status) return '';
    return status === 'bad' ? errorFor(id) : OK_MESSAGE[id];
  };
  const allValid = FIELDS.every((id) => !errorFor(id)) && agreed;

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
      bad.forEach(shake);
      if (!agreed) shake('agree');
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
        shake(id);
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
  const buttonLabel = done ? 'Account created' : !isConnected ? 'No Internet Connection' : 'Create Account';

  return (
    <AuthScaffold
      navigation={navigation}
      isConnected={isConnected}
      offlineText="No internet connection — you can create your account once you're back online."
      overlay={
        <>
          <SuccessToast text={done ? 'Welcome to PlainCo! Taking you to Home…' : ''} />
          <PrivacyPolicyModal visible={showPrivacyModal} onClose={() => setShowPrivacyModal(false)} />
        </>
      }
    >
      <RiseTitle delay={T.title} skip={skip}>Create your account</RiseTitle>
      <FadeUp delay={T.sub} skip={skip}>
        <Subtitle>Shop ukay and ready-to-wear from local stores.</Subtitle>
      </FadeUp>

      <FadeUp delay={T.name} skip={skip}>
        <Field
          label="Full name"
          value={form.name}
          onChangeText={setField('name')}
          onBlur={touchOnBlur('name')}
          status={statusFor('name')}
          message={messageFor('name')}
          shakeKey={shakes.name}
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
          shakeKey={shakes.email}
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
          shakeKey={shakes.password}
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
          shakeKey={shakes.confirmPassword}
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
          shakeKey={shakes.agree}
        />
      </FadeUp>

      {/* Stays disabled until every field is good and the box is ticked;
          turns Moss once the account exists. */}
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

      <FadeUp delay={T.foot} skip={skip} style={authStyles.foot}>
        <Text style={authStyles.footText}>
          Already have an account?{' '}
          <AuthLink accent onPress={() => navigation.replace('Login', { via: 'auth' })}>
            Log In
          </AuthLink>
        </Text>
      </FadeUp>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
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
});
