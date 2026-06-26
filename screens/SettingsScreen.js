import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';  // <- Changed import
import { Ionicons } from '@expo/vector-icons';

export default function SettingsScreen({ navigation }) {
  // Settings menu options
  const settingsOptions = [
    { icon: 'person-outline', title: 'Account Settings', screen: 'Profile' },
    { icon: 'notifications-outline', title: 'Notifications', screen: 'Notifications' },
    { icon: 'location-outline', title: 'Location', screen: 'Location' },
    { icon: 'card-outline', title: 'Payment Methods', screen: 'Payment' },
    { icon: 'help-circle-outline', title: 'Help & Support', screen: 'Help' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Status Bar - Now handled by SafeAreaView */}
      <View style={styles.statusBar}>
        <Text style={styles.time}>8:34</Text>
        <View style={styles.statusIcons}>
          <View style={styles.signal} />
          <View style={styles.wifi} />
          <View style={styles.battery} />
        </View>
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Settings Content */}
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Settings Options */}
        <View style={styles.section}>
          {settingsOptions.map((option, index) => (
            <TouchableOpacity
              key={index}
              style={styles.optionItem}
              onPress={() => navigation.navigate(option.screen)}
            >
              <View style={styles.optionLeft}>
                <Ionicons name={option.icon} size={24} color="#007AFF" />
                <Text style={styles.optionTitle}>{option.title}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
          ))}
        </View>

        {/* Admin Access Button */}
        <View style={styles.adminDivider} />
        <TouchableOpacity
          style={styles.adminButton}
          onPress={() => navigation.navigate('AdminLogin')}
        >
          <View style={styles.adminIcon}>
            <Ionicons name="shield-checkmark" size={28} color="#007AFF" />
          </View>
          <View style={styles.adminTextContainer}>
            <Text style={styles.adminTitle}>Admin Portal</Text>
            <Text style={styles.adminSubtitle}>Manage products, orders, and users</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#007AFF" />
        </TouchableOpacity>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutButton}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <View style={styles.footer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,  // Reduced significantly since SafeAreaView handles the safe area
    paddingBottom: 10,
  },
  time: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  statusIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signal: {
    width: 18,
    height: 12,
    backgroundColor: '#000',
    borderRadius: 2,
  },
  wifi: {
    width: 16,
    height: 12,
    backgroundColor: '#000',
    borderRadius: 2,
  },
  battery: {
    width: 24,
    height: 12,
    backgroundColor: '#000',
    borderRadius: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#C6C6C8',
    // No marginTop needed - SafeAreaView handles it
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
  section: {
    marginTop: 20,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionTitle: {
    fontSize: 16,
    color: '#000',
  },
  adminDivider: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginHorizontal: 20,
    marginVertical: 20,
  },
  adminButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9FB',
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  adminIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E3F2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  adminTextContainer: {
    flex: 1,
  },
  adminTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  adminSubtitle: {
    fontSize: 12,
    color: '#666',
  },
  logoutButton: {
    marginHorizontal: 16,
    marginTop: 30,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#FF3B30',
    borderRadius: 12,
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    height: 40,
  },
});