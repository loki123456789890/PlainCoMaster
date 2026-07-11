// screens/LoginScreen.js (UPDATED)
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

// --- FIREBASE IMPORTS ---
import { auth, db } from '../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

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

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Single Firestore read covers both checks below: deactivation and
      // role. A deactivated account can still authenticate successfully
      // with Firebase Auth (deactivation is a Firestore flag, not an
      // Auth-level disable), so we have to check it ourselves right here.
      const userDocRef = doc(db, 'users', uid);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists() && userDocSnap.data().isActive === false) {
        await auth.signOut();
        Alert.alert(
          "Account Deactivated",
          "This account has been deactivated. Please contact support if you believe this is a mistake."
        );
        setLoading(false);
        return;
      }

      // Admin accounts don't belong in the customer flow — Firebase Auth
      // itself has no concept of role, so this is the only place that can
      // stop an admin credential from landing on the customer HomeScreen.
      // Mirrors AdminLoginScreen's own role check, just in reverse.
      if (userDocSnap.exists() && userDocSnap.data().role === 'admin') {
        await auth.signOut();
        Alert.alert(
          "Admin Account",
          "This is an admin account. Please sign in through the Admin Portal instead.",
          [
            { text: "Go to Admin Portal", onPress: () => navigation.navigate('AdminLogin') },
            { text: "Cancel", style: "cancel" }
          ]
        );
        setLoading(false);
        return;
      }

      navigation.navigate('Home');
    } catch (error) {
      let errorMessage = "Invalid email or password.";
      
      if (error.code === 'auth/user-not-found') {
        errorMessage = "No account found with this email.";
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = "Incorrect password.";
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = "Please enter a valid email address.";
      }

      Alert.alert("Login Failed", errorMessage);
      console.error(error.code, error.message);
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
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#8B6F47" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.content}>
            <Text style={styles.welcomeTitle}>Hello there,</Text>
            <Text style={styles.welcomeSubtitle}>Welcome back</Text>

            {/* Form */}
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor="#999"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  placeholderTextColor="#999"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
              </View>

              <TouchableOpacity 
                style={[styles.signInButton, loading && { opacity: 0.8 }]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.signInText}>Sign In</Text>
                )}
              </TouchableOpacity>

              {/* THIS IS THE ONLY CHANGE MADE */}
              <TouchableOpacity 
                style={styles.forgotButton}
                onPress={() => navigation.navigate('ForgotPassword')}
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.signupButton}
                onPress={() => navigation.navigate('Signup')}
              >
                <Text style={styles.signupText}>Not here? Sign up instead</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  keyboardView: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16 },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  content: { paddingHorizontal: 32, paddingTop: 40 },
  welcomeTitle: { fontSize: 28, fontWeight: '700', color: '#000', marginBottom: 8 },
  welcomeSubtitle: { fontSize: 17, color: '#666', marginBottom: 40 },
  form: { marginTop: 20 },
  inputGroup: { marginBottom: 24 },
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
  signInButton: {
    backgroundColor: '#8B6F47',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
    height: 56,
    justifyContent: 'center',
  },
  signInText: { fontSize: 17, fontWeight: '600', color: '#fff' },
  forgotButton: { alignItems: 'center', marginTop: 24, paddingVertical: 12 },
  forgotText: { fontSize: 16, color: '#8B6F47' },
  signupButton: { alignItems: 'center', marginTop: 16, paddingVertical: 12 },
  signupText: { fontSize: 16, color: '#8B6F47' },
});