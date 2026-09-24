// Support requests, from the approved store-tools preview: an ink count of
// what's open and how long the oldest has waited, search, Open / Resolved /
// All, one row per request with its topic and age, and a sheet with the
// full message, the order it's about, "Reply by email" and "Mark as
// resolved" (with an Undo). The Platform Admin's general inbox is the same
// screen.
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import { db } from '../../firebaseConfig';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { useAdmin } from '../../context/AdminContext';
import { formatOrderNumber, orderNumber } from '../../utils/orderNumber';
import { Colors } from '../../constants/theme';
import Button from '../../components/ui/Button';
import SkeletonBlock from '../../components/ui/Skeleton';
import Sheet from '../../components/shop/Sheet';
import Reveal from '../../components/shop/Reveal';
import { TopBar, OfflineNotice, BigEmpty, UndoToast, useAutoClear } from '../../components/shop/TabScreen';
import Segmented from '../../components/admin/Segmented';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const GOLD = '#8C6D0C';
const ERR = '#B42318';
const LINE = Colors.light.border;
const CARD_LINE = '#EEE7DD';

const HOUR_MS = 60 * 60 * 1000;
// Mirrors AdminOrdersScreen.js's stalled-pending threshold, so "needs
// attention" means the same thing across both admin queues.
const ATTENTION_THRESHOLD_HOURS = 24;
// Past a week the age turns red and gets a warning mark.
const OVERDUE_DAYS = 7;

// A request has no topic field: HelpScreen writes the topic it was sent
// under at the start of the message ("Payment failed: …"), and older
// requests said "I need help with: Payment Failed." Read back out of the
// text here, with the rest of the message shown as the body.
const TOPIC_TONES = [
  { match: /payment|refund|wrong|damag/i, bg: '#FBEDEB', fg: '#8E1B12' },
  { match: /order|deliver|ship|received/i, bg: '#E6ECF3', fg: '#2F4B6B' },
  { match: /account|login|password|address/i, bg: '#EEF0EA', fg: '#37412F' },
];
const PLAIN_TONE = { bg: '#F6EFE3', fg: '#6B5A2E' };

// HelpScreen's TOPICS, so an ordinary "Note: …" opening isn't read as one.
const HELP_TOPICS = ['Order not received', 'Wrong item received', 'Payment failed', 'Account issues', 'Something else'];

function splitTopic(message) {
  const prefixed = HELP_TOPICS.find((t) => message.startsWith(`${t}: `));
  if (prefixed) return { topic: prefixed, body: message.slice(prefixed.length + 2) };
  const legacy = message.match(/need help with:\s*([^.\n]+)/i);
  if (legacy) {
    const t = legacy[1].trim();
    return { topic: t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(), body: message };
  }
  return { topic: 'Support request', body: message };
}
const toneFor = (topic) => TOPIC_TONES.find((t) => t.match.test(topic)) || PLAIN_TONE;

function RowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock style={{ width: 40, height: 40, borderRadius: 13 }} />
      <View style={{ flex: 1, gap: 7 }}>
        <SkeletonBlock style={{ width: '55%', height: 13, borderRadius: 6 }} />
        <SkeletonBlock style={{ width: 80, height: 16, borderRadius: 8 }} />
        <SkeletonBlock style={{ width: '90%', height: 12, borderRadius: 6 }} />
      </View>
    </View>
  );
}

function TopicPill({ topic }) {
  const tone = toneFor(topic);
  return (
    <Text style={[styles.topic, { backgroundColor: tone.bg, color: tone.fg }]} numberOfLines={1}>
      {topic}
    </Text>
  );
}

export default function AdminSupportScreen({ navigation }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestsError, setRequestsError] = useState(false);
  const [activeTab, setActiveTab] = useState('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // Which single request's status write is in flight — one row updating
  // shouldn't lock every other one.
  const [togglingId, setTogglingId] = useState(null);
  // Bumped to tear down and re-subscribe the listener after an error.
  const [retryToken, setRetryToken] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [toast, setToast] = useState(null);
  useAutoClear(toast, () => setToast(null), 4000);
  const { isConnected } = useNetworkStatus();

  // Two inboxes share this screen. A Store Manager answers questions about
  // their own store's orders; the Platform Admin answers general questions,
  // which name no store (storeId null). handlesSupport() in firestore.rules
  // is the real boundary — each query below is filtered to exactly what it
  // admits, because an unfiltered one would be refused whole.
  const { role, storeId } = useAdmin();
  const isPlatformAdmin = role === 'platformAdmin';
  const queueStoreId = isPlatformAdmin ? null : storeId;
  const hasQueue = isPlatformAdmin || Boolean(storeId);

  // Ticks once a minute so ages and the attention check stay accurate
  // through a long session.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // A manager with no store has no queue; the empty state says why.
    if (!hasQueue) {
      setRequests([]);
      setRequestsError(false);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setRequestsError(false);
    // Needs the (storeId, createdAt desc) index in firestore.indexes.json.
    const requestsQuery = query(
      collection(db, 'supportRequests'),
      where('storeId', '==', queueStoreId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        setRequests(
          snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            const message = data.message || '';
            return {
              id: docSnap.id,
              message,
              ...splitTopic(message),
              userEmail: data.userEmail || 'Unknown',
              // Which order the customer was asking about, if any.
              orderId: data.orderId || null,
              status: data.status || 'open',
              date: data.createdAt?.toDate ? data.createdAt.toDate() : null,
            };
          })
        );
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
  }, [retryToken, hasQueue, queueStoreId]);

  const hoursOpen = (request) => (request.date ? Math.max(0, (now - request.date.getTime()) / HOUR_MS) : 0);
  const isAttention = (request) => request.status === 'open' && hoursOpen(request) >= ATTENTION_THRESHOLD_HOURS;
  const isOverdue = (request) => request.status === 'open' && hoursOpen(request) >= OVERDUE_DAYS * 24;

  const ageText = (hours) => {
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${Math.floor(hours)}h`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day' : `${days} days`;
  };
  const ageColor = (request) => (isOverdue(request) ? ERR : isAttention(request) ? GOLD : MOSS);

  const open = requests.filter((r) => r.status === 'open');
  const resolvedCount = requests.length - open.length;
  const oldestHours = open.reduce((max, r) => Math.max(max, hoursOpen(r)), 0);

  const q = searchQuery.trim().toLowerCase();
  const filteredRequests = requests
    .filter((r) => (activeTab === 'all' ? true : r.status === activeTab))
    .filter(
      (r) =>
        !q ||
        r.message.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        r.topic.toLowerCase().includes(q)
    )
    // Open before resolved, then the ones waiting longest first — that's the
    // "which one do I open next" question.
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.status === 'open') return (a.date?.getTime() || 0) - (b.date?.getTime() || 0);
      return (b.date?.getTime() || 0) - (a.date?.getTime() || 0);
    });

  // The sheet keeps showing the last request while it slides away.
  const selected = requests.find((r) => r.id === selectedId) || null;
  const lastSelected = useRef(null);
  if (selected) lastSelected.current = selected;
  const shown = lastSelected.current;

  const setStatus = async (request, status) => {
    setTogglingId(request.id);
    try {
      await updateDoc(doc(db, 'supportRequests', request.id), { status });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (error) {
      console.error('Error updating support request status:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const isNetworkError = !isConnected || error.code === 'unavailable';
      showAppAlert(
        isNetworkError ? 'No internet connection' : 'Not saved',
        isNetworkError ? 'Check your connection and try again.' : 'Could not update this request. Please try again.'
      );
      return false;
    } finally {
      setTogglingId(null);
    }
  };

  // No confirmation first: the Undo in the toast is the safety net, and
  // this is done dozens of times a day.
  const resolve = async (request) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (await setStatus(request, 'resolved')) {
      setSelectedId(null);
      setToast({ text: 'Marked as resolved', undo: request });
    }
  };

  const reopen = async (request, fromUndo) => {
    setToast(null);
    if ((await setStatus(request, 'open')) && !fromUndo) {
      setSelectedId(null);
      setToast({ text: 'Request reopened' });
    }
  };

  const replyByEmail = async (request) => {
    const url = `mailto:${request.userEmail}?subject=${encodeURIComponent(`Re: ${request.topic}`)}`;
    try {
      await Linking.openURL(url);
    } catch {
      showAppAlert('No email app found', `Reply to ${request.userEmail} from any email app.`);
    }
  };

  const openOrder = (request) => {
    setSelectedId(null);
    navigation.navigate('AdminOrders', { search: orderNumber(request.orderId) });
  };

  const empty = q
    ? { icon: 'search-outline', title: 'No matches', text: 'Try another search.' }
    : activeTab === 'open'
      ? { icon: 'checkmark-done-outline', title: 'Inbox zero', text: 'No open requests. Nice work.' }
      : activeTab === 'resolved'
        ? { icon: 'chatbubbles-outline', title: 'Nothing here', text: 'Resolved requests show up here.' }
        : { icon: 'chatbubbles-outline', title: 'No support requests', text: 'Requests from customers appear here.' };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar
        title={isPlatformAdmin ? 'General support' : 'Support requests'}
        onBack={() => navigation.goBack()}
        stuck={stuck}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        onScroll={(e) => setStuck(e.nativeEvent.contentOffset.y > 4)}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
      >
        {!isConnected ? <OfflineNotice>No internet connection. Requests may be out of date.</OfflineNotice> : null}

        <View style={styles.pad}>
          {!hasQueue ? (
            <BigEmpty
              icon="storefront-outline"
              title="No store assigned"
              text="Your account isn't assigned to a store yet. Ask a Platform Admin to assign you one in Manage Users."
            />
          ) : requestsError ? (
            <BigEmpty
              icon="cloud-offline-outline"
              title="Couldn't load requests"
              text="Check your connection and try again."
              actionLabel="Try again"
              onAction={() => setRetryToken((t) => t + 1)}
            />
          ) : (
            <>
              <Reveal delay={20} style={styles.sum}>
                <View style={[styles.sumCard, styles.sumInk]}>
                  <Text style={styles.sumNum}>{loading ? '–' : open.length}</Text>
                  <Text style={styles.sumNote}>
                    open request{open.length === 1 ? '' : 's'}
                    {!loading && open.length ? (
                      <>
                        {' · oldest waiting '}
                        <Text style={{ color: '#F0B79E' }}>{ageText(oldestHours)}</Text>
                      </>
                    ) : null}
                  </Text>
                </View>
                <View style={[styles.sumCard, styles.sumPlain]}>
                  <Text style={[styles.sumNum, { color: INK }]}>{loading ? '–' : resolvedCount}</Text>
                  <Text style={[styles.sumNote, { color: MUTED }]}>resolved</Text>
                </View>
              </Reveal>

              <Reveal delay={60}>
                <View style={[styles.search, searchFocused && styles.searchFocused]}>
                  <Ionicons name="search-outline" size={18} color={MUTED} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search message, topic or email"
                    placeholderTextColor={MUTED}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    accessibilityLabel="Search support requests by message, topic or email"
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

              <Segmented
                items={[
                  { key: 'open', label: 'Open', count: loading ? '–' : open.length },
                  { key: 'resolved', label: 'Resolved', count: loading ? '–' : resolvedCount },
                  { key: 'all', label: 'All', count: loading ? '–' : requests.length },
                ]}
                value={activeTab}
                onChange={setActiveTab}
              />

              {loading ? (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              ) : filteredRequests.length === 0 ? (
                <BigEmpty {...empty} />
              ) : (
                filteredRequests.map((request, index) => {
                  const isOpen = request.status === 'open';
                  const overdue = isOverdue(request);
                  return (
                    <Reveal key={request.id} delay={Math.min(index, 8) * 50}>
                      <Pressable
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSelectedId(request.id);
                        }}
                        style={({ pressed }) => [
                          styles.row,
                          !isOpen && styles.rowResolved,
                          pressed && { transform: [{ scale: 0.985 }] },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${isOpen ? 'Open' : 'Resolved'} request, ${request.topic}, from ${request.userEmail}${isOpen ? `, waiting ${ageText(hoursOpen(request))}` : ''}${overdue ? ', over a week' : ''}`}
                        accessibilityHint="Opens the request"
                      >
                        <View style={[styles.av, { backgroundColor: isOpen ? INK : '#B3AAA0' }]}>
                          <Text style={styles.avText}>{request.userEmail.charAt(0).toUpperCase()}</Text>
                          {isOpen ? <View style={styles.avDot} /> : null}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.r1}>
                            <Text style={styles.email} numberOfLines={1}>
                              {request.userEmail}
                            </Text>
                            <View style={styles.age}>
                              {overdue ? <Ionicons name="warning" size={11} color={ERR} /> : null}
                              <Text style={[styles.ageText, { color: isOpen ? ageColor(request) : '#A89F97' }]}>
                                {isOpen ? ageText(hoursOpen(request)) : 'Resolved'}
                              </Text>
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row' }}>
                            <TopicPill topic={request.topic} />
                          </View>
                          <Text style={styles.preview} numberOfLines={2}>
                            {request.body}
                          </Text>
                        </View>
                      </Pressable>
                    </Reveal>
                  );
                })
              )}
            </>
          )}
        </View>
      </ScrollView>

      <UndoToast
        text={toast?.text}
        lift={-40}
        onUndo={toast?.undo ? () => reopen(toast.undo, true) : undefined}
        undoLabel="Undo resolve"
      />

      <Sheet visible={Boolean(selected)} onClose={() => setSelectedId(null)} locked={Boolean(togglingId)}>
        {shown ? (
          <View>
            <Text style={styles.dsTitle}>{shown.topic}</Text>
            <View style={styles.meta}>
              <Text
                style={[
                  styles.status,
                  shown.status === 'open'
                    ? { backgroundColor: '#F6EFE3', color: '#6B5A2E' }
                    : { backgroundColor: '#EEF0EA', color: '#37412F' },
                ]}
              >
                {shown.status === 'open' ? 'Open' : 'Resolved'}
              </Text>
              <Text style={styles.metaText}>
                {shown.date
                  ? `Sent ${shown.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${
                      hoursOpen(shown) < 1 ? ' · just now' : ` · ${ageText(hoursOpen(shown))} ago`
                    }`
                  : 'Sending…'}
              </Text>
            </View>
            {isOverdue(shown) ? <Text style={styles.overdue}>Waiting longer than a week</Text> : null}

            <View style={styles.msg}>
              <View style={styles.msgTail} />
              <Text style={styles.msgText} selectable>
                {shown.message}
              </Text>
            </View>

            <View style={styles.info}>
              <View style={styles.infoCell}>
                <Text style={styles.infoLabel}>From</Text>
                <Text style={styles.infoValue} selectable numberOfLines={2}>
                  {shown.userEmail}
                </Text>
              </View>
              <View style={styles.infoCell}>
                <Text style={styles.infoLabel}>Order</Text>
                {shown.orderId && !isPlatformAdmin ? (
                  <Pressable
                    onPress={() => openOrder(shown)}
                    hitSlop={8}
                    accessibilityRole="link"
                    accessibilityLabel={`Open order ${formatOrderNumber(shown.orderId)}`}
                  >
                    <Text style={[styles.infoValue, { color: CLAY }]}>{formatOrderNumber(shown.orderId)}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.infoValue}>
                    {shown.orderId ? formatOrderNumber(shown.orderId) : 'Not linked'}
                  </Text>
                )}
              </View>
            </View>

            {shown.userEmail !== 'Unknown' ? (
              <Pressable
                onPress={() => replyByEmail(shown)}
                style={({ pressed }) => [styles.reply, pressed && { transform: [{ scale: 0.97 }] }]}
                accessibilityRole="button"
                accessibilityLabel={`Reply by email to ${shown.userEmail}`}
              >
                <Ionicons name="mail-outline" size={18} color={INK} />
                <Text style={styles.replyText}>Reply by email</Text>
              </Pressable>
            ) : null}

            {shown.status === 'open' ? (
              <>
                <Button
                  variant="success"
                  label={isConnected ? 'Mark as resolved' : 'Offline'}
                  onPress={() => resolve(shown)}
                  loading={togglingId === shown.id}
                  disabled={Boolean(togglingId) || !isConnected}
                />
                <Text style={styles.note}>
                  Only the status changes. The customer&apos;s message stays as they wrote it.
                </Text>
              </>
            ) : (
              <Pressable
                onPress={() => reopen(shown)}
                disabled={Boolean(togglingId) || !isConnected}
                style={styles.ghost}
                accessibilityRole="button"
              >
                <Text style={styles.ghostText}>{togglingId === shown.id ? 'Reopening…' : 'Reopen request'}</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scroll: { paddingBottom: 40 },
  pad: { paddingHorizontal: 16 },

  sum: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sumCard: { borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14 },
  sumInk: { flex: 1.2, backgroundColor: INK },
  sumPlain: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: CARD_LINE },
  sumNum: { fontSize: 22, fontWeight: '600', lineHeight: 26, color: Colors.light.background },
  sumNote: { fontSize: 11, color: '#BDB3A9', marginTop: 1 },

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

  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginBottom: 8,
  },
  rowResolved: { backgroundColor: '#FBF9F5' },
  av: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  avText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  avDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: CLAY,
    borderWidth: 2,
    borderColor: '#fff',
  },
  r1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  email: { flex: 1, fontSize: 13, fontWeight: '600', color: INK },
  age: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ageText: { fontSize: 11, fontWeight: '600' },
  topic: {
    fontSize: 10.5,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    marginVertical: 5,
    maxWidth: '100%',
  },
  preview: { fontSize: 12.5, lineHeight: 18, color: MUTED },

  dsTitle: { fontSize: 18, fontWeight: '600', color: INK },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12, flexWrap: 'wrap' },
  status: {
    fontSize: 10.5,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  metaText: { fontSize: 12, color: MUTED },
  overdue: { fontSize: 12, fontWeight: '600', color: ERR, marginTop: -6, marginBottom: 12 },
  msg: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  msgTail: {
    position: 'absolute',
    left: 18,
    top: -7,
    width: 12,
    height: 12,
    backgroundColor: '#fff',
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: CARD_LINE,
    transform: [{ rotate: '45deg' }],
  },
  msgText: { fontSize: 13.5, lineHeight: 21, color: INK },
  info: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  infoCell: { flex: 1, backgroundColor: '#F3EEE6', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  infoLabel: { fontSize: 10.5, color: MUTED },
  infoValue: { fontSize: 12.5, fontWeight: '600', color: INK },
  reply: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  replyText: { fontSize: 15, fontWeight: '600', color: INK },
  note: { fontSize: 11.5, color: MUTED, textAlign: 'center', marginTop: 10 },
  ghost: { height: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: MUTED },
});
