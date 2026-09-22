import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useReducedMotion, FadeIn, FadeInDown } from 'react-native-reanimated';
import { onSnapshot, doc, updateDoc } from 'firebase/firestore';

import { db } from '../../firebaseConfig';
import { showAppAlert } from '../../utils/appAlert';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { useAdmin } from '../../context/AdminContext';
import { logStoreActivity, ACTIONS } from '../../utils/activityLog';
import { Colors, Radius } from '../../constants/theme';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import StarRating from '../../components/ui/StarRating';
import {
  REVIEWS_COLLECTION,
  storeReviewsQuery,
  mapReviewDoc,
  summarizeReviews,
  formatAverage,
} from '../../utils/reviews';
import { EASE_OUT_QUART } from '../../constants/motion';

// Deeper than the customer-facing sample (utils/reviews.js caps that at 100)
// because this is a work queue, not a summary — a manager scrolling back
// through a slow week should not hit an invisible floor.
const MODERATION_LIMIT = 200;

const formatDate = (date) =>
  date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Shaped like a real review card, so the loading state previews the content
// about to arrive instead of a spinner floating mid-screen — same treatment
// AdminSupportScreen gives its queue.
function ReviewCardSkeleton() {
  return (
    <Card variant="flat" style={styles.reviewCard}>
      <SkeletonBlock style={{ width: '45%', height: 14, borderRadius: Radius.sm, marginBottom: 10 }} />
      <SkeletonBlock style={{ width: '70%', height: 13, borderRadius: Radius.sm, marginBottom: 8 }} />
      <SkeletonBlock style={{ width: '90%', height: 13, borderRadius: Radius.sm }} />
    </Card>
  );
}

/**
 * The Store Manager's review queue.
 *
 * Moderation here is a `hidden` flag and nothing else — firestore.rules
 * grants this role no delete on /reviews and no write to rating or text, so
 * this screen cannot rewrite what a customer said or make it disappear from
 * the record. That is the point: a store able to erase reviews can erase
 * the unflattering ones, and no reader could tell afterwards.
 *
 * The default tab is "Didn't match", not "All". A review reporting that an
 * item wasn't what the listing said is an operational signal about a
 * LISTING — the description is wrong, the photos flatter it, the condition
 * was overstated — and it is the one thing on this screen a manager can
 * actually go and fix.
 */
export default function AdminReviewsScreen({ navigation }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState('mismatch');
  const [searchQuery, setSearchQuery] = useState('');
  // Which single review's write is in flight — one row updating shouldn't
  // disable every other row's button. Same pattern as AdminSupportScreen.
  const [updatingId, setUpdatingId] = useState(null);
  const [retryToken, setRetryToken] = useState(0);

  const { isConnected } = useNetworkStatus();
  // Only this store's reviews: another store's are not this manager's to
  // moderate, and firestore.rules refuses them the hide.
  const { storeId } = useAdmin();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // No store, no queue. The empty state below says why.
    if (!storeId) {
      setReviews([]);
      setLoadError(false);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setLoadError(false);

    const unsubscribe = onSnapshot(
      storeReviewsQuery(storeId, MODERATION_LIMIT),
      (snapshot) => {
        setReviews(snapshot.docs.map((docSnap) => mapReviewDoc(docSnap)));
        setLoadError(false);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching reviews:', error);
        setLoadError(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [retryToken, storeId]);

  const handleRetry = () => setRetryToken((token) => token + 1);

  // Computed over the visible (non-hidden) set, deliberately: these are the
  // numbers a shopper sees, so they are the numbers worth watching. A
  // hidden review shouldn't quietly drag the store's own average around.
  const summary = summarizeReviews(reviews);
  const hiddenCount = reviews.filter((review) => review.hidden).length;
  const mismatchCount = reviews.filter(
    (review) => !review.hidden && !review.matchedDescription
  ).length;

  const tabs = [
    { id: 'mismatch', label: "Didn't match", count: mismatchCount, color: Colors.light.danger },
    { id: 'all', label: 'All', count: reviews.length },
    { id: 'hidden', label: 'Hidden', count: hiddenCount, color: Colors.light.icon },
  ];

  const filteredReviews = reviews
    .filter((review) => {
      if (activeTab === 'hidden') return review.hidden;
      if (activeTab === 'mismatch') return !review.hidden && !review.matchedDescription;
      return true;
    })
    .filter((review) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        review.productName.toLowerCase().includes(q) ||
        review.text.toLowerCase().includes(q) ||
        review.userName.toLowerCase().includes(q)
      );
    });

  const handleSelectTab = (tabId) => {
    if (tabId === activeTab) return;
    Haptics.selectionAsync();
    setActiveTab(tabId);
  };

  const handleToggleHidden = (review) => {
    const nextHidden = !review.hidden;
    Haptics.selectionAsync();

    showAppAlert(
      nextHidden ? 'Hide This Review?' : 'Show This Review Again?',
      nextHidden
        ? 'It will stop appearing on the product page. The review itself is kept, and this action is recorded in the activity log.'
        : 'It will appear on the product page again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextHidden ? 'Hide' : 'Show',
          onPress: async () => {
            setUpdatingId(review.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            try {
              await updateDoc(doc(db, REVIEWS_COLLECTION, review.id), { hidden: nextHidden });

              // Fire-and-forget, and deliberately not awaited — see
              // utils/activityLog.js. The log is what keeps moderation
              // accountable rather than silent, which is the whole reason
              // hiding is permitted where deleting is not.
              logStoreActivity({
                storeId,
                action: ACTIONS.REVIEW_MODERATED,
                targetId: review.id,
                targetLabel: review.productName || 'Review',
                summary: `${nextHidden ? 'Hid' : 'Restored'} a ${review.rating}-star review of "${
                  review.productName || 'an item'
                }"`,
              });

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              console.error('Error updating review visibility:', error);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

              const isNetworkError = !isConnected || error.code === 'unavailable';
              showAppAlert(
                isNetworkError ? 'No Internet Connection' : 'Error',
                isNetworkError
                  ? 'Network connection lost. Please check your connection and try again.'
                  : 'Could not update this review. Please try again.'
              );
            } finally {
              setUpdatingId(null);
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
        <Text style={styles.headerTitle} accessibilityRole="header">Reviews</Text>
        <View style={styles.placeholder} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — review data may be out of date.
          </Text>
        </View>
      )}

      {/* Stats */}
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
            <Text style={[styles.statValue, { color: Colors.light.highlight }]}>
              {summary.average === null ? '—' : formatAverage(summary.average)}
            </Text>
            <Text style={styles.statLabel}>Avg. rating</Text>
          </Card>
          <Card variant="flat" style={styles.statCard}>
            <Text style={styles.statValue}>{summary.count}</Text>
            <Text style={styles.statLabel}>Visible</Text>
          </Card>
          <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.success + '15' }]}>
            <Text style={[styles.statValue, { color: Colors.light.success }]}>
              {summary.matchedPercent === null ? '—' : `${summary.matchedPercent}%`}
            </Text>
            <Text style={styles.statLabel}>Matched</Text>
          </Card>
          <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.danger + '15' }]}>
            <Text style={[styles.statValue, { color: Colors.light.danger }]}>{mismatchCount}</Text>
            <Text style={styles.statLabel}>Didn&apos;t match</Text>
          </Card>
        </ScrollView>
      </Animated.View>

      {/* Search */}
      <Animated.View
        style={styles.searchContainer}
        entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(40).easing(EASE_OUT_QUART)}
      >
        <Ionicons name="search-outline" size={20} color={Colors.light.icon} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by item, reviewer, or text..."
          placeholderTextColor={Colors.light.icon}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search reviews by item, reviewer, or text"
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
      <View style={styles.tabsRow}>
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <AnimatedPressable
              key={tab.id}
              style={[styles.tab, selected && styles.tabSelected]}
              onPress={() => handleSelectTab(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${tab.label}, ${tab.count}`}
            >
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                {tab.label} ({tab.count})
              </Text>
            </AnimatedPressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <>
            <ReviewCardSkeleton />
            <ReviewCardSkeleton />
            <ReviewCardSkeleton />
          </>
        ) : !storeId ? (
          <View style={styles.centerBlock}>
            <EmptyState
              icon="storefront-outline"
              title="No store assigned"
              subtitle="Your account isn't assigned to a store yet. Ask a Platform Admin to assign you one in Manage Users."
            />
          </View>
        ) : loadError ? (
          <View style={styles.centerBlock}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load reviews"
              subtitle="Check your connection and try again."
            />
            <View style={styles.retryWrap}>
              <Button variant="secondary" label="Try Again" onPress={handleRetry} />
            </View>
          </View>
        ) : filteredReviews.length === 0 ? (
          <EmptyState
            icon={searchQuery ? 'search-outline' : 'chatbox-outline'}
            title={searchQuery ? 'No matching reviews' : emptyTitleForTab(activeTab)}
            subtitle={searchQuery ? 'Try a different search term.' : emptySubtitleForTab(activeTab)}
          />
        ) : (
          filteredReviews.map((review, index) => (
            <Animated.View
              key={review.id}
              entering={
                reduceMotion
                  ? undefined
                  : FadeInDown.delay(Math.min(index, 8) * 40).duration(220).easing(EASE_OUT_QUART)
              }
            >
              <Card variant="flat" style={[styles.reviewCard, review.hidden && styles.reviewCardHidden]}>
                <View style={styles.reviewHeader}>
                  <StarRating rating={review.rating} size={13} />
                  <Text style={styles.reviewAuthor} numberOfLines={1}>{review.userName}</Text>
                  <Text style={styles.reviewDate}>{formatDate(review.createdAt)}</Text>
                </View>

                <Text style={styles.reviewProduct} numberOfLines={1}>
                  {review.productName || 'Item no longer named on this review'}
                </Text>

                <View style={styles.badgeRow}>
                  <Badge
                    label={review.matchedDescription ? 'Matched' : "Didn't match"}
                    color={review.matchedDescription ? Colors.light.secondary : Colors.light.danger}
                  />
                  {review.hidden && <Badge label="Hidden" color={Colors.light.icon} />}
                  {review.updatedAt && <Badge label="Edited" color={Colors.light.icon} />}
                </View>

                {review.text ? <Text style={styles.reviewText}>{review.text}</Text> : null}

                <AnimatedPressable
                  style={styles.moderateButton}
                  onPress={() => handleToggleHidden(review)}
                  disabled={updatingId === review.id}
                  accessibilityRole="button"
                  accessibilityLabel={
                    review.hidden
                      ? `Show this review of ${review.productName} again`
                      : `Hide this review of ${review.productName}`
                  }
                  accessibilityState={{ disabled: updatingId === review.id }}
                >
                  <Ionicons
                    name={review.hidden ? 'eye-outline' : 'eye-off-outline'}
                    size={16}
                    color={updatingId === review.id ? Colors.light.icon : Colors.light.tint}
                  />
                  <Text
                    style={[
                      styles.moderateButtonText,
                      updatingId === review.id && { color: Colors.light.icon },
                    ]}
                  >
                    {updatingId === review.id
                      ? 'Saving…'
                      : review.hidden
                        ? 'Show on product page'
                        : 'Hide from product page'}
                  </Text>
                </AnimatedPressable>
              </Card>
            </Animated.View>
          ))
        )}

        {/* States what this screen deliberately cannot do, where a manager
            would otherwise go looking for a delete button. */}
        {!loading && !loadError && filteredReviews.length > 0 && (
          <Text style={styles.policyNote}>
            Reviews can be hidden, never deleted or edited — the record stays intact and every
            change is recorded in the activity log.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const emptyTitleForTab = (tab) => {
  if (tab === 'hidden') return 'Nothing is hidden';
  if (tab === 'mismatch') return 'No mismatch reports';
  return 'No reviews yet';
};

const emptySubtitleForTab = (tab) => {
  if (tab === 'hidden') return 'Reviews you hide from product pages will be listed here.';
  if (tab === 'mismatch') {
    return 'Every reviewer so far says their item matched its description.';
  }
  return 'Customers can review an item once their order has been delivered.';
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  placeholder: { width: 40 },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.light.danger + '12',
  },
  offlineBannerText: { flex: 1, fontSize: 12, color: Colors.light.danger },

  statsWrapper: { paddingTop: 16 },
  statsContainer: { paddingHorizontal: 20, gap: 10 },
  statCard: { minWidth: 92, alignItems: 'center', paddingVertical: 12 },
  statValue: { fontSize: 20, fontWeight: '700', color: Colors.light.text },
  statLabel: { fontSize: 11, color: Colors.light.icon, marginTop: 2 },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: Radius.md,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: Colors.light.text },

  tabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 14 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  tabSelected: { backgroundColor: Colors.light.tint, borderColor: Colors.light.tint },
  tabText: { fontSize: 12, fontWeight: '600', color: Colors.light.icon },
  tabTextSelected: { color: '#fff' },

  list: { padding: 20, paddingBottom: 40 },
  reviewCard: { marginBottom: 12, gap: 8 },
  // Hidden rows stay legible but visibly set apart — a manager scanning the
  // "All" tab must be able to tell at a glance which of these a shopper can
  // actually see.
  reviewCardHidden: { backgroundColor: Colors.light.border + '40' },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewAuthor: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.text },
  reviewDate: { fontSize: 11, color: Colors.light.icon },
  reviewProduct: { fontSize: 12, color: Colors.light.icon },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reviewText: { fontSize: 14, color: Colors.light.text, lineHeight: 20 },
  moderateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    marginTop: 2,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  moderateButtonText: { fontSize: 13, fontWeight: '600', color: Colors.light.tint },

  centerBlock: { alignItems: 'center', paddingTop: 40 },
  retryWrap: { marginTop: 16, width: 200 },
  policyNote: {
    fontSize: 12,
    color: Colors.light.icon,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
});
