import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function AdminLoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    setLoading(true);
    
    // Temporary login - replace with actual admin authentication
    setTimeout(() => {
      setLoading(false);
      navigation.replace('AdminDashboard');
    }, 1000);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollView}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
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

            <TouchableOpacity style={styles.loginButton} onPress={handleLogin} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginButtonText}>Login as Admin</Text>}
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