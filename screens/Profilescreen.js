import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Platform,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../firebaseConfig';
import { signOut } from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import PrivacyPolicyModal from '../components/PrivacyPolicyModal';
import { useAdmin } from '../context/AdminContext';
import useNetworkStatus from '../hooks/useNetworkStatus';

export default function ProfileScreen({ navigation }) {
  const [userData, setUserData] = useState({ name: 'Loading...', email: '' });
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [privacyPolicyVisible, setPrivacyPolicyVisible] = useState(false);
  const [deactivateVisible, setDeactivateVisible] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const { isAdmin, adminLoading } = useAdmin();
  const { isConnected } = useNetworkStatus();

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
      }
    };
    fetchUserData();
  }, []);

  // Routes to the dashboard directly for a restored admin session, or to
  // AdminLogin otherwise (guests and non-admins alike — this row stays
  // reachable by everyone, see the row's own comment below). Guarded by
  // `disabled={adminLoading}` on the row itself, so this can't fire while
  // isAdmin is still unresolved — that's exactly the race that used to
  // send a real admin back to AdminLogin.
  const handleAdminPortalPress = () => {
    navigation.navigate(isAdmin ? 'AdminDashboard' : 'AdminLogin');
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUserData({ name: '', email: '' });
      setLogoutVisible(false);
      navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
    } catch (error) {
      setLogoutVisible(false);
      Alert.alert("Error", "Failed to log out. Please try again.");
    }
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
        Alert.alert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
      } else {
        Alert.alert('Error', 'Could not deactivate your account. Please try again.');
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Modal
        animationType="fade"
        transparent={true}
        visible={logoutVisible}
        onRequestClose={() => setLogoutVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Logout</Text>
            <Text style={styles.modalMessage}>Are you sure you want to log out?</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setLogoutVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleLogout}
              >
                <Text style={styles.confirmButtonText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <PrivacyPolicyModal
        visible={privacyPolicyVisible}
        onClose={() => setPrivacyPolicyVisible(false)}
      />

      <Modal
        animationType="fade"
        transparent={true}
        visible={deactivateVisible}
        onRequestClose={() => {
          if (!deactivating) setDeactivateVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Deactivate Account</Text>
            <Text style={styles.deactivateModalMessage}>
              Your account will be disabled and you will be signed out. You will
              not be able to sign in again. Your personal information is
              retained only as required for order and transaction records. To
              request further action on your data, contact the Store Manager
              through the Help Center.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setDeactivateVisible(false)}
                disabled={deactivating}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.confirmButton,
                  (deactivating || !isConnected) && { opacity: 0.7 },
                ]}
                onPress={handleDeactivateAccount}
                disabled={deactivating || !isConnected}
              >
                {deactivating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>
                    {!isConnected ? 'Offline' : 'Deactivate'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={60} color="#8B6F47" />
          </View>
          <Text style={styles.name}>{userData.name}</Text>
          <Text style={styles.email}>{userData.email}</Text>
        </View>

        <View style={styles.menuSection}>
          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Orders')}>
            <Ionicons name="document-text-outline" size={24} color="#666" />
            <Text style={styles.menuLabel}>My Orders</Text>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Favorites')}>
            <Ionicons name="heart-outline" size={24} color="#666" />
            <Text style={styles.menuLabel}>Favorites</Text>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => setPrivacyPolicyVisible(true)}>
            <Ionicons name="shield-outline" size={24} color="#666" />
            <Text style={styles.menuLabel}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </TouchableOpacity>

          {/* Stays visible and reachable for everyone, admin or not —
              AdminLoginScreen has to remain the one in-app entry point to
              the portal for a signed-out admin. A non-admin tapping this
              still only ever lands on AdminLogin and can't get further;
              that's already enforced by Firestore rules + withAdminGuard,
              not by hiding this row. */}
          <TouchableOpacity
            style={[styles.menuItem, styles.adminItem]}
            onPress={handleAdminPortalPress}
            disabled={adminLoading}
          >
            <Ionicons name="shield-checkmark" size={24} color="#007AFF" />
            <Text style={[styles.menuLabel, styles.adminLabel]}>Admin Portal</Text>
            {adminLoading ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#007AFF" />
            )}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.menuItem, styles.logoutItem]} onPress={() => setLogoutVisible(true)}>
            <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
            <Text style={[styles.menuLabel, styles.logoutLabel]}>Logout</Text>
          </TouchableOpacity>

          {/* Deliberately separated from the rest of the menu (extra top
              margin, no chevron) and placed last — this is irreversible
              from the user's side, so it shouldn't sit where a normal
              settings row would be tapped by accident. */}
          <TouchableOpacity
            style={[styles.menuItem, styles.deactivateItem]}
            onPress={() => setDeactivateVisible(true)}
          >
            <Ionicons name="person-remove-outline" size={24} color="#FF3B30" />
            <Text style={[styles.menuLabel, styles.deactivateLabel]}>Deactivate My Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#000' },
  content: { flex: 1 },
  profileSection: { alignItems: 'center', paddingVertical: 30, borderBottomWidth: 1, borderBottomColor: '#eee' },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  name: { fontSize: 20, fontWeight: 'bold', color: '#000' },
  email: { fontSize: 14, color: '#666', marginTop: 5 },
  menuSection: { paddingVertical: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  menuLabel: { fontSize: 16, color: '#000', flex: 1, marginLeft: 15 },
  logoutItem: { marginTop: 10 },
  logoutLabel: { color: '#FF3B30' },
  // Extra top margin (more than logoutItem's) and no border-bottom on its
  // own row — this needs to read as clearly separate from Logout right
  // above it, not just another item in the same list.
  deactivateItem: { marginTop: 24, borderBottomWidth: 0 },
  deactivateLabel: { color: '#FF3B30' },
  adminItem: { backgroundColor: '#F9F9FB' },
  adminLabel: { color: '#007AFF', fontWeight: '500' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '80%', backgroundColor: '#fff', borderRadius: 20, padding: 25, alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  modalMessage: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 25 },
  // Left-aligned and smaller than modalMessage — this dialog's copy is a
  // full paragraph the user actually needs to read and understand (privacy
  // implications), not a short one-line confirmation, so centered text
  // would be harder to read here.
  deactivateModalMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'left',
    lineHeight: 20,
    marginBottom: 25,
    alignSelf: 'stretch',
  },
  modalButtons: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
  modalButton: { flex: 0.45, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  cancelButton: { backgroundColor: '#f0f0f0' },
  confirmButton: { backgroundColor: '#FF3B30' },
  cancelButtonText: { color: '#000', fontWeight: '600' },
  confirmButtonText: { color: '#fff', fontWeight: '600' },
});