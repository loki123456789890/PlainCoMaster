// Reviews, from the approved store-tools preview: an ink summary (average,
// star spread, how many said the item matched), search, Reported / All /
// Hidden, one card per review with the item's photo, and a sheet that says
// what hiding does before it happens. Restoring is one tap; hiding comes
// with an Undo.
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { onSnapshot, doc, updateDoc } from 'firebase/firestore';

import { db } from '../../firebaseConfig';
import { showAppAlert } from '../../utils/appAlert';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { useAdmin } from '../../context/AdminContext';
import { useProducts } from '../../context/ProductContext';
import { logStoreActivity, ACTIONS } from '../../utils/activityLog';
import { Colors } from '../../constants/theme';
import Button from '../../components/ui/Button';
import SkeletonBlock from '../../components/ui/Skeleton';
import StarRating from '../../components/ui/StarRating';
import ProductImage from '../../components/ui/ProductImage';
import Sheet from '../../components/shop/Sheet';
import Reveal from '../../components/shop/Reveal';
import { TopBar, OfflineNotice, BigEmpty, UndoToast, useAutoClear } from '../../components/shop/TabScreen';
import StoreChip from '../../components/admin/StoreChip';
import Segmented from '../../components/admin/Segmented';
import {
  REVIEWS_COLLECTION,
  storeReviewsQuery,
  mapReviewDoc,
  summarizeReviews,
  formatAverage,
} from '../../utils/reviews';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const ERR = '#B42318';
const LINE = Colors.light.border;
const CARD_LINE = '#EEE7DD';
const ON_INK_MUTED = '#BDB3A9';

// Deeper than the customer-facing sample (utils/reviews.js caps that at 100)
// because this is a work queue, not a summary — a manager scrolling back
// through a slow week should not hit an invisible floor.
const MODERATION_LIMIT = 200;

const RING_R = 18;
const RING_C = 2 * Math.PI * RING_R;

const formatDate = (date) => {
  if (!date) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

function ReviewCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <SkeletonBlock style={styles.thumb} />
        <View style={{ flex: 1, gap: 8 }}>
          <SkeletonBlock style={{ width: '60%', height: 13, borderRadius: 6 }} />
          <SkeletonBlock style={{ width: 70, height: 11, borderRadius: 6 }} />
        </View>
      </View>
      <SkeletonBlock style={{ width: '90%', height: 13, borderRadius: 6, marginBottom: 6 }} />
      <SkeletonBlock style={{ width: '70%', height: 13, borderRadius: 6 }} />
    </View>
  );
}

function Chip({ tone, icon, children }) {
  const t = CHIP_TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={t.fg} /> : null}
      <Text style={[styles.chipText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}
const CHIP_TONES = {
  bad: { bg: '#FBEDEB', fg: '#8E1B12' },
  ok: { bg: '#EEF0EA', fg: '#37412F' },
  plain: { bg: '#F3EEE6', fg: MUTED },
  hidden: { bg: '#EDE5DA', fg: MUTED },
};

// The ink card: average and star spread on the left, the "matched their
// description" ring underneath. All of it counts visible reviews only —
// the numbers a shopper sees.
function Summary({ reviews }) {
  const summary = summarizeReviews(reviews);
  const visible = reviews.filter((r) => !r.hidden);
  const matchedShare = summary.count ? summary.matchedCount / summary.count : 0;
  return (
    <Reveal delay={40} style={styles.sum}>
      <View style={styles.sumTop}>
        <View style={styles.avg}>
          <Text style={styles.avgNum}>{summary.average === null ? '—' : formatAverage(summary.average)}</Text>
          <StarRating rating={summary.average || 0} size={12} />
          <Text style={styles.avgNote}>
            {summary.count} visible review{summary.count === 1 ? '' : 's'}
          </Text>
        </View>
        <View style={styles.dist}>
          {[5, 4, 3, 2, 1].map((stars) => {
            const n = visible.filter((r) => Math.round(r.rating) === stars).length;
            return (
              <View key={stars} style={styles.distRow}>
                <Text style={styles.distLabel}>{stars}★</Text>
                <View style={styles.distTrack}>
                  <View
                    style={[
                      styles.distFill,
                      {
                        width: `${summary.count ? (n / summary.count) * 100 : 0}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.distLabel}>{n}</Text>
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.match}>
        <View style={styles.ring}>
          <Svg width={44} height={44} viewBox="0 0 44 44">
            <Circle cx={22} cy={22} r={RING_R} fill="none" stroke="rgba(250,247,242,0.12)" strokeWidth={5} />
            <Circle
              cx={22}
              cy={22}
              r={RING_R}
              fill="none"
              stroke="#8FA37D"
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - matchedShare)}
              transform="rotate(-90 22 22)"
            />
          </Svg>
          <Text style={styles.ringText} accessibilityElementsHidden importantForAccessibility="no">
            {/* Below MIN_REVIEWS_FOR_PERCENT a percentage overclaims; show the count. */}
            {summary.matchedPercent !== null
              ? `${summary.matchedPercent}%`
              : `${summary.matchedCount}/${summary.count}`}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.matchTitle}>Matched their description</Text>
          <Text style={styles.matchNote}>
            {summary.count
              ? `${summary.matchedCount} of ${summary.count} said the item matched its description`
              : 'No visible reviews yet'}
          </Text>
        </View>
      </View>
    </Reveal>
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
 * The default tab is "Reported" (the item didn't match its description),
 * not "All". That is an operational signal about a LISTING — the
 * description is wrong, the photos flatter it, the condition was
 * overstated — and it is the one thing on this screen a manager can
 * actually go and fix.
 */
export default function AdminReviewsScreen({ navigation }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState('reported');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [stuck, setStuck] = useState(false);
  // The review the hide sheet is asking about, and whether its write is in
  // flight (the sheet stays locked while it is).
  const [confirming, setConfirming] = useState(null);
  const [hiding, setHiding] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const [toast, setToast] = useState(null);
  useAutoClear(toast, () => setToast(null), 4000);

  const { isConnected } = useNetworkStatus();
  // Only this store's reviews: another store's are not this manager's to
  // moderate, and firestore.rules refuses them the hide.
  const { storeId } = useAdmin();
  const { storeProducts } = useProducts();

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

  // Keeps the sheet's content while it slides away.
  const lastConfirming = useRef(null);
  if (confirming) lastConfirming.current = confirming;
  const sheetReview = lastConfirming.current;

  const productFor = (review) => storeProducts.find((p) => p.id === review.productId);

  const counts = {
    reported: reviews.filter((r) => !r.hidden && !r.matchedDescription).length,
    all: reviews.length,
    hidden: reviews.filter((r) => r.hidden).length,
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredReviews = reviews
    .filter((review) => {
      if (activeTab === 'hidden') return review.hidden;
      if (activeTab === 'reported') return !review.hidden && !review.matchedDescription;
      return true;
    })
    .filter(
      (review) =>
        !q ||
        review.productName.toLowerCase().includes(q) ||
        review.text.toLowerCase().includes(q) ||
        review.userName.toLowerCase().includes(q)
    );

  // The one write this screen makes. Returns whether it landed.
  const setHidden = async (review, hidden) => {
    try {
      await updateDoc(doc(db, REVIEWS_COLLECTION, review.id), { hidden });
      // Fire-and-forget, and deliberately not awaited — see
      // utils/activityLog.js. The log is what keeps moderation accountable
      // rather than silent, which is the whole reason hiding is permitted
      // where deleting is not.
      logStoreActivity({
        storeId,
        action: ACTIONS.REVIEW_MODERATED,
        targetId: review.id,
        targetLabel: review.productName || 'Review',
        summary: `${hidden ? 'Hid' : 'Restored'} a ${review.rating}-star review of "${review.productName || 'an item'}"`,
      });
      return true;
    } catch (error) {
      console.error('Error updating review visibility:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const isNetworkError = !isConnected || error.code === 'unavailable';
      showAppAlert(
        isNetworkError ? 'No internet connection' : 'Not saved',
        isNetworkError ? 'Check your connection and try again.' : 'Could not update this review. Please try again.'
      );
      return false;
    }
  };

  const confirmHide = async () => {
    const review = confirming;
    if (!review) return;
    setHiding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await setHidden(review, true);
    setHiding(false);
    setConfirming(null);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToast({
        text: 'Review hidden · logged in Store Activity',
        undo: review,
      });
    }
  };

  const restore = async (review, fromUndo) => {
    setToast(null);
    setRestoringId(review.id);
    const ok = await setHidden(review, false);
    setRestoringId(null);
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (!fromUndo) setToast({ text: 'Review restored to the product page' });
    }
  };

  const empty = q
    ? {
        icon: 'search-outline',
        title: 'No matches',
        text: 'Try another search.',
      }
    : activeTab === 'hidden'
      ? {
          icon: 'eye-off-outline',
          title: 'Nothing is hidden',
          text: 'Reviews you hide from product pages show up here.',
        }
      : activeTab === 'reported'
        ? {
            icon: 'checkmark-done-outline',
            title: 'Nothing reported',
            text: 'Every visible review says the item matched its description.',
          }
        : {
            icon: 'chatbox-outline',
            title: 'No reviews yet',
            text: 'Reviews appear after customers receive their orders.',
          };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Reviews" onBack={() => navigation.goBack()} stuck={stuck} right={<StoreChip />} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        onScroll={(e) => setStuck(e.nativeEvent.contentOffset.y > 4)}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
      >
        {!isConnected ? <OfflineNotice>No internet connection. Reviews may be out of date.</OfflineNotice> : null}

        {!storeId ? (
          <BigEmpty
            icon="storefront-outline"
            title="No store assigned"
            text="Your account isn't assigned to a store yet. Ask a Platform Admin to assign you one in Manage Users."
          />
        ) : loadError ? (
          <BigEmpty
            icon="cloud-offline-outline"
            title="Couldn't load reviews"
            text="Check your connection and try again."
            actionLabel="Try again"
            onAction={() => setRetryToken((t) => t + 1)}
          />
        ) : (
          <>
            {loading ? <SkeletonBlock style={styles.sumSkeleton} /> : <Summary reviews={reviews} />}

            <View style={styles.pad}>
              <View style={[styles.search, searchFocused && styles.searchFocused]}>
                <Ionicons name="search-outline" size={18} color={MUTED} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search item, reviewer or text"
                  placeholderTextColor={MUTED}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  accessibilityLabel="Search reviews by item, reviewer or text"
                  returnKeyType="search"
                />
                {searchQuery ? (
                  <Pressable
                    onPress={() => setSearchQuery('')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Ionicons name="close-circle" size={18} color={MUTED} />
                  </Pressable>
                ) : null}
              </View>

              <Segmented
                items={[
                  {
                    key: 'reported',
                    label: 'Reported',
                    count: loading ? '–' : counts.reported,
                  },
                  {
                    key: 'all',
                    label: 'All',
                    count: loading ? '–' : counts.all,
                  },
                  {
                    key: 'hidden',
                    label: 'Hidden',
                    count: loading ? '–' : counts.hidden,
                  },
                ]}
                value={activeTab}
                onChange={setActiveTab}
              />

              {loading ? (
                <>
                  <ReviewCardSkeleton />
                  <ReviewCardSkeleton />
                </>
              ) : filteredReviews.length === 0 ? (
                <BigEmpty {...empty} />
              ) : (
                filteredReviews.map((review, index) => {
                  const product = productFor(review);
                  const busy = restoringId === review.id;
                  return (
                    <Reveal key={review.id} delay={Math.min(index, 8) * 50}>
                      <View style={[styles.card, review.hidden && styles.cardHidden]}>
                        <View style={styles.cardHead}>
                          <ProductImage uri={product?.imageUrl || product?.image} style={styles.thumb} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.item} numberOfLines={1}>
                              {review.productName || 'Item no longer named on this review'}
                            </Text>
                            <StarRating rating={review.rating} size={13} />
                          </View>
                          <Text style={styles.date}>{formatDate(review.createdAt)}</Text>
                        </View>

                        <View style={styles.chips}>
                          {/* firestore.rules only accepts a review from the buyer of a delivered order. */}
                          <Chip tone="plain" icon="checkmark">
                            Verified purchase
                          </Chip>
                          {review.matchedDescription ? (
                            <Chip tone="ok">Matched description</Chip>
                          ) : (
                            <Chip tone="bad">Didn&apos;t match description</Chip>
                          )}
                          {review.hidden ? <Chip tone="hidden">Hidden</Chip> : null}
                          {review.updatedAt ? <Chip tone="plain">Edited</Chip> : null}
                        </View>

                        {review.text ? <Text style={styles.quote}>“{review.text}”</Text> : null}
                        <Text style={styles.by}>{review.userName}</Text>

                        <View style={styles.actions}>
                          {review.hidden ? (
                            <Pressable
                              onPress={() => restore(review)}
                              disabled={busy}
                              style={({ pressed }) => [styles.actBtn, styles.actRestore, pressed && styles.pressed]}
                              accessibilityRole="button"
                              accessibilityLabel={`Restore this review of ${review.productName} to the product page`}
                              accessibilityState={{ disabled: busy, busy }}
                            >
                              <Ionicons name="eye-outline" size={16} color="#37412F" />
                              <Text style={[styles.actText, { color: '#37412F' }]}>
                                {busy ? 'Restoring…' : 'Restore to product page'}
                              </Text>
                            </Pressable>
                          ) : (
                            <>
                              {product ? (
                                <Pressable
                                  onPress={() => navigation.navigate('Product', { product })}
                                  style={({ pressed }) => [styles.actBtn, styles.actView, pressed && styles.pressed]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`View ${review.productName}`}
                                >
                                  <Text style={[styles.actText, { color: INK }]}>View product</Text>
                                </Pressable>
                              ) : null}
                              <Pressable
                                onPress={() => {
                                  Haptics.selectionAsync();
                                  setConfirming(review);
                                }}
                                style={({ pressed }) => [styles.actBtn, styles.actHide, pressed && styles.pressed]}
                                accessibilityRole="button"
                                accessibilityLabel={`Hide this review of ${review.productName}`}
                              >
                                <Ionicons name="eye-off-outline" size={16} color="#8E1B12" />
                                <Text style={[styles.actText, { color: '#8E1B12' }]}>Hide</Text>
                              </Pressable>
                            </>
                          )}
                        </View>
                      </View>
                    </Reveal>
                  );
                })
              )}

              {/* States what this screen deliberately cannot do, where a manager
                  would otherwise go looking for a delete button. */}
              {!loading ? (
                <View style={styles.foot}>
                  <Ionicons name="lock-closed-outline" size={14} color={MUTED} style={{ marginTop: 2 }} />
                  <Text style={styles.footText}>
                    Reviews can be hidden, never edited or deleted. The customer&apos;s words stay exactly as written,
                    and every hide or restore is logged in Store Activity.
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      <UndoToast
        text={toast?.text}
        lift={-40}
        onUndo={toast?.undo ? () => restore(toast.undo, true) : undefined}
        undoLabel="Undo hide"
      />

      <Sheet visible={Boolean(confirming)} onClose={() => setConfirming(null)} locked={hiding}>
        <Text style={styles.sheetTitle}>Hide this review?</Text>
        <Text style={styles.sheetText}>
          {sheetReview?.userName}&apos;s {sheetReview?.rating}★ review of{' '}
          <Text style={{ fontWeight: '600', color: INK }}>{sheetReview?.productName || 'this item'}</Text> will stop
          showing on the product page.
        </Text>
        <View style={styles.will}>
          <WillRow icon="eye-off-outline" color={ERR}>
            Shoppers <Text style={styles.b}>won&apos;t see it</Text>, and it won&apos;t count toward the rating.
          </WillRow>
          <WillRow icon="lock-closed-outline" color={MOSS}>
            The customer&apos;s rating and words are <Text style={styles.b}>kept unchanged</Text>.
          </WillRow>
          <WillRow icon="time-outline" color={MUTED} last>
            It&apos;s <Text style={styles.b}>logged in Store Activity</Text>, and you can restore it anytime.
          </WillRow>
        </View>
        <Button variant="primary" label="Hide review" onPress={confirmHide} loading={hiding} disabled={hiding} />
        <Pressable
          onPress={() => setConfirming(null)}
          disabled={hiding}
          style={styles.cancel}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </Sheet>
    </SafeAreaView>
  );
}

function WillRow({ icon, color, last, children }) {
  return (
    <View style={[styles.willRow, last && { borderBottomWidth: 0 }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.willText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scroll: { paddingBottom: 40 },
  pad: { paddingHorizontal: 16 },

  sum: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 24,
    backgroundColor: INK,
    padding: 16,
  },
  sumSkeleton: {
    marginHorizontal: 16,
    marginBottom: 14,
    height: 190,
    borderRadius: 24,
  },
  sumTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avg: {
    alignItems: 'center',
    paddingRight: 16,
    borderRightWidth: 1,
    borderRightColor: 'rgba(250,247,242,0.12)',
  },
  avgNum: {
    fontSize: 34,
    fontWeight: '600',
    lineHeight: 38,
    color: Colors.light.background,
  },
  avgNote: { fontSize: 11, color: ON_INK_MUTED, marginTop: 6 },
  dist: { flex: 1, gap: 3 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  distLabel: { fontSize: 10.5, color: ON_INK_MUTED, minWidth: 16 },
  distTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(250,247,242,0.1)',
    overflow: 'hidden',
  },
  distFill: { height: '100%', borderRadius: 3, backgroundColor: CLAY },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,247,242,0.12)',
  },
  ring: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ringText: {
    position: 'absolute',
    fontSize: 10.5,
    fontWeight: '600',
    color: Colors.light.background,
  },
  matchTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.background,
  },
  matchNote: { fontSize: 11.5, color: ON_INK_MUTED, marginTop: 1 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: LINE,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  searchFocused: { borderColor: CLAY },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: INK,
    paddingVertical: 0,
    outlineStyle: 'none',
  },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
  },
  // Hidden reviews stay legible but visibly set apart, so a manager scanning
  // "All" can tell which ones a shopper can actually see.
  cardHidden: {
    backgroundColor: '#F6F2EC',
    borderStyle: 'dashed',
    borderColor: '#DCD2C5',
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  thumb: {
    width: 44,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#E6E9E1',
  },
  item: { fontSize: 13.5, fontWeight: '600', color: INK, marginBottom: 2 },
  date: { fontSize: 11, color: MUTED, alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: { fontSize: 10.5, fontWeight: '600' },
  quote: { fontSize: 13.5, lineHeight: 21, color: INK, marginBottom: 6 },
  by: { fontSize: 12, color: MUTED, marginBottom: 12 },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1EBE3',
  },
  actBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actHide: { borderColor: '#F1CFCB', backgroundColor: '#FFF8F7' },
  actRestore: { borderColor: '#C9D3BE', backgroundColor: '#F3F5EF' },
  actView: { borderColor: LINE, backgroundColor: '#fff' },
  actText: { fontSize: 12.5, fontWeight: '600' },
  pressed: { transform: [{ scale: 0.97 }] },

  foot: { flexDirection: 'row', gap: 8, marginTop: 8, marginHorizontal: 8 },
  footText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: MUTED },

  sheetTitle: { fontSize: 18, fontWeight: '600', color: INK, marginBottom: 4 },
  sheetText: { fontSize: 13, lineHeight: 19.5, color: MUTED, marginBottom: 12 },
  will: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 14,
  },
  willRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1EBE3',
  },
  willText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: INK },
  b: { fontWeight: '600' },
  cancel: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: MUTED },
});
