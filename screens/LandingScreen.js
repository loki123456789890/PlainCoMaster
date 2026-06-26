import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

export default function LandingScreen({ navigation }) {
  const handleGetStarted = () => {
    navigation.replace('Signup');
  };

  const handleSignIn = () => {
    navigation.replace('Login');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1532453288672-3a27e9be9efd?q=80&w=764&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D' }}
        style={styles.container}
        resizeMode="cover"
      >
        <LinearGradient
          colors={['rgba(139, 69, 19, 0.3)', 'rgba(101, 50, 15, 0.8)']}
          style={styles.gradient}
        >
          {/* Logo */}
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>PlainCo</Text>
            <Text style={styles.logoSubtext}>Shop</Text>
          </View>

          {/* Main Content */}
          <View style={styles.content}>
            <Text style={styles.title}>
              Welcome to{'\n'}Your Favorite{'\n'}Shopping App
            </Text>
            <Text style={styles.subtitle}>
              Buy everything from fashion to electronics with amazing deals and fast delivery
            </Text>

            {/* Features */}
            <View style={styles.features}>
              <View style={styles.featureItem}>
                <Ionicons name="flash" size={24} color="#D4A574" />
                <Text style={styles.featureText}>Flash Sales</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="shield-checkmark" size={24} color="#D4A574" />
                <Text style={styles.featureText}>100% Secure</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="rocket" size={24} color="#D4A574" />
                <Text style={styles.featureText}>Free Shipping</Text>
              </View>
            </View>
          </View>

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleGetStarted}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Get Started</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleSignIn}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Already have account? Sign In</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoText: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#D4A574',
  },
  logoSubtext: {
    fontSize: 16,
    color: '#FFFFFF',
    marginTop: 5,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 15,
    lineHeight: 40,
  },
  subtitle: {
    fontSize: 14,
    color: '#E0E0E0',
    marginBottom: 30,
    lineHeight: 20,
  },
  features: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  featureItem: {
    alignItems: 'center',
    flex: 1,
  },
  featureText: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 8,
  },
  buttonContainer: {
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: '#8B6F47',
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginRight: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
