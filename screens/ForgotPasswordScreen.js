// screens/ForgotPasswordScreen.js
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
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
} from 'react-native-reanimated';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// --- FIREBASE IMPORTS ---
import { auth } from '../firebaseConfig';
import { sendPasswordResetEmail } from 'firebase/auth';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const emailShakeX = useSharedValue(0);
  const emailShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: emailShakeX.value }] }));

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
    if (error) setError('');
  };

  // Instant feedback for the most common slip (empty or malformed email)
  // before ever touching the network — mirrors Loginscreen.js/
  // Signupscreen.js's validate().
  const validate = () => {
    const trimmed = email.trim();
    let nextError = '';

    if (!trimmed) {
      nextError = 'Enter your email address.';
    } else if (!EMAIL_PATTERN.test(trimmed)) {
      nextError = 'Enter a valid email address.';
    }

    setError(nextError);

    if (nextError) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      triggerShake(emailShakeX);
      return false;
    }
    return true;
  };

  const handlePasswordReset = async () => {
    if (!validate()) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await sendPasswordResetEmail(auth, email.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        "Email Sent",
        "If an account exists for that email address, a password reset link has been sent. Please check your inbox and spam folder.",
        [
          {
            text: "OK",
            onPress: () => navigation.goBack()
          }
        ]
      );
    } catch (error) {
      // auth/user-not-found is intentionally handled as a success, not a
      // distinct error: the message above is deliberately vague about
      // whether an account exists so this screen can't be used to
      // enumerate registered emails. Showing "no account found" here would
      // undo that protection.
      if (error.code === 'auth/user-not-found') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showAppAlert(
          "Email Sent",
          "If an account exists for that email address, a password reset link has been sent. Please check your inbox and spam folder.",
          [
            {
              text: "OK",
              onPress: () => navigation.goBack()
            }
          ]
        );
        return;
      }

      let errorMessage = "Something went wrong. Please try again.";

      if (error.code === 'auth/network-request-failed') {
        errorMessage = "No internet connection. Please check your connection and try again.";
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = "Please enter a valid email address.";
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert("Reset Failed", errorMessage);
      console.error(error.code, error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => navigation.goBack()}
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
            No internet connection — password reset will be unavailable until you&apos;re back online.
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Content */}
          <View style={styles.content}>
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(280).easing(EASE_OUT_QUART)}
              style={styles.iconCircle}
            >
              <Ionicons name="key-outline" size={36} color={Colors.light.tint} />
            </Animated.View>

            <Animated.Text
              entering={reduceMotion ? undefined : FadeIn.duration(260).delay(40).easing(EASE_OUT_QUART)}
              style={styles.title}
            >
              Forgot Password
            </Animated.Text>
            <Animated.Text
              entering={reduceMotion ? undefined : FadeIn.duration(240).delay(80).easing(EASE_OUT_QUART)}
              style={styles.subtitle}
            >
              Enter your email address and we&apos;ll send you a link to reset your password.
            </Animated.Text>

            {/* Form */}
            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(280).delay(140).easing(EASE_OUT_QUART)}
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
                  returnKeyType="done"
                  onSubmitEditing={handlePasswordReset}
                  error={error}
                  accessibilityLabel="Email address"
                  accessibilityHint="Enter the email address for your account to receive a password reset link"
                />
              </Animated.View>

              <View style={styles.resetButtonWrap}>
                <Button
                  variant="primary"
                  label={!isConnected ? 'No Internet Connection' : 'Send Reset Link'}
                  onPress={handlePasswordReset}
                  disabled={loading || !isConnected}
                  loading={loading}
                />
              </View>

              <View style={styles.trustRow}>
                <Ionicons name="shield-checkmark-outline" size={13} color={Colors.light.icon} />
                <Text style={styles.trustText}>Your information stays private and secure</Text>
              </View>

              <AnimatedPressable
                style={styles.cancelButton}
                onPress={() => {
                  Haptics.selectionAsync();
                  navigation.goBack();
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                accessibilityHint="Returns to the sign in screen"
              >
                <Text style={styles.cancelText}>Cancel</Text>
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
  scrollContent: { flexGrow: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
    justifyContent: 'center',
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.light.tint + '20',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
    textAlign: 'center',
    marginBottom: 14,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.light.icon,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 40,
    paddingHorizontal: 8,
  },
  form: { marginTop: 0 },
  resetButtonWrap: { marginTop: 8 },
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  trustText: { fontSize: 12, color: Colors.light.icon },
  cancelButton: { alignItems: 'center', marginTop: 20, paddingVertical: 14 },
  cancelText: { fontSize: 16, color: Colors.light.tint, fontWeight: '500' },
});
