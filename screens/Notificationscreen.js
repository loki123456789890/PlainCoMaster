import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function NotificationsScreen({ navigation }) {
  const notifications = [
    { id: 1, title: 'Order Confirmed', message: 'Your order #1234 has been confirmed', time: '2 hours ago' },
    { id: 2, title: 'Shipment Update', message: 'Your order is on the way', time: '1 day ago' },
    { id: 3, title: 'Flash Sale', message: '50% off on selected items', time: '2 days ago' },
    { id: 4, title: 'New Arrival', message: 'Check out our new collection', time: '3 days ago' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        {notifications.map((notif) => (
          <TouchableOpacity key={notif.id} style={styles.notificationCard}>
            <View style={styles.iconContainer}>
              <Ionicons name="notifications-outline" size={24} color="#8B6F47" />
            </View>
            <View style={styles.notificationContent}>
              <Text style={styles.notificationTitle}>{notif.title}</Text>
              <Text style={styles.notificationMessage}>{notif.message}</Text>
              <Text style={styles.notificationTime}>{notif.time}</Text>
            </View>
          </TouchableOpacity>
        ))}
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
  content: { flex: 1, paddingVertical: 10 },
  notificationCard: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  iconContainer: { marginRight: 15 },
  notificationContent: { flex: 1 },
  notificationTitle: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  notificationMessage: { fontSize: 14, color: '#666', marginTop: 5 },
  notificationTime: { fontSize: 12, color: '#999', marginTop: 5 },
});