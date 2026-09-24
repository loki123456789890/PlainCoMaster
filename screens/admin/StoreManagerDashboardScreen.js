// The Store Manager's home, from the approved store-manager preview: the
// store's logo and name, a greeting, an ink card with the store's delivered
// sales and a week of orders, "Needs your attention" (only what is actually
// waiting), and a grid of everything the manager can open.
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import { signOut } from 'firebase/auth';
import { collection, collectionGroup, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { useAdmin } from '../../context/AdminContext';
import { useProducts } from '../../context/ProductContext';
import { useStores } from '../../context/StoreContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors } from '../../constants/theme';
import { MAIL_PROBLEM_STATUSES } from '../../constants/mail';
import { stockLevel, parseStockLimit } from '../../utils/stock';
import SkeletonBlock from '../../components/ui/Skeleton';
import Button from '../../components/ui/Button';
import Sheet from '../../components/shop/Sheet';
import Reveal from '../../components/shop/Reveal';
import StoreLogo from '../../components/shop/StoreLogo';
import { OfflineNotice } from '../../components/shop/TabScreen';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const DANGER = Colors.light.danger;
const CARD_LINE = '#EEE7DD';
const ON_INK_MUTED = '#BDB3A9';
const ON_INK_GOLD = '#F1D98A';
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const getTimeGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

// Manual thousands-grouping instead of Number.toLocaleString — avoids
// depending on the JS engine shipping full ICU/Intl data for number
// formatting, which isn't guaranteed across Hermes builds.
const groupThousands = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const formatCurrency = (value) => {
  const [intPart, decPart] = (Number(value) || 0).toFixed(2).split('.');
  return `${groupThousands(intPart)}.${decPart}`;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// "Oldest waiting 2 days" — how long the longest-waiting open order has sat.
const waitingLabel = (date) => {
  if (!date) return null;
  const days = Math.floor((Date.now() - date.getTime()) / DAY_MS);
  if (days < 1) return 'Oldest came in today';
  return `Oldest waiting ${plural(days, 'day', 'days')}`;
};

// Everything the dashboard reads from one store's orders, summed once per
// snapshot rather than per render.
//
// "Delivered sales" is the confirmed figure: an order counts once it has
// been delivered, which for Cash on Delivery is when the money is actually
// collected. Everything placed but not yet delivered or cancelled is "still
// open", and the unpaid-COD part of that is shown separately, because it is
// money the store hasn't got and may never get.
function summarizeOrders(docs) {
  const today = startOfDay(Date.now());
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = today - (6 - i) * DAY_MS;
    return {
      day,
      label: i === 6 ? 'Today' : DAY_NAMES[new Date(day).getDay()],
      count: 0,
    };
  });
  const summary = {
    total: docs.length,
    deliveredValue: 0,
    deliveredCount: 0,
    openValue: 0,
    unpaidCodValue: 0,
    toPrepare: 0,
    oldestToPrepare: null,
    week,
  };
  docs.forEach((docSnap) => {
    const data = docSnap.data();
    const status = data.status || 'pending';
    const total = Number(data.total || 0);
    const created = data.createdAt?.toDate ? data.createdAt.toDate() : null;
    if (status === 'cancelled') return;
    if (status === 'delivered') {
      summary.deliveredValue += total;
      summary.deliveredCount += 1;
    } else {
      summary.openValue += total;
      if (data.paymentMethod === 'cod' && data.paymentStatus !== 'paid') summary.unpaidCodValue += total;
    }
    if (status === 'pending' || status === 'processing') {
      summary.toPrepare += 1;
      if (created && (!summary.oldestToPrepare || created < summary.oldestToPrepare)) summary.oldestToPrepare = created;
    }
    if (created) {
      const slot = week.find((w) => w.day === startOfDay(created));
      if (slot) slot.count += 1;
    }
  });
  return summary;
}

const EMPTY_SUMMARY = summarizeOrders([]);

// One row of "Needs your attention": a tinted count, what it is, a detail.
function TodoRow({ count, tone, title, detail, onPress, delay }) {
  return (
    <Reveal delay={delay}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.todo, pressed && styles.pressedCard]}
        accessibilityRole="button"
        accessibilityLabel={`${count} ${title}${detail ? `. ${detail}` : ''}`}
      >
        <View style={[styles.todoCount, { backgroundColor: tone.bg }]}>
          <Text style={[styles.todoCountText, { color: tone.ink }]}>{count > 99 ? '99+' : count}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.todoTitle}>{title}</Text>
          {detail ? (
            <Text style={styles.todoDetail} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color="#B3AAA0" />
      </Pressable>
    </Reveal>
  );
}

const TONES = {
  gold: { bg: '#F6EFE3', ink: '#6B5A2E' },
  clay: { bg: '#F6E6DE', ink: '#A94F2F' },
  danger: { bg: '#FBEDEB', ink: '#B42318' },
  moss: { bg: '#EEF0EA', ink: '#37412F' },
};

export default function StoreManagerDashboardScreen({ navigation }) {
  const { logoutAsAdmin, storeId } = useAdmin();
  const {
    // This manager's own store only — see ProductContext.
    storeProducts: products,
    loading: productsLoading,
    error: productsError,
    retryFetchProducts,
  } = useProducts();
  const { getStore } = useStores();
  const store = getStore(storeId);
  const { isConnected } = useNetworkStatus();
  const { width } = useWindowDimensions();

  const [managerName, setManagerName] = useState('');
  const [orders, setOrders] = useState(EMPTY_SUMMARY);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);

  const [openSupportCount, setOpenSupportCount] = useState(0);
  const [latestSupport, setLatestSupport] = useState('');
  const [supportLoading, setSupportLoading] = useState(true);
  const [supportError, setSupportError] = useState(false);
  const [mailProblemCount, setMailProblemCount] = useState(0);
  const [mailLoading, setMailLoading] = useState(true);
  const [mailError, setMailError] = useState(false);

  const [logoutVisible, setLogoutVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Bumped by handleRetry() to force the effect below to tear down and
  // re-subscribe every listener — same shape as ProductContext's own
  // retryToken, so a permissions blip or a bad connection at mount doesn't
  // leave a stat silently stuck on an unrecoverable listener.
  const [retryToken, setRetryToken] = useState(0);

  // The manager's first name for the greeting. Read once: it's a greeting,
  // not something to keep live, and a failure just leaves it off.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, 'users', uid))
      .then((snap) => setManagerName((snap.data()?.name || '').trim().split(/\s+/)[0] || ''))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Every count on this screen is one store's, and a manager with no
    // store has none. Zeros rather than error states: the listeners would
    // be refused, and retrying cannot fix an unassigned account.
    if (!storeId) {
      setOrders(EMPTY_SUMMARY);
      setOpenSupportCount(0);
      setMailProblemCount(0);
      setOrdersLoading(false);
      setSupportLoading(false);
      setMailLoading(false);
      return undefined;
    }

    setOrdersLoading(true);
    setOrdersError(false);
    setSupportLoading(true);
    setSupportError(false);

    // Same collectionGroup shape AdminOrdersScreen uses to read orders
    // across every user's subcollection, filtered to this manager's store
    // — the rules refuse any query that could return another store's
    // order. No orderBy: the equality filter alone uses the single-field
    // collection-group index on storeId declared in firestore.indexes.json.
    const unsubscribeOrders = onSnapshot(
      query(collectionGroup(db, 'orders'), where('storeId', '==', storeId)),
      (snapshot) => {
        setOrders(summarizeOrders(snapshot.docs));
        setOrdersLoading(false);
      },
      (error) => {
        console.error('Error fetching orders:', error);
        setOrdersError(true);
        setOrdersLoading(false);
      }
    );

    // Filtered server-side to only "open" requests, and to this store's
    // queue: the rules refuse any other request, so that filter is
    // required, not tidy. The newest one's message is quoted on the row.
    const unsubscribeSupport = onSnapshot(
      query(collection(db, 'supportRequests'), where('storeId', '==', storeId), where('status', '==', 'open')),
      (snapshot) => {
        setOpenSupportCount(snapshot.size);
        const newest = snapshot.docs
          .map((d) => d.data())
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))[0];
        setLatestSupport((newest?.message || '').trim());
        setSupportLoading(false);
      },
      (error) => {
        console.error('Error fetching open support request count:', error);
        setSupportError(true);
        setSupportLoading(false);
      }
    );

    // Undelivered transactional email. The status list is
    // MAIL_PROBLEM_STATUSES and not a literal, because the row links to
    // AdminMailLogScreen, which filters by the same definition — written
    // out twice they drifted. This store's mail only. Uses the
    // (storeId, status) index in firestore.indexes.json.
    const unsubscribeMail = onSnapshot(
      query(collection(db, 'mailLog'), where('storeId', '==', storeId), where('status', 'in', MAIL_PROBLEM_STATUSES)),
      (snapshot) => {
        setMailProblemCount(snapshot.size);
        setMailLoading(false);
      },
      (error) => {
        console.error('Error fetching undelivered email count:', error);
        setMailError(true);
        setMailLoading(false);
      }
    );

    return () => {
      unsubscribeOrders();
      unsubscribeSupport();
      unsubscribeMail();
    };
  }, [retryToken, storeId]);

  const handleRetry = () => setRetryToken((t) => t + 1);

  // Which products need restocking, derived from the catalog this screen
  // already holds. Sold-out items sort ahead of merely low ones because
  // they are the ones actively costing sales. Products with no recorded
  // stock are excluded by stockLevel() rather than counted as zero.
  const restockItems = products
    .map((product) => ({ product, level: stockLevel(product.stock) }))
    .filter(({ level }) => level === 'out' || level === 'low')
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === 'out' ? -1 : 1;
      return parseStockLimit(a.product.stock) - parseStockLimit(b.product.stock);
    });
  const outOfStockCount = restockItems.filter(({ level }) => level === 'out').length;

  const handleNavigate = (screen, params) => {
    Haptics.selectionAsync();
    navigation.navigate(screen, params);
  };

  const confirmLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut(auth);
      logoutAsAdmin();
      // Reset the nav stack so "back" can't return to admin screens
      // after the session is gone.
      navigation.reset({ index: 0, routes: [{ name: 'AdminLogin', params: { loggedOut: true } }] });
    } catch (error) {
      console.error('Error signing out:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoggingOut(false);
      setLogoutVisible(false);
      showAppAlert('Error', 'Could not log out. Please try again.');
    }
  };

  // "Needs your attention": only what is actually waiting, most pressing
  // first. A row for something at zero would be furniture the eye learns to
  // skip. Reviews aren't counted here: producing that number means reading
  // every recent review on each dashboard load, and the Reviews queue
  // already opens on its "didn't match" tab.
  const todos = [];
  if (!ordersLoading && !ordersError && orders.toPrepare > 0) {
    todos.push({
      key: 'orders',
      count: orders.toPrepare,
      tone: TONES.gold,
      title: orders.toPrepare === 1 ? 'Order to prepare' : 'Orders to prepare',
      detail: waitingLabel(orders.oldestToPrepare),
      onPress: () => handleNavigate('AdminOrders'),
    });
  }
  if (!supportLoading && !supportError && openSupportCount > 0) {
    todos.push({
      key: 'support',
      count: openSupportCount,
      tone: TONES.clay,
      title: openSupportCount === 1 ? 'Open support request' : 'Open support requests',
      detail: latestSupport ? `“${latestSupport}”` : null,
      onPress: () => handleNavigate('AdminSupport'),
    });
  }
  if (!productsLoading && !productsError && restockItems.length > 0) {
    todos.push({
      key: 'stock',
      count: restockItems.length,
      tone: TONES.danger,
      title: outOfStockCount === restockItems.length ? 'Sold out' : 'Low on stock',
      detail:
        outOfStockCount > 0 && outOfStockCount < restockItems.length
          ? `${outOfStockCount} sold out, ${restockItems.length - outOfStockCount} running low`
          : restockItems
              .slice(0, 2)
              .map(({ product }) => product.name)
              .join(', ') + (restockItems.length > 2 ? ` +${restockItems.length - 2} more` : ''),
      onPress: () => handleNavigate('AdminProducts', { filter: 'restock' }),
    });
  }
  if (!mailLoading && !mailError && mailProblemCount > 0) {
    todos.push({
      key: 'mail',
      count: mailProblemCount,
      tone: TONES.danger,
      title: mailProblemCount === 1 ? "Email didn't send" : "Emails didn't send",
      detail: 'Receipts or support alerts that never reached anyone',
      onPress: () => handleNavigate('AdminMailLog', { problemsOnly: true }),
    });
  }
  const todosLoading = ordersLoading || supportLoading || productsLoading || mailLoading;
  const anyError = ordersError || supportError || Boolean(productsError) || mailError;

  const tileWidth = (Math.min(width, 520) - 32 - 20) / 3;
  const tiles = [
    {
      title: 'Products',
      icon: 'cube-outline',
      screen: 'AdminProducts',
      caption: productsLoading ? null : productsError ? 'Tap to retry' : `${products.length} listed`,
      dot: restockItems.length,
      onPress: productsError ? retryFetchProducts : null,
    },
    {
      title: 'Orders',
      icon: 'cart-outline',
      screen: 'AdminOrders',
      caption: ordersLoading ? null : ordersError ? 'Tap to retry' : `${orders.total} total`,
      dot: orders.toPrepare,
    },
    {
      title: 'Support',
      icon: 'chatbubble-ellipses-outline',
      screen: 'AdminSupport',
      caption: supportLoading ? null : supportError ? 'Tap to retry' : `${openSupportCount} open`,
      dot: openSupportCount,
    },
    {
      title: 'Reviews',
      icon: 'star-outline',
      screen: 'AdminReviews',
      caption: 'Moderate',
    },
    {
      title: 'Activity',
      icon: 'time-outline',
      screen: 'AdminActivity',
      caption: 'View log',
    },
    {
      title: 'Store profile',
      icon: 'storefront-outline',
      screen: 'AdminStoreProfile',
      caption: 'Logo & about',
    },
  ];

  const weekMax = Math.max(1, ...orders.week.map((w) => w.count));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Sheet visible={logoutVisible} onClose={() => setLogoutVisible(false)} locked={loggingOut}>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Log out of the Staff Portal?
        </Text>
        <Text style={styles.sheetText}>Your store keeps running while you&apos;re away.</Text>
        {/* Who is signed in, so logging out of the wrong account is caught here. */}
        <View style={styles.whoCard}>
          <StoreLogo uri={store?.logoUrl} size={42} radius={12} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.whoName} numberOfLines={1}>
              {managerName || auth.currentUser?.email || 'Store Manager'}
            </Text>
            <Text style={styles.whoStore} numberOfLines={1}>
              {store?.name || 'No store assigned'}
            </Text>
          </View>
          <Text style={styles.whoRole}>MANAGER</Text>
        </View>
        {/* Orders still waiting are the one thing worth a second look before
            leaving; the row goes straight to them instead. */}
        {!ordersLoading && !ordersError && orders.toPrepare > 0 ? (
          <Pressable
            onPress={() => {
              setLogoutVisible(false);
              handleNavigate('AdminOrders');
            }}
            disabled={loggingOut}
            style={({ pressed }) => [styles.remind, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityHint="Opens order management"
          >
            <View style={styles.remindCount}>
              <Text style={styles.remindCountText}>{orders.toPrepare}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.remindTitle}>Before you go</Text>
              <Text style={styles.remindText}>
                {orders.toPrepare === 1 ? '1 order is' : `${orders.toPrepare} orders are`} still waiting to be prepared
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#6B5A2E" />
          </Pressable>
        ) : null}
        <Button label="Log out" fontSize={15.5} onPress={confirmLogout} loading={loggingOut} fullWidth />
        <Pressable
          onPress={() => setLogoutVisible(false)}
          disabled={loggingOut}
          style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={styles.ghostText}>Stay logged in</Text>
        </Pressable>
      </Sheet>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Reveal delay={20} style={styles.head}>
          <StoreLogo uri={store?.logoUrl} size={46} radius={14} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.roleRow}>
              <View style={styles.roleDot} />
              <Text style={styles.role}>Store Manager</Text>
            </View>
            <Text style={styles.storeName} numberOfLines={1}>
              {store?.name || (storeId ? ' ' : 'No store assigned')}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setLogoutVisible(true);
            }}
            style={({ pressed }) => [styles.logout, pressed && { backgroundColor: '#F3EEE6' }]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Ionicons name="log-out-outline" size={21} color={DANGER} />
          </Pressable>
        </Reveal>

        {!isConnected ? (
          <View style={styles.offlineWrap}>
            <OfflineNotice>No internet connection. These numbers may be out of date.</OfflineNotice>
          </View>
        ) : null}

        <Reveal delay={80} style={styles.greet}>
          <Text style={styles.greetTitle} accessibilityRole="header">
            {getTimeGreeting()}
            {managerName ? `, ${managerName}` : ''}
          </Text>
          <Text style={styles.greetSub}>Here&apos;s what&apos;s happening in your store today.</Text>
        </Reveal>

        <Reveal delay={140}>
          <Pressable
            onPress={() => handleNavigate('AdminOrders')}
            style={({ pressed }) => [styles.hero, pressed && { transform: [{ scale: 0.99 }] }]}
            accessibilityRole="button"
            accessibilityLabel={
              ordersLoading
                ? 'Delivered sales, loading'
                : ordersError
                  ? 'Delivered sales, unavailable'
                  : `Delivered sales, ₱${formatCurrency(orders.deliveredValue)} from ${plural(orders.deliveredCount, 'order', 'orders')}`
            }
            accessibilityHint="Opens order management"
          >
            <View style={[styles.ring, styles.ringBig]} pointerEvents="none" />
            <View style={[styles.ring, styles.ringSmall]} pointerEvents="none" />
            <View style={styles.heroLabelRow}>
              <Text style={styles.heroLabel}>Delivered sales · all time</Text>
              <Text style={styles.heroPill}>Confirmed</Text>
            </View>
            {ordersLoading ? (
              <SkeletonBlock style={styles.heroSkeleton} />
            ) : ordersError ? (
              <View style={styles.heroError}>
                <Ionicons name="alert-circle-outline" size={16} color="#F2A99F" />
                <Text style={styles.heroErrorText}>Couldn&apos;t load orders.</Text>
                <Pressable onPress={handleRetry} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.heroRetry}>Retry</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                ₱{formatCurrency(orders.deliveredValue)}
              </Text>
            )}
            <Text style={styles.heroSub}>
              From <Text style={styles.heroSubStrong}>{orders.deliveredCount}</Text> delivered{' '}
              {orders.deliveredCount === 1 ? 'order' : 'orders'}
            </Text>
            <View style={styles.split}>
              <View style={{ flex: 1 }}>
                <Text style={styles.splitLabel}>Still open</Text>
                <Text style={styles.splitValue}>₱{formatCurrency(orders.openValue)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.splitLabel}>Incl. unpaid COD</Text>
                <Text style={styles.splitValue}>₱{formatCurrency(orders.unpaidCodValue)}</Text>
              </View>
            </View>
            <Text style={styles.sparkLabel}>Orders, last 7 days</Text>
            <View style={styles.spark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {orders.week.map((w, i) => {
                const today = i === orders.week.length - 1;
                return (
                  <View key={w.day} style={styles.sparkCol}>
                    <View
                      style={[
                        styles.sparkBar,
                        { height: (w.count / weekMax) * 34 + 4 },
                        today && { backgroundColor: CLAY },
                      ]}
                    />
                    <Text style={[styles.sparkDay, today && styles.sparkToday]}>{w.label}</Text>
                  </View>
                );
              })}
            </View>
          </Pressable>
        </Reveal>

        <Reveal delay={200} style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Needs your attention</Text>
          {!todosLoading && todos.length > 0 ? (
            <Text style={styles.sectionMeta}>{plural(todos.length, 'thing', 'things')}</Text>
          ) : null}
        </Reveal>
        <View style={styles.todos}>
          {todosLoading && todos.length === 0 ? (
            <SkeletonBlock style={styles.todoSkeleton} />
          ) : todos.length > 0 ? (
            todos.map(({ key, ...todo }, i) => <TodoRow key={key} {...todo} delay={230 + i * 40} />)
          ) : anyError ? (
            <Pressable onPress={handleRetry} style={styles.allClear} accessibilityRole="button">
              <Ionicons name="alert-circle-outline" size={20} color={DANGER} />
              <Text style={styles.allClearText}>Some of this couldn&apos;t load. Tap to try again.</Text>
            </Pressable>
          ) : (
            <Reveal delay={230} style={styles.allClear}>
              <View style={styles.allClearIcon}>
                <Ionicons name="checkmark" size={16} color="#fff" />
              </View>
              <Text style={styles.allClearText}>All caught up. Nothing is waiting on you right now.</Text>
            </Reveal>
          )}
        </View>

        <Reveal delay={400} style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Manage</Text>
        </Reveal>
        <View style={styles.grid}>
          {tiles.map((tile, i) => (
            <Reveal key={tile.title} delay={420 + i * 30} style={{ width: tileWidth }}>
              <Pressable
                onPress={tile.onPress || (() => handleNavigate(tile.screen))}
                style={({ pressed }) => [styles.tile, pressed && styles.pressedCard]}
                accessibilityRole="button"
                accessibilityLabel={`${tile.title}${tile.caption ? `, ${tile.caption}` : ''}`}
              >
                {tile.dot > 0 ? (
                  <View style={styles.tileDot}>
                    <Text style={styles.tileDotText}>{tile.dot > 99 ? '99+' : tile.dot}</Text>
                  </View>
                ) : null}
                <View style={styles.tileIcon}>
                  <Ionicons name={tile.icon} size={19} color={INK} />
                </View>
                <View>
                  <Text style={styles.tileTitle} numberOfLines={1}>
                    {tile.title}
                  </Text>
                  {tile.caption ? (
                    <Text style={styles.tileCaption} numberOfLines={1}>
                      {tile.caption}
                    </Text>
                  ) : (
                    <SkeletonBlock style={styles.tileSkeleton} />
                  )}
                </View>
              </Pressable>
            </Reveal>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: {
    paddingBottom: 30,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: MOSS },
  role: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: MOSS,
  },
  storeName: { fontSize: 16, fontWeight: '600', color: INK, marginTop: 1 },
  logout: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineWrap: { paddingHorizontal: 16, paddingTop: 14 },

  greet: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
  greetTitle: {
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: -0.5,
    lineHeight: 32,
    color: INK,
  },
  greetSub: { fontSize: 13, color: MUTED, marginTop: 4 },

  hero: {
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 26,
    backgroundColor: INK,
    padding: 18,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.08)',
  },
  ringBig: { right: -60, top: -70, width: 220, height: 220 },
  ringSmall: { right: -20, top: -30, width: 140, height: 140 },
  heroLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroLabel: { fontSize: 12, color: ON_INK_MUTED },
  heroPill: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#CFE0BF',
    backgroundColor: 'rgba(143,163,125,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  heroValue: {
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.6,
    color: ON_INK_GOLD,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  heroSkeleton: {
    width: 170,
    height: 32,
    marginVertical: 4,
    borderRadius: 8,
    opacity: 0.25,
  },
  heroError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginVertical: 10,
  },
  heroErrorText: { fontSize: 13, fontWeight: '600', color: '#F2A99F' },
  heroRetry: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E9A385',
    marginLeft: 4,
  },
  heroSub: { fontSize: 12, color: ON_INK_MUTED, marginTop: 2 },
  heroSubStrong: { color: Colors.light.background, fontWeight: '600' },
  split: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,247,242,0.1)',
  },
  splitLabel: { fontSize: 11, color: ON_INK_MUTED },
  splitValue: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.background,
    marginTop: 1,
  },
  sparkLabel: { fontSize: 11, color: '#8B8178', marginTop: 14 },
  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 52,
    marginTop: 6,
  },
  sparkCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    height: '100%',
  },
  sparkBar: {
    width: '100%',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: 'rgba(250,247,242,0.16)',
  },
  sparkDay: { fontSize: 9.5, color: '#8B8178' },
  sparkToday: { color: Colors.light.background, fontWeight: '600' },

  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginHorizontal: 22,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: INK },
  sectionMeta: { fontSize: 12, color: MUTED },

  todos: { gap: 8, marginHorizontal: 16 },
  todo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
  },
  pressedCard: { transform: [{ scale: 0.98 }] },
  todoCount: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: 6,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todoCountText: { fontSize: 16, fontWeight: '600' },
  todoTitle: { fontSize: 13.5, fontWeight: '600', color: INK },
  todoDetail: { fontSize: 11.5, color: MUTED, marginTop: 1 },
  todoSkeleton: { height: 64, borderRadius: 18 },
  allClear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
  },
  allClearIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: MOSS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allClearText: { flex: 1, fontSize: 13, color: MUTED, lineHeight: 18 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginHorizontal: 16,
  },
  tile: {
    paddingTop: 14,
    paddingHorizontal: 10,
    paddingBottom: 12,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    gap: 10,
  },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F3EEE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: { fontSize: 12.5, fontWeight: '600', color: INK },
  tileCaption: { fontSize: 10.5, color: MUTED, marginTop: 1 },
  tileSkeleton: { width: 44, height: 10, borderRadius: 4, marginTop: 3 },
  tileDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: CLAY,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  tileDotText: { fontSize: 10, fontWeight: '600', color: '#fff' },

  sheetTitle: { fontSize: 19, fontWeight: '600', color: INK, marginTop: 4 },
  sheetText: { fontSize: 13, lineHeight: 20, color: MUTED, marginTop: 4, marginBottom: 12 },
  whoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: INK,
    marginBottom: 12,
  },
  whoName: { fontSize: 14, fontWeight: '600', color: Colors.light.background },
  whoStore: { fontSize: 11.5, color: ON_INK_MUTED, marginTop: 1 },
  whoRole: {
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: '#CFE0BF',
    backgroundColor: 'rgba(143,163,125,0.2)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  remind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#F6EFE3',
    marginBottom: 14,
  },
  remindCount: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remindCountText: { fontSize: 16, fontWeight: '600', color: '#6B5A2E' },
  remindTitle: { fontSize: 13, fontWeight: '600', color: INK },
  remindText: { fontSize: 11.5, color: '#6B5A2E', marginTop: 1 },
  ghost: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  ghostText: { fontSize: 15.5, fontWeight: '600', color: MUTED },
});
