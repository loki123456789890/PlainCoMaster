import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useReducedMotion, FadeIn, FadeInDown } from 'react-native-reanimated';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { useAdmin } from '../../context/AdminContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../../constants/theme';
import { getPortalLabel } from '../../constants/roles';
import { STORE_ACTIVITY, ACCOUNT_ACTIVITY, ACTIONS } from '../../utils/activityLog';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import { EASE_OUT_QUART } from '../../constants/motion';

// One screen, two disjoint data sources. Which log you see follows from
// your role and nothing else: a Store Manager reads store operations, a
// Platform Admin reads account changes, and firestore.rules refuses the
// other collection outright in both directions. Sharing the component
// rather than writing two near-identical screens keeps that symmetry
// visible — the roles differ in what they may read, not in what the app
// is willing to show them.
const VIEWS = {
  seller: {
    collectionName: STORE_ACTIVITY,
    title: 'Store Activity',
    subtitle: 'Product and order changes',
    emptyTitle: 'No activity yet',
    emptySubtitle: 'Product edits and order status changes will appear here.',
    searchPlaceholder: 'Search activity...',
  },
  platformAdmin: {
    collectionName: ACCOUNT_ACTIVITY,
    title: 'Account Activity',
    subtitle: 'Role and status changes',
    emptyTitle: 'No account changes yet',
    emptySubtitle: 'Role grants and account activations will appear here.',
    searchPlaceholder: 'Search account changes...',
  },
};

// Neutral icons throughout except deletion and deactivation, which get
// Rust: those are the two entries someone scanning this list for "what
// went wrong" is actually looking for.
const ACTION_META = {
  [ACTIONS.PRODUCT_CREATED]: { icon: 'add-circle-outline', tone: 'neutral' },
  [ACTIONS.PRODUCT_UPDATED]: { icon: 'create-outline', tone: 'neutral' },
  [ACTIONS.PRODUCT_DELETED]: { icon: 'trash-outline', tone: 'danger' },
  [ACTIONS.ORDER_STATUS]: { icon: 'cube-outline', tone: 'neutral' },
  // Neutral, not danger: this one action covers hiding a review AND
  // restoring it, and half of that is not a destructive act.
  [ACTIONS.REVIEW_MODERATED]: { icon: 'eye-off-outline', tone: 'neutral' },
  [ACTIONS.USER_ROLE]: { icon: 'shield-checkmark-outline', tone: 'neutral' },
  [ACTIONS.USER_STATUS]: { icon: 'person-outline', tone: 'neutral' },
};

// Reads as "how long ago" up to a week, then as a date. A log is usually
// consulted about something recent ("what changed this morning?"), and an
// exact timestamp is less useful than an elapsed one for that question.
function formatWhen(date) {
  if (!date) return 'Just now';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EntrySkeleton() {
  return (
    <Card variant="flat" style={styles.entryCard}>
      <SkeletonBlock style={styles.iconSkeleton} />
      <View style={styles.entryBody}>
        <SkeletonBlock style={{ width: '80%', height: 13, borderRadius: Radius.sm, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: '45%', height: 11, borderRadius: Radius.sm }} />
      </View>
    </Card>
  );
}

export default function AdminActivityScreen({ navigation }) {
  const { role } = useAdmin();
  const view = VIEWS[role] ?? VIEWS.seller;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setLoading(true);
    setLoadError(false);

    // Capped at 200: this is a monitoring view, not an archive, and an
    // unbounded listener on a collection that grows with every privileged
    // action would download more history on every cold start forever.
    const unsubscribe = onSnapshot(
      query(collection(db, view.collectionName), orderBy('createdAt', 'desc'), limit(200)),
      (snapshot) => {
        setEntries(
          snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              action: data.action || '',
              actorEmail: data.actorEmail || 'Unknown',
              targetLabel: data.targetLabel || '',
              summary: data.summary || '',
              // serverTimestamp() is null for a beat on the writer's own
              // device until the server round-trips the real value.
              createdAt: data.createdAt?.toDate?.() ?? null,
            };
          })
        );
        setLoadError(false);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading activity log:', error);
        setLoadError(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [view.collectionName, retryToken]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.summary.toLowerCase().includes(q) ||
        entry.actorEmail.toLowerCase().includes(q) ||
        entry.targetLabel.toLowerCase().includes(q)
    );
  }, [entries, searchQuery]);

  return (
    <SafeAreaView style={styles.container}>
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
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle} accessibilityRole="header">{view.title}</Text>
          <Text style={styles.headerRole}>{getPortalLabel(role)}</Text>
        </View>
        <View style={styles.placeholder} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — this list may be out of date.
          </Text>
        </View>
      )}

      <Animated.View
        style={styles.searchContainer}
        entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(40).easing(EASE_OUT_QUART)}
      >
        <Ionicons name="search-outline" size={20} color={Colors.light.icon} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={view.searchPlaceholder}
          placeholderTextColor={Colors.light.icon}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search activity"
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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContainer}>
        {loading ? (
          <>
            <EntrySkeleton />
            <EntrySkeleton />
            <EntrySkeleton />
          </>
        ) : loadError ? (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load activity"
              subtitle="Check your connection and try again."
            />
            <View style={styles.emptyStateAction}>
              <Button variant="outline" label="Retry" onPress={() => setRetryToken((t) => t + 1)} />
            </View>
          </View>
        ) : filtered.length > 0 ? (
          filtered.map((entry, index) => {
            const meta = ACTION_META[entry.action] ?? { icon: 'ellipse-outline', tone: 'neutral' };
            const tint = meta.tone === 'danger' ? Colors.light.danger : Colors.light.icon;
            return (
              <Animated.View
                key={entry.id}
                entering={
                  reduceMotion
                    ? undefined
                    : FadeIn.duration(200).delay(Math.min(index, 8) * 25)
                }
              >
                <Card variant="flat" style={styles.entryCard}>
                  <View style={[styles.iconCircle, { backgroundColor: tint + '15' }]}>
                    <Ionicons name={meta.icon} size={18} color={tint} />
                  </View>
                  <View style={styles.entryBody}>
                    <Text style={styles.entrySummary}>{entry.summary}</Text>
                    <Text style={styles.entryMeta}>
                      {entry.actorEmail} · {formatWhen(entry.createdAt)}
                    </Text>
                  </View>
                </Card>
              </Animated.View>
            );
          })
        ) : (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon={searchQuery ? 'search-outline' : 'time-outline'}
              title={searchQuery ? 'No matches' : view.emptyTitle}
              subtitle={searchQuery ? 'Try a different search term.' : view.emptySubtitle}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

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
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleGroup: { alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  headerRole: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.light.icon,
    marginTop: 2,
  },
  placeholder: { width: 40 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.danger + '40',
  },
  offlineBannerText: { flex: 1, fontSize: 12, color: Colors.light.danger },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, fontSize: 14, color: Colors.light.text },
  listContainer: { padding: 16, paddingTop: 0 },
  entryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: 12,
    marginBottom: 10,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSkeleton: { width: 34, height: 34, borderRadius: 17 },
  entryBody: { flex: 1 },
  entrySummary: { fontSize: 14, lineHeight: 19, color: Colors.light.text },
  entryMeta: { fontSize: 11, color: Colors.light.icon, marginTop: 4 },
  emptyStateWrap: { paddingHorizontal: Spacing.md },
  emptyStateAction: { marginTop: -Spacing.sm, marginBottom: Spacing.md, paddingHorizontal: Spacing.xl },
});
