import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../firebaseConfig';
import { signOut, updateProfile } from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';
import { useAdmin } from '../context/AdminContext';
import { getPortalLabel } from '../constants/roles';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors, Spacing } from '../constants/theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Input from '../components/ui/Input';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// Loading placeholder shaped like the real identity block (avatar + two
// text lines), so there's no layout shift once the account data resolves —
// same reasoning as OrdersSkeleton/CartSkeleton. Replaces the old
// name: 'Loading...' placeholder text, which read as an unfinished string
// rather than a deliberate loading state.
function ProfileSkeleton() {
  return (
    <View style={styles.profileSection}>
      <SkeletonBlock style={styles.avatarSkeleton} />
      <SkeletonBlock style={[styles.skeletonLine, styles.skeletonNameLine]} />
      <SkeletonBlock style={[styles.skeletonLine, styles.skeletonEmailLine]} />
    </View>
  );
}

// One account menu row: a tinted icon circle, a label, and a chevron (or a
// trailing element in its place, e.g. a spinner). A shared shape for every
// row on this screen — Orders, Favorites, Privacy Policy, Admin Portal,
// Logout, and Deactivate all render through this so the menu reads as one
// consistent list rather than several one-off treatments.
function MenuRow({
  icon,
  iconColor,
  circleColor,
  label,
  labelColor,
  onPress,
  disabled,
  trailing,
  accessibilityLabel,
  accessibilityHint,
  style,
  index = 0,
  reduceMotion,
}) {
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(220).easing(EASE_OUT_QUART)}
    >
      <AnimatedPressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: Boolean(disabled) }}
      >
        <Card variant="flat" style={[styles.menuCard, style]}>
          <View style={[styles.menuIconCircle, { backgroundColor: circleColor }]}>
            <Ionicons name={icon} size={20} color={iconColor} />
          </View>
          <Text style={[styles.menuLabel, labelColor && { color: labelColor }]}>{label}</Text>
          {trailing}
        </Card>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function ProfileScreen({ navigation }) {
  const [userData, setUserData] = useState({ name: '', email: '' });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [privacyPolicyVisible, setPrivacyPolicyVisible] = useState(false);
  const [deactivateVisible, setDeactivateVisible] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  // True only while the sole-platform-admin check in handleOpenDeactivate
  // is in flight, so the row can't be tapped twice into two queries.
  const [checkingSoleAdmin, setCheckingSoleAdmin] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const { role, adminLoading } = useAdmin();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const user = auth.currentUser;

    if (!user) {
      // Previously there was no else branch here at all — if nobody was
      // signed in, userData just stayed at its initial placeholder state
      // forever, which is why the name literally showed "Loading...".
      // Profile is a customer-only screen, so redirect instead.
      navigation.replace('Login');
      return;
    }

    const fetchUserData = async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          setUserData({ name: userDoc.data().name, email: userDoc.data().email });
        } else {
          setUserData({ name: user.displayName || 'User', email: user.email });
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
        setUserData({ name: user.displayName || 'User', email: user.email });
      } finally {
        setLoadingProfile(false);
      }
    };
    fetchUserData();
  }, []);

  const handleStartEditName = () => {
    Haptics.selectionAsync();
    setNameDraft(userData.name || '');
    setNameError('');
    setEditingName(true);
  };

  const handleCancelEditName = () => {
    setEditingName(false);
    setNameDraft('');
    setNameError('');
  };

  const handleChangeNameDraft = (text) => {
    setNameDraft(text);
    if (nameError) setNameError('');
  };

  const handleSaveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError('Name cannot be empty.');
      return;
    }
    if (trimmed.length > 60) {
      setNameError('Name must be 60 characters or fewer.');
      return;
    }
    // Save is already disabled while offline — this is just a defensive
    // no-op in case isConnected flips between render and press.
    if (!isConnected) return;

    setSavingName(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Field-scoped update — only "name" is sent, so no other field on
      // the document can be touched by this write. Matches the allowlist
      // in firestore.rules, which permits owners to change "name" alone.
      await updateDoc(doc(db, "users", auth.currentUser.uid), { name: trimmed });

      // The Firestore document is the source of truth for display, but it
      // is not the only place the name is stored: Signupscreen writes it
      // to the Auth profile as well, and WriteReviewScreen stamps
      // auth.currentUser.displayName onto every review it creates. This
      // screen used to update only the Firestore half, so a customer who
      // renamed themselves kept publishing reviews under the name they
      // signed up with.
      //
      // Not awaited as part of the success path, and its failure is not
      // surfaced: the Firestore write above has already succeeded, the
      // name the user is looking at is already correct, and telling them
      // the rename failed because a secondary mirror did not update would
      // be false. Logged so it is diagnosable.
      updateProfile(auth.currentUser, { displayName: trimmed }).catch((error) => {
        console.error('Name saved, but Auth displayName did not sync:', error?.code, error?.message);
      });

      setUserData((prev) => ({ ...prev, name: trimmed }));
      setEditingName(false);
      setSavingName(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setSavingName(false);
      console.error("Error updating name:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
      } else {
        showAppAlert('Error', 'Could not update your name. Please try again.');
      }
    }
  };

  // Routes straight to the right portal for a restored privileged session —
  // seller to the dashboard, platformAdmin to user management — or to
  // AdminLogin otherwise (guests and unprivileged accounts alike, this row
  // stays reachable by everyone, see the row's own comment below). Guarded
  // by `disabled={adminLoading}` on the row itself, so this can't fire
  // while role is still unresolved — that's exactly the race that used to
  // send a real seller/platformAdmin back to AdminLogin.
  const handleAdminPortalPress = () => {
    Haptics.selectionAsync();
    if (role === 'seller') {
      navigation.navigate('AdminDashboard');
    } else if (role === 'platformAdmin') {
      navigation.navigate('AdminUsers');
    } else {
      navigation.navigate('AdminLogin');
    }
  };

  const handleOpenLogout = () => {
    setLogoutVisible(true);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUserData({ name: '', email: '' });
      setLogoutVisible(false);
      navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
    } catch (error) {
      setLogoutVisible(false);
      showAppAlert("Error", "Failed to log out. Please try again.");
    }
  };

  // Self-deactivation is permitted for every account by firestore.rules'
  // owner branch, and for almost everyone that's fine — a customer who
  // deactivates can be reactivated by a platform admin. The exception is
  // the LAST active platform admin: only that role can set isActive back
  // to true, so if the last one deactivates itself there is nobody left
  // who can undo it, and account management can only be restored by
  // editing the document in the Firebase console.
  //
  // firestore.rules already blocks a platform admin from deactivating
  // themselves through AdminUsersScreen, for exactly this reason.
  //
  // REACHABILITY, honestly: a platform admin cannot currently open this
  // screen at all. No staff screen navigates to Profile, and Loginscreen
  // signs staff accounts out and redirects them to the Staff Portal, so
  // there is no path from a privileged session into the customer stack.
  // (The handleAdminPortalPress branch above, which routes a privileged
  // viewer to their portal, predates that redirect and describes a state
  // the app no longer reaches.) A customer promoted mid-session doesn't
  // reach it either: AdminContext only re-resolves role on auth state
  // change, so `role` is still null for them and this check wouldn't fire.
  //
  // It is kept as defence in depth, not because it currently protects
  // anything: it costs nothing at runtime (the query only runs when role
  // is already platformAdmin, which never happens here today) and it would
  // become load-bearing again the moment someone adds a route from the
  // staff stack to Profile, or makes a persisted session enter the app
  // directly. Anyone reading this should know it is currently dormant
  // rather than assume the door is being held shut.
  //
  // A client-side check, deliberately: rules can't count documents, so
  // this can't be enforced server-side. That's acceptable here because
  // this guards against a mistake, not an attacker — someone determined to
  // strand their own account has other ways, and no security property
  // depends on stopping them.
  const handleOpenDeactivate = async () => {
    if (role === 'platformAdmin') {
      setCheckingSoleAdmin(true);
      try {
        // Only a platform admin may read /users, which is also the only
        // role this check applies to.
        const adminsSnap = await getDocs(
          query(collection(db, 'users'), where('role', '==', 'platformAdmin'))
        );
        const activeAdmins = adminsSnap.docs.filter(
          (d) => d.data().isActive !== false
        ).length;

        if (activeAdmins <= 1) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          showAppAlert(
            "You're the only Platform Admin",
            'Deactivating this account would leave nobody able to manage user roles, and no one inside the app could restore it. Grant someone else the Platform Admin role first, then deactivate.'
          );
          return;
        }
      } catch (error) {
        // Fails closed. Deactivation is irreversible from inside the app
        // for this role, so proceeding on an unverified count risks the
        // exact outcome this check exists to prevent — better to ask them
        // to retry than to strand the account on a network blip.
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
    setDeactivateVisible(true);
  };

  const handleDeactivateAccount = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setDeactivating(true);
    try {
      // Must happen before signOut() — the rule permitting this write
      // checks isOwner(userId) against the current request.auth, so once
      // signed out this same write would fail on permissions instead of
      // succeeding. Both fields are written together in one call, not two
      // separate writes.
      await updateDoc(doc(db, "users", user.uid), {
        isActive: false,
        deactivatedAt: serverTimestamp(),
      });

      await signOut(auth);

      setDeactivateVisible(false);
      setDeactivating(false);
      // Reset (not navigate) so "back" can't return to this authenticated
      // screen now that the session is gone — same reasoning as logout.
      navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
    } catch (error) {
      setDeactivating(false);
      console.error("Error deactivating account:", error);

      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
      } else {
        showAppAlert('Error', 'Could not deactivate your account. Please try again.');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ConfirmDialog
        visible={logoutVisible}
        onClose={() => setLogoutVisible(false)}
        title="Logout"
        confirmLabel="Logout"
        confirmVariant="primary"
        onConfirm={handleLogout}
      >
        <Text style={styles.modalMessage}>Are you sure you want to log out?</Text>
      </ConfirmDialog>

      <PrivacyPolicyModal
        visible={privacyPolicyVisible}
        onClose={() => setPrivacyPolicyVisible(false)}
      />

      <ConfirmDialog
        visible={deactivateVisible}
        onClose={() => setDeactivateVisible(false)}
        title="Deactivate Account"
        confirmLabel={!isConnected ? 'Offline' : 'Deactivate'}
        confirmVariant="danger"
        onConfirm={handleDeactivateAccount}
        loading={deactivating}
        confirmDisabled={deactivating || !isConnected}
        cancelDisabled={deactivating}
      >
        <Text style={styles.deactivateModalMessage}>
          Your account will be disabled and you will be signed out. You will
          not be able to sign in again. Your personal information is
          retained only as required for order and transaction records. To
          request further action on your data, contact the Store Manager
          through the Help Center.
        </Text>
      </ConfirmDialog>

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Help')}
          style={styles.headerAction}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Get help"
        >
          <Ionicons name="help-circle-outline" size={24} color={Colors.light.tint} />
        </TouchableOpacity>
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — some account actions are unavailable.
          </Text>
        </View>
      )}

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {loadingProfile ? (
          <ProfileSkeleton />
        ) : (
          <Animated.View
            style={styles.profileSection}
            entering={reduceMotion ? undefined : FadeIn.duration(240).easing(EASE_OUT_QUART)}
            accessible
            accessibilityLabel={`Signed in as ${userData.name}, ${userData.email}`}
          >
            <View style={styles.avatar}>
              <Ionicons name="person" size={56} color={Colors.light.tint} />
            </View>

            {editingName ? (
              <View style={styles.nameEditWrap}>
                <Input
                  value={nameDraft}
                  onChangeText={handleChangeNameDraft}
                  placeholder="Your name"
                  maxLength={60}
                  autoFocus
                  editable={!savingName}
                  error={
                    nameError ||
                    (!isConnected
                      ? 'Network connection lost. Please check your connection and try again.'
                      : '')
                  }
                  accessibilityLabel="Name"
                />
                <View style={styles.nameEditButtons}>
                  <View style={styles.nameEditButtonWrap}>
                    <Button
                      variant="secondary"
                      label="Cancel"
                      onPress={handleCancelEditName}
                      disabled={savingName}
                    />
                  </View>
                  <View style={styles.nameEditButtonWrap}>
                    <Button
                      variant="primary"
                      label={!isConnected ? 'Offline' : 'Save'}
                      onPress={handleSaveName}
                      loading={savingName}
                      disabled={savingName || !isConnected}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.nameRow}>
                <Text style={styles.name}>{userData.name}</Text>
                <Pressable
                  onPress={handleStartEditName}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Edit name"
                >
                  <Ionicons name="pencil" size={16} color={Colors.light.tint} />
                </Pressable>
              </View>
            )}
            <Text style={styles.email}>{userData.email}</Text>
          </Animated.View>
        )}

        <View style={styles.menuContent}>
          <Text style={styles.sectionTitle}>Account</Text>

          <MenuRow
            index={0}
            icon="document-text-outline"
            iconColor={Colors.light.icon}
            circleColor={Colors.light.border}
            label="My Orders"
            onPress={() => navigation.navigate('Orders')}
            accessibilityHint="Opens your order history"
            trailing={<Ionicons name="chevron-forward" size={20} color={Colors.light.icon} />}
            reduceMotion={reduceMotion}
          />

          <MenuRow
            index={1}
            icon="heart-outline"
            iconColor={Colors.light.icon}
            circleColor={Colors.light.border}
            label="Favorites"
            onPress={() => navigation.navigate('Favorites')}
            accessibilityHint="Opens your saved items"
            trailing={<Ionicons name="chevron-forward" size={20} color={Colors.light.icon} />}
            reduceMotion={reduceMotion}
          />

          <MenuRow
            index={2}
            icon="shield-outline"
            iconColor={Colors.light.icon}
            circleColor={Colors.light.border}
            label="Privacy Policy"
            onPress={() => setPrivacyPolicyVisible(true)}
            accessibilityHint="Opens the privacy policy"
            trailing={<Ionicons name="chevron-forward" size={20} color={Colors.light.icon} />}
            reduceMotion={reduceMotion}
          />

          {/* Stays visible and reachable for everyone, staff or not —
              AdminLoginScreen has to remain the one in-app entry point to
              the portal for a signed-out staff member. A customer tapping
              this still only ever lands on AdminLogin and can't get
              further; that's already enforced by Firestore rules +
              withRoleGuard, not by hiding this row.

              The label names the role for a restored privileged session
              ("Store Manager" / "Platform Admin") and falls back to the
              neutral "Staff Portal" for everyone else — so it always
              matches the screen handleAdminPortalPress() is about to open,
              and never promises a customer a portal they can't enter. */}
          <MenuRow
            index={3}
            icon="shield-checkmark"
            iconColor={Colors.light.tint}
            circleColor={Colors.light.tint + '15'}
            label={getPortalLabel(role)}
            labelColor={Colors.light.tint}
            onPress={handleAdminPortalPress}
            disabled={adminLoading}
            accessibilityHint={`Opens the ${getPortalLabel(role)}`}
            style={styles.adminCard}
            trailing={
              adminLoading ? (
                <ActivityIndicator size="small" color={Colors.light.tint} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={Colors.light.tint} />
              )
            }
            reduceMotion={reduceMotion}
          />

          <View style={styles.sessionSection}>
            <MenuRow
              index={4}
              icon="log-out-outline"
              iconColor={Colors.light.danger}
              circleColor={Colors.light.danger + '12'}
              label="Logout"
              labelColor={Colors.light.danger}
              onPress={handleOpenLogout}
              accessibilityHint="Signs you out of your account"
              reduceMotion={reduceMotion}
            />

            {/* Deliberately separated from Logout above (extra top margin) and
                placed last — this is irreversible from the user's side, so it
                shouldn't sit where a normal settings row would be tapped by
                accident. */}
            <MenuRow
              index={5}
              icon="person-remove-outline"
              iconColor={Colors.light.danger}
              circleColor={Colors.light.danger + '12'}
              label="Deactivate My Account"
              labelColor={Colors.light.danger}
              onPress={handleOpenDeactivate}
              disabled={checkingSoleAdmin}
              accessibilityHint="Opens a confirmation to deactivate your account"
              style={styles.deactivateCard}
              reduceMotion={reduceMotion}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  headerAction: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },

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

  content: { flex: 1 },

  // Identity block — kept full-bleed under the header (not inset with the
  // menu below) so it reads as the screen's one hero moment, the same way
  // Home's greeting + hero photo sit outside its padded content sections.
  profileSection: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.light.tint + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  name: { fontSize: 19, fontWeight: '700', color: Colors.light.text },
  email: { fontSize: 14, color: Colors.light.icon, marginTop: 4 },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameEditWrap: { width: '100%', paddingHorizontal: 20 },
  nameEditButtons: { flexDirection: 'row', gap: 12, marginTop: Spacing.xs },
  nameEditButtonWrap: { flex: 1 },

  avatarSkeleton: { width: 100, height: 100, borderRadius: 50, marginBottom: Spacing.md },
  skeletonLine: { height: 14, borderRadius: 4, marginTop: 6 },
  skeletonNameLine: { width: 140 },
  skeletonEmailLine: { width: 180, height: 12 },

  menuContent: { paddingHorizontal: 20, paddingTop: Spacing.lg, paddingBottom: Spacing.xxl },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.light.text, marginBottom: 12 },

  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 12,
    marginBottom: 10,
  },
  menuIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: { fontSize: 15, fontWeight: '600', color: Colors.light.text, flex: 1 },

  adminCard: { backgroundColor: Colors.light.tint + '0D', borderColor: Colors.light.tint + '30' },

  sessionSection: { marginTop: Spacing.lg },
  deactivateCard: { marginTop: 14, marginBottom: 0 },

  // Confirmation dialogs (rendered through the shared ConfirmDialog component
  // — only the message text styles below are local to this screen)
  modalMessage: { fontSize: 15, color: Colors.light.icon, textAlign: 'center', marginBottom: Spacing.lg },
  // Left-aligned and smaller than modalMessage — this dialog's copy is a
  // full paragraph the user actually needs to read and understand (privacy
  // implications), not a short one-line confirmation, so centered text
  // would be harder to read here.
  deactivateModalMessage: {
    fontSize: 14,
    color: Colors.light.icon,
    textAlign: 'left',
    lineHeight: 20,
    marginBottom: Spacing.lg,
    alignSelf: 'stretch',
  },
});
