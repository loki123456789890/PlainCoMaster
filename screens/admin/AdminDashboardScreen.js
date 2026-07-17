import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { signOut } from 'firebase/auth';
import { collection, collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { useAdmin } from '../../context/AdminContext';
import { useProducts } from '../../context/ProductContext';

export default function AdminDashboardScreen({ navigation }) {
  const { logoutAsAdmin } = useAdmin();
  const { products, loading: productsLoading } = useProducts();

  const [orderCount, setOrderCount] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);
  const [usersLoading, setUsersLoading] = useState(true);
  // "Total Order Value" — deliberately not "Revenue"/"Sales". COD is the
  // primary payment method and there's no payment gateway integration
  // (per SRS), so an order's total isn't confirmed money collected, just
  // the value of what was ordered.
  const [totalOrderValue, setTotalOrderValue] = useState(0);

  const [openSupportCount, setOpenSupportCount] = useState(0);
  const [supportLoading, setSupportLoading] = useState(true);

  useEffect(() => {
    // Same collectionGroup shape AdminOrdersScreen uses to read orders
    // across every user's subcollection. No orderBy here since only the
    // count and total are needed, which avoids requiring the composite
    // index that screen needs for sorting.
    const unsubscribeOrders = onSnapshot(
      collectionGroup(db, 'orders'),
      (snapshot) => {
        setOrderCount(snapshot.size);

        // Same calculation AdminOrdersScreen uses for its totalRevenue
        // stat: sum of order totals, excluding cancelled orders. Reused
        // here from the same snapshot rather than a second listener.
        const value = snapshot.docs.reduce((sum, docSnap) => {
          const data = docSnap.data();
          if (data.status === 'cancelled') return sum;
          return sum + Number(data.total || 0);
        }, 0);
        setTotalOrderValue(value);

        setOrdersLoading(false);
      },
      (error) => {
        console.error('Error fetching order count:', error);
        setOrdersLoading(false);
      }
    );

    // Same top-level users collection AdminUsersScreen listens to.
    const unsubscribeUsers = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        setUserCount(snapshot.size);
        setUsersLoading(false);
      },
      (error) => {
        console.error('Error fetching user count:', error);
        setUsersLoading(false);
      }
    );

    // Filtered server-side to only "open" requests — a dashboard count
    // card only needs the number, so there's no reason to also download
    // every already-resolved request just to filter them out client-side.
    const unsubscribeSupport = onSnapshot(
      query(collection(db, 'supportRequests'), where('status', '==', 'open')),
      (snapshot) => {
        setOpenSupportCount(snapshot.size);
        setSupportLoading(false);
      },
      (error) => {
        console.error('Error fetching open support request count:', error);
        setSupportLoading(false);
      }
    );

    return () => {
      unsubscribeOrders();
      unsubscribeUsers();
      unsubscribeSupport();
    };
  }, []);

  const menuItems = [
    {
      title: 'Products',
      icon: 'cube-outline',
      color: '#007AFF',
      screen: 'AdminProducts',
      count: products.length,
      loading: productsLoading,
    },
    {
      title: 'Orders',
      icon: 'cart-outline',
      color: '#34C759',
      screen: 'AdminOrders',
      count: orderCount,
      loading: ordersLoading,
    },
    {
      title: 'Users',
      icon: 'people-outline',
      color: '#FF9500',
      screen: 'AdminUsers',
      count: userCount,
      loading: usersLoading,
    },
    {
      title: 'Total Order Value',
      icon: 'cash-outline',
      color: '#5856D6',
      screen: 'AdminOrders',
      count: totalOrderValue,
      loading: ordersLoading,
      currency: true,
    },
    {
      title: 'Support',
      icon: 'chatbubble-ellipses-outline',
      color: '#FF3B30',
      screen: 'AdminSupport',
      count: openSupportCount,
      loading: supportLoading,
    },
  ];

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of the admin panel?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
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
              Alert.alert('Error', 'Could not log out. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Admin Dashboard</Text>
        <TouchableOpacity onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.welcomeText}>Welcome Admin!</Text>
        <Text style={styles.subtext}>Manage your store from here</Text>

        <View style={styles.menuGrid}>
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.menuCard}
              onPress={() => navigation.navigate(item.screen)}
            >
              <View style={[styles.menuIcon, { backgroundColor: item.color + '20' }]}>
                <Ionicons name={item.icon} size={32} color={item.color} />
              </View>
              <Text style={styles.menuTitle}>{item.title}</Text>
              {item.loading ? (
                <ActivityIndicator size="small" color={item.color} style={styles.menuCount} />
              ) : (
                <Text
                  style={[styles.menuCount, { color: item.color }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {item.currency ? `₱${item.count.toFixed(2)}` : item.count}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  content: {
    padding: 20,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtext: {
    fontSize: 14,
    color: '#666',
    marginBottom: 40,
    textAlign: 'center',
  },
  menuGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    flexWrap: 'wrap',
  },
  menuCard: {
    alignItems: 'center',
    width: '30%',
    marginBottom: 20,
  },
  menuIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },
  menuCount: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
  },
});
