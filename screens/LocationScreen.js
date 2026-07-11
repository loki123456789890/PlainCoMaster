import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { auth, db } from '../firebaseConfig';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

export default function LocationScreen({ navigation }) {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    address: '',
    city: '',
    province: '',
    zipCode: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) {
      // Delivery address is account-tied data, same as Cart/Favorites/Orders —
      // a guest has nowhere to save it, so send them to Login first.
      navigation.replace('Login');
      return;
    }

    const loadAddress = async () => {
      try {
        const userDocRef = doc(db, 'users', auth.currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        const savedAddress = userDocSnap.exists() ? userDocSnap.data().shippingAddress : null;
        if (savedAddress) {
          setFormData({
            fullName: savedAddress.fullName || '',
            phone: savedAddress.phone || '',
            address: savedAddress.address || '',
            city: savedAddress.city || '',
            province: savedAddress.province || '',
            zipCode: savedAddress.zipCode || '',
          });
        }
      } catch (error) {
        console.error('Error loading address:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAddress();
  }, []);

  const useCurrentLocation = async () => {
    setIsLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Allow location access to use this feature.');
        setIsLoadingLocation(false);
        return;
      }

      let location;
      try {
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      } catch (fixError) {
        // getCurrentPositionAsync can fail even with permission granted if
        // the device's system-level Location Services are off, or if it
        // can't get a fresh GPS fix (weak signal, indoors, simulator with
        // no location set). Try a cached last-known position before giving
        // up entirely — it's stale but often close enough to be usable.
        console.log('getCurrentPositionAsync failed, trying last known position:', fixError);
        location = await Location.getLastKnownPositionAsync();
        if (!location) {
          throw fixError;
        }
      }

      const reverseGeocode = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (reverseGeocode.length > 0) {
        const place = reverseGeocode[0];
        setFormData((prev) => ({
          ...prev,
          address: `${place.street || ''} ${place.name || ''}`.trim(),
          city: place.city || prev.city,
          province: place.region || prev.province,
          zipCode: place.postalCode || prev.zipCode,
        }));
      } else {
        Alert.alert('Not Found', 'Could not determine an address for your current location.');
      }
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert(
        'Location Unavailable',
        "Couldn't detect your location. Make sure Location Services are turned on for this device in your phone's Settings, then try again — or just fill in the address fields below manually."
      );
    } finally {
      setIsLoadingLocation(false);
    }
  };

  const handleSave = async () => {
    if (!formData.fullName.trim()) {
      Alert.alert('Error', 'Please enter the recipient\'s full name.');
      return;
    }
    if (!formData.phone.trim()) {
      Alert.alert('Error', 'Please enter a phone number.');
      return;
    }
    if (!formData.address.trim()) {
      Alert.alert('Error', 'Please enter a street address.');
      return;
    }
    if (!formData.city.trim()) {
      Alert.alert('Error', 'Please enter a city.');
      return;
    }
    if (!formData.province.trim()) {
      Alert.alert('Error', 'Please enter a province/region.');
      return;
    }
    if (!formData.zipCode.trim()) {
      Alert.alert('Error', 'Please enter a zip code.');
      return;
    }

    setSaving(true);
    try {
      const userDocRef = doc(db, 'users', auth.currentUser.uid);
      await updateDoc(userDocRef, {
        shippingAddress: {
          ...formData,
          updatedAt: serverTimestamp(),
        },
      });
      Alert.alert('Saved', 'Your delivery address has been saved.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.error('Error saving address:', error);
      Alert.alert('Error', 'Could not save your address. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delivery Address</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B6F47" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Delivery Address</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <TouchableOpacity
            style={styles.useLocationButton}
            onPress={useCurrentLocation}
            disabled={isLoadingLocation}
          >
            {isLoadingLocation ? (
              <ActivityIndicator size="small" color="#8B6F47" />
            ) : (
              <Ionicons name="locate-outline" size={20} color="#8B6F47" />
            )}
            <Text style={styles.useLocationButtonText}>
              {isLoadingLocation ? 'Detecting location...' : 'Use Current Location'}
            </Text>
          </TouchableOpacity>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Recipient's full name"
              placeholderTextColor="#999"
              value={formData.fullName}
              onChangeText={(text) => setFormData({ ...formData, fullName: text })}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone Number</Text>
            <TextInput
              style={styles.input}
              placeholder="+63 XXX XXX XXXX"
              placeholderTextColor="#999"
              value={formData.phone}
              onChangeText={(text) => setFormData({ ...formData, phone: text })}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Street Address</Text>
            <TextInput
              style={styles.input}
              placeholder="House number, street, barangay"
              placeholderTextColor="#999"
              value={formData.address}
              onChangeText={(text) => setFormData({ ...formData, address: text })}
              multiline
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>City</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter city"
              placeholderTextColor="#999"
              value={formData.city}
              onChangeText={(text) => setFormData({ ...formData, city: text })}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Province/Region</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter province or region"
              placeholderTextColor="#999"
              value={formData.province}
              onChangeText={(text) => setFormData({ ...formData, province: text })}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Zip Code</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter zip code"
              placeholderTextColor="#999"
              value={formData.zipCode}
              onChangeText={(text) => setFormData({ ...formData, zipCode: text })}
              keyboardType="numeric"
            />
          </View>

          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Address</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, paddingBottom: 40 },
  useLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginBottom: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8B6F47',
    backgroundColor: '#F5EFE6',
  },
  useLocationButtonText: {
    fontSize: 14,
    color: '#8B6F47',
    fontWeight: '600',
  },
  inputGroup: { marginBottom: 20 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: '#000', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#000',
    backgroundColor: '#F9F9FB',
  },
  saveButton: {
    backgroundColor: '#8B6F47',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
    height: 56,
    justifyContent: 'center',
  },
  saveButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});