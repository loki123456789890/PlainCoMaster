import React, { useState, useEffect } from 'react';
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
import { db, auth } from '../../firebaseConfig';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  getDocs,
} from 'firebase/firestore';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../../constants/theme';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';

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
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usersError, setUsersError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: '',
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

  useEffect(() => {
    setLoading(true);
    setUsersError(false);

    const unsubscribe = onSnapshot(
      collection(db, 'users'),
      async (snapshot) => {
        // Base profile fields come straight from each users/{uid} doc.
        // role and isActive don't exist on most existing docs (only
        // manually-set admin accounts have "role"), so missing values
        // are defaulted here rather than left undefined.
        const baseUsers = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data.name || 'Unnamed User',
            email: data.email || '—',
            role: data.role || 'customer',
            isActive: data.isActive !== false,
            createdAt: data.createdAt || null,
            totalOrders: 0,
            totalSpent: 0,
          };
        });

        setUsers(baseUsers);
        setUsersError(false);
        setLoading(false);

        // Order stats live in each user's orders subcollection, not on
        // the user doc itself, so they're fetched separately as a
        // one-time read per user rather than part of the live listener.
        const withStats = await Promise.all(
          baseUsers.map(async (u) => {
            try {
              const ordersSnap = await getDocs(collection(db, 'users', u.id, 'orders'));
              let totalSpent = 0;
              ordersSnap.forEach((orderDoc) => {
                const order = orderDoc.data();
                if (order.status !== 'cancelled') {
                  totalSpent += Number(order.total || 0);
                }
              });
              return { ...u, totalOrders: ordersSnap.size, totalSpent };
            } catch (err) {
              console.error(`Error fetching orders for user ${u.id}:`, err);
              return u;
            }
          })
        );

        setUsers(withStats);
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
    Haptics.selectionAsync();
    setSelectedUser(user);
    setEditFormData({
      name: user.name,
      role: user.role,
    });
    setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
    if (!editFormData.name.trim()) {
      showAppAlert('Error', 'Please enter a name');
      return;
    }

    if (selectedUser.id === auth.currentUser?.uid && editFormData.role !== 'admin') {
      showAppAlert(
        'Not Allowed',
        "You can't remove your own admin role — that would lock you out of this dashboard. Have another admin make this change instead."
      );
      return;
    }

    setUpdating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateDoc(doc(db, 'users', selectedUser.id), {
        name: editFormData.name.trim(),
        role: editFormData.role,
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
    if (user.id === auth.currentUser?.uid) {
      showAppAlert('Not Allowed', "You can't deactivate your own account.");
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
    if (role === 'admin') {
      return { backgroundColor: Colors.light.danger + '20', color: Colors.light.danger };
    }
    return { backgroundColor: Colors.light.tint + '20', color: Colors.light.tint };
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
    const adminUsers = users.filter((u) => u.role === 'admin').length;
    const totalSpent = users.reduce((sum, u) => sum + (u.totalSpent || 0), 0);

    return { totalUsers, activeUsers, adminUsers, totalSpent };
  };

  const stats = getStats();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </AnimatedPressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Manage Users</Text>
        <View style={styles.placeholder} />
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
            <Text style={styles.statValue}>{stats.adminUsers}</Text>
            <Text style={styles.statLabel}>{stats.adminUsers === 1 ? 'Admin' : 'Admins'}</Text>
          </Card>
          <Card variant="flat" style={styles.statCard}>
            <Text style={styles.statValue}>₱{stats.totalSpent.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Total Spent</Text>
          </Card>
        </ScrollView>
      </Animated.View>

      {/* Search Bar */}
      <Animated.View
        style={styles.searchContainer}
        entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(40).easing(EASE_OUT_QUART)}
      >
        <Ionicons name="search-outline" size={20} color={Colors.light.icon} style={styles.searchIcon} />
        <TextInput
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
          filteredUsers.map((user, index) => (
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
                accessibilityLabel={`${user.name}, ${user.role} role, ${user.isActive ? 'active' : 'inactive'}`}
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
                          {user.role.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.userEmailRow}>
                      <Ionicons name="mail-outline" size={12} color={Colors.light.icon} />
                      <Text style={styles.userEmail} numberOfLines={1} ellipsizeMode="tail">
                        {user.email}
                      </Text>
                    </View>
                    <View style={styles.userStats}>
                      <View style={styles.userStatsItem}>
                        <Ionicons name="receipt-outline" size={11} color={Colors.light.icon} />
                        <Text style={styles.userStatsText}>{user.totalOrders} orders</Text>
                      </View>
                      <View style={styles.userStatsItem}>
                        <Ionicons name="cash-outline" size={11} color={Colors.light.icon} />
                        <Text style={styles.userStatsText}>₱{user.totalSpent.toFixed(2)}</Text>
                      </View>
                    </View>
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
                        style={styles.actionButton}
                        onPress={() => handleEditUser(user)}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${user.name}`}
                      >
                        <Ionicons name="create-outline" size={20} color={Colors.light.tint} />
                      </AnimatedPressable>
                      <AnimatedPressable
                        style={styles.actionButton}
                        onPress={() => handleToggleUserStatus(user)}
                        disabled={!isConnected || togglingUserId === user.id}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel={`${user.isActive ? 'Deactivate' : 'Activate'} ${user.name}`}
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
                            color={!isConnected ? Colors.light.border : (user.isActive ? Colors.light.danger : Colors.light.success)}
                          />
                        )}
                      </AnimatedPressable>
                    </View>
                  </View>
                </Card>
              </AnimatedPressable>
            </Animated.View>
          ))
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
                      {selectedUser.role.toUpperCase()}
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

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Total Orders:</Text>
                  <Text style={styles.modalInfoValue}>{selectedUser.totalOrders}</Text>
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Total Spent:</Text>
                  <Text style={styles.modalInfoValue}>₱{selectedUser.totalSpent.toFixed(2)}</Text>
                </View>

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
              <Input
                label="Name *"
                value={editFormData.name}
                onChangeText={(text) => setEditFormData({ ...editFormData, name: text })}
                placeholder="Full name"
              />

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email</Text>
                <View style={[styles.input, styles.inputDisabled]}>
                  <Text style={styles.disabledInputText}>{selectedUser?.email}</Text>
                </View>
                <Text style={styles.inputHint}>
                  Login email can't be changed here — it's tied to their Firebase Auth account.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Role</Text>
                <View style={styles.roleSelector}>
                  <AnimatedPressable
                    style={[
                      styles.roleOption,
                      editFormData.role === 'customer' && styles.roleOptionActive,
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setEditFormData({ ...editFormData, role: 'customer' });
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: editFormData.role === 'customer' }}
                    accessibilityLabel="Customer role"
                  >
                    <Text style={[
                      styles.roleOptionText,
                      editFormData.role === 'customer' && styles.roleOptionTextActive,
                    ]}>
                      Customer
                    </Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    style={[
                      styles.roleOption,
                      editFormData.role === 'admin' && styles.roleOptionActive,
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setEditFormData({ ...editFormData, role: 'admin' });
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: editFormData.role === 'admin' }}
                    accessibilityLabel="Admin role"
                  >
                    <Text style={[
                      styles.roleOptionText,
                      editFormData.role === 'admin' && styles.roleOptionTextActive,
                    ]}>
                      Admin
                    </Text>
                  </AnimatedPressable>
                </View>
              </View>

              <View style={styles.modalButtons}>
                <View style={styles.modalButtonHalf}>
                  <Button
                    variant="secondary"
                    label="Cancel"
                    onPress={() => setShowEditModal(false)}
                    disabled={updating}
                  />
                </View>
                <View style={styles.modalButtonHalf}>
                  <Button
                    variant="primary"
                    label={!isConnected ? 'Offline' : 'Save Changes'}
                    onPress={handleUpdateUser}
                    loading={updating}
                    disabled={updating || !isConnected}
                  />
                </View>
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
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
  },
  placeholder: {
    width: 40,
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
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
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
  userStats: {
    flexDirection: 'row',
    gap: 12,
  },
  userStatsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userStatsText: {
    fontSize: 11,
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
    flexDirection: 'row',
    gap: 12,
  },
  roleOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center',
    backgroundColor: Colors.light.background,
  },
  roleOptionActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  roleOptionText: {
    fontSize: 14,
    color: Colors.light.icon,
  },
  roleOptionTextActive: {
    color: '#fff',
  },
});
