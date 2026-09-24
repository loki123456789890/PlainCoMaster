// screens/LocationScreen.js — Delivery address
//
// The saved delivery address and phone, in the approved address/help/stores
// preview's design: a "use my current location" card that fills the
// address fields (and tints them Moss so it's clear what changed), the
// recipient and address fields grouped under small headings, and Save held
// at the bottom. What it saves, and where, is unchanged: one
// `shippingAddress` on the user's document, which checkout copies onto each
// order.
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  useReducedMotion,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { auth, db } from '../firebaseConfig';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { showAppAlert } from '../utils/appAlert';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import Button from '../components/ui/Button';
import SkeletonBlock from '../components/ui/Skeleton';
import { Field, SuccessToast, useShakes } from '../components/auth/AuthKit';
import Reveal from '../components/shop/Reveal';
import { TopBar, GroupHeading, OfflineNotice } from '../components/shop/TabScreen';
import { EASE_OUT_QUINT } from '../constants/motion';

const FIELDS = ['fullName', 'phone', 'address', 'city', 'zipCode', 'province'];
const SAVED_HOLD_MS = 1100;

// "0917 123 4567", "+639171234567", "9171234567" → "917 123 4567". Anything
// that isn't a PH mobile number is left as its digits, for the check to flag.
const phoneDigits = (value) => {
  let d = String(value || '').replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
};
const formatPhone = (value) => {
  const d = phoneDigits(value);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ');
};

const RULES = {
  fullName: (v) => (!v ? "Enter the recipient's full name." : ''),
  phone: (v) =>
    !v ? 'Enter a mobile number.' : !/^9\d{9}$/.test(phoneDigits(v)) ? 'Enter a valid PH mobile number, e.g. 917 123 4567.' : '',
  address: (v) => (!v ? 'Enter your house number, street and barangay.' : ''),
  city: (v) => (!v ? 'Enter a city or municipality.' : ''),
  zipCode: (v) => (!v ? 'Enter a ZIP code.' : !/^\d{4}$/.test(v) ? 'ZIP codes in the Philippines have 4 digits.' : ''),
  province: (v) => (!v ? 'Enter a province.' : ''),
};

function FormSkeleton() {
  return (
    <View>
      <SkeletonBlock style={styles.skeletonCard} />
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ marginTop: 18 }}>
          <SkeletonBlock style={{ width: 90, height: 12, borderRadius: 6, marginBottom: 8 }} />
          <SkeletonBlock style={{ height: 50, borderRadius: 14 }} />
        </View>
      ))}
    </View>
  );
}

// The Clay tile's ring, pulsing outward while the location is found.
function Ping({ active }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (active && !reduceMotion) {
      t.value = 0;
      t.value = withRepeat(withTiming(1, { duration: 1200, easing: EASE_OUT_QUINT }), -1, false);
    } else {
      t.value = 0;
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({
    opacity: active ? 0.8 * (1 - t.value) : 0,
    transform: [{ scale: 1 + t.value * 0.6 }],
  }));
  return <Animated.View style={[styles.ping, style]} pointerEvents="none" />;
}

export default function LocationScreen({ navigation }) {
  const [formData, setFormData] = useState({ fullName: '', phone: '', address: '', city: '', province: '', zipCode: '' });
  const [errors, setErrors] = useState({});
  const [filled, setFilled] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // idle | busy | ok | fail
  const [locState, setLocState] = useState('idle');
  const [locationError, setLocationError] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [shakes, shake] = useShakes();
  const { isConnected } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const refs = {
    fullName: useRef(null),
    phone: useRef(null),
    address: useRef(null),
    city: useRef(null),
    zipCode: useRef(null),
    province: useRef(null),
  };
  const savedTimer = useRef(null);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  useEffect(() => {
    if (!auth.currentUser) {
      // Account-tied data, like Cart and Orders: a guest has nowhere to
      // save it, so send them to Login first.
      navigation.replace('Login');
      return;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
        const a = snap.exists() ? snap.data().shippingAddress : null;
        if (a) {
          setFormData({
            fullName: a.fullName || '',
            phone: a.phone ? formatPhone(a.phone) : '',
            address: a.address || '',
            city: a.city || '',
            province: a.province || '',
            zipCode: a.zipCode || '',
          });
        }
      } catch (error) {
        console.error('Error loading address:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = (field, text) => {
    const value = field === 'phone' ? formatPhone(text) : field === 'zipCode' ? text.replace(/\D/g, '').slice(0, 4) : text;
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (filled[field]) setFilled((prev) => ({ ...prev, [field]: false }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: RULES[field](value.trim()) }));
  };

  // Checks a field when you leave it, once it has something in it.
  const blurCheck = (field) => () => {
    const value = formData[field].trim();
    if (value) setErrors((prev) => ({ ...prev, [field]: RULES[field](value) }));
  };

  const handleUseLocation = async () => {
    if (locState === 'busy') return;
    Haptics.selectionAsync();
    setLocationError('');
    setLocState('busy');
    const fail = (message) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setLocationError(message);
      setLocState('fail');
    };
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        fail('Allow location access for this app in your device settings to use this feature.');
        return;
      }
      // The app permission and the device's Location Services switch are
      // separate; checking the switch lets us say which one is off.
      if (!(await Location.hasServicesEnabledAsync())) {
        fail("Location Services are turned off for this device. Turn them on in Settings (not just this app's permission), then try again.");
        return;
      }
      let location;
      try {
        location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      } catch (fixError) {
        // No fresh fix (indoors, weak signal): a cached one is often close enough.
        location = await Location.getLastKnownPositionAsync();
        if (!location) throw fixError;
      }
      const places = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      if (!places.length) {
        fail('Could not determine an address for your current location. You can fill in the fields below manually.');
        return;
      }
      const place = places[0];
      const next = {
        address: `${place.street || ''} ${place.name || ''}`.trim(),
        city: place.city || '',
        province: place.region || '',
        zipCode: (place.postalCode || '').replace(/\D/g, '').slice(0, 4),
      };
      const changed = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
      setFormData((prev) => ({ ...prev, ...changed }));
      setFilled(Object.fromEntries(Object.keys(changed).map((k) => [k, true])));
      setErrors((prev) => ({ ...prev, ...Object.fromEntries(Object.keys(changed).map((k) => [k, ''])) }));
      setLocState('ok');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error getting location:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLocationError(
        "Couldn't detect your location. Make sure Location Services are turned on for this device in Settings, then try again — or fill in the address fields below manually."
      );
      setLocState('fail');
    }
  };

  const handleSave = async () => {
    if (saving || saved) return;
    const trimmed = Object.fromEntries(FIELDS.map((f) => [f, formData[f].trim()]));
    const nextErrors = Object.fromEntries(FIELDS.map((f) => [f, RULES[f](trimmed[f])]));
    setErrors(nextErrors);
    const bad = FIELDS.filter((f) => nextErrors[f]);
    if (bad.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      bad.forEach(shake);
      refs[bad[0]].current?.focus();
      return;
    }
    if (!isConnected) return;

    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        shippingAddress: {
          ...trimmed,
          phone: `+63 ${formatPhone(trimmed.phone)}`,
          updatedAt: serverTimestamp(),
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(true);
      savedTimer.current = setTimeout(() => navigation.goBack(), SAVED_HOLD_MS);
    } catch (error) {
      console.error('Error saving address:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Our own connection state, or Firestore's 'unavailable' if the
      // connection dropped mid-write before NetInfo noticed.
      const isNetworkError = !isConnected || error.code === 'unavailable';
      showAppAlert(
        isNetworkError ? 'No Internet Connection' : 'Error',
        isNetworkError
          ? 'Network connection lost. Please check your connection and try again.'
          : 'Could not save your address. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const field = (name, props) => (
    <Field
      inputRef={refs[name]}
      value={formData[name]}
      onChangeText={(t) => updateField(name, t)}
      onBlur={blurCheck(name)}
      status={errors[name] ? 'bad' : null}
      message={errors[name] || ''}
      shakeKey={shakes[name]}
      highlight={filled[name]}
      {...props}
    />
  );

  const locTitle = {
    idle: 'Use my current location',
    busy: 'Finding your location…',
    ok: 'Location found',
    fail: 'Location unavailable',
  }[locState];
  const locSub = {
    idle: 'Fills in the fields below. You can still edit them.',
    busy: 'This takes a few seconds.',
    ok: 'Tap to refresh',
    fail: 'Tap to try again',
  }[locState];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Delivery address" onBack={() => navigation.goBack()} stuck={scrolled} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          onScroll={(e) => {
            const past = e.nativeEvent.contentOffset.y > 4;
            if (past !== scrolled) setScrolled(past);
          }}
          scrollEventThrottle={32}
        >
          <Reveal delay={40}>
            <Text style={styles.big} accessibilityRole="header">
              Where should we deliver?
            </Text>
            <Text style={styles.lead}>This address is used at checkout and copied onto each order you place.</Text>
          </Reveal>

          {!isConnected ? (
            <View style={styles.offlineWrap}>
              <OfflineNotice>No internet connection — saving will be unavailable until you&apos;re back online.</OfflineNotice>
            </View>
          ) : null}

          {loading ? (
            <FormSkeleton />
          ) : (
            <>
              <Reveal delay={110}>
                <Pressable
                  onPress={handleUseLocation}
                  style={({ pressed }) => [
                    styles.loc,
                    locState === 'ok' && styles.locOk,
                    locState === 'fail' && styles.locFail,
                    pressed && { transform: [{ scale: 0.98 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={locTitle}
                  accessibilityHint="Fills in the address fields below using your device's location"
                  accessibilityState={{ busy: locState === 'busy' }}
                >
                  <View
                    style={[
                      styles.locIcon,
                      locState === 'ok' && { backgroundColor: Colors.light.secondary },
                      locState === 'fail' && { backgroundColor: DANGER_INK },
                    ]}
                  >
                    <Ping active={locState === 'busy'} />
                    <Ionicons name="locate-outline" size={22} color="#fff" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.locTitle}>{locTitle}</Text>
                    <Text style={styles.locSub}>{locSub}</Text>
                  </View>
                </Pressable>
                {locState === 'ok' ? (
                  <Animated.View style={[styles.note, styles.noteOk]} entering={reduceMotion ? undefined : FadeIn.duration(350)}>
                    <Ionicons name="information-circle-outline" size={16} color="#37412F" />
                    <Text style={[styles.noteText, { color: '#37412F' }]}>
                      Filled from your location. Please check the details, especially your house number and street.
                    </Text>
                  </Animated.View>
                ) : null}
                {locState === 'fail' && locationError ? (
                  <Animated.View style={[styles.note, styles.noteErr]} entering={reduceMotion ? undefined : FadeIn.duration(350)}>
                    <Ionicons name="alert-circle-outline" size={16} color="#7A1B12" />
                    <Text style={[styles.noteText, { color: '#7A1B12' }]}>{locationError}</Text>
                  </Animated.View>
                ) : null}
              </Reveal>

              <Reveal delay={170}>
                <GroupHeading>Recipient</GroupHeading>
              </Reveal>
              <Reveal delay={200}>
                {field('fullName', {
                  label: 'Full name',
                  placeholder: 'Who will receive the order?',
                  autoComplete: 'name',
                  textContentType: 'name',
                  returnKeyType: 'next',
                  submitBehavior: 'submit',
                  onSubmitEditing: () => refs.phone.current?.focus(),
                })}
              </Reveal>
              <Reveal delay={240}>
                {field('phone', {
                  label: 'Mobile number',
                  prefix: '+63',
                  placeholder: '917 123 4567',
                  keyboardType: 'number-pad',
                  autoComplete: 'tel',
                  textContentType: 'telephoneNumber',
                  maxLength: 12,
                  returnKeyType: 'next',
                  submitBehavior: 'submit',
                  onSubmitEditing: () => refs.address.current?.focus(),
                })}
              </Reveal>

              <Reveal delay={290}>
                <GroupHeading>Address</GroupHeading>
              </Reveal>
              <Reveal delay={320}>
                {field('address', {
                  label: 'House no., street & barangay',
                  placeholder: 'e.g. 12 Rizal St., Brgy. Poblacion',
                  autoComplete: 'street-address',
                  textContentType: 'fullStreetAddress',
                  returnKeyType: 'next',
                  submitBehavior: 'submit',
                  onSubmitEditing: () => refs.city.current?.focus(),
                })}
              </Reveal>
              <Reveal delay={360} style={styles.two}>
                {field('city', {
                  label: 'City / Municipality',
                  placeholder: 'Toledo City',
                  textContentType: 'addressCity',
                  returnKeyType: 'next',
                  submitBehavior: 'submit',
                  onSubmitEditing: () => refs.zipCode.current?.focus(),
                  style: { flex: 1.4 },
                })}
                {field('zipCode', {
                  label: 'ZIP code',
                  placeholder: '6038',
                  keyboardType: 'number-pad',
                  textContentType: 'postalCode',
                  maxLength: 4,
                  returnKeyType: 'next',
                  submitBehavior: 'submit',
                  onSubmitEditing: () => refs.province.current?.focus(),
                  style: { flex: 1 },
                })}
              </Reveal>
              <Reveal delay={400}>
                {field('province', {
                  label: 'Province',
                  placeholder: 'Cebu',
                  textContentType: 'addressState',
                  returnKeyType: 'done',
                  onSubmitEditing: handleSave,
                })}
              </Reveal>
            </>
          )}
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          <Button
            variant={saved ? 'success' : 'primary'}
            label={saved ? 'Address saved' : !isConnected ? 'No Internet Connection' : 'Save address'}
            fontSize={16}
            onPress={handleSave}
            disabled={!saved && (saving || loading || !isConnected)}
            loading={saving}
          />
          <View style={styles.trust}>
            <Ionicons name="shield-checkmark-outline" size={13} color={Colors.light.icon} />
            <Text style={styles.trustText}>Your address is only used for delivery.</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
      <SuccessToast text={saved ? 'Address saved. It will be used at checkout.' : ''} />
    </SafeAreaView>
  );
}
const DANGER_INK = '#B42318';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  big: { fontSize: 26, fontWeight: '600', letterSpacing: -0.5, color: Colors.light.text, marginTop: 4, marginBottom: 4 },
  lead: { fontSize: 13.5, lineHeight: 20, color: Colors.light.icon, marginBottom: 18 },
  offlineWrap: { marginHorizontal: -20 },

  loc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D9B3A3',
    backgroundColor: '#FBF1EC',
  },
  locOk: { borderStyle: 'solid', borderColor: '#C9D3BE', backgroundColor: '#F1F4EC' },
  locFail: { borderStyle: 'solid', borderColor: '#F1CFCB', backgroundColor: '#FBEDEB' },
  locIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ping: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.light.tint,
  },
  locTitle: { fontSize: 14.5, fontWeight: '600', color: Colors.light.text },
  locSub: { fontSize: 12, color: Colors.light.icon, marginTop: 1 },
  note: { flexDirection: 'row', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, marginTop: 10 },
  noteOk: { backgroundColor: '#EEF0EA' },
  noteErr: { backgroundColor: '#FBEDEB' },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17.5 },

  two: { flexDirection: 'row', gap: 10 },

  foot: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: '#F1EBE3',
  },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  trustText: { fontSize: 11.5, color: Colors.light.icon },

  skeletonCard: { height: 74, borderRadius: 18 },
});
