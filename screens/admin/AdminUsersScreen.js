import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { signOut } from 'firebase/auth';
import { db, auth } from '../../firebaseConfig';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { useAdmin } from '../../context/AdminContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../../constants/theme';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import DialogButtonRow from '../../components/ui/DialogButtonRow';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';
import { ROLES, getRoleLabel, getPortalLabel, ROLE_PLATFORM_ADMIN } from '../../constants/roles';
import { logAccountActivity, ACTIONS } from '../../utils/activityLog';

// The three roles Firestore recognizes (see firestore.rules) and their
// user-facing names both come from constants/roles.js, so the picker, the
// badges, and every other screen that names a role can't drift apart.
// "admin" is not one of them — no document holds it and no rule grants it
// anything. Note the stored value 'seller' displays as "Store Manager":
// that's the job title the SRS and the customer-facing copy both use.
const ROLE_OPTIONS = ROLES;

// Shaped like a real user row so the loading state previews the content
// that's about to arrive, instead of a spinner floating mid-screen.
function UserCardSkeleton() {
  return (
    <Card variant="flat" style={styles.userCard}>
      <SkeletonBlock style={styles.avatarSkeleton} />
      <View style={styles.userInfo}>
        <SkeletonBlock style={{ width: '55%', height: 14, borderRadius: Radius.sm, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: '75%', height: 11, borderRadius: Radius.sm, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: '40%', height: 11, borderRadius: Radius.sm }} />
      </View>
      <View style={styles.userActions}>
        <SkeletonBlock style={{ width: 54, height: 18, borderRadius: Radius.pill, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: 60, height: 20, borderRadius: Radius.sm }} />
      </View>
    </Card>
  );
}

export default function AdminUsersScreen({ navigation }) {
  const { logoutAsAdmin } = useAdmin();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usersError, setUsersError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({
    role: 'customer',
  });
  // Tracks which single user's activate/deactivate write is in flight, so
  // one row updating doesn't disable every other row's action button too.
  const [togglingUserId, setTogglingUserId] = useState(null);
  // Bumped by handleRetry() to force the listener below to tear down and
  // re-subscribe — same shape as AdminOrdersScreen's retryToken, so a
  // permissions blip or bad connection at mount doesn't leave the list
  // silently stuck on an unrecoverable listener.
  const [retryToken, setRetryToken] = useState(0);
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  // AdminUsersScreen is the root of the stack for a platformAdmin who just
  // logged in (AdminLoginScreen reaches it via replace(), not navigate() —
  // see AdminLoginScreen.js), so there's no screen underneath to pop back
  // to. When that's the case, the header control can't go back at all; it
  // has to actually exit the admin portal instead, the same way
  // StoreManagerDashboardScreen's logout button does.
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Explains where staff accounts come from. There is deliberately no
  // "create account" form behind this: a client app can't create another
  // person's Firebase Auth account (createUserWithEmailAndPassword signs
  // the CALLER in as the new user, which would drop this admin's own
  // session), and firestore.rules now forbids "role" from being set at
  // document-creation time at all — so signing up can never mint a
  // privileged account. Staff access is granted here, by promoting an
  // existing customer, and this dialog is what makes that visible instead
  // of folklore.
  const [addStaffVisible, setAddStaffVisible] = useState(false);
  // Focused when the dialog's action is taken, so "find the person" leads
  // straight into the search rather than leaving the admin to hunt for it.
  const searchInputRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    setUsersError(false);

    const unsubscribe = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        // Base profile fields come straight from each users/{uid} doc.
        // role and isActive don't exist on most existing docs (only
        // manually-set seller/platformAdmin accounts have "role"), so
        // missing values are defaulted here rather than left undefined.
        //
        // Deliberately no per-user order stats here: platformAdmin has no
        // read access to users/{uid}/orders under firestore.rules — that
        // subcollection is a seller/owner concern (purchase history), not
        // an account-management one. Account management does not include
        // reading purchase histories.
        const baseUsers = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data.name || 'Unnamed User',
            email: data.email || '—',
            role: data.role || 'customer',
            isActive: data.isActive !== false,
            createdAt: data.createdAt || null,
          };
        });

        setUsers(baseUsers);
        setUsersError(false);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching users:', error);
        setUsersError(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [retryToken]);

  const handleRetry = () => setRetryToken((t) => t + 1);

  // Reached from Profilescreen.js's staff-portal row via navigate(), which
  // pushes on top of the customer stack — canGoBack() is true there, so a
  // normal pop is correct. Reached from AdminLoginScreen via replace(), it
  // isn't, and the same tap has to exit the portal instead — see
  // confirmLogout below, copied from StoreManagerDashboardScreen's logout.
  const handleBackPress = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    Haptics.selectionAsync();
    setLogoutVisible(true);
  };

  const handleOpenAddStaff = () => {
    Haptics.selectionAsync();
    setAddStaffVisible(true);
  };

  // Closing straight into a focused search field is the whole point of the
  // dialog's action — the next step really is "find that person in this
  // list", so the control does it instead of describing it.
  const handleAddStaffFindUser = () => {
    setAddStaffVisible(false);
    searchInputRef.current?.focus();
  };

  const confirmLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut(auth);
      logoutAsAdmin();
      // Reset the nav stack so "back" can't return to admin screens
      // after the session is gone.
      navigation.reset({
        index: 0,
        routes: [{ name: 'AdminLogin' }],
      });
    } catch (error) {
      console.error('Error signing out:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoggingOut(false);
      setLogoutVisible(false);
      showAppAlert('Error', 'Could not log out. Please try again.');
    }
  };

  // The signed-in platformAdmin's own document — firestore.rules blocks
  // the platformAdmin write branch from ever targeting request.auth.uid,
  // so role and isActive controls on this row must be disabled in the UI
  // rather than let someone tap them and get a write denied on submit.
  const isSelf = (userId) => userId === auth.currentUser?.uid;

  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleViewUser = (user) => {
    Haptics.selectionAsync();
    setSelectedUser(user);
    setShowUserModal(true);
  };

  const handleEditUser = (user) => {
    if (isSelf(user.id)) return; // Edit action is disabled on the self row; defensive no-op.
    Haptics.selectionAsync();
    setSelectedUser(user);
    setEditFormData({
      role: user.role,
    });
    setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
    if (isSelf(selectedUser.id)) {
      // Defensive — role chips and Save are disabled whenever the modal is
      // open on the signed-in platformAdmin's own document (see
      // editingSelf below), so this shouldn't be reachable. firestore.rules
      // would deny the write either way: the platformAdmin branch never
      // matches when the target document is the requester's own.
      return;
    }

    setUpdating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Field-scoped update — only "role" is sent, matching the
      // hasOnly(['role', 'isActive']) allowlist in firestore.rules for the
      // platformAdmin branch. Name is edited by the account owner from
      // their own Profile screen, not here.
      const previousRole = selectedUser.role;
      await updateDoc(doc(db, 'users', selectedUser.id), {
        role: editFormData.role,
      });
      // Granting or revoking staff access is the single most consequential
      // action this screen performs, so it's the one the log most needs to
      // carry — including what the role was before.
      logAccountActivity({
        action: ACTIONS.USER_ROLE,
        targetId: selectedUser.id,
        targetLabel: selectedUser.name,
        summary:
          `${selectedUser.name} — role ${getRoleLabel(previousRole)} → ` +
          `${getRoleLabel(editFormData.role)}`,
      });
      setShowEditModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert('Success', 'User updated successfully');
    } catch (error) {
      console.error('Error updating user:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
        return;
      }

      showAppAlert('Error', 'Could not update user. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleUserStatus = (user) => {
    if (isSelf(user.id)) {
      // Defensive — the status toggle is disabled on the signed-in
      // platformAdmin's own row; firestore.rules would deny this write
      // either way.
      return;
    }

    Haptics.selectionAsync();
    const newStatus = !user.isActive;
    showAppAlert(
      newStatus ? 'Activate User' : 'Deactivate User',
      `Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} ${user.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: newStatus ? 'Activate' : 'Deactivate',
          style: newStatus ? 'default' : 'destructive',
          onPress: async () => {
            setTogglingUserId(user.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              await updateDoc(doc(db, 'users', user.id), { isActive: newStatus });
              // Deactivation is this project's stand-in for deletion (SRS
              // §2.4 keeps accounts for auditability), so it needs to leave
              // a trace of its own — otherwise an account can go dark with
              // nothing recording who did it.
              logAccountActivity({
                action: ACTIONS.USER_STATUS,
                targetId: user.id,
                targetLabel: user.name,
                summary: `${user.name} — account ${newStatus ? 'activated' : 'deactivated'}`,
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              showAppAlert('Success', `User ${newStatus ? 'activated' : 'deactivated'} successfully`);
            } catch (error) {
              console.error('Error updating user status:', error);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

              const isNetworkError = !isConnected || error.code === 'unavailable';
              if (isNetworkError) {
                showAppAlert(
                  'No Internet Connection',
                  'Network connection lost. Please check your connection and try again.'
                );
              } else {
                showAppAlert('Error', 'Could not update user status. Please try again.');
              }
            } finally {
              setTogglingUserId(null);
            }
          },
        },
      ]
    );
  };

  const getRoleBadgeStyle = (role) => {
    if (role === 'platformAdmin') {
      return { backgroundColor: Colors.light.danger + '20', color: Colors.light.danger };
    }
    if (role === 'seller') {
      return { backgroundColor: Colors.light.tint + '20', color: Colors.light.tint };
    }
    return { backgroundColor: Colors.light.border + '60', color: Colors.light.icon };
  };

  const getActiveBadgeStyle = (isActive) => {
    if (isActive) {
      return { backgroundColor: Colors.light.success + '20', color: Colors.light.success };
    }
    return { backgroundColor: Colors.light.danger + '20', color: Colors.light.danger };
  };

  const getStatusIcon = (isActive) => (isActive ? 'checkmark-circle-outline' : 'close-circle-outline');

  const formatDate = (dateInput) => {
    if (!dateInput) return 'Unknown';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getStats = () => {
    const totalUsers = users.length;
    const activeUsers = users.filter((u) => u.isActive).length;
    // Counts ACTIVE platform admins only. A deactivated one can't sign in
    // (AdminLoginScreen refuses them) and resolves to no role at all
    // (AdminContext.resolvePrivilegedRole), so counting them here would
    // report cover that doesn't exist — and this number is what the
    // single-admin warning below depends on.
    const platformAdminUsers = users.filter(
      (u) => u.role === 'platformAdmin' && u.isActive
    ).length;

    return { totalUsers, activeUsers, platformAdminUsers };
  };

  const stats = getStats();
  // The role can be locked out of the app entirely. firestore.rules stops
  // a platform admin from deactivating themselves through THIS screen, but
  // the ordinary owner branch still lets any account deactivate itself
  // from Profile — and only a platform admin can set isActive back to
  // true. So if the last active one deactivates, or simply loses access to
  // their email, nothing inside the app can restore account management;
  // recovery means editing the document in the Firebase console.
  //
  // Profilescreen blocks the self-deactivation half of that. This warning
  // covers the rest: it names the risk while a second admin can still be
  // appointed, which is the only cheap moment to fix it.
  const isSolePlatformAdmin = !loading && !usersError && stats.platformAdminUsers <= 1;
  // Guards the Edit User modal's role picker + Save button — see the
  // comment above the picker for why this defensive check exists even
  // though the modal's entry points are already gated.
  const editingSelf = selectedUser ? isSelf(selectedUser.id) : false;
  // Decides both the header control's behavior and what it looks like —
  // see handleBackPress above.
  const canGoBack = navigation.canGoBack();

  return (
    <SafeAreaView style={styles.container}>
      <ConfirmDialog
        visible={addStaffVisible}
        onClose={() => setAddStaffVisible(false)}
        title="Adding a staff member"
        cancelLabel="Close"
        confirmLabel="Find the user"
        confirmVariant="primary"
        onConfirm={handleAddStaffFindUser}
      >
        <Text style={styles.modalMessage}>
          Staff accounts aren&apos;t created here — they&apos;re granted. Nobody can sign
          up as a Store Manager or Platform Admin, which is what stops a
          stranger from giving themselves access.
        </Text>
        <View style={styles.addStaffSteps}>
          <Text style={styles.addStaffStep}>
            <Text style={styles.addStaffStepNumber}>1. </Text>
            Ask the person to sign up in the PlainCo app like any customer.
          </Text>
          <Text style={styles.addStaffStep}>
            <Text style={styles.addStaffStepNumber}>2. </Text>
            Find their account in this list.
          </Text>
          <Text style={styles.addStaffStep}>
            <Text style={styles.addStaffStepNumber}>3. </Text>
            Open Edit User and set their role to Store Manager or Platform Admin.
          </Text>
        </View>
        <Text style={styles.addStaffFootnote}>
          Granting roles is this account&apos;s job — no one else can do it.
        </Text>
      </ConfirmDialog>

      <ConfirmDialog
        visible={logoutVisible}
        onClose={() => setLogoutVisible(false)}
        title="Log Out"
        confirmLabel="Log Out"
        confirmVariant="primary"
        onConfirm={confirmLogout}
        loading={loggingOut}
        confirmDisabled={loggingOut}
        cancelDisabled={loggingOut}
      >
        <Text style={styles.modalMessage}>Are you sure you want to log out of the Platform Admin portal?</Text>
      </ConfirmDialog>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerActions}>
          <AnimatedPressable
            onPress={handleBackPress}
            style={styles.backButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={canGoBack ? 'Go back' : 'Log out'}
          >
            <Ionicons
              name={canGoBack ? 'arrow-back' : 'log-out-outline'}
              size={24}
              color={canGoBack ? Colors.light.text : Colors.light.danger}
            />
          </AnimatedPressable>
          <View style={styles.headerSpacer} />
        </View>
        {/* The signed-in role is named in the header, not just implied by
            which screen you happen to be on. Before the split there was
            one "admin" and no reason to say which hat you were wearing;
            now there are two non-overlapping ones, and "why can't I see
            Products?" has a visible answer sitting at the top of the
            screen. */}
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle} accessibilityRole="header">Manage Users</Text>
          <Text style={styles.headerRole}>{getPortalLabel(ROLE_PLATFORM_ADMIN)}</Text>
        </View>
        {/* Sits in the slot the layout already reserved for balance, so the
            title stays centered. "Add staff" is the question every new
            platform admin arrives with; answering it in the place they'd
            look for a + button is cheaper than letting them conclude the
            feature is missing. */}
        <View style={styles.headerActions}>
          <AnimatedPressable
            onPress={() => {
              Haptics.selectionAsync();
              navigation.navigate('AdminActivity');
            }}
            style={styles.headerAction}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Account activity log"
          >
            <Ionicons name="time-outline" size={22} color={Colors.light.tint} />
          </AnimatedPressable>
          <AnimatedPressable
            onPress={handleOpenAddStaff}
            style={styles.headerAction}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="How to add a staff member"
          >
            <Ionicons name="person-add-outline" size={22} color={Colors.light.tint} />
          </AnimatedPressable>
        </View>
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — user data may be out of date.
          </Text>
        </View>
      )}

      {/* Stats Cards */}
      <Animated.View
        style={styles.statsWrapper}
        entering={reduceMotion ? undefined : FadeIn.duration(220)}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsContainer}
        >
          <Card variant="flat" style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalUsers}</Text>
            <Text style={styles.statLabel}>Total {stats.totalUsers === 1 ? 'User' : 'Users'}</Text>
          </Card>
          <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.success + '15' }]}>
            <Text style={[styles.statValue, { color: Colors.light.success }]}>{stats.activeUsers}</Text>
            <Text style={styles.statLabel}>Active {stats.activeUsers === 1 ? 'User' : 'Users'}</Text>
          </Card>
          <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.border + '60' }]}>
            <Text style={styles.statValue}>{stats.platformAdminUsers}</Text>
            <Text style={styles.statLabel}>{stats.platformAdminUsers === 1 ? 'Platform Admin' : 'Platform Admins'}</Text>
          </Card>
        </ScrollView>
      </Animated.View>

      {/* Highlight rather than danger: nothing is broken yet, and this is a
          standing condition rather than a failure — Rust here would cry
          wolf on every visit until a second admin exists. */}
      {isSolePlatformAdmin && (
        <Animated.View
          style={styles.warningBanner}
          entering={reduceMotion ? undefined : FadeIn.duration(220)}
        >
          <Ionicons name="warning-outline" size={16} color={Colors.light.highlight} />
          <Text style={styles.warningText}>
            You&apos;re the only active Platform Admin. If this account is lost or
            deactivated, nobody can manage roles — grant a second person the
            Platform Admin role to avoid that.
          </Text>
        </Animated.View>
      )}

      {/* Search Bar */}
      <Animated.View
        style={styles.searchContainer}
        entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(40).easing(EASE_OUT_QUART)}
      >
        <Ionicons name="search-outline" size={20} color={Colors.light.icon} style={styles.searchIcon} />
        <TextInput
          ref={searchInputRef}
          style={styles.searchInput}
          placeholder="Search by name or email..."
          placeholderTextColor={Colors.light.icon}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search users by name or email"
        />
        {searchQuery.length > 0 && (
          <Pressable
            onPress={() => setSearchQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={20} color={Colors.light.icon} />
          </Pressable>
        )}
      </Animated.View>

      {/* Users List */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.usersContainer}>
        {loading ? (
          <>
            <UserCardSkeleton />
            <UserCardSkeleton />
            <UserCardSkeleton />
          </>
        ) : usersError ? (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load users"
              subtitle="Check your connection and try again."
            />
            <View style={styles.emptyStateAction}>
              <Button variant="outline" label="Retry" onPress={handleRetry} />
            </View>
          </View>
        ) : filteredUsers.length > 0 ? (
          filteredUsers.map((user, index) => {
            const selfRow = isSelf(user.id);
            const editDisabled = selfRow;
            const toggleDisabled = !isConnected || togglingUserId === user.id || selfRow;
            return (
              <Animated.View
                key={user.id}
                entering={
                  reduceMotion
                    ? undefined
                    : FadeInDown.duration(240)
                        .delay(80 + Math.min(index, 8) * 40)
                        .easing(EASE_OUT_QUART)
                }
              >
                <AnimatedPressable
                  onPress={() => handleViewUser(user)}
                  accessibilityRole="button"
                  accessibilityLabel={`${user.name}, ${getRoleLabel(user.role)} role, ${user.isActive ? 'active' : 'inactive'}`}
                  accessibilityHint="Opens user details"
                >
                  <Card variant="flat" style={styles.userCard}>
                    <View style={styles.userAvatar}>
                      <Text style={styles.userAvatarText}>
                        {user.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.userInfo}>
                      <View style={styles.userNameRow}>
                        <Text style={styles.userName} numberOfLines={1} ellipsizeMode="tail">
                          {user.name}
                        </Text>
                        <View style={[styles.roleBadge, getRoleBadgeStyle(user.role)]}>
                          <Text style={[styles.roleText, { color: getRoleBadgeStyle(user.role).color }]}>
                            {getRoleLabel(user.role).toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.userEmailRow}>
                        <Ionicons name="mail-outline" size={12} color={Colors.light.icon} />
                        <Text style={styles.userEmail} numberOfLines={1} ellipsizeMode="tail">
                          {user.email}
                        </Text>
                      </View>
                      {selfRow && (
                        <Text style={styles.selfRowHint}>
                          This is you — role and status can&apos;t be changed here
                        </Text>
                      )}
                    </View>
                    <View style={styles.userActions}>
                      <View style={[styles.statusBadge, getActiveBadgeStyle(user.isActive)]}>
                        <Ionicons
                          name={getStatusIcon(user.isActive)}
                          size={11}
                          color={getActiveBadgeStyle(user.isActive).color}
                        />
                        <Text style={[styles.statusText, { color: getActiveBadgeStyle(user.isActive).color }]}>
                          {user.isActive ? 'ACTIVE' : 'INACTIVE'}
                        </Text>
                      </View>
                      <View style={styles.actionButtons}>
                        <AnimatedPressable
                          style={[styles.actionButton, editDisabled && styles.actionButtonDisabled]}
                          onPress={() => handleEditUser(user)}
                          disabled={editDisabled}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                          accessibilityRole="button"
                          accessibilityLabel={
                            editDisabled ? "Edit disabled — this is your own account" : `Edit ${user.name}`
                          }
                          accessibilityState={{ disabled: editDisabled }}
                        >
                          <Ionicons
                            name="create-outline"
                            size={20}
                            color={editDisabled ? Colors.light.border : Colors.light.tint}
                          />
                        </AnimatedPressable>
                        <AnimatedPressable
                          style={[styles.actionButton, toggleDisabled && styles.actionButtonDisabled]}
                          onPress={() => handleToggleUserStatus(user)}
                          disabled={toggleDisabled}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                          accessibilityRole="button"
                          accessibilityLabel={
                            selfRow
                              ? "Status change disabled — this is your own account"
                              : `${user.isActive ? 'Deactivate' : 'Activate'} ${user.name}`
                          }
                          accessibilityState={{ disabled: toggleDisabled }}
                        >
                          {togglingUserId === user.id ? (
                            <ActivityIndicator
                              size="small"
                              color={user.isActive ? Colors.light.danger : Colors.light.success}
                            />
                          ) : (
                            <Ionicons
                              name={user.isActive ? 'person-remove-outline' : 'person-add-outline'}
                              size={20}
                              color={toggleDisabled ? Colors.light.border : (user.isActive ? Colors.light.danger : Colors.light.success)}
                            />
                          )}
                        </AnimatedPressable>
                      </View>
                    </View>
                  </Card>
                </AnimatedPressable>
              </Animated.View>
            );
          })
        ) : (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="people-outline"
              title="No users found"
              subtitle={searchQuery ? 'Try a different search term' : 'Users will appear here'}
            />
            {Boolean(searchQuery) && (
              <View style={styles.emptyStateAction}>
                <Button variant="outline" label="Clear search" onPress={() => setSearchQuery('')} />
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* User Details Modal */}
      <Modal
        visible={showUserModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowUserModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>User Details</Text>
              <Pressable
                onPress={() => setShowUserModal(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>

            {selectedUser && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalAvatar}>
                  <Text style={styles.modalAvatarText}>
                    {selectedUser.name.charAt(0).toUpperCase()}
                  </Text>
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Name:</Text>
                  <Text style={styles.modalInfoValue}>{selectedUser.name}</Text>
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Email:</Text>
                  <Text style={styles.modalInfoValue}>{selectedUser.email}</Text>
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Role:</Text>
                  <View style={[styles.modalRoleBadge, getRoleBadgeStyle(selectedUser.role)]}>
                    <Text style={[styles.modalRoleText, { color: getRoleBadgeStyle(selectedUser.role).color }]}>
                      {getRoleLabel(selectedUser.role).toUpperCase()}
                    </Text>
                  </View>
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Status:</Text>
                  <View style={[styles.modalStatusBadge, getActiveBadgeStyle(selectedUser.isActive)]}>
                    <Ionicons
                      name={getStatusIcon(selectedUser.isActive)}
                      size={12}
                      color={getActiveBadgeStyle(selectedUser.isActive).color}
                    />
                    <Text style={[styles.modalStatusText, { color: getActiveBadgeStyle(selectedUser.isActive).color }]}>
                      {selectedUser.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </Text>
                  </View>
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Join Date:</Text>
                  <Text style={styles.modalInfoValue}>{formatDate(selectedUser.createdAt)}</Text>
                </View>

                {isSelf(selectedUser.id) ? (
                  <Text style={styles.selfModalHint}>
                    This is your account — role and status can&apos;t be changed from here.
                    Ask another platform administrator to make this change.
                  </Text>
                ) : (
                  <View style={styles.modalButtons}>
                    <View style={styles.modalButtonHalf}>
                      <Button
                        variant="primary"
                        label="Edit User"
                        onPress={() => {
                          setShowUserModal(false);
                          handleEditUser(selectedUser);
                        }}
                      />
                    </View>
                    <View style={styles.modalButtonHalf}>
                      <AnimatedPressable
                        style={[
                          styles.statusToggleButton,
                          { backgroundColor: selectedUser.isActive ? Colors.light.danger : Colors.light.success },
                          !isConnected && { opacity: 0.7 },
                        ]}
                        onPress={() => {
                          setShowUserModal(false);
                          handleToggleUserStatus(selectedUser);
                        }}
                        disabled={!isConnected}
                        accessibilityRole="button"
                        accessibilityLabel={
                          !isConnected
                            ? 'Offline, cannot change status'
                            : `${selectedUser.isActive ? 'Deactivate' : 'Activate'} ${selectedUser.name}`
                        }
                      >
                        <Text style={styles.statusButtonText}>
                          {/* Shortened vs. the full "No Internet Connection" —
                              this button shares a half-width row with Edit
                              User, so the longer phrase wrapped awkwardly. */}
                          {!isConnected
                            ? 'Offline'
                            : selectedUser.isActive ? 'Deactivate' : 'Activate'}
                        </Text>
                      </AnimatedPressable>
                    </View>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        visible={showEditModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit User</Text>
              <Pressable
                onPress={() => setShowEditModal(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Name</Text>
                <View style={[styles.input, styles.inputDisabled]}>
                  <Text style={styles.disabledInputText}>{selectedUser?.name}</Text>
                </View>
                <Text style={styles.inputHint}>
                  Users change their own display name from Profile — it isn&apos;t an administrative action.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <View style={[styles.input, styles.inputDisabled]}>
                  <Text style={styles.disabledInputText}>{selectedUser?.email}</Text>
                </View>
                <Text style={styles.inputHint}>
                  Login email can&apos;t be changed here — it&apos;s tied to their Firebase Auth account.
                </Text>
              </View>

              {/* editingSelf should never be true here in normal use — the Edit
                  entry points on the list row and detail modal are already
                  disabled for the signed-in platformAdmin's own account. Kept
                  as a defensive guard anyway: firestore.rules denies this
                  write regardless of how the modal was reached, and the UI
                  must not present a control that's guaranteed to be denied. */}
              {editingSelf && (
                <Text style={styles.selfModalHint}>
                  You can&apos;t change your own role — have another platform
                  administrator make this change instead.
                </Text>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Role</Text>
                {/* Each option carries a one-line statement of what the role
                    can and can't reach. Assigning roles is this account's
                    entire job, so the consequence of the choice belongs next
                    to the choice — three unlabeled pills ("Customer / Store
                    Manager / Platform Admin") assume the reader already
                    knows the boundary, which is exactly the assumption that
                    made the old single "admin" role confusing. Stacked
                    vertically rather than as a pill row because a sentence
                    doesn't fit in a pill. */}
                <View style={styles.roleSelector}>
                  {ROLE_OPTIONS.map((option) => {
                    const active = editFormData.role === option.value;
                    return (
                      <AnimatedPressable
                        key={option.value}
                        style={[
                          styles.roleOption,
                          active && styles.roleOptionActive,
                          editingSelf && styles.roleOptionDisabled,
                        ]}
                        onPress={() => {
                          if (editingSelf) return;
                          Haptics.selectionAsync();
                          setEditFormData({ ...editFormData, role: option.value });
                        }}
                        disabled={editingSelf}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active, disabled: editingSelf }}
                        accessibilityLabel={`${option.label} role. ${option.capability}`}
                      >
                        <View style={styles.roleOptionCheck}>
                          <Ionicons
                            name={active ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={active ? Colors.light.tint : Colors.light.icon}
                          />
                        </View>
                        <View style={styles.roleOptionCopy}>
                          <Text
                            style={[
                              styles.roleOptionText,
                              active && styles.roleOptionTextActive,
                            ]}
                          >
                            {option.label}
                          </Text>
                          <Text style={styles.roleOptionCapability}>{option.capability}</Text>
                        </View>
                      </AnimatedPressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.editModalButtons}>
                <DialogButtonRow
                  buttons={[
                    {
                      label: 'Cancel',
                      variant: 'secondary',
                      onPress: () => setShowEditModal(false),
                      disabled: updating,
                    },
                    {
                      label: !isConnected ? 'Offline' : 'Save Changes',
                      variant: 'primary',
                      onPress: handleUpdateUser,
                      loading: updating,
                      disabled: updating || !isConnected || editingSelf,
                    },
                  ]}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleGroup: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
  },
  headerRole: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.light.icon,
    marginTop: 2,
  },
  placeholder: {
    width: 40,
  },
  headerAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Two actions now sit on the right, so the left side has to reserve the
  // same 80px or the centered title drifts off-centre by exactly one
  // button. backButton keeps its own 40 and this pads the rest.
  // Both header sides use this: 80px wide holding two 40px slots, so they
  // balance exactly and the title stays centered. The left side is the
  // back button plus a spacer; the right is two real buttons. No
  // justifyContent needed — the children fill the width precisely.
  headerActions: {
    flexDirection: 'row',
    width: 80,
  },
  headerSpacer: {
    width: 40,
  },
  addStaffSteps: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  addStaffStep: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.light.text,
  },
  addStaffStepNumber: {
    fontWeight: '700',
    color: Colors.light.tint,
  },
  addStaffFootnote: {
    fontSize: 12,
    lineHeight: 17,
    color: Colors.light.icon,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.danger + '40',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.light.highlight + '18',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.highlight + '40',
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.light.text,
  },
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
  modalMessage: { fontSize: 15, color: Colors.light.icon, textAlign: 'center', marginBottom: Spacing.lg },
  statsWrapper: {
    marginTop: 16,
  },
  statsContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  statCard: {
    minWidth: 100,
    alignItems: 'center',
  },
  // Matches AdminOrdersScreen.js's statValue exactly (no lineHeight /
  // includeFontPadding overrides) — those were added earlier as a guess at
  // fixing clipped-looking numbers, but AdminOrdersScreen renders the same
  // bold 24px numerals cleanly with this exact style, so the real cause
  // was more likely the stats row's wrapping structure (now matched too)
  // than glyph metrics. Revisit with a lineHeight override only if a real
  // regression shows up here that Orders doesn't have.
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.icon,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: Colors.light.text,
  },
  usersContainer: {
    padding: 16,
    paddingTop: 0,
  },
  emptyStateWrap: { paddingHorizontal: Spacing.md },
  emptyStateAction: { marginTop: -Spacing.sm, marginBottom: Spacing.md, paddingHorizontal: Spacing.xl },
  userCard: {
    flexDirection: 'row',
    padding: 12,
    marginBottom: 12,
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarSkeleton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  userAvatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  userInfo: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
    flexShrink: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '600',
  },
  userEmailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  userEmail: {
    fontSize: 12,
    color: Colors.light.icon,
    flexShrink: 1,
  },
  selfRowHint: {
    fontSize: 11,
    fontStyle: 'italic',
    color: Colors.light.icon,
  },
  userActions: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginBottom: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  actionButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.4,
  },
  selfModalHint: {
    fontSize: 13,
    color: Colors.light.icon,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.light.background,
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
  },
  modalAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalAvatarText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '600',
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalInfoLabel: {
    fontSize: 14,
    color: Colors.light.icon,
    fontWeight: '500',
  },
  modalInfoValue: {
    fontSize: 14,
    color: Colors.light.text,
  },
  modalRoleBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  modalRoleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  modalStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalButtonHalf: { flex: 1 },
  // Cancel/Save Changes render through DialogButtonRow, which keeps both
  // buttons the same width and the same text size — this wrap just adds
  // the top spacing above the row.
  editModalButtons: {
    marginTop: 20,
  },
  statusToggleButton: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  statusButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },
  inputDisabled: {
    backgroundColor: Colors.light.border + '30',
    justifyContent: 'center',
  },
  disabledInputText: {
    fontSize: 14,
    color: Colors.light.icon,
  },
  inputHint: {
    fontSize: 11,
    color: Colors.light.icon,
    marginTop: 6,
  },
  roleSelector: {
    gap: Spacing.sm,
  },
  // Selection reads as a tinted outline rather than a solid Clay fill:
  // the option now carries a description line, and white-on-Clay body copy
  // at 12px would be the least legible text in the modal. Flat-by-default
  // per DESIGN.md, with the fill reserved for the actual primary action
  // (Save Changes) at the bottom of the same modal.
  roleOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  roleOptionActive: {
    backgroundColor: Colors.light.tint + '12',
    borderColor: Colors.light.tint,
  },
  roleOptionDisabled: {
    opacity: 0.5,
  },
  roleOptionCheck: {
    // Nudged down so the radio sits on the label's optical center rather
    // than the top edge of a two-line block.
    marginTop: 1,
  },
  roleOptionCopy: {
    flex: 1,
  },
  roleOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  roleOptionTextActive: {
    color: Colors.light.tint,
  },
  roleOptionCapability: {
    fontSize: 12,
    lineHeight: 16,
    color: Colors.light.icon,
    marginTop: 2,
  },
});
