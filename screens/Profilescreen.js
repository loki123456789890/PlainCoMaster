// screens/Profilescreen.js
//
// The account screen, in the approved favorites/cart/profile preview's
// design: an ink identity card (photo, name, email, verification), the
// saved delivery address, grouped rows, and the name edited in a sheet.
// Everything it did before it still does: photo upload, email
// verification with its re-checks, the name saved to both places it lives,
// the Staff Portal row, log out, and deactivation with the sole-admin check.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  AppState,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../firebaseConfig';
import { signOut, updateProfile, sendEmailVerification } from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  getCountFromServer,
  deleteField,
} from 'firebase/firestore';
import { showAppAlert } from '../utils/appAlert';
import { pickAndUploadImage, uploadErrorMessage } from '../utils/imageUpload';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';
import { useAdmin } from '../context/AdminContext';
import { useFavorites } from '../context/FavoritesContext';
import { useCart } from '../context/CartContext';
import LoggedOut from '../components/auth/LoggedOut';
import { getPortalLabel } from '../constants/roles';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import SkeletonBlock from '../components/ui/Skeleton';
import TabBar, { goToTab } from '../components/shop/TabBar';
import Sheet from '../components/shop/Sheet';
import Reveal from '../components/shop/Reveal';
import { PageHead, OfflineNotice } from '../components/shop/TabScreen';
import { EASE_OUT_QUINT } from '../constants/motion';
import appConfig from '../app.json';

const NAME_MAX = 60;

const initialsOf = (name = '') => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
};

// "12 Rizal St., Poblacion, Toledo City, Cebu 6038"
const addressLine = (a) =>
  [a.address, a.city, [a.province, a.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// One row in a group: an icon tile, a label, an optional note, a chevron.
function Row({ icon, label, note, onPress, danger, disabled, trailing, hint, last }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={note ? `${label}, ${note}` : label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Ionicons name={icon} size={18} color={danger ? DANGER_INK : Colors.light.text} />
      </View>
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
      {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      {trailing || <Ionicons name="chevron-forward" size={16} color="#B3AAA0" />}
    </Pressable>
  );
}
const DANGER_INK = '#B42318';

function Group({ label, delay, children }) {
  return (
    <>
      <Reveal delay={delay}>
        <Text style={styles.groupLabel}>{label}</Text>
      </Reveal>
      <Reveal delay={delay + 30} style={styles.group}>
        {children}
      </Reveal>
    </>
  );
}

// The name editor: a sheet that rises from the bottom over a scrim. Stays
// mounted through its closing slide, then unmounts.
function NameSheet({ visible, onClose, value, onChange, error, email, saving, isConnected, onSave }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [focused, setFocused] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = reduceMotion ? 1 : withTiming(1, { duration: 450, easing: EASE_OUT_QUINT });
    } else if (mounted) {
      if (reduceMotion) {
        progress.value = 0;
        setMounted(false);
      } else {
        progress.value = withTiming(0, { duration: 300, easing: EASE_OUT_QUINT }, (done) => {
          if (done) runOnJS(setMounted)(false);
        });
      }
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrim = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * 420 }] }));

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => !saving && onClose()}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !saving && onClose()} accessibilityLabel="Close" />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.sheetWrap} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 14 }, sheet]}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>Edit profile</Text>
          <Text style={styles.sheetSub}>
            Your name appears on your orders, and on reviews as your first name and last initial.
          </Text>

          <Text style={[styles.fieldLabel, focused && { color: Colors.light.tint }, error && { color: DANGER_INK }]}>
            Display name
          </Text>
          <View>
            {focused || error ? (
              <View style={[styles.halo, { backgroundColor: error ? 'rgba(196,70,62,0.08)' : 'rgba(196,98,62,0.12)' }]} />
            ) : null}
            <TextInput
              value={value}
              onChangeText={onChange}
              maxLength={NAME_MAX}
              autoFocus
              editable={!saving}
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              onSubmitEditing={onSave}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={[
                styles.input,
                { borderColor: error ? DANGER_INK : focused ? Colors.light.tint : Colors.light.border },
              ]}
              placeholder="Your name"
              placeholderTextColor="#B3AAA0"
              accessibilityLabel="Display name"
            />
          </View>
          <Text style={styles.fieldError} accessibilityLiveRegion="polite">
            {error || (!isConnected ? 'Network connection lost. Please check your connection and try again.' : '')}
          </Text>

          <Text style={styles.fieldLabel}>Email</Text>
          <View style={styles.readOnly}>
            <Text style={styles.readOnlyText} numberOfLines={1}>
              {email}
            </Text>
            <Ionicons name="lock-closed-outline" size={16} color="#9C938A" />
          </View>
          <Text style={styles.readOnlyHint}>Email can&apos;t be changed because it&apos;s tied to your login.</Text>

          <Button
            variant="primary"
            label={!isConnected ? 'Offline' : 'Save'}
            fontSize={16}
            onPress={onSave}
            loading={saving}
            disabled={saving || !isConnected}
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// The account being logged out of, so there's no doubt which one it is.
function WhoCard({ name, email, photoUrl }) {
  const initials = initialsOf(name);
  return (
    <View style={styles.who}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.whoAvatar} contentFit="cover" />
      ) : (
        <View style={[styles.whoAvatar, styles.avatarInitials]}>
          {initials ? <Text style={styles.whoInitials}>{initials}</Text> : <Ionicons name="person" size={20} color="#fff" />}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.whoName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.whoEmail} numberOfLines={1}>
          {email}
        </Text>
      </View>
    </View>
  );
}

// One consequence in the deactivate dialog: red for what's lost, moss for
// what's kept, grey for how to undo it.
function Consequence({ icon, color, children, last }) {
  return (
    <View style={[styles.cons, !last && styles.consDivider]}>
      <Ionicons name={icon} size={18} color={color} style={{ marginTop: 1 }} />
      <Text style={styles.consText}>{children}</Text>
    </View>
  );
}

// Shown after deactivating, over the (now signed-out)
// Profile screen, until the customer moves on to Landing.
function Farewell({ farewell, onDone }) {
  const reduceMotion = useReducedMotion();
  if (!farewell) return null;
  return (
    <Modal transparent={false} visible animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onDone}>
      <View style={styles.bye}>
        <View style={styles.byeTile}>
          <Ionicons name={farewell.icon} size={36} color={Colors.light.icon} />
        </View>
        <Text style={styles.byeTitle} accessibilityRole="header">
          {farewell.title}
        </Text>
        <Text style={styles.byeText}>{farewell.text}</Text>
        <Button variant="primary" label="Back to the landing screen" fontSize={15.5} onPress={onDone} style={styles.byeButton} />
      </View>
    </Modal>
  );
}

function ProfileSkeleton() {
  return (
    <View style={[styles.card, styles.cardSkeleton]}>
      <SkeletonBlock style={styles.avatarSkeleton} color="#3A3531" />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBlock style={{ height: 14, width: '60%', borderRadius: 6 }} color="#3A3531" />
        <SkeletonBlock style={{ height: 11, width: '80%', borderRadius: 6 }} color="#3A3531" />
      </View>
    </View>
  );
}

export default function ProfileScreen({ navigation, route }) {
  const [userData, setUserData] = useState({ name: '', email: '', photoUrl: null, shippingAddress: null });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [emailVerified, setEmailVerified] = useState(Boolean(auth.currentUser?.emailVerified));
  const [sendingVerification, setSendingVerification] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [privacyPolicyVisible, setPrivacyPolicyVisible] = useState(false);
  const [deactivateVisible, setDeactivateVisible] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  // Deactivate stays disabled until the customer ticks that they understand
  // they can't log back in.
  const [deactivateAck, setDeactivateAck] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // What the goodbye screen says after deactivating.
  const [farewell, setFarewell] = useState(null);
  const [orderCount, setOrderCount] = useState(null);
  // True only while the sole-platform-admin check is in flight, so the row
  // can't be tapped twice into two queries.
  const [checkingSoleAdmin, setCheckingSoleAdmin] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const { role, adminLoading, acknowledgeSelfDeactivation } = useAdmin();
  const { favorites } = useFavorites();
  const { cartCount } = useCart();
  // Set on logging out: who it was and what they had saved.
  const [loggedOut, setLoggedOut] = useState(null);
  const { isConnected } = useNetworkStatus();
  const fromTab = route.params?.via === 'tab';

  useEffect(() => {
    // Profile is customer-only; a guest goes to Login.
    if (!auth.currentUser) navigation.replace('Login');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-read on focus, so the address card shows what was just saved on the
  // Delivery Address screen.
  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) return undefined;
      let active = true;
      (async () => {
        try {
          const snap = await getDoc(doc(db, 'users', user.uid));
          if (!active) return;
          if (snap.exists()) {
            const data = snap.data();
            setUserData({
              name: data.name,
              email: data.email,
              photoUrl: data.photoUrl || null,
              shippingAddress: data.shippingAddress || null,
            });
          } else {
            setUserData({ name: user.displayName || 'User', email: user.email, photoUrl: null, shippingAddress: null });
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          if (active) {
            setUserData((prev) =>
              prev.email ? prev : { name: user.displayName || 'User', email: user.email, photoUrl: null, shippingAddress: null }
            );
          }
        } finally {
          if (active) setLoadingProfile(false);
        }
      })();
      // The count beside My Orders. An aggregate, so it costs one read
      // however many orders there are; left blank if it can't be had.
      getCountFromServer(collection(db, 'users', user.uid, 'orders'))
        .then((snap) => active && setOrderCount(snap.data().count))
        .catch((error) => console.error('Could not count orders:', error?.code));
      return () => {
        active = false;
      };
    }, [])
  );

  // emailVerified on the cached user only changes after reload(), and
  // Firebase doesn't say when the link is clicked — so the app asks: when
  // this screen gains focus, when PlainCo returns to the foreground (back
  // from the mail app, which is not navigation), and every few seconds for
  // a while after a link is sent (for a link opened on another device).
  const [verificationSentAt, setVerificationSentAt] = useState(null);
  const refreshVerification = useCallback(() => {
    const user = auth.currentUser;
    if (!user || user.emailVerified) return;
    user
      .reload()
      .then(() => {
        const verified = Boolean(auth.currentUser?.emailVerified);
        setEmailVerified(verified);
        if (verified) {
          setVerificationSentAt(null);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      })
      .catch((error) => console.error('Could not refresh verification status:', error?.code));
  }, []);

  useEffect(() => {
    refreshVerification();
    const unsubscribeFocus = navigation.addListener('focus', refreshVerification);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshVerification();
    });
    return () => {
      unsubscribeFocus();
      appStateSub.remove();
    };
  }, [navigation, refreshVerification]);

  useEffect(() => {
    if (!verificationSentAt || emailVerified) return undefined;
    const POLL_MS = 4000;
    const POLL_FOR_MS = 3 * 60 * 1000;
    const timer = setInterval(() => {
      if (Date.now() - verificationSentAt > POLL_FOR_MS) {
        clearInterval(timer);
        return;
      }
      refreshVerification();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [verificationSentAt, emailVerified, refreshVerification]);

  const handleSendVerification = async () => {
    if (!auth.currentUser || sendingVerification) return;
    Haptics.selectionAsync();
    setSendingVerification(true);
    try {
      await sendEmailVerification(auth.currentUser);
      setVerificationSentAt(Date.now());
      showAppAlert('Check your email', `We sent a verification link to ${userData.email}. Open it, then come back here.`);
    } catch (error) {
      console.error('Could not send verification email:', error?.code);
      showAppAlert(
        'Couldn’t send the email',
        error?.code === 'auth/too-many-requests'
          ? 'A link was sent recently. Please wait a few minutes before asking for another.'
          : 'Please check your connection and try again.'
      );
    } finally {
      setSendingVerification(false);
    }
  };

  // Stored on the user document (the profile's source of truth) and on the
  // Auth profile, which is what WriteReviewScreen copies onto a review.
  const savePhoto = async (photoUrl) => {
    const user = auth.currentUser;
    await updateDoc(doc(db, 'users', user.uid), { photoUrl: photoUrl || deleteField() });
    updateProfile(user, { photoURL: photoUrl || null }).catch((error) => {
      console.error('Photo saved, but Auth photoURL did not sync:', error?.code);
    });
    setUserData((prev) => ({ ...prev, photoUrl: photoUrl || null }));
  };

  const uploadPhoto = async (source) => {
    setPhotoBusy(true);
    try {
      const result = await pickAndUploadImage({ source, folder: `avatars/${auth.currentUser.uid}` });
      if (result.cancelled) return;
      if (!result.success) {
        showAppAlert('Photo not updated', uploadErrorMessage(result.error));
        return;
      }
      await savePhoto(result.url);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Could not save profile photo:', error);
      showAppAlert('Photo not updated', 'Please check your connection and try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      await savePhoto(null);
    } catch (error) {
      console.error('Could not remove profile photo:', error);
      showAppAlert('Photo not removed', 'Please check your connection and try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleChangePhoto = () => {
    if (photoBusy || !isConnected) return;
    Haptics.selectionAsync();
    const options =
      Platform.OS === 'web'
        ? [{ text: 'Choose a Photo', onPress: () => uploadPhoto('library') }]
        : [
            { text: 'Take Photo', onPress: () => uploadPhoto('camera') },
            { text: 'Choose from Library', onPress: () => uploadPhoto('library') },
          ];
    if (userData.photoUrl) options.push({ text: 'Remove Photo', style: 'destructive', onPress: removePhoto });
    options.push({ text: 'Cancel', style: 'cancel' });
    showAppAlert('Profile photo', undefined, options);
  };

  const handleStartEditName = () => {
    Haptics.selectionAsync();
    setNameDraft(userData.name || '');
    setNameError('');
    setEditingName(true);
  };

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError('Name cannot be empty.');
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setNameError(`Name must be ${NAME_MAX} characters or fewer.`);
      return;
    }
    if (!isConnected || savingName) return;

    setSavingName(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Only "name" is sent — firestore.rules lets an owner change that
      // field alone.
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { name: trimmed });
      // The Auth profile carries the name too, and WriteReviewScreen stamps
      // it onto new reviews. Not awaited: the rename has already succeeded,
      // and a failed mirror would be wrong to report as a failed rename.
      updateProfile(auth.currentUser, { displayName: trimmed }).catch((error) => {
        console.error('Name saved, but Auth displayName did not sync:', error?.code, error?.message);
      });
      setUserData((prev) => ({ ...prev, name: trimmed }));
      setEditingName(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error updating name:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const isNetworkError = !isConnected || error.code === 'unavailable';
      showAppAlert(
        isNetworkError ? 'No Internet Connection' : 'Error',
        isNetworkError
          ? 'Network connection lost. Please check your connection and try again.'
          : 'Could not update your name. Please try again.'
      );
    } finally {
      setSavingName(false);
    }
  };

  // Straight to the right portal for a restored privileged session, or to
  // the Staff Portal sign-in otherwise. The row is disabled while the role
  // is still resolving, so a real seller isn't sent to the sign-in.
  const handleAdminPortalPress = () => {
    Haptics.selectionAsync();
    if (role === 'seller') navigation.navigate('AdminDashboard');
    else if (role === 'platformAdmin') navigation.navigate('AdminUsers');
    else navigation.navigate('AdminLogin');
  };

  const firstName = (userData.name || '').trim().split(/\s+/)[0];

  const goToLanding = () => {
    setFarewell(null);
    navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      // Read before signing out, which empties the cart and favorites.
      const saved = { firstName, email: userData.email, cartCount, favoriteCount: favorites.length };
      await signOut(auth);
      setLogoutVisible(false);
      setLoggedOut(saved);
    } catch (error) {
      console.error('Logout failed:', error?.code);
      setLogoutVisible(false);
      showAppAlert('Error', 'Failed to log out. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  };

  // The last active Platform Admin must not deactivate themselves: only
  // that role can reactivate an account, so nobody could undo it. Dormant
  // today (staff never reach this screen), kept as defence in depth. Rules
  // can't count documents, so this is a client-side check; it guards a
  // mistake, not an attack. Fails closed if the count can't be read.
  const handleOpenDeactivate = async () => {
    if (role === 'platformAdmin') {
      setCheckingSoleAdmin(true);
      try {
        const adminsSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'platformAdmin')));
        const activeAdmins = adminsSnap.docs.filter((d) => d.data().isActive !== false).length;
        if (activeAdmins <= 1) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showAppAlert(
            "You're the only Platform Admin",
            'Deactivating this account would leave nobody able to manage user roles, and no one inside the app could restore it. Grant someone else the Platform Admin role first, then deactivate.'
          );
          return;
        }
      } catch (error) {
        console.error('Could not verify platform admin count:', error);
        showAppAlert(
          'Could not verify',
          "We couldn't check whether another Platform Admin exists. Please try again when you're back online."
        );
        return;
      } finally {
        setCheckingSoleAdmin(false);
      }
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setDeactivateAck(false);
    setDeactivateVisible(true);
  };

  const handleDeactivateAccount = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setDeactivating(true);
    try {
      // Tells AdminContext this deactivation is the user's own, before the
      // write (its snapshot can land while the write is in flight), so it
      // doesn't answer it with "contact support if this is a mistake".
      acknowledgeSelfDeactivation();
      // Before signOut: the rule allowing this write checks the owner.
      await updateDoc(doc(db, 'users', user.uid), { isActive: false, deactivatedAt: serverTimestamp() });
      await signOut(auth);
      setDeactivateVisible(false);
      setDeactivating(false);
      setFarewell({
        icon: 'ban-outline',
        title: 'Your account is deactivated',
        text: "You've been logged out. Your past orders are kept for records. To restore access, contact PlainCo support.",
      });
    } catch (error) {
      setDeactivating(false);
      console.error('Error deactivating account:', error);
      const isNetworkError = !isConnected || error.code === 'unavailable';
      showAppAlert(
        isNetworkError ? 'No Internet Connection' : 'Error',
        isNetworkError
          ? 'Network connection lost. Please check your connection and try again.'
          : 'Could not deactivate your account. Please try again.'
      );
    }
  };

  const address = userData.shippingAddress;
  const initials = initialsOf(userData.name);
  const favoriteCount = favorites.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Cart and favorites live under the account in Firestore, so the
          promise that they'll be waiting is one the app keeps. */}
      <Sheet visible={logoutVisible} onClose={() => setLogoutVisible(false)} locked={loggingOut}>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Log out of PlainCo?
        </Text>
        <Text style={styles.sheetSub}>
          Your cart and favorites are saved to your account. They&apos;ll be here when you log back in.
        </Text>
        <WhoCard name={userData.name} email={userData.email} photoUrl={userData.photoUrl} />
        <Button variant="primary" label="Log out" fontSize={15.5} onPress={handleLogout} loading={loggingOut} fullWidth />
        <Pressable
          onPress={() => setLogoutVisible(false)}
          disabled={loggingOut}
          style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={styles.ghostText}>Stay logged in</Text>
        </Pressable>
      </Sheet>

      <ConfirmDialog
        visible={deactivateVisible}
        onClose={() => setDeactivateVisible(false)}
        icon="ban-outline"
        iconTone="danger"
        title="Deactivate your account?"
        cancelLabel="Keep account"
        confirmLabel={!isConnected ? 'Offline' : 'Deactivate'}
        confirmVariant="danger"
        onConfirm={handleDeactivateAccount}
        loading={deactivating}
        confirmDisabled={!deactivateAck || deactivating || !isConnected}
        cancelDisabled={deactivating}
      >
        <Text style={styles.dialogText}>Here&apos;s what happens:</Text>
        <View style={styles.consCard}>
          <Consequence icon="log-out-outline" color={DANGER_INK}>
            You&apos;ll be logged out and <Text style={styles.bold}>can&apos;t log in again</Text>.
          </Consequence>
          <Consequence icon="receipt-outline" color={Colors.light.secondary}>
            Your past orders are <Text style={styles.bold}>kept</Text> for transaction records.
          </Consequence>
          <Consequence icon="shield-outline" color={Colors.light.icon} last>
            Only a PlainCo Platform Admin can reactivate it. For questions about your data, contact support from the Help
            Center.
          </Consequence>
        </View>
        <Pressable
          onPress={() => setDeactivateAck((on) => !on)}
          disabled={deactivating}
          style={styles.ack}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: deactivateAck, disabled: deactivating }}
        >
          <View style={[styles.ackBox, deactivateAck && styles.ackBoxOn]}>
            {deactivateAck ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
          </View>
          <Text style={styles.ackText}>I understand I won&apos;t be able to log in to this account again.</Text>
        </Pressable>
      </ConfirmDialog>

      <Farewell farewell={farewell} onDone={goToLanding} />
      <LoggedOut
        info={loggedOut}
        onStart={() => {
          setLoggedOut(null);
          navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
        }}
        onLogBackIn={() => {
          const email = loggedOut?.email;
          setLoggedOut(null);
          // Landing under Log In, so Back from Log In goes to the start.
          navigation.reset({
            index: 1,
            routes: [{ name: 'Landing' }, { name: 'Login', params: email ? { email } : undefined }],
          });
        }}
      />

      <PrivacyPolicyModal visible={privacyPolicyVisible} onClose={() => setPrivacyPolicyVisible(false)} />

      <NameSheet
        visible={editingName}
        onClose={() => setEditingName(false)}
        value={nameDraft}
        onChange={(text) => {
          setNameDraft(text);
          if (nameError) setNameError('');
        }}
        error={nameError}
        email={userData.email}
        saving={savingName}
        isConnected={isConnected}
        onSave={handleSaveName}
      />

      {/* The "?" is what the Privacy Policy points to for Contact Support. */}
      <PageHead
        title="Profile"
        onBack={fromTab ? null : () => navigation.goBack()}
        right={
          <Pressable
            onPress={() => navigation.navigate('Help')}
            style={({ pressed }) => [styles.helpButton, pressed && styles.rowPressed]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Get help"
          >
            <Ionicons name="help-circle-outline" size={24} color={Colors.light.tint} />
          </Pressable>
        }
      />

      {!isConnected && <OfflineNotice>No internet connection — some account actions are unavailable.</OfflineNotice>}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loadingProfile ? (
          <ProfileSkeleton />
        ) : (
          <Reveal delay={90}>
            <View style={styles.card} accessible={false}>
              <View style={styles.cardRing} pointerEvents="none" />
              <Pressable
                onPress={handleChangePhoto}
                disabled={photoBusy}
                accessibilityRole="button"
                accessibilityLabel={userData.photoUrl ? 'Change profile photo' : 'Add a profile photo'}
              >
                {userData.photoUrl ? (
                  <Image source={{ uri: userData.photoUrl }} style={styles.avatar} contentFit="cover" transition={150} />
                ) : (
                  <View style={[styles.avatar, styles.avatarInitials]}>
                    {initials ? (
                      <Text style={styles.avatarText}>{initials}</Text>
                    ) : (
                      <Ionicons name="person" size={24} color="#fff" />
                    )}
                  </View>
                )}
                {photoBusy ? (
                  <View style={[styles.avatar, styles.avatarBusy]}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
                <View style={styles.cameraBadge}>
                  <Ionicons name="camera" size={11} color="#fff" />
                </View>
              </Pressable>
              <View style={styles.cardText}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {userData.name}
                </Text>
                <Text style={styles.cardEmail} numberOfLines={1}>
                  {userData.email}
                </Text>
                {emailVerified ? (
                  <View style={styles.verify}>
                    <Ionicons name="checkmark-circle" size={13} color="#A9BD97" />
                    <Text style={styles.verified}>Email verified</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={handleSendVerification}
                    disabled={sendingVerification || !isConnected}
                    hitSlop={8}
                    style={styles.verify}
                    accessibilityRole="button"
                    accessibilityLabel="Email not verified. Send a verification link."
                  >
                    <Ionicons name="alert-circle-outline" size={13} color="#BDB3A9" />
                    <Text style={styles.unverified}>Not verified ·</Text>
                    <Text style={styles.verifyLink}>{sendingVerification ? 'Sending…' : 'Verify now'}</Text>
                  </Pressable>
                )}
              </View>
              <Pressable
                onPress={handleStartEditName}
                style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Edit display name"
              >
                <Ionicons name="pencil" size={16} color={Colors.light.background} />
              </Pressable>
            </View>
          </Reveal>
        )}

        {/* The phone lives with the saved delivery address, where checkout
            reads it — one copy, edited in one place. */}
        <Reveal delay={150}>
          <Pressable
            onPress={() => navigation.navigate('Location')}
            style={({ pressed }) => [styles.address, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={address ? 'Delivery address and phone. Edit' : 'Add a delivery address and phone'}
          >
            <View style={styles.addressHead}>
              <Text style={styles.addressLabel}>Delivery address</Text>
              <Text style={styles.addressAction}>{address ? 'Edit' : 'Add'}</Text>
            </View>
            {address ? (
              <>
                <Text style={styles.addressName}>
                  {[address.fullName, address.phone].filter(Boolean).join(' · ')}
                </Text>
                <Text style={styles.addressText}>{addressLine(address)}</Text>
              </>
            ) : (
              <Text style={styles.addressText}>Add where your orders should be delivered, and a phone number.</Text>
            )}
          </Pressable>
        </Reveal>

        <Group label="Shopping" delay={200}>
          <Row
            icon="receipt-outline"
            label="My Orders"
            note={orderCount ? `${orderCount} order${orderCount === 1 ? '' : 's'}` : null}
            onPress={() => navigation.navigate('Orders')}
            hint="Opens your order history"
          />
          <Row
            icon="heart-outline"
            label="Favorites"
            note={favoriteCount ? String(favoriteCount) : null}
            onPress={() => goToTab(navigation, 'Favorites')}
            hint="Opens your saved items"
            last
          />
        </Group>

        <Group label="Support & legal" delay={280}>
          <Row icon="help-circle-outline" label="Help & Support" onPress={() => navigation.navigate('Help')} />
          <Row
            icon="shield-outline"
            label="Privacy Policy"
            onPress={() => setPrivacyPolicyVisible(true)}
            hint="Opens the privacy policy"
            last
          />
        </Group>

        <Group label="Account" delay={360}>
          {/* Reachable by everyone: the Staff Portal sign-in has to stay
              the one way in for a signed-out staff member, and a customer
              gets no further than it (rules + withRoleGuard). The label
              names the portal a restored staff session will open. */}
          <Row
            icon="shield-checkmark-outline"
            label={getPortalLabel(role)}
            onPress={handleAdminPortalPress}
            disabled={adminLoading}
            hint={`Opens the ${getPortalLabel(role)}`}
            trailing={adminLoading ? <ActivityIndicator size="small" color={Colors.light.tint} /> : null}
          />
          <Row icon="log-out-outline" label="Log Out" onPress={() => setLogoutVisible(true)} hint="Signs you out" />
          {/* Last, and red: irreversible from the user's side. */}
          <Row
            icon="ban-outline"
            label="Deactivate Account"
            danger
            onPress={handleOpenDeactivate}
            disabled={checkingSoleAdmin}
            hint="Opens a confirmation to deactivate your account"
            last
          />
        </Group>

        <Text style={styles.version}>PlainCo v{appConfig.expo.version} · BSIT-4C Group 5</Text>
      </ScrollView>

      <TabBar navigation={navigation} current="Profile" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 28 },
  helpButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginRight: -8 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: Colors.light.text,
    marginBottom: 18,
    overflow: 'hidden',
  },
  cardSkeleton: { minHeight: 88 },
  cardRing: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.1)',
  },
  avatar: { width: 56, height: 56, borderRadius: 18 },
  avatarInitials: { backgroundColor: Colors.light.tint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 19, fontWeight: '600', color: '#fff' },
  avatarBusy: { position: 'absolute', backgroundColor: 'rgba(28,27,26,0.5)', alignItems: 'center', justifyContent: 'center' },
  avatarSkeleton: { width: 56, height: 56, borderRadius: 18 },
  cameraBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.light.tint,
    borderWidth: 2,
    borderColor: Colors.light.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 17, fontWeight: '600', color: Colors.light.background },
  cardEmail: { fontSize: 12, color: '#BDB3A9', marginTop: 1 },
  verify: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  verified: { fontSize: 11.5, fontWeight: '600', color: '#A9BD97' },
  unverified: { fontSize: 11.5, color: '#BDB3A9' },
  verifyLink: { fontSize: 11.5, fontWeight: '600', color: '#E9A385' },
  editButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(250,247,242,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  address: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    marginBottom: 18,
  },
  addressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  addressLabel: { fontSize: 12, color: Colors.light.icon },
  addressAction: { fontSize: 12, fontWeight: '600', color: Colors.light.tint },
  addressName: { fontSize: 13.5, fontWeight: '600', color: Colors.light.text },
  addressText: { fontSize: 12.5, lineHeight: 19, color: Colors.light.icon, marginTop: 2 },

  groupLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: Colors.light.icon,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  group: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 56 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: '#F1EBE3' },
  rowPressed: { backgroundColor: '#F7F2EB' },
  rowIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#F3EEE6', alignItems: 'center', justifyContent: 'center' },
  rowIconDanger: { backgroundColor: '#FBEDEB' },
  rowLabel: { flex: 1, fontSize: 14, color: Colors.light.text },
  rowLabelDanger: { color: DANGER_INK },
  rowNote: { fontSize: 12, color: Colors.light.icon },

  version: { textAlign: 'center', fontSize: 11, color: '#8E857B', marginTop: 8 },

  dialogText: { fontSize: 12.5, lineHeight: 19, color: Colors.light.icon, textAlign: 'center', marginTop: -4, marginBottom: 14 },
  consCard: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEE7DD',
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 12,
  },
  cons: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  consDivider: { borderBottomWidth: 1, borderBottomColor: '#F1EBE3' },
  consText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: Colors.light.text },
  bold: { fontWeight: '600' },
  ack: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 16 },
  ackBox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#CFC6BC',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ackBoxOn: { backgroundColor: DANGER_INK, borderColor: DANGER_INK },
  ackText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: Colors.light.text },

  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    marginBottom: 14,
  },
  whoAvatar: { width: 42, height: 42, borderRadius: 13 },
  whoInitials: { fontSize: 15, fontWeight: '600', color: '#fff' },
  whoName: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  whoEmail: { fontSize: 12, color: Colors.light.icon, marginTop: 1 },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ghostText: { fontSize: 15.5, fontWeight: '600', color: Colors.light.icon },

  bye: { flex: 1, backgroundColor: Colors.light.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  byeTile: { width: 80, height: 80, borderRadius: 26, backgroundColor: '#F1EBE3', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  byeTitle: { fontSize: 21, fontWeight: '600', color: Colors.light.text, textAlign: 'center', marginBottom: 6 },
  byeText: { fontSize: 13, lineHeight: 20, color: Colors.light.icon, textAlign: 'center', marginBottom: 22 },
  byeButton: { alignSelf: 'stretch', maxWidth: 320, width: '100%' },

  scrim: { backgroundColor: 'rgba(28,27,26,0.42)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8CFC4', alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: 18, fontWeight: '600', color: Colors.light.text, marginBottom: 4 },
  sheetSub: { fontSize: 13, lineHeight: 19, color: Colors.light.icon, marginBottom: 16 },
  fieldLabel: { fontSize: 12.5, fontWeight: '500', color: Colors.light.text, marginBottom: 6, marginLeft: 2 },
  halo: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 18 },
  input: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 15,
    fontSize: 15,
    color: Colors.light.text,
    // Above the halo; on web an absolute sibling would paint over it.
    zIndex: 1,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  fieldError: { fontSize: 11.5, color: DANGER_INK, minHeight: 16, marginTop: 6, marginBottom: 10, marginLeft: 2 },
  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 50,
    borderRadius: 14,
    backgroundColor: '#F1EBE3',
    paddingHorizontal: 15,
    marginBottom: 6,
  },
  readOnlyText: { flex: 1, fontSize: 14, color: Colors.light.icon, marginRight: 8 },
  readOnlyHint: { fontSize: 11.5, color: Colors.light.icon, marginBottom: 16, marginLeft: 2 },
});
