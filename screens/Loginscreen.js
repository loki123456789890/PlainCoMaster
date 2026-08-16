// screens/LoginScreen.js (UPDATED)
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
import AnimatedPressable from '../components/ui/AnimatedPressable';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// --- FIREBASE IMPORTS ---
import { auth, db } from '../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../constants/theme';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { getRoleLabel, ROLE_SELLER, ROLE_PLATFORM_ADMIN } from '../constants/roles';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Password show/hide control — a proper 44pt-plus touch target (the icon
// itself is only 20px), a satisfying scale pulse on tap, and an icon
// crossfade instead of an instant swap so the state change reads as
// deliberate rather than a flicker.
function PasswordToggle({ visible, onToggle, reduceMotion }) {
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
      accessibilityLabel={visible ? 'Hide password' : 'Show password'}
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

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const passwordInputRef = useRef(null);

  // Shake targets for the two fields — same shake shape Checkoutscreen.js
  // uses for its missing address/payment selections, applied here to
  // invalid or empty fields on submit.
  const emailShakeX = useSharedValue(0);
  const passwordShakeX = useSharedValue(0);
  const emailShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: emailShakeX.value }] }));
  const passwordShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: passwordShakeX.value }] }));

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
      // Reached here via navigation.replace('Login') from LandingScreen,
      // which swaps the stack entry instead of pushing one — so there's
      // no history to go back to. Landing is the natural pre-auth fallback.
      navigation.navigate('Landing');
    }
  };

  const handleEmailChange = (text) => {
    setEmail(text);
    if (errors.email) setErrors((prev) => ({ ...prev, email: '' }));
  };

  const handlePasswordChange = (text) => {
    setPassword(text);
    if (errors.password) setErrors((prev) => ({ ...prev, password: '' }));
  };

  // Client-side check before ever touching the network — instant feedback
  // for the most common slip (empty or malformed field), no round trip and
  // no modal required since the error renders right under the field.
  const validate = () => {
    const nextErrors = { email: '', password: '' };

    if (!email.trim()) {
      nextErrors.email = 'Enter your email address.';
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (!password) {
      nextErrors.password = 'Enter your password.';
    }

    setErrors(nextErrors);

    const hasErrors = Boolean(nextErrors.email || nextErrors.password);
    if (hasErrors) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (nextErrors.email) triggerShake(emailShakeX);
      if (nextErrors.password) triggerShake(passwordShakeX);
    }
    return !hasErrors;
  };

  const handleLogin = async () => {
    if (!validate()) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const uid = userCredential.user.uid;

      // Single Firestore read covers both checks below: deactivation and
      // role. A deactivated account can still authenticate successfully
      // with Firebase Auth (deactivation is a Firestore flag, not an
      // Auth-level disable), so we have to check it ourselves right here.
      const userDocRef = doc(db, 'users', uid);
      const userDocSnap = await getDoc(userDocRef);

      // An Auth account with no matching Firestore document has no
      // privacyConsentAccepted record, no isActive flag, and no role —
      // the two checks below are both gated on exists() and would
      // silently skip themselves for exactly this case, falling straight
      // through to Home. Catch it explicitly instead.
      if (!userDocSnap.exists()) {
        await auth.signOut();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showAppAlert(
          "Account Error",
          "We couldn't load your account details. Please sign up again or contact support."
        );
        setLoading(false);
        return;
      }

      if (userDocSnap.exists() && userDocSnap.data().isActive === false) {
        await auth.signOut();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showAppAlert(
          "Account Deactivated",
          "This account has been deactivated. Please contact support if you believe this is a mistake."
        );
        setLoading(false);
        return;
      }

      // Staff accounts don't belong in the customer flow — Firebase Auth
      // itself has no concept of role, so this is the only place that can
      // stop a staff credential from landing on the customer HomeScreen.
      // Mirrors AdminLoginScreen's own role check, just in reverse.
      //
      // This tested `role === 'admin'` until the role split, which left it
      // comparing against a value no document holds any more — so it
      // silently stopped matching anyone and both privileged roles fell
      // straight through to HomeScreen. Checked against the same
      // PRIVILEGED_ROLES list the rest of the app uses, so adding a role
      // later can't reopen the same hole.
      const signedInRole = userDocSnap.exists() ? userDocSnap.data().role : null;
      if (signedInRole === ROLE_SELLER || signedInRole === ROLE_PLATFORM_ADMIN) {
        await auth.signOut();
        showAppAlert(
          "Staff Account",
          `This is a ${getRoleLabel(signedInRole)} account. Please sign in through the Staff Portal instead.`,
          [
            { text: "Go to Staff Portal", onPress: () => navigation.navigate('AdminLogin') },
            { text: "Cancel", style: "cancel" }
          ]
        );
        setLoading(false);
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.navigate('Home');
    } catch (error) {
      let errorMessage = "Invalid email or password.";

      if (error.code === 'auth/network-request-failed') {
        errorMessage = "No internet connection. Please check your connection and try again.";
      } else if (error.code === 'auth/user-not-found') {
        errorMessage = "No account found with this email.";
      } else if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        errorMessage = "Incorrect email or password.";
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = "Please enter a valid email address.";
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = "Too many attempts. Please wait a moment and try again.";
      }

      if (
        error.code === 'auth/wrong-password' ||
        error.code === 'auth/invalid-credential' ||
        error.code === 'auth/user-not-found'
      ) {
        triggerShake(passwordShakeX);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert("Login Failed", errorMessage);
      console.error(error.code, error.message);
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
            No internet connection — sign in will be unavailable until you&apos;re back online.
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
              style={styles.welcomeTitle}
            >
              Hello there,
            </Animated.Text>
            <Animated.Text
              entering={reduceMotion ? undefined : FadeIn.duration(240).delay(60).easing(EASE_OUT_QUART)}
              style={styles.welcomeSubtitle}
            >
              Welcome back
            </Animated.Text>

            {/* Form */}
            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(280).delay(120).easing(EASE_OUT_QUART)}
              style={styles.form}
            >
              <Animated.View style={emailShakeStyle}>
                <Input
                  label="Email Address"
                  value={email}
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
                  accessibilityHint="Enter the email address for your account"
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
                      placeholder="Enter your password"
                      placeholderTextColor={Colors.light.icon}
                      value={password}
                      onChangeText={handlePasswordChange}
                      secureTextEntry={!showPassword}
                      textContentType="password"
                      autoComplete="password"
                      returnKeyType="done"
                      onSubmitEditing={handleLogin}
                      accessibilityLabel="Password"
                      accessibilityHint="Enter the password for your account"
                    />
                    <PasswordToggle
                      visible={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      reduceMotion={reduceMotion}
                    />
                  </View>
                  {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
                </View>
              </Animated.View>

              <View style={styles.signInButtonWrap}>
                <Button
                  variant="primary"
                  label={!isConnected ? 'No Internet Connection' : 'Sign In'}
                  onPress={handleLogin}
                  disabled={loading || !isConnected}
                  loading={loading}
                />
              </View>

              <View style={styles.trustRow}>
                <Ionicons name="shield-checkmark-outline" size={13} color={Colors.light.icon} />
                <Text style={styles.trustText}>Your information stays private and secure</Text>
              </View>

              <AnimatedPressable
                style={styles.forgotButton}
                onPress={() => {
                  Haptics.selectionAsync();
                  navigation.navigate('ForgotPassword');
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Forgot password"
                accessibilityHint="Opens the password reset screen"
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={styles.signupButton}
                onPress={() => {
                  Haptics.selectionAsync();
                  navigation.navigate('Signup');
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Sign up instead"
                accessibilityHint="Opens the account creation screen"
              >
                <Text style={styles.signupText}>Not here? Sign up instead</Text>
              </AnimatedPressable>
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  content: { paddingHorizontal: 20, paddingTop: 24 },
  welcomeTitle: { fontSize: 28, fontWeight: '700', color: Colors.light.text, marginBottom: 8 },
  welcomeSubtitle: { fontSize: 17, color: Colors.light.icon, marginBottom: 40 },
  form: { marginTop: 20 },
  inputGroup: { marginBottom: Spacing.md },
  label: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: Spacing.xs },
  // Mirrors Input's own field styling (Radius.md, same padding/type scale)
  // so the two fields read as one consistent pair — only the trailing eye
  // toggle needs this to be a hand-rolled row instead of the Input
  // component itself.
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
  signInButtonWrap: { marginTop: 20 },
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  trustText: { fontSize: 12, color: Colors.light.icon },
  forgotButton: { alignItems: 'center', marginTop: 20, paddingVertical: 12 },
  forgotText: { fontSize: 16, color: Colors.light.tint },
  signupButton: { alignItems: 'center', marginTop: 16, paddingVertical: 12 },
  signupText: { fontSize: 16, color: Colors.light.tint },
});
