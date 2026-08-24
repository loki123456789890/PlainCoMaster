import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
} from 'react-native-reanimated';

import PrivacyPolicyModal from '../components/PrivacyPolicyModal';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// --- FIREBASE IMPORTS ---
import { auth, db } from '../firebaseConfig';
import { createUserWithEmailAndPassword, updateProfile, deleteUser } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../constants/theme';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Password show/hide control — a proper 44pt-plus touch target (the icon
// itself is only 20px), a satisfying scale pulse on tap, and an icon
// crossfade instead of an instant swap so the state change reads as
// deliberate rather than a flicker. Identical to Loginscreen.js's version
// so both password fields in the auth flow behave the same way.
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
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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

// Privacy-policy consent checkbox — same tap-pulse vocabulary as
// PasswordToggle above so every interactive control in the form feels like
// one system.
function ConsentCheckbox({ checked, onToggle, reduceMotion }) {
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
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel="Agree to the Privacy Policy"
    >
      <Animated.View style={animatedStyle}>
        <Ionicons
          name={checked ? 'checkbox' : 'square-outline'}
          size={22}
          color={checked ? Colors.light.tint : Colors.light.icon}
        />
      </Animated.View>
    </Pressable>
  );
}

export default function SignupScreen({ navigation }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });

  const [loading, setLoading] = useState(false);
  const [agreedToPrivacyPolicy, setAgreedToPrivacyPolicy] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({ name: '', email: '', password: '', confirmPassword: '', consent: '' });
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const emailInputRef = useRef(null);
  const passwordInputRef = useRef(null);
  const confirmPasswordInputRef = useRef(null);

  // Shake targets, one per field — same shake shape Loginscreen.js and
  // Checkoutscreen.js use for invalid or missing selections, applied here
  // to every field with a validation error on submit.
  const nameShakeX = useSharedValue(0);
  const emailShakeX = useSharedValue(0);
  const passwordShakeX = useSharedValue(0);
  const confirmShakeX = useSharedValue(0);
  const consentShakeX = useSharedValue(0);
  const nameShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nameShakeX.value }] }));
  const emailShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: emailShakeX.value }] }));
  const passwordShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: passwordShakeX.value }] }));
  const confirmShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: confirmShakeX.value }] }));
  const consentShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: consentShakeX.value }] }));

  const triggerShake = (sharedValue) => {
    if (reduceMotion) return;
    sharedValue.value = withSequence(
      withTiming(-6, { duration: 45, easing: Easing.linear }),
      withTiming(6, { duration: 45, easing: Easing.linear }),
      withTiming(-4, { duration: 45, easing: Easing.linear }),
      withTiming(4, { duration: 45, easing: Easing.linear }),
      withTiming(0, { duration: 45, easing: Easing.linear })
    );
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // Reached here via navigation.replace('Signup') from LandingScreen,
      // which swaps the stack entry instead of pushing one — so there's no
      // history to go back to. Landing is the natural pre-auth fallback,
      // same as Loginscreen.js's handleBack.
      navigation.navigate('Landing');
    }
  };

  const handleNameChange = (text) => {
    setForm((prev) => ({ ...prev, name: text }));
    if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
  };

  const handleEmailChange = (text) => {
    setForm((prev) => ({ ...prev, email: text }));
    if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
  };

  const handlePasswordChange = (text) => {
    setForm((prev) => ({ ...prev, password: text }));
    if (errors.password) setErrors((prev) => ({ ...prev, password: '' }));
  };

  const handleConfirmPasswordChange = (text) => {
    setForm((prev) => ({ ...prev, confirmPassword: text }));
    if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: '' }));
  };

  const handleConsentToggle = () => {
    setAgreedToPrivacyPolicy((prev) => !prev);
    if (errors.consent) setErrors((prev) => ({ ...prev, consent: '' }));
  };

  // Client-side check before ever touching the network — instant feedback
  // for the most common slips (empty fields, short password, mismatched
  // confirmation, missing consent), no modal required since every error
  // renders right under its field. Mirrors Loginscreen.js's validate().
  const validate = () => {
    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim();
    const nextErrors = { name: '', email: '', password: '', confirmPassword: '', consent: '' };

    if (!trimmedName) {
      nextErrors.name = 'Enter your name.';
    }

    if (!trimmedEmail) {
      nextErrors.email = 'Enter your email address.';
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!form.password) {
      nextErrors.password = 'Enter a password.';
    } else if (form.password.length < 6) {
      nextErrors.password = 'Password should be at least 6 characters.';
    }

    if (!form.confirmPassword) {
      nextErrors.confirmPassword = 'Confirm your password.';
    } else if (form.confirmPassword !== form.password) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    if (!agreedToPrivacyPolicy) {
      nextErrors.consent = 'Please agree to the Privacy Policy to continue.';
    }

    setErrors(nextErrors);

    const hasErrors = Object.values(nextErrors).some(Boolean);
    if (hasErrors) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (nextErrors.name) triggerShake(nameShakeX);
      if (nextErrors.email) triggerShake(emailShakeX);
      if (nextErrors.password) triggerShake(passwordShakeX);
      if (nextErrors.confirmPassword) triggerShake(confirmShakeX);
      if (nextErrors.consent) triggerShake(consentShakeX);
    }
    return !hasErrors;
  };

  const handleSignup = async () => {
    if (!validate()) return;

    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim();
    const { password } = form;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Phase 1: create the Auth account. Nothing exists yet if this fails,
    // so a failure here needs no cleanup — just report it, same as before.
    let user = null;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      user = userCredential.user;
    } catch (error) {
      setLoading(false);
      let errorMessage = "Something went wrong. Please try again.";

      if (error.code === 'auth/network-request-failed') {
        errorMessage = "No internet connection. Please check your connection and try again.";
      } else if (error.code === 'auth/email-already-in-use') {
        errorMessage = "That email address is already in use!";
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = "That email address is invalid!";
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert("Signup Failed", errorMessage);
      console.error(error.code, error.message);
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

      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name: trimmedName,
        email: trimmedEmail,
        // serverTimestamp(), like every other createdAt in the app. A
        // client-supplied date is whatever the device's clock says — a
        // wrong timezone, a skewed clock, or a deliberately set one — and
        // it does not sort against the Timestamps every other collection
        // stores. The users create rule allows the field without
        // constraining its type, so this was accepted; it was just the
        // one place still writing a string.
        createdAt: serverTimestamp(),
        // Auditable consent record for the Philippine Data Privacy Act —
        // the checkbox above is just a UI gate, this is what actually
        // proves consent was given, and when.
        privacyConsentAccepted: true,
        privacyConsentTimestamp: serverTimestamp(),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert("Success", "Account created successfully!", [
        { text: "OK", onPress: () => navigation.navigate('Home') }
      ]);
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

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert("Signup Failed", "Could not complete signup. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AnimatedPressable
          onPress={handleBack}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </AnimatedPressable>
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — account creation will be unavailable until you&apos;re back online.
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.content}>
            <Animated.Text
              entering={reduceMotion ? undefined : FadeIn.duration(260).easing(EASE_OUT_QUART)}
              style={styles.title}
            >
              Create Account
            </Animated.Text>
            <Animated.Text
              entering={reduceMotion ? undefined : FadeIn.duration(240).delay(60).easing(EASE_OUT_QUART)}
              style={styles.subtitle}
            >
              Join PlainCo and start shopping smarter
            </Animated.Text>

            {/* Form */}
            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(280).delay(120).easing(EASE_OUT_QUART)}
              style={styles.form}
            >
              <Animated.View style={nameShakeStyle}>
                <Input
                  label="Name"
                  value={form.name}
                  onChangeText={handleNameChange}
                  placeholder="Enter your name"
                  textContentType="name"
                  autoComplete="name"
                  returnKeyType="next"
                  onSubmitEditing={() => emailInputRef.current?.focus()}
                  error={errors.name}
                  accessibilityLabel="Name"
                  accessibilityHint="Enter your full name"
                />
              </Animated.View>

              <Animated.View style={emailShakeStyle}>
                <Input
                  ref={emailInputRef}
                  label="Email Address"
                  value={form.email}
                  onChangeText={handleEmailChange}
                  placeholder="Enter your email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="username"
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  error={errors.email}
                  accessibilityLabel="Email address"
                  accessibilityHint="Enter the email address for your new account"
                />
              </Animated.View>

              <Animated.View style={passwordShakeStyle}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Password</Text>
                  <View
                    style={[
                      styles.passwordInputContainer,
                      errors.password && styles.passwordInputContainerError,
                    ]}
                  >
                    <TextInput
                      ref={passwordInputRef}
                      style={styles.passwordInput}
                      placeholder="At least 6 characters"
                      placeholderTextColor={Colors.light.icon}
                      value={form.password}
                      onChangeText={handlePasswordChange}
                      secureTextEntry={!showPassword}
                      textContentType="newPassword"
                      autoComplete="password-new"
                      returnKeyType="next"
                      onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
                      accessibilityLabel="Password"
                      accessibilityHint="Create a password with at least 6 characters"
                    />
                    <PasswordToggle
                      visible={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      reduceMotion={reduceMotion}
                      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                    />
                  </View>
                  {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
                </View>
              </Animated.View>

              <Animated.View style={confirmShakeStyle}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Confirm Password</Text>
                  <View
                    style={[
                      styles.passwordInputContainer,
                      errors.confirmPassword && styles.passwordInputContainerError,
                    ]}
                  >
                    <TextInput
                      ref={confirmPasswordInputRef}
                      style={styles.passwordInput}
                      placeholder="Re-enter your password"
                      placeholderTextColor={Colors.light.icon}
                      value={form.confirmPassword}
                      onChangeText={handleConfirmPasswordChange}
                      secureTextEntry={!showConfirmPassword}
                      textContentType="newPassword"
                      autoComplete="password-new"
                      returnKeyType="done"
                      onSubmitEditing={handleSignup}
                      accessibilityLabel="Confirm password"
                      accessibilityHint="Re-enter your password to confirm it matches"
                    />
                    <PasswordToggle
                      visible={showConfirmPassword}
                      onToggle={() => setShowConfirmPassword((v) => !v)}
                      reduceMotion={reduceMotion}
                      accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    />
                  </View>
                  {errors.confirmPassword ? <Text style={styles.errorText}>{errors.confirmPassword}</Text> : null}
                </View>
              </Animated.View>

              <Animated.View style={consentShakeStyle}>
                <View style={styles.consentRow}>
                  <ConsentCheckbox
                    checked={agreedToPrivacyPolicy}
                    onToggle={handleConsentToggle}
                    reduceMotion={reduceMotion}
                  />
                  <Text style={styles.consentText}>
                    I have read and agree to the{' '}
                    <Text style={styles.consentLink} onPress={() => setShowPrivacyModal(true)}>
                      Privacy Policy
                    </Text>
                  </Text>
                </View>
                {errors.consent ? <Text style={styles.errorText}>{errors.consent}</Text> : null}
              </Animated.View>

              <View style={styles.signupButtonWrap}>
                <Button
                  variant="primary"
                  label={!isConnected ? 'No Internet Connection' : 'Sign Up'}
                  onPress={handleSignup}
                  disabled={loading || !isConnected}
                  loading={loading}
                />
              </View>

              <View style={styles.trustRow}>
                <Ionicons name="shield-checkmark-outline" size={13} color={Colors.light.icon} />
                <Text style={styles.trustText}>Your information stays private and secure</Text>
              </View>

              <AnimatedPressable
                style={styles.loginButton}
                onPress={() => {
                  Haptics.selectionAsync();
                  navigation.navigate('Login');
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Sign in instead"
                accessibilityHint="Opens the sign in screen"
              >
                <Text style={styles.loginText}>Already a member? Sign in</Text>
              </AnimatedPressable>
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <PrivacyPolicyModal
        visible={showPrivacyModal}
        onClose={() => setShowPrivacyModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 20, paddingVertical: 16 },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.danger + '40',
  },
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
  keyboardView: { flex: 1 },
  scrollContent: { paddingBottom: Spacing.xxl },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  title: { fontSize: 28, fontWeight: '700', color: Colors.light.text, marginBottom: 8 },
  subtitle: { fontSize: 17, color: Colors.light.icon, marginBottom: 32 },
  form: { marginTop: 12 },
  inputGroup: { marginBottom: Spacing.md },
  label: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: Spacing.xs },
  // Mirrors Input's own field styling (Radius.md, same padding/type scale)
  // so the two fields read as one consistent pair — only the trailing eye
  // toggle needs this to be a hand-rolled row instead of the Input
  // component itself. Identical to Loginscreen.js's password field.
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  passwordInputContainerError: {
    borderColor: Colors.light.danger,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.light.text,
  },
  errorText: {
    fontSize: 12,
    color: Colors.light.danger,
    marginTop: Spacing.xs,
  },
  signupButtonWrap: { marginTop: 8 },
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  trustText: { fontSize: 12, color: Colors.light.icon },
  loginButton: { alignItems: 'center', marginTop: 16, paddingVertical: 12 },
  loginText: { fontSize: 16, color: Colors.light.tint },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
    marginBottom: Spacing.md,
  },
  consentText: { flex: 1, fontSize: 14, color: Colors.light.icon, lineHeight: 20 },
  consentLink: { color: Colors.light.tint, fontWeight: '600', textDecorationLine: 'underline' },
});
