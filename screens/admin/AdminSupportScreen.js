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
import { db } from '../../firebaseConfig';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Radius } from '../../constants/theme';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';

const HOUR_MS = 60 * 60 * 1000;
// Mirrors AdminOrdersScreen.js's stalled-pending threshold, so "urgent"
// means the same thing across both admin queues.
const ATTENTION_THRESHOLD_HOURS = 24;

const getStatusColor = (status) => (status === 'resolved' ? Colors.light.success : Colors.light.highlight);
const getStatusIcon = (status) =>
  status === 'resolved' ? 'checkmark-circle-outline' : 'alert-circle-outline';
const getStatusLabel = (status) => (status === 'resolved' ? 'Resolved' : 'Open');

// Shaped like a real request card so the loading state previews the content
// that's about to arrive, instead of a spinner floating mid-screen.
function RequestCardSkeleton() {
  return (
    <Card variant="flat" style={styles.requestCard}>
      <SkeletonBlock style={styles.requestIconSkeleton} />
      <View style={styles.requestInfo}>
        <SkeletonBlock style={{ width: '90%', height: 13, borderRadius: Radius.sm, marginBottom: 6 }} />
        <SkeletonBlock style={{ width: '55%', height: 13, borderRadius: Radius.sm, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: '35%', height: 11, borderRadius: Radius.sm }} />
      </View>
      <View style={styles.requestActions}>
        <SkeletonBlock style={{ width: 54, height: 18, borderRadius: Radius.pill, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: 30, height: 30, borderRadius: Radius.pill }} />
      </View>
    </Card>
  );
}

export default function AdminSupportScreen({ navigation }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestsError, setRequestsError] = useState(false);
  const [activeTab, setActiveTab] = useState('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  // Tracks which single request's status write is in flight, same pattern
  // AdminUsersScreen uses for activate/deactivate — one row updating
  // shouldn't disable every other row's toggle too.
  const [togglingId, setTogglingId] = useState(null);
  // Bumped by handleRetry() to force the listener below to tear down and
  // re-subscribe — same shape as AdminOrdersScreen's / AdminUsersScreen's
  // retryToken, so a permissions blip or a bad connection at mount doesn't
  // leave the list silently stuck on an unrecoverable listener.
  const [retryToken, setRetryToken] = useState(0);
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  // Ticks once a minute so "2h ago" timestamps and the "needs attention"
  // aging check stay accurate through a long admin session, without needing
  // a re-render on every Firestore update to notice.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setLoading(true);
    setRequestsError(false);

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
        setRequestsError(false);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching support requests:', error);
        setRequestsError(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [retryToken]);

  const handleRetry = () => setRetryToken((t) => t + 1);

  // A request "needs attention" once it's sat open for a full day — the same
  // 24h threshold AdminOrdersScreen uses to flag stalled pending orders, so
  // "urgent" means the same thing across both admin queues.
  const isAttention = (request) => {
    if (request.status !== 'open' || !request.date) return false;
    return (now - request.date.getTime()) / HOUR_MS >= ATTENTION_THRESHOLD_HOURS;
  };

  const stats = {
    total: requests.length,
    open: requests.filter((r) => r.status === 'open').length,
    resolved: requests.filter((r) => r.status === 'resolved').length,
    attention: requests.filter(isAttention).length,
  };

  // Open listed first (and defaulted to below) so open requests are what
  // the admin sees immediately, not buried under resolved ones.
  const tabs = [
    { id: 'open', label: 'Open', count: stats.open, color: Colors.light.highlight },
    { id: 'all', label: 'All', count: stats.total },
    { id: 'resolved', label: 'Resolved', count: stats.resolved, color: Colors.light.success },
  ];

  const filteredRequests = requests
    .filter((r) => (activeTab === 'all' ? true : r.status === activeTab))
    .filter((r) => {
      const q = searchQuery.toLowerCase();
      if (!q) return true;
      return r.message.toLowerCase().includes(q) || r.userEmail.toLowerCase().includes(q);
    })
    // Requests waiting longest without a response float to the top within
    // each tab, so the queue reads by urgency first and recency second —
    // that's the actual "which one do I open next" question an admin asks.
    .sort((a, b) => {
      const aUrgent = isAttention(a) ? 1 : 0;
      const bUrgent = isAttention(b) ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      return (b.date?.getTime() || 0) - (a.date?.getTime() || 0);
    });

  const formatDate = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Favors "2h ago" over an absolute date on the list card — a shift
  // scanning dozens of requests reads recency faster than a calendar date.
  // The request details modal still shows the precise date for the record.
  const formatRelativeTime = (date) => {
    if (!date) return '';
    const diffHours = Math.max(0, (now - date.getTime()) / HOUR_MS);
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
    const days = Math.floor(diffHours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  };

  const handleViewRequest = (request) => {
    Haptics.selectionAsync();
    setSelectedRequest(request);
    setShowDetailModal(true);
  };

  const handleToggleStatus = (request) => {
    const newStatus = request.status === 'resolved' ? 'open' : 'resolved';
    Haptics.selectionAsync();
    showAppAlert(
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
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              await updateDoc(doc(db, 'supportRequests', request.id), { status: newStatus });
              // No follow-up success alert here (unlike Orders/Users) — this
              // screen is worked dozens of times a day, the badge updates
              // instantly from the live listener, and the haptic already
              // confirms the write. An extra tap-to-dismiss per resolve adds
              // up fast at that volume for no added clarity.
              setShowDetailModal(false);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              console.error('Error updating support request status:', error);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

              const isNetworkError = !isConnected || error.code === 'unavailable';
              if (isNetworkError) {
                showAppAlert(
                  'No Internet Connection',
                  'Network connection lost. Please check your connection and try again.'
                );
              } else {
                showAppAlert('Error', 'Could not update request status. Please try again.');
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
        <AnimatedPressable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </AnimatedPressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Support Requests</Text>
        <View style={styles.placeholder} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — request data may be out of date.
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
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </Card>
          <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.highlight + '15' }]}>
            <Text style={[styles.statValue, { color: Colors.light.highlight }]}>{stats.open}</Text>
            <Text style={styles.statLabel}>Open</Text>
          </Card>
          <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.danger + '15' }]}>
            <Text style={[styles.statValue, { color: Colors.light.danger }]}>{stats.attention}</Text>
            <Text style={styles.statLabel}>Needs Attention</Text>
          </Card>
          <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.success + '15' }]}>
            <Text style={[styles.statValue, { color: Colors.light.success }]}>{stats.resolved}</Text>
            <Text style={styles.statLabel}>Resolved</Text>
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
          placeholder="Search by message or email..."
          placeholderTextColor={Colors.light.icon}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search support requests by message or email"
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

      {/* Tabs */}
      <Animated.View
        style={styles.tabsWrapper}
        entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(80).easing(EASE_OUT_QUART)}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContainer}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <AnimatedPressable
                key={tab.id}
                style={[styles.tab, isActive && styles.activeTab]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActiveTab(tab.id);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`${tab.label}, ${tab.count} requests`}
              >
                <Text style={[styles.tabText, isActive && styles.activeTabText]}>
                  {tab.label}
                </Text>
                <View style={[styles.tabBadge, tab.color ? { backgroundColor: tab.color + '20' } : null]}>
                  <Text style={[styles.tabBadgeText, tab.color ? { color: tab.color } : null]}>
                    {tab.count}
                  </Text>
                </View>
              </AnimatedPressable>
            );
          })}
        </ScrollView>
      </Animated.View>

      {/* Requests List */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.requestsContainer}>
        {loading ? (
          <>
            <RequestCardSkeleton />
            <RequestCardSkeleton />
            <RequestCardSkeleton />
          </>
        ) : requestsError ? (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load requests"
              subtitle="Check your connection and try again."
            />
            <View style={styles.emptyStateAction}>
              <Button variant="outline" label="Retry" onPress={handleRetry} />
            </View>
          </View>
        ) : filteredRequests.length > 0 ? (
          filteredRequests.map((request, index) => {
            const urgent = isAttention(request);
            const isToggling = togglingId === request.id;
            return (
              <Animated.View
                key={request.id}
                entering={
                  reduceMotion
                    ? undefined
                    : FadeInDown.duration(240)
                        .delay(120 + Math.min(index, 8) * 40)
                        .easing(EASE_OUT_QUART)
                }
              >
                <AnimatedPressable
                  onPress={() => handleViewRequest(request)}
                  accessibilityRole="button"
                  accessibilityLabel={`${getStatusLabel(request.status)} request from ${request.userEmail}${urgent ? ', needs attention' : ''}`}
                  accessibilityHint="Opens request details"
                >
                  <Card variant="flat" style={styles.requestCard}>
                    <View style={styles.requestIcon}>
                      <Ionicons name="chatbubble-ellipses-outline" size={22} color={Colors.light.tint} />
                    </View>
                    <View style={styles.requestInfo}>
                      <Text style={styles.requestMessage} numberOfLines={2}>
                        {request.message}
                      </Text>
                      <View style={styles.requestEmailRow}>
                        <Ionicons name="mail-outline" size={12} color={Colors.light.icon} />
                        <Text style={styles.requestEmail} numberOfLines={1} ellipsizeMode="tail">
                          {request.userEmail}
                        </Text>
                      </View>
                      <Text style={styles.requestDate}>{formatRelativeTime(request.date)}</Text>
                    </View>
                    <View style={styles.requestActions}>
                      <View style={styles.requestBadges}>
                        {urgent && (
                          <View style={styles.attentionBadge}>
                            <Ionicons name="alert-circle" size={11} color={Colors.light.danger} />
                            <Text style={styles.attentionBadgeText}>Attention</Text>
                          </View>
                        )}
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
                      </View>
                      <AnimatedPressable
                        style={styles.quickActionButton}
                        onPress={() => handleToggleStatus(request)}
                        disabled={!isConnected || isToggling}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        accessibilityRole="button"
                        accessibilityLabel={
                          request.status === 'resolved'
                            ? `Reopen request from ${request.userEmail}`
                            : `Mark request from ${request.userEmail} as resolved`
                        }
                      >
                        {isToggling ? (
                          <ActivityIndicator size="small" color={getStatusColor(request.status)} />
                        ) : (
                          <Ionicons
                            name={request.status === 'resolved' ? 'refresh-outline' : 'checkmark-done-outline'}
                            size={18}
                            color={
                              !isConnected
                                ? Colors.light.border
                                : request.status === 'resolved'
                                ? Colors.light.icon
                                : Colors.light.success
                            }
                          />
                        )}
                      </AnimatedPressable>
                    </View>
                  </Card>
                </AnimatedPressable>
              </Animated.View>
            );
          })
        ) : (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="chatbubbles-outline"
              title={searchQuery ? 'No matching requests' : 'No support requests'}
              subtitle={
                searchQuery
                  ? 'Try a different search term'
                  : activeTab === 'open'
                  ? 'All caught up — no open requests right now'
                  : activeTab === 'resolved'
                  ? 'Resolved requests will show up here'
                  : 'Support requests will appear here'
              }
            />
            {Boolean(searchQuery) && (
              <View style={styles.emptyStateAction}>
                <Button variant="outline" label="Clear search" onPress={() => setSearchQuery('')} />
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Request Details Modal */}
      <Modal
        visible={showDetailModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Support Request</Text>
              <Pressable
                onPress={() => setShowDetailModal(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>

            {selectedRequest && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalBadgeRow}>
                  <View
                    style={[
                      styles.requestStatus,
                      { backgroundColor: getStatusColor(selectedRequest.status) + '20' },
                    ]}
                  >
                    <Ionicons
                      name={getStatusIcon(selectedRequest.status)}
                      size={12}
                      color={getStatusColor(selectedRequest.status)}
                    />
                    <Text style={[styles.requestStatusText, { color: getStatusColor(selectedRequest.status) }]}>
                      {getStatusLabel(selectedRequest.status)}
                    </Text>
                  </View>
                  {isAttention(selectedRequest) && (
                    <View style={styles.attentionBadge}>
                      <Ionicons name="alert-circle" size={11} color={Colors.light.danger} />
                      <Text style={styles.attentionBadgeText}>Needs attention</Text>
                    </View>
                  )}
                </View>

                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>From:</Text>
                  <Text style={styles.modalInfoValue} numberOfLines={1} ellipsizeMode="tail">
                    {selectedRequest.userEmail}
                  </Text>
                </View>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Submitted:</Text>
                  <Text style={styles.modalInfoValue}>{formatDate(selectedRequest.date)}</Text>
                </View>

                <View style={styles.modalMessageBox}>
                  <Text style={styles.modalMessageLabel}>Message</Text>
                  <Text style={styles.modalMessageText}>{selectedRequest.message}</Text>
                </View>

                <View style={styles.modalButtons}>
                  <Button
                    variant="primary"
                    label={
                      !isConnected
                        ? 'Offline'
                        : selectedRequest.status === 'resolved'
                        ? 'Reopen Request'
                        : 'Mark as Resolved'
                    }
                    onPress={() => handleToggleStatus(selectedRequest)}
                    loading={togglingId === selectedRequest.id}
                    disabled={togglingId === selectedRequest.id || !isConnected}
                  />
                </View>
              </ScrollView>
            )}
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
    gap: 8,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: 16,
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
    marginBottom: 8,
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
  tabsWrapper: {
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
    backgroundColor: Colors.light.border + '40',
    gap: 8,
  },
  activeTab: {
    backgroundColor: Colors.light.tint,
  },
  tabText: {
    fontSize: 14,
    color: Colors.light.icon,
    fontWeight: '500',
  },
  activeTabText: {
    color: '#fff',
  },
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: Colors.light.border,
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.light.icon,
  },
  requestsContainer: {
    padding: 16,
    paddingTop: 8,
  },
  emptyStateWrap: { paddingHorizontal: 16 },
  emptyStateAction: { marginTop: -8, marginBottom: 16, paddingHorizontal: 32 },
  requestCard: {
    flexDirection: 'row',
    padding: 12,
    marginBottom: 12,
  },
  requestIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.tint + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  requestIconSkeleton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  requestInfo: {
    flex: 1,
    marginRight: 8,
    justifyContent: 'center',
  },
  requestMessage: {
    fontSize: 14,
    color: Colors.light.text,
    marginBottom: 6,
    lineHeight: 19,
  },
  requestEmailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  requestEmail: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.icon,
    flexShrink: 1,
  },
  requestDate: {
    fontSize: 11,
    color: Colors.light.icon,
  },
  requestActions: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  requestBadges: {
    alignItems: 'flex-end',
    gap: 6,
  },
  attentionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.danger + '15',
  },
  attentionBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.light.danger, letterSpacing: 0.2 },
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
  quickActionButton: {
    width: 30,
    height: 30,
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
  modalBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    gap: 12,
  },
  modalInfoLabel: {
    fontSize: 14,
    color: Colors.light.icon,
    fontWeight: '500',
  },
  modalInfoValue: {
    fontSize: 14,
    color: Colors.light.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  modalMessageBox: {
    backgroundColor: Colors.light.border + '30',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  modalMessageLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.light.icon,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  modalMessageText: {
    fontSize: 14,
    color: Colors.light.text,
    lineHeight: 20,
  },
  modalButtons: {
    marginTop: 20,
  },
});
