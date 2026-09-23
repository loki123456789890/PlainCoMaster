import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
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
import { auth, db } from '../../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useAdmin } from '../../context/AdminContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../../constants/theme';
import { getHomeRouteForRole } from '../../constants/roles';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Password show/hide control — a proper 44pt-plus touch target (the icon
// itself is only 20px), a satisfying scale pulse on tap, and an icon
// crossfade instead of an instant swap. Identical to Loginscreen.js's
// version so the interaction feels the same on both login surfaces.
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

export default function AdminLoginScreen({ navigation }) {
  const { loginAsAdmin } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const passwordInputRef = useRef(null);

  // Shake targets for the two fields — same shake shape Loginscreen.js uses
  // for invalid or empty fields on submit.
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
  // Mirrors Loginscreen.js's validate().
  const validate = () => {
    const nextErrors = { email: '', password: '' };

    if (!email.trim()) {
      nextErrors.email = 'Enter your staff email.';
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
      // Actually sign in with Firebase Auth instead of faking it with a timer
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const uid = userCredential.user.uid;

      // Confirm this account actually holds one of the two privileged
      // roles before letting them in. This mirrors isSeller()/
      // isPlatformAdmin() in firestore.rules, so a customer account can't
      // reach either portal even if they know this screen exists. "admin"
      // is not a valid role anymore — the role split replaced it with
      // "seller" and "platformAdmin", and no document holds "admin".
      const userDocRef = doc(db, 'users', uid);
      const userDocSnap = await getDoc(userDocRef);
      const role = userDocSnap.exists() ? userDocSnap.data().role : null;
      const isPrivilegedRole = role === 'seller' || role === 'platformAdmin';

      if (!userDocSnap.exists() || !isPrivilegedRole) {
        await auth.signOut();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showAppAlert(
          'Access Denied',
          'This account does not have Store Manager or Platform Admin privileges.'
        );
        setLoading(false);
        return;
      }

      // Deactivation check — a privileged account can be deactivated by a
      // platformAdmin (AdminUsersScreen), and that flag needs to actually
      // block sign-in here, not just hide the account in a list somewhere.
      if (userDocSnap.data().isActive === false) {
        await auth.signOut();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showAppAlert(
          'Account Deactivated',
          'This staff account has been deactivated.'
        );
        setLoading(false);
        return;
      }

      // Role confirmed server-side above — now reflect it in AdminContext
      // so useAdmin().role actually tracks who's signed in, instead of
      // always being null (nothing was calling this before).
      loginAsAdmin(role);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setLoading(false);
      // Platform administration is account/role management, not
      // product/order operations — landing a platformAdmin on the seller
      // dashboard they can't write to would be misleading.
      //
      // Shared with LandingScreen, which needs the same answer when it
      // skips itself for a persisted staff session. Two copies of this
      // mapping would drift the first time a role or a route is renamed.
      //
      // reset, not replace: the portal becomes the only screen. replace
      // left the customer Login screen underneath, so Back — the header
      // arrow, or Android's back gesture — took a signed-in staff member
      // to a login form. Now Back leaves the app, like any home screen,
      // and Log out is the way out of the portal.
      navigation.reset({ index: 0, routes: [{ name: getHomeRouteForRole(role) }] });
    } catch (error) {
      setLoading(false);
      console.error('Staff login error:', error);

      // Firebase error codes -> friendly messages
      let message = 'Could not sign in. Please try again.';
      if (error.code === 'auth/network-request-failed') {
        message = 'No internet connection. Please check your connection and try again.';
      } else if (
        error.code === 'auth/invalid-credential' ||
        error.code === 'auth/wrong-password' ||
        error.code === 'auth/user-not-found'
      ) {
        message = 'Invalid email or password.';
        triggerShake(passwordShakeX);
      } else if (error.code === 'auth/invalid-email') {
        message = 'Please enter a valid email address.';
      } else if (error.code === 'auth/too-many-requests') {
        message = 'Too many failed attempts. Please try again later.';
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Login Failed', message);
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // No history to go back to — this happens right after an admin
      // logout, since StoreManagerDashboardScreen resets the nav stack (and
      // signs out of the single shared Firebase Auth session) so "back"
      // can't return into an authenticated admin screen. Landing on
      // Profile here would be worse — it expects someone signed in.
      navigation.navigate('Home');
    }
  };

  const handleCustomerLogin = () => {
    Haptics.selectionAsync();
    navigation.navigate('Login');
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
            No internet connection — sign-in will be unavailable until you&apos;re back online.
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
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(280).easing(EASE_OUT_QUART)}
              style={styles.logoContainer}
            >
              <View style={styles.logo}>
                <Ionicons name="shield-checkmark" size={56} color={Colors.light.tint} />
              </View>
              {/* One login for both privileged roles, so it can't name
                  either one — the old "Sign in to manage your store" was
                  simply false for a Platform Admin, who has no store
                  access at all. The account's own role decides where it
                  lands (see the navigation.replace() below); this screen
                  just says who it's for. */}
              <Text style={styles.title}>Staff Portal</Text>
              <Text style={styles.subtitle}>For store managers and platform admins</Text>
            </Animated.View>

            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(280).delay(80).easing(EASE_OUT_QUART)}
              style={styles.form}
            >
              <Animated.View style={emailShakeStyle}>
                <Input
                  label="Staff Email"
                  value={email}
                  onChangeText={handleEmailChange}
                  placeholder="you@gmail.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="username"
                  autoComplete="email"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  error={errors.email}
                  accessibilityLabel="Staff email"
                  accessibilityHint="Enter the email address for your staff account"
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
                      accessibilityHint="Enter the password for your staff account"
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
                <Ionicons name="lock-closed-outline" size={13} color={Colors.light.icon} />
                <Text style={styles.trustText}>Restricted to authorized staff accounts</Text>
              </View>
            </Animated.View>

            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(240).delay(160).easing(EASE_OUT_QUART)}
              style={styles.infoContainer}
            >
              <View style={styles.infoCard}>
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={Colors.light.icon}
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                />
                <Text style={styles.infoText}>
                  This portal is for store managers and platform admins.{' '}
                  <Text
                    style={styles.infoLink}
                    onPress={handleCustomerLogin}
                    accessibilityRole="button"
                    accessibilityLabel="Go to customer login"
                  >
                    Use the customer login
                  </Text>{' '}
                  if you&apos;re shopping.
                </Text>
              </View>
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  backButton: { width: 44, height: 44, justifyContent: 'center' },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.danger + '40',
  },
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Spacing.xxl,
  },
  content: { paddingHorizontal: Spacing.md },
  logoContainer: {
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.xl,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.light.tint + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.light.icon,
  },
  form: {
    marginBottom: Spacing.lg,
  },
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
  signInButtonWrap: { marginTop: Spacing.sm },
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.md,
  },
  trustText: { fontSize: 12, color: Colors.light.icon },
  infoContainer: {
    marginTop: Spacing.sm,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: Colors.light.background,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: Colors.light.icon,
    lineHeight: 18,
  },
  infoLink: {
    color: Colors.light.tint,
    fontWeight: '600',
  },
});
