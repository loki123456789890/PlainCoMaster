import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../../firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useAdmin } from '../../context/AdminContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';

export default function AdminLoginScreen({ navigation }) {
  const { loginAsAdmin } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { isConnected } = useNetworkStatus();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    setLoading(true);

    try {
      // Actually sign in with Firebase Auth instead of faking it with a timer
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const uid = userCredential.user.uid;

      // Confirm this account is actually an admin before letting them in.
      // This mirrors the isAdmin() check in firestore.rules, so a customer
      // account can't reach the dashboard even if they know this screen exists.
      const userDocRef = doc(db, 'users', uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists() || userDocSnap.data().role !== 'admin') {
        await auth.signOut();
        Alert.alert(
          'Access Denied',
          'This account does not have admin privileges.'
        );
        setLoading(false);
        return;
      }

      // Deactivation check — an admin account can be deactivated by another
      // admin (AdminUsersScreen), and that flag needs to actually block
      // sign-in here, not just hide the account in a list somewhere.
      if (userDocSnap.data().isActive === false) {
        await auth.signOut();
        Alert.alert(
          'Account Deactivated',
          'This admin account has been deactivated.'
        );
        setLoading(false);
        return;
      }

      // Role confirmed server-side above — now reflect it in AdminContext
      // so useAdmin().isAdmin actually tracks who's signed in, instead of
      // always being false (nothing was calling this before).
      loginAsAdmin();

      setLoading(false);
      navigation.replace('AdminDashboard');
    } catch (error) {
      setLoading(false);
      console.error('Admin login error:', error);

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
      } else if (error.code === 'auth/invalid-email') {
        message = 'Please enter a valid email address.';
      } else if (error.code === 'auth/too-many-requests') {
        message = 'Too many failed attempts. Please try again later.';
      }
      Alert.alert('Login Failed', message);
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // No history to go back to — this happens right after an admin
      // logout, since AdminDashboardScreen resets the nav stack (and
      // signs out of the single shared Firebase Auth session) so "back"
      // can't return into an authenticated admin screen. Landing on
      // Profile here would be worse — it expects someone signed in.
      navigation.navigate('Home');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollView}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#007AFF" />
          </TouchableOpacity>

          <View style={styles.logoContainer}>
            <View style={styles.logo}>
              <Ionicons name="shield-checkmark" size={60} color="#007AFF" />
            </View>
            <Text style={styles.title}>Admin Portal</Text>
            <Text style={styles.subtitle}>Sign in to manage your store</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Ionicons name="mail-outline" size={20} color="#999" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Admin Email"
                placeholderTextColor="#999"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={styles.inputContainer}>
              <Ionicons name="lock-closed-outline" size={20} color="#999" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#999"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#999" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.loginButton,
                (loading || !isConnected) && styles.loginButtonDisabled,
              ]}
              onPress={handleLogin}
              disabled={loading || !isConnected}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.loginButtonText}>
                  {!isConnected ? 'No Internet Connection' : 'Login as Admin'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.infoContainer}>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle-outline" size={20} color="#666" />
              <Text style={styles.infoText}>
                This portal is for administrators only. If you&apos;re a customer, please use the customer login.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#fff' 
  },
  keyboardView: { 
    flex: 1 
  },
  scrollView: { 
    flexGrow: 1, 
    padding: 20 
  },
  backButton: { 
    marginTop: Platform.OS === 'ios' ? 0 : 20, 
    marginBottom: 20, 
    width: 40 
  },
  logoContainer: { 
    alignItems: 'center', 
    marginBottom: 40 
  },
  logo: { 
    width: 100, 
    height: 100, 
    borderRadius: 50, 
    backgroundColor: '#E3F2FF', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 20 
  },
  title: { 
    fontSize: 28, 
    fontWeight: '700', 
    color: '#000', 
    marginBottom: 8 
  },
  subtitle: { 
    fontSize: 14, 
    color: '#666' 
  },
  form: { 
    gap: 16, 
    marginBottom: 24 
  },
  inputContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#E5E5EA', 
    borderRadius: 12, 
    paddingHorizontal: 12, 
    backgroundColor: '#F9F9FB' 
  },
  inputIcon: { 
    marginRight: 8 
  },
  input: { 
    flex: 1, 
    height: 48, 
    fontSize: 14, 
    color: '#000' 
  },
  loginButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8
  },
  loginButtonDisabled: {
    backgroundColor: '#ccc',
  },
  loginButtonText: { 
    color: '#fff', 
    fontSize: 16, 
    fontWeight: '600' 
  },
  infoContainer: { 
    marginTop: 20 
  },
  infoCard: { 
    flexDirection: 'row', 
    backgroundColor: '#F9F9FB', 
    borderRadius: 12, 
    padding: 16, 
    gap: 12, 
    borderWidth: 1, 
    borderColor: '#E5E5EA' 
  },
  infoText: { 
    flex: 1, 
    fontSize: 12, 
    color: '#666', 
    lineHeight: 18 
  },
});