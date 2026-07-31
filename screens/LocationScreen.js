import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { auth, db } from '../firebaseConfig';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../constants/theme';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// Shaped like the real form (a button-sized block, then six label+field
// pairs) so there's no layout jump once the saved address loads — same
// reasoning as ProfileSkeleton/CheckoutScreen's skeleton card.
function LocationFormSkeleton() {
  return (
    <View>
      <SkeletonBlock style={styles.skeletonLocationButton} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={styles.skeletonFieldGroup}>
          <SkeletonBlock style={styles.skeletonLabel} />
          <SkeletonBlock style={styles.skeletonField} />
        </View>
      ))}
    </View>
  );
}

// A thin ring that flashes over the address fields right after a
// successful "Use Current Location" fill — same visual language as
// Checkoutscreen.js's ValidationRing, generalized with a color prop so it
// can flash moss (success) instead of rust (error) here.
function FieldRing({ opacity, color }) {
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" style={[styles.fieldRing, { borderColor: color }, animatedStyle]} />
  );
}

const emptyErrors = {
  fullName: '',
  phone: '',
  address: '',
  city: '',
  province: '',
  zipCode: '',
};

export default function LocationScreen({ navigation }) {
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    address: '',
    city: '',
    province: '',
    zipCode: '',
  });
  const [errors, setErrors] = useState(emptyErrors);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationError, setLocationError] = useState('');
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const phoneRef = useRef(null);
  const addressRef = useRef(null);
  const cityRef = useRef(null);
  const provinceRef = useRef(null);
  const zipRef = useRef(null);

  // Shake targets, one per field — same shake shape Login/Signup use for
  // invalid or missing fields, applied here on a failed Save.
  const fullNameShakeX = useSharedValue(0);
  const phoneShakeX = useSharedValue(0);
  const addressShakeX = useSharedValue(0);
  const cityShakeX = useSharedValue(0);
  const provinceShakeX = useSharedValue(0);
  const zipShakeX = useSharedValue(0);
  const fullNameShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: fullNameShakeX.value }] }));
  const phoneShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: phoneShakeX.value }] }));
  const addressShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: addressShakeX.value }] }));
  const cityShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: cityShakeX.value }] }));
  const provinceShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: provinceShakeX.value }] }));
  const zipShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: zipShakeX.value }] }));

  // Flashes moss around the address group right after a successful
  // "Use Current Location" fill — confirms detection actually worked
  // instead of leaving the field values to change silently.
  const addressGroupHighlight = useSharedValue(0);

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

  const flashHighlight = (sharedValue) => {
    if (reduceMotion) {
      sharedValue.value = 1;
      setTimeout(() => {
        sharedValue.value = 0;
      }, 900);
      return;
    }
    sharedValue.value = withSequence(
      withTiming(1, { duration: 150, easing: EASE_OUT_QUART }),
      withTiming(0, { duration: 700, easing: EASE_OUT_QUART })
    );
  };

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

  const updateField = (field, text) => {
    setFormData((prev) => ({ ...prev, [field]: text }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const useCurrentLocation = async () => {
    Haptics.selectionAsync();
    setLocationError('');
    setIsLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setLocationError('Allow location access for this app in your device settings to use this feature.');
        setIsLoadingLocation(false);
        return;
      }

      // requestForegroundPermissionsAsync only covers the app-level
      // permission — the device's system-wide Location Services (GPS) toggle
      // is separate and can still be off even after the user grants that
      // permission. Checking it explicitly lets us say so directly instead
      // of always blaming a failed GPS fix on the same generic message.
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setLocationError(
          'Location Services are turned off for this device. Turn them on in Settings (not just this app\'s permission), then try again.'
        );
        setIsLoadingLocation(false);
        return;
      }

      let location;
      try {
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      } catch (fixError) {
        // getCurrentPositionAsync can still fail here if it can't get a
        // fresh GPS fix (weak signal, indoors, simulator with no location
        // set). Try a cached last-known position before giving up
        // entirely — it's stale but often close enough to be usable.
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
        setErrors((prev) => ({ ...prev, address: '', city: '', province: '', zipCode: '' }));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        flashHighlight(addressGroupHighlight);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setLocationError('Could not determine an address for your current location. You can fill in the fields below manually.');
      }
    } catch (error) {
      console.error('Error getting location:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLocationError(
        "Couldn't detect your location. Make sure Location Services are turned on for this device in Settings, then try again — or fill in the address fields below manually."
      );
    } finally {
      setIsLoadingLocation(false);
    }
  };

  // Client-side check before ever touching the network — every error
  // renders right under its field instead of a chain of alerts, matching
  // Loginscreen.js/Signupscreen.js's validate().
  const validate = (trimmed) => {
    const nextErrors = { ...emptyErrors };

    if (!trimmed.fullName) nextErrors.fullName = "Enter the recipient's full name.";
    if (!trimmed.phone) nextErrors.phone = 'Enter a phone number.';
    if (!trimmed.address) nextErrors.address = 'Enter a street address.';
    if (!trimmed.city) nextErrors.city = 'Enter a city.';
    if (!trimmed.province) nextErrors.province = 'Enter a province or region.';
    if (!trimmed.zipCode) nextErrors.zipCode = 'Enter a zip code.';

    setErrors(nextErrors);

    const hasErrors = Object.values(nextErrors).some(Boolean);
    if (hasErrors) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (nextErrors.fullName) triggerShake(fullNameShakeX);
      if (nextErrors.phone) triggerShake(phoneShakeX);
      if (nextErrors.address) triggerShake(addressShakeX);
      if (nextErrors.city) triggerShake(cityShakeX);
      if (nextErrors.province) triggerShake(provinceShakeX);
      if (nextErrors.zipCode) triggerShake(zipShakeX);
    }
    return !hasErrors;
  };

  const handleSave = async () => {
    const trimmed = {
      fullName: formData.fullName.trim(),
      phone: formData.phone.trim(),
      address: formData.address.trim(),
      city: formData.city.trim(),
      province: formData.province.trim(),
      zipCode: formData.zipCode.trim(),
    };

    if (!validate(trimmed)) return;

    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const userDocRef = doc(db, 'users', auth.currentUser.uid);
      await updateDoc(userDocRef, {
        shippingAddress: {
          ...trimmed,
          updatedAt: serverTimestamp(),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert('Saved', 'Your delivery address has been saved.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.error('Error saving address:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // Same check CheckoutScreen.js's handlePlaceOrder uses: our own
      // NetInfo state, OR'd with Firestore's own 'unavailable' code in case
      // connectivity dropped mid-write faster than the NetInfo event fired.
      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
        return;
      }

      showAppAlert('Error', 'Could not save your address. Please try again.');
    } finally {
      setSaving(false);
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
        <Text style={styles.headerTitle}>Delivery Address</Text>
        <View style={{ width: 40 }} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — saving will be unavailable until you're back online.
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {loading ? (
            <LocationFormSkeleton />
          ) : (
            <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(240).easing(EASE_OUT_QUART)}>
              <AnimatedPressable
                style={[styles.useLocationButton, isLoadingLocation && styles.useLocationButtonDisabled]}
                onPress={useCurrentLocation}
                disabled={isLoadingLocation}
                accessibilityRole="button"
                accessibilityLabel="Use current location"
                accessibilityHint="Fills in the address fields below using your device's location"
                accessibilityState={{ disabled: isLoadingLocation }}
              >
                {isLoadingLocation ? (
                  <ActivityIndicator size="small" color={Colors.light.tint} />
                ) : (
                  <Ionicons name="locate-outline" size={20} color={Colors.light.tint} />
                )}
                <Text style={styles.useLocationButtonText}>
                  {isLoadingLocation ? 'Detecting location...' : 'Use Current Location'}
                </Text>
              </AnimatedPressable>
              {locationError ? (
                <Animated.View
                  style={styles.locationErrorBanner}
                  entering={reduceMotion ? undefined : FadeIn.duration(180).easing(EASE_OUT_QUART)}
                >
                  <Ionicons name="alert-circle-outline" size={16} color={Colors.light.danger} />
                  <Text style={styles.locationErrorText}>{locationError}</Text>
                </Animated.View>
              ) : (
                <Text style={styles.locationHint}>
                  We'll only use this to prefill the fields below.
                </Text>
              )}

              <Text style={styles.sectionTitle}>Recipient</Text>
              <Animated.View style={fullNameShakeStyle}>
                <Input
                  label="Full Name"
                  placeholder="Recipient's full name"
                  value={formData.fullName}
                  onChangeText={(text) => updateField('fullName', text)}
                  error={errors.fullName}
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                  accessibilityLabel="Full name"
                  accessibilityHint="Enter the recipient's full name"
                />
              </Animated.View>

              <Animated.View style={phoneShakeStyle}>
                <Input
                  ref={phoneRef}
                  label="Phone Number"
                  placeholder="+63 XXX XXX XXXX"
                  value={formData.phone}
                  onChangeText={(text) => updateField('phone', text)}
                  keyboardType="phone-pad"
                  error={errors.phone}
                  returnKeyType="next"
                  onSubmitEditing={() => addressRef.current?.focus()}
                  accessibilityLabel="Phone number"
                  accessibilityHint="Enter a contact number for the delivery"
                />
              </Animated.View>

              <Text style={styles.sectionTitle}>Address</Text>
              <View style={styles.fieldGroupWrap}>
                <Animated.View style={addressShakeStyle}>
                  <Input
                    ref={addressRef}
                    label="Street Address"
                    placeholder="House number, street, barangay"
                    value={formData.address}
                    onChangeText={(text) => updateField('address', text)}
                    multiline
                    error={errors.address}
                    accessibilityLabel="Street address"
                    accessibilityHint="Enter the house number, street, and barangay"
                  />
                </Animated.View>

                <Animated.View style={cityShakeStyle}>
                  <Input
                    ref={cityRef}
                    label="City"
                    placeholder="Enter city"
                    value={formData.city}
                    onChangeText={(text) => updateField('city', text)}
                    error={errors.city}
                    returnKeyType="next"
                    onSubmitEditing={() => provinceRef.current?.focus()}
                    accessibilityLabel="City"
                  />
                </Animated.View>

                <Animated.View style={provinceShakeStyle}>
                  <Input
                    ref={provinceRef}
                    label="Province/Region"
                    placeholder="Enter province or region"
                    value={formData.province}
                    onChangeText={(text) => updateField('province', text)}
                    error={errors.province}
                    returnKeyType="next"
                    onSubmitEditing={() => zipRef.current?.focus()}
                    accessibilityLabel="Province or region"
                  />
                </Animated.View>

                <Animated.View style={zipShakeStyle}>
                  <Input
                    ref={zipRef}
                    label="Zip Code"
                    placeholder="Enter zip code"
                    value={formData.zipCode}
                    onChangeText={(text) => updateField('zipCode', text)}
                    keyboardType="numeric"
                    error={errors.zipCode}
                    returnKeyType="done"
                    onSubmitEditing={handleSave}
                    accessibilityLabel="Zip code"
                  />
                </Animated.View>

                <FieldRing opacity={addressGroupHighlight} color={Colors.light.secondary} />
              </View>

              <View style={styles.saveButtonWrap}>
                <Button
                  variant="primary"
                  label={!isConnected ? 'No Internet Connection' : 'Save Address'}
                  onPress={handleSave}
                  disabled={saving || !isConnected}
                  loading={saving}
                />
              </View>
              <View style={styles.trustRow}>
                <Ionicons name="shield-checkmark-outline" size={13} color={Colors.light.icon} />
                <Text style={styles.trustText}>Your address is only used for delivery</Text>
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },

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

  content: { padding: 20, paddingBottom: 40 },

  useLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.tint + '15',
  },
  useLocationButtonDisabled: { opacity: 0.7 },
  useLocationButtonText: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: '600',
  },
  locationHint: {
    fontSize: 12,
    color: Colors.light.icon,
    textAlign: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  // Same treatment as the offline banner up in the header (danger tint +
  // border, themed danger text) so this reads as one visual language
  // instead of the OS's own un-themeable Alert.alert chrome.
  locationErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.light.danger + '15',
    borderWidth: 1,
    borderColor: Colors.light.danger + '40',
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  locationErrorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.danger,
    lineHeight: 17,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginBottom: 12,
    marginTop: 4,
  },

  // Position-relative wrap so the moss FieldRing can sit above the whole
  // address block after a successful "Use Current Location" fill, the same
  // shape Checkoutscreen.js uses for its own validation ring.
  fieldGroupWrap: { position: 'relative' },
  fieldRing: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: Radius.md + 6,
    borderWidth: 2,
  },

  saveButtonWrap: { marginTop: 8 },
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  trustText: { fontSize: 12, color: Colors.light.icon },

  // Loading skeleton — shaped like the real form (button block, then six
  // label+field pairs) so nothing jumps once the saved address arrives.
  skeletonLocationButton: { height: 48, borderRadius: Radius.md, marginBottom: Spacing.lg + Spacing.sm },
  skeletonFieldGroup: { marginBottom: Spacing.md },
  skeletonLabel: { width: 90, height: 12, borderRadius: 4, marginBottom: Spacing.xs + 2 },
  skeletonField: { height: 46, borderRadius: Radius.md },
});
