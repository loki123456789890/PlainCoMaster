// Reported problems — the Store Manager's queue of return and refund
// requests, built like the Support queue: a count of what is waiting on
// the manager, To do / Waiting / Closed, one row per report with its next
// step, and a sheet with the customer's photos, note, items, the refund
// and the one action the report's status allows next.
//
// Every write here is a single status step that firestore.rules checks
// (users/{uid}/returnRequests): approve choosing refund-only or
// return-first, decline with a reason, mark the item received (optionally
// putting it back in stock, in the same transaction), mark refunded with a
// reference. The amount, items, photos and payout account are read-only to
// everyone after the customer sends the report.
//
// Refunds are not sent from here. The manager pays the customer's GCash or
// bank account (COD) or refunds the PayMongo payment from its dashboard,
// then records the reference — and the customer is emailed it.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import {
  collectionGroup,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  runTransaction,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { useAdmin } from '../../context/AdminContext';
import { showAppAlert } from '../../utils/appAlert';
import { logStoreActivity, ACTIONS } from '../../utils/activityLog';
import { parseStock, totalQuantityByProductId } from '../../utils/stock';
import { formatOrderNumber, orderNumber } from '../../utils/orderNumber';
import { reasonLabel } from '../../constants/returns';
import { getPaymentLabel } from '../../constants/payment';
import { Colors } from '../../constants/theme';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import SkeletonBlock from '../../components/ui/Skeleton';
import ProductImage from '../../components/ui/ProductImage';
import Sheet from '../../components/shop/Sheet';
import Reveal from '../../components/shop/Reveal';
import PhotoViewer from '../../components/shop/PhotoViewer';
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
const SOFT = '#F3EEE6';

const HOUR_MS = 60 * 60 * 1000;
// A report waiting this long for a decision turns gold, then red past
// OVERDUE — the customer was told the store would look at it, and the
// 7-day window they reported in is the same span they will expect an
// answer in.
const ATTENTION_HOURS = 24;
const OVERDUE_HOURS = 72;

const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

// What the manager does next with each report, which decides the tab it
// sits in and the words on its row.
function nextStep(report) {
  switch (report.status) {
    case 'requested':
      return { tab: 'todo', label: 'Decide', color: CLAY };
    case 'approved':
      return report.resolution === 'return_first'
        ? { tab: 'waiting', label: 'Waiting for the item', color: MUTED }
        : { tab: 'todo', label: 'Send refund', color: GOLD };
    case 'received':
      return { tab: 'todo', label: 'Send refund', color: GOLD };
    case 'refunded':
      return { tab: 'closed', label: 'Refunded', color: MOSS };
    case 'declined':
      return { tab: 'closed', label: 'Declined', color: MUTED };
    case 'withdrawn':
      return { tab: 'closed', label: 'Withdrawn', color: MUTED };
    default:
      return { tab: 'closed', label: report.status || 'Unknown', color: MUTED };
  }
}

const owesRefund = (report) =>
  report.status === 'received' || (report.status === 'approved' && report.resolution !== 'return_first');

function toReport(docSnap) {
  const data = docSnap.data();
  return {
    ...data,
    id: docSnap.id,
    ref: docSnap.ref,
    orderId: data.orderId || docSnap.id,
    items: Array.isArray(data.items) ? data.items : [],
    photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
    customerEmail: data.customerEmail && data.customerEmail !== 'unknown' ? data.customerEmail : 'No email',
    date: data.createdAt?.toDate ? data.createdAt.toDate() : null,
  };
}

const itemsLine = (items) =>
  items.map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name)).join(', ');

function RowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock style={{ width: 48, height: 48, borderRadius: 13 }} />
      <View style={{ flex: 1, gap: 7 }}>
        <SkeletonBlock style={{ width: '55%', height: 13, borderRadius: 6 }} />
        <SkeletonBlock style={{ width: 90, height: 16, borderRadius: 8 }} />
        <SkeletonBlock style={{ width: '80%', height: 12, borderRadius: 6 }} />
      </View>
    </View>
  );
}

export default function AdminReturnsScreen({ navigation }) {
  const { storeId } = useAdmin();
  const { isConnected } = useNetworkStatus();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [activeTab, setActiveTab] = useState('todo');
  const [stuck, setStuck] = useState(false);

  const [selectedId, setSelectedId] = useState(null);
  // What the sheet is asking: the report itself, or one of the steps.
  const [mode, setMode] = useState('view');
  const [resolution, setResolution] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [restock, setRestock] = useState(false);
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [toast, setToast] = useState(null);
  useAutoClear(toast, () => setToast(null), 4000);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!storeId) {
      setReports([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setLoadError(false);
    // Every customer's reports as one collection group, filtered to this
    // store — the rules refuse anything wider. Uses the (storeId,
    // createdAt desc) collection-group index in firestore.indexes.json.
    return onSnapshot(
      query(collectionGroup(db, 'returnRequests'), where('storeId', '==', storeId), orderBy('createdAt', 'desc')),
      (snapshot) => {
        setReports(snapshot.docs.map(toReport));
        setLoadError(false);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching problem reports:', error);
        setLoadError(true);
        setLoading(false);
      }
    );
  }, [storeId, retryToken]);

  const hoursWaiting = (report) => (report.date ? Math.max(0, (now - report.date.getTime()) / HOUR_MS) : 0);
  const ageText = (hours) => {
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${Math.floor(hours)}h`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day' : `${days} days`;
  };
  const ageColor = (report) => {
    if (report.status !== 'requested') return MUTED;
    const hours = hoursWaiting(report);
    return hours >= OVERDUE_HOURS ? ERR : hours >= ATTENTION_HOURS ? GOLD : MOSS;
  };

  const byTab = { todo: [], waiting: [], closed: [] };
  reports.forEach((report) => byTab[nextStep(report).tab].push(report));
  // Oldest first while something is owed, so the longest wait is on top;
  // newest first once closed.
  byTab.todo.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  byTab.waiting.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  const toDecide = byTab.todo.filter((r) => r.status === 'requested');
  const oldestToDecide = toDecide.reduce((max, r) => Math.max(max, hoursWaiting(r)), 0);
  const owed = reports.filter(owesRefund).reduce((sum, r) => sum + Number(r.refundAmount || 0), 0);
  const visible = byTab[activeTab];

  // The sheet keeps showing the last report while it slides away.
  const selected = reports.find((r) => r.id === selectedId) || null;
  const lastSelected = useRef(null);
  if (selected) lastSelected.current = selected;
  const shown = lastSelected.current;

  const open = (report) => {
    Haptics.selectionAsync();
    setSelectedId(report.id);
    setMode('view');
    setResolution(null);
    setDeclineReason('');
    setRestock(false);
    setReference('');
  };
  const close = () => {
    if (saving) return;
    setSelectedId(null);
  };

  const log = (report, summary) =>
    logStoreActivity({
      storeId,
      action: ACTIONS.RETURN_STATUS,
      targetId: report.orderId,
      targetLabel: `Order ${formatOrderNumber(report.orderId)}`,
      summary: `Order ${formatOrderNumber(report.orderId)} — ${summary}`,
    });

  // One status step. `write` does the Firestore part; the rest — haptics,
  // the log, the toast, what an error says — is the same for every step.
  const step = async (report, write, { logSummary, toastText }) => {
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await write();
      log(report, logSummary);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelectedId(null);
      setToast({ text: toastText });
    } catch (error) {
      console.error('Error updating problem report:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const offline = !isConnected || error.code === 'unavailable';
      showAppAlert(
        offline ? 'No internet connection' : 'Not saved',
        offline
          ? 'Check your connection and try again.'
          : error.code === 'permission-denied' || error.code === 'failed-precondition'
            ? 'This report has changed since you opened it — the customer may have withdrawn it. Close it and look again.'
            : 'Could not update this report. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const approve = (report) =>
    step(
      report,
      () => updateDoc(report.ref, { status: 'approved', resolution, decidedAt: serverTimestamp() }),
      {
        logSummary: `problem approved, ${resolution === 'return_first' ? 'return first' : 'refund only'} (${peso(report.refundAmount)})`,
        toastText: resolution === 'return_first' ? 'Approved. The customer will send it back.' : 'Approved. Send the refund next.',
      }
    );

  const decline = (report) =>
    step(
      report,
      () => updateDoc(report.ref, { status: 'declined', declineReason: declineReason.trim(), decidedAt: serverTimestamp() }),
      { logSummary: 'problem declined', toastText: 'Declined. The customer has been told why.' }
    );

  // Putting the piece back on sale happens in the same transaction as the
  // status, like a cancellation's stock restore: the rules allow
  // "received" once, so the stock can only come back once.
  const receive = (report) =>
    step(
      report,
      () =>
        runTransaction(db, async (transaction) => {
          // Read inside the transaction, not taken from the screen: the
          // listener may be a moment behind, and the stock decision has to
          // be made on what the report says now.
          const snap = await transaction.get(report.ref);
          const current = snap.exists() ? snap.data() : null;
          if (!current || current.status !== 'approved' || current.resolution !== 'return_first') {
            const error = new Error('Report changed');
            error.code = 'failed-precondition';
            throw error;
          }
          if (restock) {
            const quantities = totalQuantityByProductId(
              (current.items || []).filter((item) => item.productId),
              (item) => item.productId
            );
            const productIds = Array.from(quantities.keys());
            const productRefs = productIds.map((id) => doc(db, 'products', id));
            const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));
            productSnaps.forEach((productSnap, index) => {
              // A product deleted since has nowhere to go back to.
              if (!productSnap.exists()) return;
              const quantity = quantities.get(productIds[index]);
              transaction.update(productRefs[index], { stock: parseStock(productSnap.data().stock) + quantity });
            });
          }
          transaction.update(report.ref, { status: 'received', receivedAt: serverTimestamp(), restocked: restock });
        }),
      {
        logSummary: restock ? 'returned item received, put back in stock' : 'returned item received',
        toastText: restock ? 'Received and back in stock. Send the refund next.' : 'Received. Send the refund next.',
      }
    );

  const markRefunded = (report) =>
    step(
      report,
      () =>
        updateDoc(report.ref, { status: 'refunded', refundReference: reference.trim(), refundedAt: serverTimestamp() }),
      {
        logSummary: `refund of ${peso(report.refundAmount)} sent, reference ${reference.trim()}`,
        toastText: 'Refund recorded. The customer has the reference.',
      }
    );

  const copy = async (text, what) => {
    try {
      await Clipboard.setStringAsync(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToast({ text: `${what} copied` });
    } catch (error) {
      console.error('Could not copy:', error);
    }
  };

  const openChat = (report) => {
    setSelectedId(null);
    navigation.navigate('OrderChat', {
      customerId: report.customerId,
      orderId: report.orderId,
      side: 'store',
      title: report.customerEmail,
    });
  };

  const openOrder = (report) => {
    setSelectedId(null);
    navigation.navigate('AdminOrders', { search: orderNumber(report.orderId) });
  };

  const empty = {
    todo: { icon: 'checkmark-done-outline', title: 'Nothing to do', text: 'No problems waiting on you.' },
    waiting: { icon: 'cube-outline', title: 'Nothing on its way back', text: 'Returns you approve as "return first" wait here until the item arrives.' },
    closed: { icon: 'archive-outline', title: 'Nothing closed yet', text: 'Refunded, declined and withdrawn reports show up here.' },
  }[activeTab];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TopBar title="Returns & refunds" onBack={() => navigation.goBack()} stuck={stuck} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        onScroll={(e) => setStuck(e.nativeEvent.contentOffset.y > 4)}
        scrollEventThrottle={32}
      >
        {!isConnected ? <OfflineNotice>No internet connection. Reports may be out of date.</OfflineNotice> : null}

        <View style={styles.pad}>
          {!storeId ? (
            <BigEmpty
              icon="storefront-outline"
              title="No store assigned"
              text="Your account isn't assigned to a store yet. Ask a Platform Admin to assign you one in Manage Users."
            />
          ) : loadError ? (
            <BigEmpty
              icon="cloud-offline-outline"
              title="Couldn't load reports"
              text="Check your connection and try again."
              actionLabel="Try again"
              onAction={() => setRetryToken((t) => t + 1)}
            />
          ) : (
            <>
              <Reveal delay={20} style={styles.sum}>
                <View style={[styles.sumCard, styles.sumInk]}>
                  <Text style={styles.sumNum}>{loading ? '–' : toDecide.length}</Text>
                  <Text style={styles.sumNote}>
                    to decide
                    {!loading && toDecide.length ? (
                      <>
                        {' · oldest '}
                        <Text style={{ color: '#F0B79E' }}>{ageText(oldestToDecide)}</Text>
                      </>
                    ) : null}
                  </Text>
                </View>
                <View style={[styles.sumCard, styles.sumPlain]}>
                  <Text style={[styles.sumNum, { color: GOLD }]} numberOfLines={1} adjustsFontSizeToFit>
                    {loading ? '–' : peso(owed)}
                  </Text>
                  <Text style={[styles.sumNote, { color: MUTED }]}>approved, still to refund</Text>
                </View>
              </Reveal>

              <Segmented
                items={[
                  { key: 'todo', label: 'To do', count: loading ? '–' : byTab.todo.length },
                  { key: 'waiting', label: 'Waiting', count: loading ? '–' : byTab.waiting.length },
                  { key: 'closed', label: 'Closed', count: loading ? '–' : byTab.closed.length },
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
              ) : visible.length === 0 ? (
                <BigEmpty {...empty} />
              ) : (
                visible.map((report, index) => {
                  const next = nextStep(report);
                  const first = report.items[0];
                  return (
                    <Reveal key={report.id} delay={Math.min(index, 8) * 50}>
                      <Pressable
                        onPress={() => open(report)}
                        style={({ pressed }) => [
                          styles.row,
                          next.tab === 'closed' && styles.rowClosed,
                          pressed && { transform: [{ scale: 0.985 }] },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${reasonLabel(report.reason)}, order ${formatOrderNumber(report.orderId)}, ${peso(report.refundAmount)}, ${next.label}`}
                        accessibilityHint="Opens the report"
                      >
                        {first?.image ? (
                          <ProductImage uri={first.image} style={styles.thumb} />
                        ) : (
                          <View style={[styles.thumb, styles.thumbEmpty]}>
                            <Ionicons name="shirt-outline" size={20} color={MUTED} />
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={styles.r1}>
                            <Text style={styles.rowTitle} numberOfLines={1}>{reasonLabel(report.reason)}</Text>
                            <Text style={[styles.ageText, { color: ageColor(report) }]}>{ageText(hoursWaiting(report))}</Text>
                          </View>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {`${formatOrderNumber(report.orderId)} · ${itemsLine(report.items)}`}
                          </Text>
                          <View style={styles.r3}>
                            <Text style={[styles.nextPill, { color: next.color, backgroundColor: `${next.color}18` }]}>
                              {next.label}
                            </Text>
                            <Text style={styles.rowAmount}>{peso(report.refundAmount)}</Text>
                          </View>
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

      <UndoToast text={toast?.text} lift={-40} />

      <Sheet visible={Boolean(selected)} onClose={close} locked={saving}>
        {shown ? (
          <ReportSheet
            report={shown}
            mode={mode}
            setMode={setMode}
            resolution={resolution}
            setResolution={setResolution}
            declineReason={declineReason}
            setDeclineReason={setDeclineReason}
            restock={restock}
            setRestock={setRestock}
            reference={reference}
            setReference={setReference}
            saving={saving}
            isConnected={isConnected}
            onApprove={() => approve(shown)}
            onDecline={() => decline(shown)}
            onReceive={() => receive(shown)}
            onRefunded={() => markRefunded(shown)}
            onCopy={copy}
            onChat={() => openChat(shown)}
            onOrder={() => openOrder(shown)}
            onPhoto={(index) => setViewing({ report: shown, index })}
          />
        ) : null}
      </Sheet>

      <PhotoViewer
        visible={viewing !== null}
        photos={(viewing?.report.photoUrls || []).map((url, i, all) => ({
          url,
          label: `Customer photo ${i + 1} of ${all.length}`,
        }))}
        initialIndex={viewing?.index ?? 0}
        productName={viewing ? itemsLine(viewing.report.items) : 'this item'}
        onClose={() => setViewing(null)}
      />
    </SafeAreaView>
  );
}

// The report in full, and below it the one step its status allows. Each
// step opens its own small form in place (mode), so a decision is two
// deliberate taps rather than one accidental one.
function ReportSheet({
  report,
  mode,
  setMode,
  resolution,
  setResolution,
  declineReason,
  setDeclineReason,
  restock,
  setRestock,
  reference,
  setReference,
  saving,
  isConnected,
  onApprove,
  onDecline,
  onReceive,
  onRefunded,
  onCopy,
  onChat,
  onOrder,
  onPhoto,
}) {
  const next = nextStep(report);
  const payout = report.payout;
  const paidOnline = report.refundMethod === 'original';
  const go = (m) => {
    Haptics.selectionAsync();
    setMode(m);
  };
  const offlineLabel = (label) => (isConnected ? label : 'Offline');

  return (
    <View>
      <Text style={styles.dsTitle}>{reasonLabel(report.reason)}</Text>
      <View style={styles.meta}>
        <Text style={[styles.nextPill, { color: next.color, backgroundColor: `${next.color}18` }]}>{next.label}</Text>
        <Pressable onPress={onOrder} hitSlop={8} accessibilityRole="link">
          <Text style={[styles.metaText, { color: CLAY, fontWeight: '600' }]}>{formatOrderNumber(report.orderId)}</Text>
        </Pressable>
        <Text style={styles.metaText}>
          {report.date ? `Reported ${report.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Sending…'}
        </Text>
      </View>

      {report.photoUrls.length ? (
        <View style={styles.photos}>
          {report.photoUrls.map((url, i) => (
            <Pressable
              key={url}
              onPress={() => onPhoto(i)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Customer photo ${i + 1} of ${report.photoUrls.length}, opens full screen`}
            >
              <ProductImage uri={url} style={styles.photo} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {report.note ? (
        <View style={styles.msg}>
          <Text style={styles.msgText} selectable>{report.note}</Text>
        </View>
      ) : null}

      <View style={styles.items}>
        {report.items.map((item) => (
          <View key={`${item.index}-${item.productId}`} style={styles.itemRow}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.name}
              <Text style={styles.itemMeta}>{[item.size, item.color].filter(Boolean).length ? `  ${[item.size, item.color].filter(Boolean).join(' · ')}` : ''}</Text>
            </Text>
            <Text style={styles.itemQty}>×{item.quantity}</Text>
            <Text style={styles.itemPrice}>{peso(Number(item.price) * Number(item.quantity))}</Text>
          </View>
        ))}
        <View style={[styles.itemRow, styles.itemTotal]}>
          <Text style={[styles.itemName, { fontWeight: '600' }]}>{report.status === 'refunded' ? 'Refunded' : 'Refund'}</Text>
          <Text style={styles.totalValue}>{peso(report.refundAmount)}</Text>
        </View>
      </View>

      {/* Where the money goes. In full here, and nowhere else: the emails
          show the last four digits only. */}
      <View style={styles.info}>
        <Text style={styles.infoLabel}>Refund to</Text>
        {paidOnline ? (
          <Text style={styles.infoValue}>
            {`Back to the customer's ${getPaymentLabel(report.paymentMethod)} payment. Refund it from the PayMongo dashboard.`}
          </Text>
        ) : payout ? (
          <>
            <Text style={styles.infoValue} selectable>
              {payout.method === 'bank' ? `${payout.bankName} · ${payout.accountName}` : `GCash · ${payout.accountName}`}
            </Text>
            <Pressable
              onPress={() => onCopy(payout.accountNumber, 'Account number')}
              style={styles.copyRow}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Copy account number ${payout.accountNumber}`}
            >
              <Text style={styles.accountNumber} selectable>{payout.accountNumber}</Text>
              <Ionicons name="copy-outline" size={14} color={CLAY} />
            </Pressable>
          </>
        ) : (
          <Text style={styles.infoValue}>Not given</Text>
        )}
        {report.status === 'refunded' && report.refundReference ? (
          <Text style={[styles.infoValue, { marginTop: 6 }]} selectable>{`Reference ${report.refundReference}`}</Text>
        ) : null}
        {report.status === 'declined' && report.declineReason ? (
          <Text style={[styles.infoValue, { marginTop: 6, fontWeight: '400' }]}>{`You said: ${report.declineReason}`}</Text>
        ) : null}
        {report.status === 'received' || report.status === 'refunded' ? (
          report.restocked ? <Text style={styles.infoSub}>Put back in stock when it arrived.</Text> : null
        ) : null}
      </View>

      <Pressable
        onPress={onChat}
        style={({ pressed }) => [styles.reply, pressed && { transform: [{ scale: 0.97 }] }]}
        accessibilityRole="button"
        accessibilityLabel={`Message ${report.customerEmail} about this order`}
      >
        <Ionicons name="chatbubble-outline" size={18} color={INK} />
        <Text style={styles.replyText}>Message the customer</Text>
      </Pressable>

      {/* The next step, by status. */}
      {report.status === 'requested' && mode === 'view' ? (
        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label="Decline" fontSize={15.5} onPress={() => go('decline')} disabled={!isConnected} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Approve" fontSize={15.5} onPress={() => go('approve')} disabled={!isConnected} />
          </View>
        </View>
      ) : null}

      {report.status === 'requested' && mode === 'approve' ? (
        <View>
          <Text style={styles.formTitle}>How should it be refunded?</Text>
          {[
            ['refund_only', 'Refund only', 'They keep the item. Best when sending it back costs more than it is worth.'],
            ['return_first', 'Return first', 'They send it back, the store pays the shipping, and you refund when it arrives.'],
          ].map(([key, title, text]) => {
            const on = resolution === key;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  Haptics.selectionAsync();
                  setResolution(key);
                }}
                style={[styles.option, on && styles.optionOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${title}. ${text}`}
              >
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>{title}</Text>
                  <Text style={styles.optionText}>{text}</Text>
                </View>
              </Pressable>
            );
          })}
          <Button
            label={offlineLabel(resolution === 'return_first' ? 'Approve the return' : `Approve ${peso(report.refundAmount)} refund`)}
            fontSize={15.5}
            onPress={onApprove}
            loading={saving}
            disabled={!resolution || saving || !isConnected}
            style={{ marginTop: 6 }}
          />
          <Text style={styles.note}>The customer is emailed straight away.</Text>
          <BackLink onPress={() => go('view')} disabled={saving} />
        </View>
      ) : null}

      {report.status === 'requested' && mode === 'decline' ? (
        <View>
          <Text style={styles.formTitle}>Why not?</Text>
          <Input
            value={declineReason}
            onChangeText={(text) => setDeclineReason(text.slice(0, 500))}
            placeholder="e.g. The tag in your second photo says Medium, the size you ordered."
            multiline
            style={{ minHeight: 88, textAlignVertical: 'top', fontSize: 14 }}
            maxLength={500}
          />
          <Button
            variant="danger"
            label={offlineLabel('Decline report')}
            fontSize={15.5}
            onPress={onDecline}
            loading={saving}
            disabled={!declineReason.trim() || saving || !isConnected}
          />
          <Text style={styles.note}>The customer is emailed your reason, word for word.</Text>
          <BackLink onPress={() => go('view')} disabled={saving} />
        </View>
      ) : null}

      {report.status === 'approved' && report.resolution === 'return_first' ? (
        mode === 'receive' ? (
          <View>
            <Text style={styles.formTitle}>Did the item come back?</Text>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setRestock((value) => !value);
              }}
              style={[styles.option, restock && styles.optionOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: restock }}
            >
              <View style={[styles.check, restock && styles.checkOn]}>
                {restock ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Put it back in stock</Text>
                <Text style={styles.optionText}>
                  Only if it can be sold again as listed. A damaged piece should stay off the shop.
                </Text>
              </View>
            </Pressable>
            <Button
              variant="success"
              label={offlineLabel('Mark received')}
              fontSize={15.5}
              onPress={onReceive}
              loading={saving}
              disabled={saving || !isConnected}
            />
            <BackLink onPress={() => go('view')} disabled={saving} />
          </View>
        ) : (
          <>
            <Button variant="success" label="Item arrived" fontSize={15.5} onPress={() => go('receive')} disabled={!isConnected} />
            <Text style={styles.note}>Waiting for the customer to send it back.</Text>
          </>
        )
      ) : null}

      {owesRefund(report) ? (
        mode === 'refund' ? (
          <View>
            <Text style={styles.formTitle}>{`Sent ${peso(report.refundAmount)}?`}</Text>
            <Input
              label={paidOnline ? 'PayMongo refund reference' : `${payout?.method === 'bank' ? 'Bank' : 'GCash'} reference number`}
              value={reference}
              onChangeText={(text) => setReference(text.slice(0, 100))}
              placeholder="As shown on the transfer"
              autoCapitalize="characters"
              maxLength={100}
            />
            <Button
              variant="success"
              label={offlineLabel('Mark refunded')}
              fontSize={15.5}
              onPress={onRefunded}
              loading={saving}
              disabled={!reference.trim() || saving || !isConnected}
            />
            <Text style={styles.note}>The customer is emailed this reference so they can check it arrived.</Text>
            <BackLink onPress={() => go('view')} disabled={saving} />
          </View>
        ) : (
          <>
            <Button label="I've sent the refund" fontSize={15.5} onPress={() => go('refund')} disabled={!isConnected} />
            <Text style={styles.note}>
              {paidOnline
                ? 'Refund the payment from the PayMongo dashboard first, then record it here.'
                : 'Send it to the account above first, then record the reference here.'}
            </Text>
          </>
        )
      ) : null}
    </View>
  );
}

function BackLink({ onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={styles.ghost} accessibilityRole="button">
      <Text style={styles.ghostText}>Back</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scroll: { paddingBottom: 40 },
  pad: { paddingHorizontal: 16 },

  sum: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sumCard: { borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14 },
  sumInk: { flex: 1, backgroundColor: INK },
  sumPlain: { flex: 1.2, backgroundColor: '#fff', borderWidth: 1, borderColor: CARD_LINE },
  sumNum: { fontSize: 22, fontWeight: '600', lineHeight: 26, color: Colors.light.background, fontVariant: ['tabular-nums'] },
  sumNote: { fontSize: 11, color: '#BDB3A9', marginTop: 1 },

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
  rowClosed: { backgroundColor: '#FBF9F5' },
  thumb: { width: 48, height: 48, borderRadius: 13, backgroundColor: LINE },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  r1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { flex: 1, fontSize: 13.5, fontWeight: '600', color: INK },
  ageText: { fontSize: 11, fontWeight: '600' },
  rowMeta: { fontSize: 12, color: MUTED, marginTop: 2 },
  r3: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  nextPill: {
    fontSize: 10.5,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  rowAmount: { fontSize: 13, fontWeight: '600', color: GOLD, fontVariant: ['tabular-nums'] },

  dsTitle: { fontSize: 18, fontWeight: '600', color: INK },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12, flexWrap: 'wrap' },
  metaText: { fontSize: 12, color: MUTED },
  photos: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  photo: { width: 88, height: 88, borderRadius: 14, backgroundColor: LINE },
  msg: { backgroundColor: '#fff', borderWidth: 1, borderColor: CARD_LINE, borderRadius: 16, padding: 12, marginBottom: 12 },
  msgText: { fontSize: 13.5, lineHeight: 20, color: INK },
  items: { borderWidth: 1, borderColor: CARD_LINE, borderRadius: 16, paddingHorizontal: 12, backgroundColor: '#fff', marginBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 },
  itemTotal: { borderTopWidth: 1, borderTopColor: CARD_LINE },
  itemName: { flex: 1, fontSize: 13, color: INK },
  itemMeta: { fontSize: 12, color: MUTED },
  itemQty: { fontSize: 12, color: MUTED, fontVariant: ['tabular-nums'] },
  itemPrice: { fontSize: 13, color: INK, fontVariant: ['tabular-nums'] },
  totalValue: { fontSize: 15, fontWeight: '600', color: GOLD, fontVariant: ['tabular-nums'] },
  info: { backgroundColor: SOFT, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
  infoLabel: { fontSize: 10.5, color: MUTED },
  infoValue: { fontSize: 13, fontWeight: '600', color: INK, lineHeight: 19 },
  infoSub: { fontSize: 12, color: MUTED, marginTop: 4 },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, alignSelf: 'flex-start' },
  accountNumber: {
    fontSize: 15,
    fontWeight: '600',
    color: INK,
    letterSpacing: 0.5,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  reply: {
    height: 50,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  replyText: { fontSize: 15, fontWeight: '600', color: INK },
  pair: { flexDirection: 'row', gap: 10 },
  formTitle: { fontSize: 15, fontWeight: '600', color: INK, marginBottom: 10, marginTop: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  optionOn: { borderColor: CLAY, backgroundColor: '#FCF3EE' },
  optionTitle: { fontSize: 14, fontWeight: '600', color: INK },
  optionText: { fontSize: 12, color: MUTED, lineHeight: 17, marginTop: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#D8CDBF', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: CLAY },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: CLAY },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: '#D8CDBF', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: CLAY, borderColor: CLAY },
  note: { fontSize: 11.5, color: MUTED, textAlign: 'center', marginTop: 10 },
  ghost: { height: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '600', color: MUTED },
});
