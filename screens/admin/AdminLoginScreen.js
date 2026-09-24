// screens/admin/AdminLoginScreen.js — the Staff Portal
//
// One sign-in for both privileged roles, from the approved staff preview:
// Log In's form on ink, under the same lockup (its wordmark in cream). The
// account's own role decides where it lands; this screen only says who it
// is for, and refuses in the form, not in a pop-up, anyone it can't let in.
//
// THERE IS NO STAFF SIGN-UP, on purpose — staff accounts are granted by a
// Platform Admin, never self-registered (SRS_UPDATE_NOTES.md §3, enforced
// in firestore.rules). What was missing was saying so where people look:
// "How do I get a staff account?" opens a sheet with the three steps, so
// someone new to PlainCo is not left hunting for a Register button.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  EMAIL_PATTERN,
} from '../../components/auth/AuthKit';
import { auth, db } from '../../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useAdmin } from '../../context/AdminContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import Button from '../../components/ui/Button';
import Sheet from '../../components/shop/Sheet';
import Reveal from '../../components/shop/Reveal';
import StaffLoggedOut from '../../components/auth/StaffLoggedOut';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/theme';
import { getHomeRouteForRole, ROLE_SELLER, ROLE_PLATFORM_ADMIN } from '../../constants/roles';

const RULES = {
  email: (v) => (!v.trim() ? 'Please enter your email.' : !EMAIL_PATTERN.test(v.trim()) ? 'Enter a valid email address.' : ''),
  password: (v) => (!v ? 'Please enter your password.' : ''),
};

// When each piece arrives, in ms after the screen opens.
const T = { pill: 60, title: 120, sub: 200, email: 260, password: 320, forgot: 370, button: 420, foot: 520 };
const SUCCESS_HOLD_MS = 1100;

// Where each role lands, as the toast says it.
const WELCOME = {
  [ROLE_PLATFORM_ADMIN]: { button: 'Welcome, Admin', toast: 'Signed in as Platform Admin', detail: 'Opening Manage Users…' },
  [ROLE_SELLER]: { button: 'Welcome back', toast: 'Signed in as Store Manager', detail: 'Opening your store dashboard…' },
};

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
      return { kind: 'err', title: "Couldn't sign you in.", body: 'Something went wrong. Please try again.' };
  }
}

function StaffPill() {
  return (
    <View style={styles.pill}>
      <Ionicons name="shield-outline" size={13} color={PILL_INK} />
      <Text style={styles.pillText}>STAFF PORTAL</Text>
    </View>
  );
}
const PILL_INK = '#E9A385';

function AccessNote() {
  return (
    <View style={styles.note}>
      <Ionicons name="lock-closed-outline" size={14} color={NOTE_INK} />
      <Text style={styles.noteText}>Access is limited to your role.</Text>
    </View>
  );
}
// This screen is only ever drawn on ink, so its own few colors are fixed.
const NOTE_INK = '#8B8178';
const FOOT_INK = '#BDB3A9';

// Step 2 names the two roles as tags rather than in the sentence.
const STAFF_STEPS = [
  {
    title: 'Create a customer account',
    body: ['Sign up on the main PlainCo sign-up screen with the ', { em: "email you'll use for work" }, '.'],
  },
  {
    title: 'Ask a Platform Admin for a role',
    body: ['They find your email in Manage Users and give you one of these roles:'],
    tags: [
      { label: 'Store Manager · your store', tone: 'clay' },
      { label: 'Platform Admin', tone: 'moss' },
    ],
  },
  {
    title: 'Sign in here',
    body: ['Use the same email and password. The Staff Portal opens your dashboard.'],
  },
];

// The sheet behind "How do I get a staff account?", on ink like the rest
// of the Staff Portal: a header with a close button, the three steps as a
// numbered timeline, a note about passwords, and a way to sign up.
function StaffAccountSheet({ visible, onClose, onSignUp }) {
  return (
    <Sheet visible={visible} onClose={onClose} dark>
      <View style={styles.sheetHead}>
        <View style={styles.sheetIcon}>
          <Ionicons name="shield-checkmark-outline" size={22} color={PILL_INK} />
        </View>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Getting a staff account
        </Text>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.sheetClose, pressed && { opacity: 0.7 }]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={17} color={FOOT_INK} />
        </Pressable>
      </View>
      <Text style={styles.sheetSub}>
        Staff accounts can manage stores, orders and other people&apos;s accounts, so a Platform Admin grants them. You
        can&apos;t sign up for one.
      </Text>

      <View style={styles.timeline}>
        {STAFF_STEPS.map((step, index) => {
          const last = index === STAFF_STEPS.length - 1;
          return (
            <Reveal key={step.title} delay={120 + index * 80} style={[styles.step, last && { paddingBottom: 0 }]}>
              {/* The line down to the next step, Clay fading into the ink. */}
              {!last ? (
                <LinearGradient colors={[Colors.light.tint, '#4A423B']} style={styles.stepLine} pointerEvents="none" />
              ) : null}
              <View style={[styles.stepNum, last && styles.stepNumLast]}>
                <Text style={[styles.stepNumText, last && { color: PILL_INK }]}>{index + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepBody}>
                  {step.body.map((bit, i) =>
                    typeof bit === 'string' ? (
                      bit
                    ) : (
                      <Text key={i} style={styles.stepEm}>
                        {bit.em}
                      </Text>
                    )
                  )}
                </Text>
                {step.tags ? (
                  <View style={styles.tags}>
                    {step.tags.map((tag) => (
                      <Text key={tag.label} style={[styles.tag, tag.tone === 'moss' ? styles.tagMoss : styles.tagClay]}>
                        {tag.label.toUpperCase()}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            </Reveal>
          );
        })}
      </View>

      <View style={styles.sheetNote}>
        <Ionicons name="key-outline" size={18} color="#D5E0C9" style={{ marginTop: 1 }} />
        <Text style={styles.sheetNoteText}>You keep your own password. The Platform Admin never sees it.</Text>
      </View>

      <Button label="Create a customer account" fontSize={15.5} onPress={onSignUp} fullWidth />
      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
      >
        <Text style={styles.ghostText}>Close</Text>
      </Pressable>
    </Sheet>
  );
}

export default function AdminLoginScreen({ navigation, route }) {
  const reduceMotion = useReducedMotion();
  const { isConnected } = useNetworkStatus();
  const { loginAsAdmin, holdRevocationForSignIn } = useAdmin();

  // Prefilled when the customer Log In sent a staff account here.
  const [form, setForm] = useState({ email: route?.params?.email || '', password: '' });
  const [fieldError, setFieldError] = useState({});
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Arriving from a portal log out: the confirmation covers the form until
  // "Sign in again".
  const [loggedOut, setLoggedOut] = useState(Boolean(route?.params?.loggedOut));
  const [shakes, shake] = useShakes();

  const passwordInputRef = useRef(null);
  const successTimer = useRef(null);
  useEffect(() => () => clearTimeout(successTimer.current), []);

  const setField = (id) => (text) => {
    setForm((prev) => ({ ...prev, [id]: text }));
    if (fieldError[id]) setFieldError((prev) => ({ ...prev, [id]: '' }));
    if (alert) setAlert(null);
  };

  // Back to the customer Log In: back, if that's where this was opened
  // from, otherwise swap this screen for it. Carries the email over, since
  // the usual reason is having typed a customer account in here.
  const goToCustomerLogin = (email) => {
    const routes = navigation.getState()?.routes || [];
    const below = routes[routes.length - 2];
    if (below?.name === 'Login') {
      if (email) navigation.popTo('Login', { email });
      else navigation.goBack();
    } else {
      navigation.replace('Login', { via: 'staff', ...(email ? { email } : null) });
    }
  };

  const handleSignIn = async () => {
    if (loading || welcome) return;
    setAlert(null);

    const bad = ['email', 'password'].filter((id) => RULES[id](form[id]));
    if (bad.length) {
      setFieldError(Object.fromEntries(bad.map((id) => [id, RULES[id](form[id])])));
      bad.forEach(shake);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!isConnected) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

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
      const { user } = await signInWithEmailAndPassword(auth, form.email.trim(), form.password);
      const userDocSnap = await getDoc(doc(db, 'users', user.uid));

      if (!userDocSnap.exists()) {
        await refuse({ kind: 'err', title: "We couldn't load this account.", body: 'Contact a Platform Admin.' });
        return;
      }

      // Only the two privileged roles get in — mirrors isSeller() /
      // isPlatformAdmin() in firestore.rules, so knowing this screen exists
      // gets a customer account nowhere. Role is checked before isActive:
      // a deactivated customer is still told this isn't their door.
      const { role, isActive } = userDocSnap.data();
      if (role !== ROLE_SELLER && role !== ROLE_PLATFORM_ADMIN) {
        await refuse({
          kind: 'info',
          title: 'This is a customer account.',
          body: 'The Staff Portal is for staff only. Customers sign in on the main log-in screen.',
          action: { label: 'Go to customer log in', onPress: () => goToCustomerLogin(form.email.trim()) },
        });
        return;
      }

      // A Platform Admin can deactivate a staff account (AdminUsersScreen);
      // that has to block sign-in here, not just grey out a list row.
      if (isActive === false) {
        await refuse({
          kind: 'err',
          title: 'This staff account has been deactivated.',
          body: 'Contact a Platform Admin to restore access.',
        });
        return;
      }

      // Role confirmed server-side above; AdminContext tracks it from here.
      loginAsAdmin(role);
      setLoading(false);
      setWelcome(WELCOME[role]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // A Platform Admin lands on Manage Users, a Store Manager on the store
      // dashboard (the same mapping Landing uses for a persisted session).
      //
      // reset, not replace: the portal becomes the only screen, so Back
      // can't take a signed-in staff member to a login form. Log out is
      // the way out of the portal.
      successTimer.current = setTimeout(() => {
        navigation.reset({ index: 0, routes: [{ name: getHomeRouteForRole(role) }] });
      }, SUCCESS_HOLD_MS);
    } catch (error) {
      console.error('Staff login error:', error.code, error.message);
      setLoading(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      if (error.code === 'auth/invalid-email') {
        setFieldError({ email: 'Enter a valid email address.' });
        shake('email');
        return;
      }
      setAlert(alertForAuthError(error.code));
      if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(error.code)) {
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
  const buttonLabel = welcome ? welcome.button : !isConnected ? 'No Internet Connection' : 'Sign In';

  return (
    <AuthScaffold
      dark
      navigation={navigation}
      isConnected={isConnected}
      offlineText="No internet connection — you can sign in once you're back online."
      overlay={<SuccessToast text={welcome?.toast || ''} detail={welcome?.detail} />}
    >
      <FadeUp delay={T.pill} skip={skip} style={styles.pillRow}>
        <StaffPill />
      </FadeUp>
      <RiseTitle delay={T.title} skip={skip}>Staff sign in</RiseTitle>
      <FadeUp delay={T.sub} skip={skip}>
        <Subtitle>For Store Managers and Platform Admins.</Subtitle>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setHelpOpen(true);
          }}
          style={({ pressed }) => [styles.helpLink, pressed && { opacity: 0.7 }]}
          hitSlop={6}
          accessibilityRole="button"
        >
          <Ionicons name="help-circle-outline" size={16} color={PILL_INK} />
          <Text style={styles.helpLinkText}>How do I get a staff account?</Text>
        </Pressable>
      </FadeUp>

      <AuthAlert alert={alert} />

      <FadeUp delay={T.email} skip={skip}>
        <Field
          label="Work email"
          value={form.email}
          onChangeText={setField('email')}
          status={fieldError.email ? 'bad' : null}
          message={fieldError.email || ''}
          shakeKey={shakes.email}
          placeholder="you@store.com"
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
          status={fieldError.password ? 'bad' : null}
          message={fieldError.password || ''}
          shakeKey={shakes.password}
          placeholder="Enter your password"
          textContentType="password"
          autoComplete="password"
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
        />
      </FadeUp>

      {/* The same reset flow customers use. */}
      <FadeUp delay={T.forgot} skip={skip} style={styles.forgotRow}>
        <AuthLink onPress={() => navigation.navigate('ForgotPassword', { email: form.email.trim() })} style={styles.forgot}>
          Forgot password?
        </AuthLink>
      </FadeUp>

      <FadeUp delay={T.button} skip={skip}>
        <Button
          variant={welcome ? 'success' : 'primary'}
          label={buttonLabel}
          fontSize={16}
          onPress={handleSignIn}
          disabled={!welcome && (!ready || !isConnected)}
          loading={loading}
        />
      </FadeUp>

      <FadeUp delay={T.foot} skip={skip} style={styles.foot}>
        <AccessNote />
        <Text style={styles.footText}>
          Not staff? <AuthLink onPress={() => goToCustomerLogin()}>Back to customer log in</AuthLink>
        </Text>
      </FadeUp>
      <StaffLoggedOut
        visible={loggedOut}
        onSignIn={() => setLoggedOut(false)}
        storeName={route?.params?.storeName}
        loggedOutAt={route?.params?.loggedOutAt}
      />
      <StaffAccountSheet
        visible={helpOpen}
        onClose={() => setHelpOpen(false)}
        onSignUp={() => {
          setHelpOpen(false);
          navigation.navigate('Signup');
        }}
      />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  pillRow: { alignItems: 'flex-start', marginBottom: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(196,98,62,0.55)',
    backgroundColor: 'rgba(196,98,62,0.12)',
  },
  pillText: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1.7, color: PILL_INK },
  forgotRow: { alignItems: 'flex-end', marginTop: -4, marginBottom: 18 },
  forgot: { fontSize: 12.5, paddingVertical: 6, paddingHorizontal: 2 },
  foot: { marginTop: 'auto', paddingTop: 20, alignItems: 'center' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  noteText: { fontSize: 11.5, color: NOTE_INK },
  footText: { fontSize: 13, color: FOOT_INK, textAlign: 'center' },
  // The pill's light terracotta rather than Clay: Clay on ink is too dim
  // to read comfortably at this size.
  helpLink: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -10, marginBottom: 16, paddingVertical: 6 },
  helpLinkText: { fontSize: 13, fontWeight: '600', color: PILL_INK },

  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 6 },
  sheetIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(196,98,62,0.4)',
    backgroundColor: 'rgba(196,98,62,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: { flex: 1, fontSize: 19, fontWeight: '600', letterSpacing: -0.2, color: Colors.light.background, marginTop: 10 },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(250,247,242,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSub: { fontSize: 13, lineHeight: 20, color: FOOT_INK, marginTop: 6, marginBottom: 18 },
  timeline: { marginBottom: 16 },
  step: { flexDirection: 'row', gap: 14, paddingBottom: 18 },
  stepLine: { position: 'absolute', left: 15, top: 32, bottom: 0, width: 2 },
  stepNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumLast: { backgroundColor: '#3A332E', borderWidth: 1.5, borderColor: Colors.light.tint },
  stepNumText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  stepTitle: { fontSize: 14.5, fontWeight: '600', color: Colors.light.background, marginTop: 5 },
  stepBody: { fontSize: 12.5, lineHeight: 19, color: FOOT_INK, marginTop: 3 },
  stepEm: { fontWeight: '500', color: Colors.light.background },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  tag: {
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.6,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagClay: { backgroundColor: 'rgba(196,98,62,0.16)', color: PILL_INK },
  tagMoss: { backgroundColor: 'rgba(143,163,125,0.16)', color: '#CFE0BF' },
  sheetNote: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(143,163,125,0.3)',
    backgroundColor: 'rgba(143,163,125,0.12)',
    marginBottom: 18,
  },
  sheetNoteText: { flex: 1, fontSize: 12.5, lineHeight: 19, color: '#D5E0C9' },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ghostText: { fontSize: 15.5, fontWeight: '600', color: FOOT_INK },
});
