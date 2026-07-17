import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { db } from '../../firebaseConfig';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import useNetworkStatus from '../../hooks/useNetworkStatus';

const getStatusColor = (status) => (status === 'resolved' ? '#34C759' : '#FF9500');
const getStatusIcon = (status) =>
  status === 'resolved' ? 'checkmark-circle-outline' : 'alert-circle-outline';
const getStatusLabel = (status) => (status === 'resolved' ? 'Resolved' : 'Open');

export default function AdminSupportScreen({ navigation }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('open');
  // Tracks which single request's status write is in flight, same pattern
  // AdminUsersScreen uses for activate/deactivate — one row updating
  // shouldn't disable every other row's toggle too.
  const [togglingId, setTogglingId] = useState(null);
  const { isConnected } = useNetworkStatus();

  useEffect(() => {
    const requestsQuery = query(collection(db, 'supportRequests'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        const fetched = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            message: data.message || '',
            userEmail: data.userEmail || 'Unknown',
            status: data.status || 'open',
            date: data.createdAt?.toDate ? data.createdAt.toDate() : null,
          };
        });
        setRequests(fetched);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching support requests:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const stats = {
    total: requests.length,
    open: requests.filter((r) => r.status === 'open').length,
    resolved: requests.filter((r) => r.status === 'resolved').length,
  };

  // Open listed first (and defaulted to below) so open requests are what
  // the admin sees immediately, not buried under resolved ones.
  const tabs = [
    { id: 'open', label: 'Open', count: stats.open, color: '#FF9500' },
    { id: 'all', label: 'All', count: stats.total },
    { id: 'resolved', label: 'Resolved', count: stats.resolved, color: '#34C759' },
  ];

  const filteredRequests =
    activeTab === 'all' ? requests : requests.filter((r) => r.status === activeTab);

  const formatDate = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleToggleStatus = (request) => {
    const newStatus = request.status === 'resolved' ? 'open' : 'resolved';
    Alert.alert(
      newStatus === 'resolved' ? 'Mark as Resolved' : 'Reopen Request',
      newStatus === 'resolved'
        ? 'Mark this request as resolved?'
        : 'Reopen this request as unresolved?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: newStatus === 'resolved' ? 'Resolve' : 'Reopen',
          onPress: async () => {
            setTogglingId(request.id);
            try {
              await updateDoc(doc(db, 'supportRequests', request.id), { status: newStatus });
            } catch (error) {
              console.error('Error updating support request status:', error);

              const isNetworkError = !isConnected || error.code === 'unavailable';
              if (isNetworkError) {
                Alert.alert(
                  'No Internet Connection',
                  'Network connection lost. Please check your connection and try again.'
                );
              } else {
                Alert.alert('Error', 'Could not update request status. Please try again.');
              }
            } finally {
              setTogglingId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Support Requests</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Stats Cards */}
      <View style={styles.statsWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsContainer}
        >
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#FFF3E0' }]}>
            <Text style={[styles.statValue, { color: '#FF9500' }]}>{stats.open}</Text>
            <Text style={styles.statLabel}>Open</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
            <Text style={[styles.statValue, { color: '#34C759' }]}>{stats.resolved}</Text>
            <Text style={styles.statLabel}>Resolved</Text>
          </View>
        </ScrollView>
      </View>

      {/* Tabs */}
      <View style={styles.tabsWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContainer}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.activeTab]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={[styles.tabText, activeTab === tab.id && styles.activeTabText]}>
                {tab.label}
              </Text>
              <View style={[styles.tabBadge, tab.color ? { backgroundColor: tab.color + '20' } : null]}>
                <Text style={[styles.tabBadgeText, tab.color ? { color: tab.color } : null]}>
                  {tab.count}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Requests List */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.requestsContainer}>
        {loading ? (
          <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
        ) : filteredRequests.length > 0 ? (
          filteredRequests.map((request) => (
            <TouchableOpacity
              key={request.id}
              style={styles.requestCard}
              onPress={() => handleToggleStatus(request)}
              disabled={!isConnected || togglingId === request.id}
            >
              <View style={styles.requestIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={22} color="#007AFF" />
              </View>
              <View style={styles.requestInfo}>
                <Text style={styles.requestMessage} numberOfLines={3}>
                  {request.message}
                </Text>
                <Text style={styles.requestEmail}>{request.userEmail}</Text>
                <Text style={styles.requestDate}>{formatDate(request.date)}</Text>
              </View>
              {togglingId === request.id ? (
                <ActivityIndicator size="small" color={getStatusColor(request.status)} />
              ) : (
                <View
                  style={[
                    styles.requestStatus,
                    { backgroundColor: getStatusColor(request.status) + '20' },
                  ]}
                >
                  <Ionicons
                    name={getStatusIcon(request.status)}
                    size={12}
                    color={getStatusColor(request.status)}
                  />
                  <Text style={[styles.requestStatusText, { color: getStatusColor(request.status) }]}>
                    {getStatusLabel(request.status)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={64} color="#ccc" />
            <Text style={styles.emptyStateText}>No support requests</Text>
            <Text style={styles.emptyStateSubtext}>
              {activeTab === 'open'
                ? 'All caught up — no open requests right now'
                : 'Support requests will appear here'}
            </Text>
          </View>
        )}
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
  statsWrapper: {
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
  tabsWrapper: {
    marginTop: 16,
    marginBottom: 8,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 10,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F9F9FB',
    gap: 8,
  },
  activeTab: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#fff',
  },
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: '#E5E5EA',
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#666',
  },
  requestsContainer: {
    padding: 16,
    paddingTop: 0,
  },
  loader: {
    marginTop: 40,
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  requestIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  requestInfo: {
    flex: 1,
    marginRight: 8,
  },
  requestMessage: {
    fontSize: 14,
    color: '#000',
    marginBottom: 6,
    lineHeight: 19,
  },
  requestEmail: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 2,
  },
  requestDate: {
    fontSize: 11,
    color: '#999',
  },
  requestStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  requestStatusText: {
    fontSize: 10,
    fontWeight: '600',
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
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
