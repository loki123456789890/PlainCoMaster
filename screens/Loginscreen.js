// screens/LoginScreen.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from 'react-native-reanimated';
import {
  AuthScaffold,
  AuthAlert,
  AuthLink,
  Field,
  FadeUp,
  RiseTitle,
  Subtitle,
  SuccessToast,
  useShakes,
  authStyles,
  EMAIL_PATTERN,
} from '../components/auth/AuthKit';

// --- FIREBASE IMPORTS ---
import { auth, db } from '../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import Button from '../components/ui/Button';
import { Colors } from '../constants/theme';
import { getRoleLabel, ROLE_SELLER, ROLE_PLATFORM_ADMIN } from '../constants/roles';
import { useAdmin } from '../context/AdminContext';

// The approved log-in preview's rules and wording.
const RULES = {
  email: (v) => (!v.trim() ? 'Please enter your email.' : !EMAIL_PATTERN.test(v.trim()) ? 'Enter a valid email address.' : ''),
  password: (v) => (!v ? 'Please enter your password.' : ''),
};

// When each piece arrives, in ms after the screen opens.
const T = { title: 120, sub: 220, email: 290, password: 350, forgot: 400, button: 450, foot: 540 };
const SUCCESS_HOLD_MS = 1100;

// What a failed sign-in says. Wrong details are the box's job, not the
// password field's: Firebase won't say which of the two was wrong.
function alertForAuthError(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return { kind: 'err', title: 'Incorrect email or password.', body: 'Check your details and try again.' };
    case 'auth/too-many-requests':
      return { kind: 'err', title: 'Too many attempts.', body: 'Please wait a moment and try again.' };
    case 'auth/network-request-failed':
      return { kind: 'err', title: 'No internet connection.', body: 'Check your connection and try again.' };
    default:
      return { kind: 'err', title: "Couldn't log you in.", body: 'Something went wrong. Please try again.' };
  }
}

export default function LoginScreen({ navigation }) {
  const reduceMotion = useReducedMotion();
  const { isConnected } = useNetworkStatus();
  const { holdRevocationForSignIn } = useAdmin();

  const [form, setForm] = useState({ email: '', password: '' });
  const [touched, setTouched] = useState({});
  const [fieldError, setFieldError] = useState({});
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [shakes, shake] = useShakes();

  const passwordInputRef = useRef(null);
  const successTimer = useRef(null);
  useEffect(() => () => clearTimeout(successTimer.current), []);

  const errorFor = (id) => fieldError[id] || RULES[id](form[id]);
  // Only problems show here — a correct-looking email proves nothing
  // until the server agrees, so there are no ticks on this form.
  const statusFor = (id) => (touched[id] || fieldError[id]) && errorFor(id) ? 'bad' : null;

  const setField = (id) => (text) => {
    setForm((prev) => ({ ...prev, [id]: text }));
    if (fieldError[id]) setFieldError((prev) => ({ ...prev, [id]: '' }));
    if (alert) setAlert(null);
  };

  const goToStaffPortal = () => navigation.navigate('AdminLogin');

  const handleLogin = async () => {
    if (loading || done) return;
    setAlert(null);

    const bad = ['email', 'password'].filter((id) => errorFor(id));
    if (bad.length) {
      setTouched({ email: true, password: true });
      bad.forEach(shake);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!isConnected) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Signs out and shows why, for an account that authenticated but must
    // not continue into the customer app.
    const refuse = async (nextAlert) => {
      await auth.signOut();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAlert(nextAlert);
      setLoading(false);
    };

    // This screen refuses a deactivated account itself, in the form; the
    // app-wide listener would otherwise bounce to Landing mid-check.
    const releaseRevocation = holdRevocationForSignIn();
    try {
      const userCredential = await signInWithEmailAndPassword(auth, form.email.trim(), form.password);
      const uid = userCredential.user.uid;

      // Single Firestore read covers both checks below: deactivation and
      // role. A deactivated account can still authenticate successfully
      // with Firebase Auth (deactivation is a Firestore flag, not an
      // Auth-level disable), so we have to check it ourselves right here.
      const userDocSnap = await getDoc(doc(db, 'users', uid));

      // An Auth account with no matching Firestore document has no
      // privacyConsentAccepted record, no isActive flag, and no role — the
      // checks below would silently skip themselves for exactly this case,
      // falling straight through to Home. Catch it explicitly instead.
      if (!userDocSnap.exists()) {
        await refuse({
          kind: 'err',
          title: "We couldn't load your account.",
          body: 'Please sign up again or contact PlainCo support.',
        });
        return;
      }

      if (userDocSnap.data().isActive === false) {
        await refuse({
          kind: 'err',
          title: 'This account has been deactivated.',
          body: 'If you think this is a mistake, contact PlainCo support.',
        });
        return;
      }

      // Staff accounts don't belong in the customer flow — Firebase Auth
      // itself has no concept of role, so this is the only place that can
      // stop a staff credential from landing on the customer HomeScreen.
      // Mirrors AdminLoginScreen's own role check, just in reverse, and
      // compares against the roles constants so a renamed role can't
      // silently stop matching.
      const signedInRole = userDocSnap.data().role;
      if (signedInRole === ROLE_SELLER || signedInRole === ROLE_PLATFORM_ADMIN) {
        await refuse({
          kind: 'info',
          title: `This is a ${getRoleLabel(signedInRole)} account.`,
          body: 'Staff sign in through the Staff Portal.',
          action: { label: 'Go to Staff Portal', onPress: goToStaffPortal },
        });
        return;
      }

      setLoading(false);
      setDone(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // reset, not navigate: Log In must not sit behind Home where a back
      // gesture could return a signed-in user to it.
      successTimer.current = setTimeout(() => {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }, SUCCESS_HOLD_MS);
    } catch (error) {
      console.error(error.code, error.message);
      setLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      if (error.code === 'auth/invalid-email') {
        setFieldError({ email: 'Enter a valid email address.' });
        shake('email');
        return;
      }
      setAlert(alertForAuthError(error.code));
      if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(error.code)) {
        // A fresh try starts from an empty password, as in the preview.
        shake('password');
        setForm((prev) => ({ ...prev, password: '' }));
        passwordInputRef.current?.focus();
      }
    } finally {
      releaseRevocation();
    }
  };

  const skip = reduceMotion;
  const ready = form.email.trim() && form.password;
  const buttonLabel = done ? 'Welcome back' : !isConnected ? 'No Internet Connection' : 'Log In';

  return (
    <AuthScaffold
      navigation={navigation}
      isConnected={isConnected}
      offlineText="No internet connection — you can log in once you're back online."
      overlay={<SuccessToast text={done ? 'Signed in. Taking you to Home…' : ''} />}
    >
      <RiseTitle delay={T.title} skip={skip}>Welcome back</RiseTitle>
      <FadeUp delay={T.sub} skip={skip}>
        <Subtitle>Log in to continue shopping.</Subtitle>
      </FadeUp>

      <AuthAlert alert={alert} />

      <FadeUp delay={T.email} skip={skip}>
        <Field
          label="Email address"
          value={form.email}
          onChangeText={setField('email')}
          onBlur={() => form.email && setTouched((t) => ({ ...t, email: true }))}
          status={statusFor('email')}
          message={statusFor('email') ? errorFor('email') : ''}
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
          value={form.password}
          onChangeText={setField('password')}
          status={statusFor('password')}
          message={statusFor('password') ? errorFor('password') : ''}
          shakeKey={shakes.password}
          placeholder="Enter your password"
          textContentType="password"
          autoComplete="password"
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />
      </FadeUp>

      <FadeUp delay={T.forgot} skip={skip} style={styles.forgotRow}>
        <AuthLink onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgot}>
          Forgot password?
        </AuthLink>
      </FadeUp>

      {/* Stays disabled until both fields have something in them; turns
          Moss once signed in. */}
      <FadeUp delay={T.button} skip={skip}>
        <Button
          variant={done ? 'success' : 'primary'}
          label={buttonLabel}
          fontSize={16}
          onPress={handleLogin}
          disabled={!done && (!ready || !isConnected)}
          loading={loading}
        />
      </FadeUp>

      <FadeUp delay={T.foot} skip={skip} style={authStyles.foot}>
        <Text style={authStyles.footText}>
          New to PlainCo?{' '}
          <AuthLink accent onPress={() => navigation.replace('Signup', { via: 'auth' })}>
            Create an account
          </AuthLink>
        </Text>
        <View style={styles.staffRow}>
          <Text style={styles.staffText}>
            Store staff? <AuthLink onPress={goToStaffPortal}>Sign in to the Staff Portal</AuthLink>
          </Text>
        </View>
      </FadeUp>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  forgotRow: { alignItems: 'flex-end', marginTop: -4, marginBottom: 18 },
  forgot: { fontSize: 12.5, paddingVertical: 6, paddingHorizontal: 2 },
  staffRow: { marginTop: 10 },
  staffText: { fontSize: 12, color: Colors.light.icon, textAlign: 'center' },
});
