// Store Activity (and, for the Platform Admin, Account Activity), from the
// approved store-tools preview: a read-only notice, search, type chips, and
// the log as a timeline grouped by day. An order's status change shows as
// "from → to" pills; tapping any entry opens its server time and id.
import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { useAdmin } from '../../context/AdminContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors } from '../../constants/theme';
import { STORE_ACTIVITY, ACCOUNT_ACTIVITY, ACTIONS } from '../../utils/activityLog';
import SkeletonBlock from '../../components/ui/Skeleton';
import Reveal from '../../components/shop/Reveal';
import { TopBar, OfflineNotice, BigEmpty } from '../../components/shop/TabScreen';
import StoreChip from '../../components/admin/StoreChip';
import { EASE_OUT_QUINT } from '../../constants/motion';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const GOLD = '#8C6D0C';
const ERR = '#B42318';
const LINE = Colors.light.border;
const CARD_LINE = '#EEE7DD';

// Types, each with the actions it covers, a color and an icon. Deletion and
// deactivation are drawn in red: those are the entries someone scanning for
// "what went wrong" is looking for.
const STORE_TYPES = [
  { key: 'order', label: 'Orders', one: 'Order', color: CLAY, icon: 'cube-outline', actions: [ACTIONS.ORDER_STATUS] },
  {
    key: 'product',
    label: 'Products',
    one: 'Product',
    color: MOSS,
    icon: 'pricetag-outline',
    actions: [ACTIONS.PRODUCT_CREATED, ACTIONS.PRODUCT_UPDATED, ACTIONS.PRODUCT_DELETED],
  },
  {
    key: 'review',
    label: 'Reviews',
    one: 'Review',
    color: GOLD,
    icon: 'star-outline',
    actions: [ACTIONS.REVIEW_MODERATED],
  },
];
const ACCOUNT_TYPES = [
  {
    key: 'role',
    label: 'Roles',
    one: 'Role',
    color: CLAY,
    icon: 'shield-checkmark-outline',
    actions: [ACTIONS.USER_ROLE],
  },
  {
    key: 'status',
    label: 'Accounts',
    one: 'Account',
    color: MOSS,
    icon: 'person-outline',
    actions: [ACTIONS.USER_STATUS],
  },
];
const DANGER_ACTIONS = [ACTIONS.PRODUCT_DELETED];

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
    notice:
      "A read-only record of product, order and review actions in your store. Entries can't be edited or deleted by anyone.",
    emptyTitle: 'No activity yet',
    emptyText: 'Product edits, order status changes and hidden reviews will appear here.',
    types: STORE_TYPES,
  },
  platformAdmin: {
    collectionName: ACCOUNT_ACTIVITY,
    title: 'Account Activity',
    notice: "A read-only record of role and account changes. Entries can't be edited or deleted by anyone.",
    emptyTitle: 'No account changes yet',
    emptyText: 'Role grants and account activations will appear here.',
    types: ACCOUNT_TYPES,
  },
};

// Colors for the actor's initial, picked by a hash of the email so the same
// person keeps the same color down the whole list.
const AVATAR_COLORS = [MOSS, CLAY, GOLD, '#2F4B6B', '#6B5A2E'];
const avatarColor = (email) => {
  let h = 0;
  for (let i = 0; i < email.length; i += 1) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
function dayLabel(date) {
  if (!date) return 'Today';
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
const timeLabel = (date) =>
  date ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Just now';
const fullTime = (date) =>
  date
    ? `${date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
    : 'Waiting for the server';

// The summaries are free text written by utils/activityLog.js's callers.
// Two shapes carry structure worth drawing, so they're split here:
//   "Order #X — status Pending → Processing, 2 item(s) returned to stock"
//   "Ana Cruz — role Customer → Store Manager" (AdminUsersScreen)
//   "Edited "Jacket" — changed price, stock"
// Anything else is shown as written.
function parseSummary(summary) {
  const status = summary.match(/^(.*?)\s+—\s+(?:status|role)\s+(.+?)\s+→\s+(.+?)(?:,\s*(.+))?$/);
  if (status) return { head: status[1], from: status[2], to: status[3], extra: status[4] || '' };
  const changed = summary.match(/^(.*?)\s+—\s+changed\s+(.+)$/);
  if (changed) return { head: changed[1], extra: `Changed: ${changed[2]}` };
  return { head: summary };
}

// Draws quoted names ("Knit Poncho") and order numbers in semibold.
function Emphasized({ text }) {
  const parts = text.split(/("[^"]+"|#[A-Za-z0-9]+)/);
  return (
    <Text style={styles.evText}>
      {parts.map((part, i) =>
        /^("[^"]+"|#[A-Za-z0-9]+)$/.test(part) ? (
          <Text key={i} style={styles.b}>
            {part.startsWith('"') ? part.slice(1, -1) : part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

function EntrySkeleton() {
  return (
    <View style={[styles.ev, { marginLeft: 28 }]}>
      <SkeletonBlock style={{ width: 70, height: 11, borderRadius: 6, marginBottom: 10 }} />
      <SkeletonBlock style={{ width: '85%', height: 13, borderRadius: 6, marginBottom: 8 }} />
      <SkeletonBlock style={{ width: '45%', height: 11, borderRadius: 6 }} />
    </View>
  );
}

function Entry({ entry, type, isYou, open, onToggle, delay }) {
  const reduceMotion = useReducedMotion();
  const parsed = parseSummary(entry.summary);
  const danger = DANGER_ACTIONS.includes(entry.action);
  const color = danger ? ERR : type?.color || MUTED;
  return (
    <Reveal delay={delay}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.ev, pressed && { transform: [{ scale: 0.985 }] }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${type?.one || 'Entry'}, ${timeLabel(entry.createdAt)}. ${entry.summary}. By ${entry.actorEmail}${isYou ? ', you' : ''}.`}
        accessibilityHint={open ? 'Hides the entry details' : 'Shows the entry details'}
      >
        <View style={[styles.dot, { backgroundColor: color }]} />
        <View style={styles.evTop}>
          <Ionicons name={danger ? 'trash-outline' : type?.icon || 'ellipse-outline'} size={13} color={color} />
          <Text style={[styles.evType, { color }]}>{danger ? 'Deleted' : type?.one || 'Other'}</Text>
          <Text style={styles.evTime}>{timeLabel(entry.createdAt)}</Text>
        </View>

        <View style={styles.evBody}>
          <Emphasized text={parsed.head} />
          {parsed.from ? (
            <View style={styles.pills}>
              <Text style={[styles.pill, styles.pillFrom]}>{parsed.from}</Text>
              <Text style={{ color: CLAY }}>→</Text>
              <Text style={[styles.pill, styles.pillTo]}>{parsed.to}</Text>
            </View>
          ) : null}
          {parsed.extra ? <Text style={styles.evExtra}>{parsed.extra}</Text> : null}
        </View>

        <View style={styles.who}>
          <View style={[styles.av, { backgroundColor: avatarColor(entry.actorEmail) }]}>
            <Text style={styles.avText}>{entry.actorEmail.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.whoText} numberOfLines={1}>
            {entry.actorEmail}
            {isYou ? ' (you)' : ''}
          </Text>
        </View>

        {open ? (
          <Animated.View
            style={styles.more}
            entering={reduceMotion ? undefined : FadeIn.duration(250).easing(EASE_OUT_QUINT)}
          >
            <Text style={styles.dt}>Server time</Text>
            <Text style={styles.dd} selectable>
              {fullTime(entry.createdAt)}
            </Text>
            <Text style={styles.dt}>Entry ID</Text>
            <Text style={styles.dd} selectable>
              {entry.id}
            </Text>
            <Text style={styles.dt}>Status</Text>
            <Text style={styles.dd}>Append-only · can&apos;t be changed</Text>
          </Animated.View>
        ) : null}
      </Pressable>
    </Reveal>
  );
}

export default function AdminActivityScreen({ navigation, route }) {
  const { role, storeId } = useAdmin();
  const view = VIEWS[role] ?? VIEWS.seller;
  // The store log is per store: a manager reads their own store's entries
  // and the rules refuse the rest, including an unfiltered query. The
  // account log has no store.
  const scopedToStore = view.collectionName === STORE_ACTIVITY;
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Manage Users' "See their history" opens the log already searched for
  // that person.
  const [searchQuery, setSearchQuery] = useState(route?.params?.query || '');
  const [searchFocused, setSearchFocused] = useState(false);
  const [typeKey, setTypeKey] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const [stuck, setStuck] = useState(false);
  const { isConnected } = useNetworkStatus();
  const myEmail = auth.currentUser?.email || '';

  useEffect(() => {
    // A manager with no store has no store log to read.
    if (scopedToStore && !storeId) {
      setEntries([]);
      setLoadError(false);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setLoadError(false);

    // Capped at 200: this is a monitoring view, not an archive, and an
    // unbounded listener on a collection that grows with every privileged
    // action would download more history on every cold start forever.
    const unsubscribe = onSnapshot(
      query(
        collection(db, view.collectionName),
        // Needs the (storeId, createdAt desc) index in firestore.indexes.json.
        ...(scopedToStore ? [where('storeId', '==', storeId)] : []),
        orderBy('createdAt', 'desc'),
        limit(200)
      ),
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
  }, [view.collectionName, retryToken, scopedToStore, storeId]);

  const typeOf = (action) => view.types.find((t) => t.actions.includes(action));

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const type = view.types.find((t) => t.key === typeKey);
    return entries.filter(
      (entry) =>
        (!type || type.actions.includes(entry.action)) &&
        (!q ||
          entry.summary.toLowerCase().includes(q) ||
          entry.actorEmail.toLowerCase().includes(q) ||
          entry.targetLabel.toLowerCase().includes(q))
    );
  }, [entries, searchQuery, typeKey, view.types]);

  // Consecutive entries under one day heading. The list is already newest
  // first, so a new heading starts whenever the day changes.
  const days = useMemo(() => {
    const out = [];
    filtered.forEach((entry) => {
      const label = dayLabel(entry.createdAt);
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, entries: [] });
      out[out.length - 1].entries.push(entry);
    });
    return out;
  }, [filtered]);

  const chips = [{ key: 'all', label: 'All', color: '#B3AAA0' }, ...view.types];
  const searching = Boolean(searchQuery.trim()) || typeKey !== 'all';
  let index = 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar
        title={view.title}
        onBack={() => navigation.goBack()}
        stuck={stuck}
        right={scopedToStore ? <StoreChip /> : null}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        onScroll={(e) => setStuck(e.nativeEvent.contentOffset.y > 4)}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
      >
        {!isConnected ? <OfflineNotice>No internet connection. This list may be out of date.</OfflineNotice> : null}

        <View style={styles.pad}>
          <Reveal delay={20} style={styles.lock}>
            <Ionicons name="lock-closed-outline" size={16} color={MUTED} />
            <Text style={styles.lockText}>{view.notice}</Text>
          </Reveal>

          <Reveal delay={60}>
            <View style={[styles.search, searchFocused && styles.searchFocused]}>
              <Ionicons name="search-outline" size={18} color={MUTED} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search activity"
                placeholderTextColor={MUTED}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                accessibilityLabel="Search activity"
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
          </Reveal>

          <Reveal delay={100}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              accessibilityRole="tablist"
            >
              {chips.map((chip) => {
                const on = typeKey === chip.key;
                return (
                  <Pressable
                    key={chip.key}
                    onPress={() => {
                      if (on) return;
                      Haptics.selectionAsync();
                      setTypeKey(chip.key);
                    }}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <View style={[styles.chipDot, { backgroundColor: chip.color }]} />
                    <Text style={[styles.chipText, on && { color: Colors.light.background }]}>{chip.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Reveal>

          {loading ? (
            <>
              <EntrySkeleton />
              <EntrySkeleton />
              <EntrySkeleton />
            </>
          ) : scopedToStore && !storeId ? (
            <BigEmpty
              icon="storefront-outline"
              title="No store assigned"
              text="Your account isn't assigned to a store yet. Ask a Platform Admin to assign you one in Manage Users."
            />
          ) : loadError ? (
            <BigEmpty
              icon="cloud-offline-outline"
              title="Couldn't load activity"
              text="Check your connection and try again."
              actionLabel="Try again"
              onAction={() => setRetryToken((t) => t + 1)}
            />
          ) : days.length === 0 ? (
            <BigEmpty
              icon={searching ? 'search-outline' : 'time-outline'}
              title={searching ? 'No matching activity' : view.emptyTitle}
              text={searching ? 'Try another filter or search.' : view.emptyText}
            />
          ) : (
            days.map((day) => (
              <View key={day.label}>
                <Text style={styles.day} accessibilityRole="header">
                  {day.label}
                </Text>
                <View style={styles.tl}>
                  <View style={styles.rail} />
                  {day.entries.map((entry) => (
                    <Entry
                      key={entry.id}
                      entry={entry}
                      type={typeOf(entry.action)}
                      isYou={Boolean(myEmail) && entry.actorEmail === myEmail}
                      open={openId === entry.id}
                      onToggle={() => {
                        Haptics.selectionAsync();
                        setOpenId((id) => (id === entry.id ? null : entry.id));
                      }}
                      delay={Math.min(index++, 8) * 45}
                    />
                  ))}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scroll: { paddingBottom: 40 },
  pad: { paddingHorizontal: 16 },

  lock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#F3EEE6',
    marginBottom: 12,
  },
  lockText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: MUTED },

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
  searchInput: { flex: 1, fontSize: 14, color: INK, paddingVertical: 0, outlineStyle: 'none' },

  chips: { gap: 6, paddingBottom: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: INK, borderColor: INK },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 12, fontWeight: '500', color: INK },

  day: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: MUTED,
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  tl: { paddingLeft: 28 },
  rail: { position: 'absolute', left: 11, top: 8, bottom: 16, width: 2, borderRadius: 2, backgroundColor: '#E9E1D6' },
  ev: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  dot: {
    position: 'absolute',
    left: -24,
    top: 16,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: Colors.light.background,
  },
  evTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  evType: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  evTime: { marginLeft: 'auto', fontSize: 11, color: MUTED },
  evBody: { marginTop: 6, marginBottom: 8, gap: 5 },
  evText: { fontSize: 13.5, lineHeight: 19.5, color: INK },
  b: { fontWeight: '600' },
  pills: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  pillFrom: { backgroundColor: '#F3EEE6', color: '#A89F97', textDecorationLine: 'line-through' },
  pillTo: { backgroundColor: '#F6E6DE', color: '#A94F2F' },
  evExtra: { fontSize: 12, color: MUTED },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  av: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  avText: { fontSize: 9.5, fontWeight: '600', color: '#fff' },
  whoText: { flex: 1, fontSize: 11.5, color: MUTED },
  more: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: LINE,
    borderStyle: 'dashed',
  },
  dt: { fontSize: 11, color: MUTED, marginTop: 2 },
  dd: {
    fontSize: 11.5,
    color: INK,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    marginBottom: 4,
  },
});
