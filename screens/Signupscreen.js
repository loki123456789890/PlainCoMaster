import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import PrivacyPolicyModal from '../components/PrivacyPolicyModal';

// --- FIREBASE IMPORTS ---
import { auth, db } from '../firebaseConfig';
import { createUserWithEmailAndPassword, updateProfile, deleteUser } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';

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
  const { isConnected } = useNetworkStatus();

  const handleSignup = async () => {
    const { name, email, password, confirmPassword } = form;

    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Error", "Password should be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match");
      return;
    }

    if (!agreedToPrivacyPolicy) {
      Alert.alert("Error", "Please agree to the Privacy Policy to continue");
      return;
    }

    setLoading(true);

    // Phase 1: create the Auth account. Nothing exists yet if this fails,
    // so a failure here needs no cleanup — just report it, same as before.
    let user = null;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
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

      Alert.alert("Signup Failed", errorMessage);
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
      await updateProfile(user, { displayName: name });

      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name: name,
        email: email,
        createdAt: new Date().toISOString(),
        // Auditable consent record for the Philippine Data Privacy Act —
        // the checkbox above is just a UI gate, this is what actually
        // proves consent was given, and when.
        privacyConsentAccepted: true,
        privacyConsentTimestamp: serverTimestamp(),
      });

      Alert.alert("Success", "Account created successfully!", [
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

      Alert.alert("Signup Failed", "Could not complete signup. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity 
              onPress={() => navigation.navigate('Landing')}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={24} color="#8B6F47" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Create Account</Text>
            <View style={styles.headerPlaceholder} />
          </View>

          {/* Form */}
          <View style={styles.content}>
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your name"
                  placeholderTextColor="#999"
                  value={form.name}
                  onChangeText={(text) => setForm({...form, name: text})}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor="#999"
                  value={form.email}
                  onChangeText={(text) => setForm({...form, email: text})}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Enter your password"
                    placeholderTextColor="#999"
                    value={form.password}
                    onChangeText={(text) => setForm({...form, password: text})}
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#999" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <View style={styles.passwordInputContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Confirm your password"
                    placeholderTextColor="#999"
                    value={form.confirmPassword}
                    onChangeText={(text) => setForm({...form, confirmPassword: text})}
                    secureTextEntry={!showConfirmPassword}
                  />
                  <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                    <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#999" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.consentRow}>
                <TouchableOpacity
                  onPress={() => setAgreedToPrivacyPolicy((prev) => !prev)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={agreedToPrivacyPolicy ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={agreedToPrivacyPolicy ? '#8B6F47' : '#999'}
                  />
                </TouchableOpacity>
                <Text style={styles.consentText}>
                  I have read and agree to the{' '}
                  <Text style={styles.consentLink} onPress={() => setShowPrivacyModal(true)}>
                    Privacy Policy
                  </Text>
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.signupButton,
                  (loading || !isConnected) && styles.signupButtonDisabled,
                ]}
                onPress={handleSignup}
                disabled={loading || !isConnected}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.signupText}>
                    {!isConnected ? 'No Internet Connection' : 'Sign Up'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.loginButton}
                onPress={() => navigation.navigate('Login')}
              >
                <Text style={styles.loginText}>Already a member? Sign in</Text>
              </TouchableOpacity>
            </View>
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
  container: { flex: 1, backgroundColor: '#fff' },
  keyboardView: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  headerPlaceholder: { width: 40 },
  content: { paddingHorizontal: 32, paddingTop: 20 },
  form: { marginTop: 20 },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 16, fontWeight: '600', color: '#000', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000',
  },
  // Same border/radius/color as `input` above, just as a row container so
  // the eye toggle can sit at the trailing edge — matches
  // AdminLoginScreen's password field layout.
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000',
  },
  signupButton: {
    backgroundColor: '#8B6F47',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
    height: 56,
    justifyContent: 'center',
  },
  signupButtonDisabled: { backgroundColor: '#ccc' },
  signupText: { fontSize: 17, fontWeight: '600', color: '#fff' },
  loginButton: { alignItems: 'center', marginTop: 24, paddingVertical: 12 },
  loginText: { fontSize: 16, color: '#8B6F47' },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  consentText: { flex: 1, fontSize: 14, color: '#666', lineHeight: 20 },
  consentLink: { color: '#8B6F47', fontWeight: '600', textDecorationLine: 'underline' },
});