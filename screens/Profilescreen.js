import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../firebaseConfig';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

export default function ProfileScreen({ navigation }) {
  const [userData, setUserData] = useState({ name: 'Loading...', email: '' });
  const [logoutVisible, setLogoutVisible] = useState(false);

  useEffect(() => {
    const fetchUserData = async () => {
      const user = auth.currentUser;
      if (user) {
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
      }
    };
    fetchUserData();
  }, []);

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

          <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Settings')}>
            <Ionicons name="settings-outline" size={24} color="#666" />
            <Text style={styles.menuLabel}>Settings</Text>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.menuItem, styles.adminItem]} onPress={() => navigation.navigate('AdminLogin')}>
            <Ionicons name="shield-checkmark" size={24} color="#007AFF" />
            <Text style={[styles.menuLabel, styles.adminLabel]}>Admin Portal</Text>
            <Ionicons name="chevron-forward" size={20} color="#007AFF" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.menuItem, styles.logoutItem]} onPress={() => setLogoutVisible(true)}>
            <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
            <Text style={[styles.menuLabel, styles.logoutLabel]}>Logout</Text>
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
  adminItem: { backgroundColor: '#F9F9FB' },
  adminLabel: { color: '#007AFF', fontWeight: '500' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '80%', backgroundColor: '#fff', borderRadius: 20, padding: 25, alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  modalMessage: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 25 },
  modalButtons: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
  modalButton: { flex: 0.45, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  cancelButton: { backgroundColor: '#f0f0f0' },
  confirmButton: { backgroundColor: '#FF3B30' },
  cancelButtonText: { color: '#000', fontWeight: '600' },
  confirmButtonText: { color: '#fff', fontWeight: '600' },
});