import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { db, auth } from '../../firebaseConfig';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  getDocs,
} from 'firebase/firestore';

export default function AdminUsersScreen({ navigation }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: '',
    role: 'customer',
  });

  useEffect(() => {
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
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleViewUser = (user) => {
    setSelectedUser(user);
    setShowUserModal(true);
  };

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setEditFormData({
      name: user.name,
      role: user.role,
    });
    setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
    if (!editFormData.name.trim()) {
      Alert.alert('Error', 'Please enter a name');
      return;
    }

    if (selectedUser.id === auth.currentUser?.uid && editFormData.role !== 'admin') {
      Alert.alert(
        'Not Allowed',
        "You can't remove your own admin role — that would lock you out of this dashboard. Have another admin make this change instead."
      );
      return;
    }

    setUpdating(true);
    try {
      await updateDoc(doc(db, 'users', selectedUser.id), {
        name: editFormData.name.trim(),
        role: editFormData.role,
      });
      setShowEditModal(false);
      Alert.alert('Success', 'User updated successfully');
    } catch (error) {
      console.error('Error updating user:', error);
      Alert.alert('Error', 'Could not update user. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleUserStatus = (user) => {
    if (user.id === auth.currentUser?.uid) {
      Alert.alert('Not Allowed', "You can't deactivate your own account.");
      return;
    }

    const newStatus = !user.isActive;
    Alert.alert(
      newStatus ? 'Activate User' : 'Deactivate User',
      `Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} ${user.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: newStatus ? 'Activate' : 'Deactivate',
          style: newStatus ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'users', user.id), { isActive: newStatus });
              Alert.alert('Success', `User ${newStatus ? 'activated' : 'deactivated'} successfully`);
            } catch (error) {
              console.error('Error updating user status:', error);
              Alert.alert('Error', 'Could not update user status. Please try again.');
            }
          },
        },
      ]
    );
  };

  const getRoleBadgeStyle = (role) => {
    if (role === 'admin') {
      return { backgroundColor: '#FF3B3020', color: '#FF3B30' };
    }
    return { backgroundColor: '#007AFF20', color: '#007AFF' };
  };

  const getActiveBadgeStyle = (isActive) => {
    if (isActive) {
      return { backgroundColor: '#34C75920', color: '#34C759' };
    }
    return { backgroundColor: '#FF3B3020', color: '#FF3B30' };
  };

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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Users</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Stats Cards */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        style={styles.statsScroll}
        contentContainerStyle={styles.statsContainer}
      >
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.activeUsers}</Text>
          <Text style={styles.statLabel}>Active Users</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.adminUsers}</Text>
          <Text style={styles.statLabel}>Admins</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>₱{stats.totalSpent.toFixed(2)}</Text>
          <Text style={styles.statLabel}>Total Spent</Text>
        </View>
      </ScrollView>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or email..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {/* Users List */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.usersContainer}>
        {loading ? (
          <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
        ) : filteredUsers.length > 0 ? (
          filteredUsers.map((user) => (
            <TouchableOpacity
              key={user.id}
              style={styles.userCard}
              onPress={() => handleViewUser(user)}
            >
              <View style={styles.userAvatar}>
                <Text style={styles.userAvatarText}>
                  {user.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.userInfo}>
                <View style={styles.userNameRow}>
                  <Text style={styles.userName}>{user.name}</Text>
                  <View style={[styles.roleBadge, getRoleBadgeStyle(user.role)]}>
                    <Text style={[styles.roleText, { color: getRoleBadgeStyle(user.role).color }]}>
                      {user.role.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={styles.userEmail}>{user.email}</Text>
                <View style={styles.userStats}>
                  <Text style={styles.userStatsText}>Orders: {user.totalOrders}</Text>
                  <Text style={styles.userStatsText}>Spent: ₱{user.totalSpent.toFixed(2)}</Text>
                </View>
              </View>
              <View style={styles.userActions}>
                <View style={[styles.statusBadge, getActiveBadgeStyle(user.isActive)]}>
                  <Text style={[styles.statusText, { color: getActiveBadgeStyle(user.isActive).color }]}>
                    {user.isActive ? 'active' : 'inactive'}
                  </Text>
                </View>
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleEditUser(user)}
                  >
                    <Ionicons name="create-outline" size={20} color="#007AFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleToggleUserStatus(user)}
                  >
                    <Ionicons
                      name={user.isActive ? 'person-remove-outline' : 'person-add-outline'}
                      size={20}
                      color={user.isActive ? '#FF3B30' : '#34C759'}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={64} color="#ccc" />
            <Text style={styles.emptyStateText}>No users found</Text>
            <Text style={styles.emptyStateSubtext}>
              {searchQuery ? 'Try a different search term' : 'Users will appear here'}
            </Text>
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
              <TouchableOpacity onPress={() => setShowUserModal(false)}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            {selectedUser && (
              <ScrollView>
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
                  <TouchableOpacity
                    style={[styles.modalButton, styles.editButton]}
                    onPress={() => {
                      setShowUserModal(false);
                      handleEditUser(selectedUser);
                    }}
                  >
                    <Text style={styles.editButtonText}>Edit User</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.statusButton]}
                    onPress={() => {
                      setShowUserModal(false);
                      handleToggleUserStatus(selectedUser);
                    }}
                  >
                    <Text style={styles.statusButtonText}>
                      {selectedUser.isActive ? 'Deactivate' : 'Activate'}
                    </Text>
                  </TouchableOpacity>
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
              <TouchableOpacity onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            <ScrollView>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Full name"
                  value={editFormData.name}
                  onChangeText={(text) => setEditFormData({ ...editFormData, name: text })}
                />
              </View>

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
                  <TouchableOpacity
                    style={[
                      styles.roleOption,
                      editFormData.role === 'customer' && styles.roleOptionActive,
                    ]}
                    onPress={() => setEditFormData({ ...editFormData, role: 'customer' })}
                  >
                    <Text style={[
                      styles.roleOptionText,
                      editFormData.role === 'customer' && styles.roleOptionTextActive,
                    ]}>
                      Customer
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.roleOption,
                      editFormData.role === 'admin' && styles.roleOptionActive,
                    ]}
                    onPress={() => setEditFormData({ ...editFormData, role: 'admin' })}
                  >
                    <Text style={[
                      styles.roleOptionText,
                      editFormData.role === 'admin' && styles.roleOptionTextActive,
                    ]}>
                      Admin
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => setShowEditModal(false)}
                  disabled={updating}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.saveButton, updating && { opacity: 0.7 }]}
                  onPress={handleUpdateUser}
                  disabled={updating}
                >
                  {updating ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
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
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  placeholder: {
    width: 40,
  },
  statsScroll: {
    marginTop: 16,
  },
  statsContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  statCard: {
    backgroundColor: '#F9F9FB',
    borderRadius: 12,
    padding: 16,
    minWidth: 100,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9FB',
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: '#000',
  },
  usersContainer: {
    padding: 16,
    paddingTop: 0,
  },
  loader: {
    marginTop: 40,
  },
  userCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#000',
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
  userEmail: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  userStats: {
    flexDirection: 'row',
    gap: 12,
  },
  userStatsText: {
    fontSize: 11,
    color: '#999',
  },
  userActions: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  statusBadge: {
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
    gap: 8,
  },
  actionButton: {
    padding: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
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
    color: '#000',
  },
  modalAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
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
    borderBottomColor: '#F2F2F7',
  },
  modalInfoLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  modalInfoValue: {
    fontSize: 14,
    color: '#000',
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
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  editButton: {
    backgroundColor: '#007AFF',
  },
  editButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  statusButton: {
    backgroundColor: '#FF9500',
  },
  statusButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#F2F2F7',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  saveButtonText: {
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
    color: '#000',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#F9F9FB',
  },
  inputDisabled: {
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
  },
  disabledInputText: {
    fontSize: 14,
    color: '#999',
  },
  inputHint: {
    fontSize: 11,
    color: '#999',
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
    borderColor: '#E5E5EA',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  roleOptionActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  roleOptionText: {
    fontSize: 14,
    color: '#666',
  },
  roleOptionTextActive: {
    color: '#fff',
  },
});