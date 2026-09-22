import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
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
import { signOut } from 'firebase/auth';
import { collection, collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';
import { useAdmin } from '../../context/AdminContext';
import { useProducts } from '../../context/ProductContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../../constants/theme';
import { MAIL_PROBLEM_STATUSES } from '../../constants/mail';
import { stockLevel, parseStockLimit } from '../../utils/stock';
import Card from '../../components/ui/Card';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';

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

const formatCount = (value) => groupThousands(String(Number(value) || 0));

export default function StoreManagerDashboardScreen({ navigation }) {
  const { logoutAsAdmin, storeId } = useAdmin();
  const {
    // This manager's own store only — see ProductContext.
    storeProducts: products,
    loading: productsLoading,
    error: productsError,
    retryFetchProducts,
  } = useProducts();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const [orderCount, setOrderCount] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);

  // "Total Order Value" — deliberately not "Revenue"/"Sales". COD is the
  // primary payment method and there's no payment gateway integration
  // (per SRS), so an order's total isn't confirmed money collected, just
  // the value of what was ordered.
  const [totalOrderValue, setTotalOrderValue] = useState(0);

  const [openSupportCount, setOpenSupportCount] = useState(0);
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

  useEffect(() => {
    setOrdersLoading(true);
    setOrdersError(false);
    setSupportLoading(true);
    setSupportError(false);

    // Same collectionGroup shape AdminOrdersScreen uses to read orders
    // across every user's subcollection, filtered to this manager's store
    // — the rules refuse any query that could return another store's
    // order. No orderBy here since only the count and total are needed;
    // the equality filter alone uses the single-field collection-group
    // index on storeId declared in firestore.indexes.json.
    //
    // A manager with no store has no orders, so no query at all.
    let unsubscribeOrders = () => {};
    if (!storeId) {
      setOrderCount(0);
      setTotalOrderValue(0);
      setOrdersLoading(false);
    } else {
      unsubscribeOrders = onSnapshot(
        query(collectionGroup(db, 'orders'), where('storeId', '==', storeId)),
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
          setOrdersError(true);
          setOrdersLoading(false);
        }
      );
    }

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
        setSupportError(true);
        setSupportLoading(false);
      }
    );

    // Undelivered transactional email. Filtered server-side to the three
    // statuses that mean something went wrong, for the same reason as the
    // support query above: the card needs a count, not the history.
    //
    // The status list is MAIL_PROBLEM_STATUSES and not a literal, because
    // this card links to AdminMailLogScreen, which filters by the same
    // definition. Written out twice they drifted, and the failure is
    // quiet and confusing: a card saying one email did not send, opening
    // a screen that says everything sent.
    //
    // A single-field `in` needs no composite index, so this adds nothing
    // to firestore.indexes.json.
    const unsubscribeMail = onSnapshot(
      query(collection(db, 'mailLog'), where('status', 'in', MAIL_PROBLEM_STATUSES)),
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
  // already holds — no extra listener, no extra read.
  //
  // Worth having at all because the customer-facing app has known this
  // longer than the shop has: Productscreen renders "Only N left in stock"
  // and an Out of Stock badge to shoppers, while this dashboard showed a
  // bare product count. The shopkeeper found out an item had run out after
  // the shopper did.
  //
  // Sold-out items sort ahead of merely low ones because they are the ones
  // actively costing sales, and within each group the smallest number
  // first. Products with no recorded stock are excluded by stockLevel()
  // rather than counted as zero — see its note there.
  //
  // Declared above gridItems because that list reads restockItems for its
  // badge.
  const restockItems = products
    .map((product) => ({ product, level: stockLevel(product.stock) }))
    .filter(({ level }) => level === 'out' || level === 'low')
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === 'out' ? -1 : 1;
      return parseStockLimit(a.product.stock) - parseStockLimit(b.product.stock);
    });

  const outOfStockCount = restockItems.filter(({ level }) => level === 'out').length;

  // Neutral icon tiles by design: none of Products/Orders/Support map to an
  // existing semantic color (Clay = actions, Moss = success, Gold = money,
  // Rust = danger), so coloring them arbitrarily would be decoration, not
  // meaning. The Support tile still gets a real signal — a Rust count
  // badge when requests are open — reusing the same overlay pattern as the
  // customer tab bar's cart-count badge, rather than inventing a new one.
  //
  // No "Users" tile: this dashboard is guarded to sellers only, and user
  // account management is a platformAdmin-only screen per firestore.rules
  // — a seller navigating there would just be bounced by the guard.
  const gridItems = [
    {
      title: 'Products',
      icon: 'cube-outline',
      screen: 'AdminProducts',
      count: products.length,
      loading: productsLoading,
      error: Boolean(productsError),
      onRetry: retryFetchProducts,
      // Reuses the same overlay dot the Support tile uses for its open
      // queue, so "this needs attention" reads the same way in both
      // places rather than inventing a second signal for one idea.
      badge: restockItems.length > 0,
    },
    {
      title: 'Orders',
      icon: 'cart-outline',
      screen: 'AdminOrders',
      count: orderCount,
      loading: ordersLoading,
      error: ordersError,
      onRetry: handleRetry,
    },
    {
      title: 'Support',
      icon: 'chatbubble-ellipses-outline',
      screen: 'AdminSupport',
      count: openSupportCount,
      loading: supportLoading,
      error: supportError,
      onRetry: handleRetry,
      badge: openSupportCount > 0,
    },
    {
      // No count, deliberately, even though a "didn't match" tally would fit
      // the badge pattern above: producing it means reading every recent
      // review on dashboard load, and this dashboard opens on mobile data
      // many times a shift. The queue itself sorts that out on arrival — it
      // opens on the mismatch tab.
      title: 'Reviews',
      icon: 'star-outline',
      screen: 'AdminReviews',
      caption: 'Moderate',
      loading: false,
      error: false,
    },
    {
      // No count: the other tiles count things needing attention, while an
      // activity log only ever grows. A number here would read as a queue
      // to clear rather than a history to consult.
      title: 'Activity',
      icon: 'time-outline',
      screen: 'AdminActivity',
      caption: 'View log',
      loading: false,
      error: false,
    },
  ];

  const handleLogout = () => {
    Haptics.selectionAsync();
    setLogoutVisible(true);
  };

  const confirmLogout = async () => {
    setLoggingOut(true);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoggingOut(false);
      setLogoutVisible(false);
      showAppAlert('Error', 'Could not log out. Please try again.');
    }
  };

  const handleNavigate = (screen, params) => {
    Haptics.selectionAsync();
    navigation.navigate(screen, params);
  };

  const heroAccessibilityLabel = ordersLoading
    ? 'Total order value, loading'
    : ordersError
    ? 'Total order value, unavailable'
    : `Total order value, ₱${formatCurrency(totalOrderValue)}`;

  return (
    <SafeAreaView style={styles.container}>
      <ConfirmDialog
        visible={logoutVisible}
        onClose={() => setLogoutVisible(false)}
        title="Log Out"
        confirmLabel="Log Out"
        confirmVariant="primary"
        onConfirm={confirmLogout}
        loading={loggingOut}
        confirmDisabled={loggingOut}
        cancelDisabled={loggingOut}
      >
        <Text style={styles.modalMessage}>Are you sure you want to log out of the Store Manager portal?</Text>
      </ConfirmDialog>

      <View style={styles.header}>
        {/* "Admin Dashboard" named a role that no longer exists. This
            screen is guarded to sellers only (App.js), so it says so —
            and the subtitle states the boundary, which is the fastest
            answer to "where did user management go?" for anyone who
            remembers the old combined portal. */}
        <View>
          <Text style={styles.headerTitle}>Store Manager</Text>
          <Text style={styles.headerSubtitle}>Products, orders, and support</Text>
        </View>
        <AnimatedPressable
          onPress={handleLogout}
          style={styles.logoutButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Ionicons name="log-out-outline" size={22} color={Colors.light.danger} />
        </AnimatedPressable>
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — dashboard numbers may be out of date.
          </Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)}>
          {/* Just the greeting — the header two lines up already says
              "Store Manager", so naming the role again here would repeat
              it rather than tell anyone anything. */}
          <Text style={styles.welcomeText}>{getTimeGreeting()}</Text>
          <Text style={styles.subtext}>Manage your store from here</Text>
        </Animated.View>

        <Animated.View
          entering={
            reduceMotion ? undefined : FadeInDown.duration(240).delay(40).easing(EASE_OUT_QUART)
          }
        >
          <AnimatedPressable
            onPress={() => handleNavigate('AdminOrders')}
            accessibilityRole="button"
            accessibilityLabel={heroAccessibilityLabel}
            accessibilityHint="Opens order management"
          >
            <Card variant="flat" style={styles.heroCard}>
              <View style={styles.heroIcon}>
                <Ionicons name="cash-outline" size={26} color={Colors.light.highlight} />
              </View>
              <View style={styles.heroTextGroup}>
                <Text style={styles.heroLabel}>Total Order Value</Text>
                {ordersLoading ? (
                  <SkeletonBlock style={styles.heroSkeleton} />
                ) : ordersError ? (
                  <View style={styles.errorRow}>
                    <Ionicons name="alert-circle-outline" size={16} color={Colors.light.danger} />
                    <Text style={styles.errorText}>Couldn&apos;t load</Text>
                    <Pressable
                      onPress={handleRetry}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading order value"
                    >
                      {({ pressed }) => (
                        <Text style={[styles.retryText, pressed && styles.retryTextPressed]}>
                          Retry
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                    ₱{formatCurrency(totalOrderValue)}
                  </Text>
                )}
                <Text style={styles.heroCaption}>
                  Includes pending &amp; unpaid COD orders — not confirmed revenue
                </Text>
              </View>
            </Card>
          </AnimatedPressable>
        </Animated.View>

        {/* Restocking. Renders only when there is something to act on —
            a permanent "0 items need restocking" card would be furniture
            the eye learns to skip, which is exactly what this must not
            become. Named items rather than a bare count, because "what do
            I need to restock today" is answered by names, and a number
            alone would just start a hunt through the product list. */}
        {!productsLoading && !productsError && restockItems.length > 0 && (
          <Animated.View
            entering={
              reduceMotion ? undefined : FadeInDown.duration(240).delay(60).easing(EASE_OUT_QUART)
            }
          >
            <AnimatedPressable
              onPress={() => handleNavigate('AdminProducts', { filter: 'restock' })}
              accessibilityRole="button"
              accessibilityLabel={
                `${restockItems.length} ${restockItems.length === 1 ? 'product needs' : 'products need'} restocking` +
                (outOfStockCount > 0 ? `, ${outOfStockCount} sold out` : '')
              }
              accessibilityHint="Opens the product list filtered to these items"
            >
              <Card variant="flat" style={styles.restockCard}>
                <View style={styles.restockHeader}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color={outOfStockCount > 0 ? Colors.light.danger : Colors.light.highlight}
                  />
                  <Text style={styles.restockTitle}>
                    {restockItems.length} {restockItems.length === 1 ? 'item needs' : 'items need'} restocking
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.icon} />
                </View>

                {restockItems.slice(0, 3).map(({ product, level }) => (
                  <View key={product.id} style={styles.restockRow}>
                    <Text style={styles.restockName} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text
                      style={[
                        styles.restockCount,
                        level === 'out' ? styles.restockCountOut : styles.restockCountLow,
                      ]}
                    >
                      {level === 'out' ? 'Sold out' : `${parseStockLimit(product.stock)} left`}
                    </Text>
                  </View>
                ))}

                {restockItems.length > 3 && (
                  <Text style={styles.restockMore}>
                    +{restockItems.length - 3} more
                  </Text>
                )}
              </Card>
            </AnimatedPressable>
          </Animated.View>
        )}

        {/* Undelivered email. Same rule as the restocking card above:
            appears only when there is something to act on, because a
            standing "0 emails failed" row is furniture the eye learns to
            skip — and this one has to be noticed the one time it matters.
            Links straight into the filtered view, since a card that counts
            problems should not land you in a list where you have to find
            them again. */}
        {!mailLoading && !mailError && mailProblemCount > 0 && (
          <Animated.View
            entering={
              reduceMotion ? undefined : FadeInDown.duration(240).delay(80).easing(EASE_OUT_QUART)
            }
          >
            <AnimatedPressable
              onPress={() => handleNavigate('AdminMailLog', { problemsOnly: true })}
              accessibilityRole="button"
              accessibilityLabel={
                `${mailProblemCount} ${mailProblemCount === 1 ? 'email' : 'emails'} did not send`
              }
              accessibilityHint="Opens the email delivery list, filtered to these"
            >
              <Card variant="flat" style={styles.mailCard}>
                <View style={styles.mailHeader}>
                  <Ionicons name="mail-unread-outline" size={18} color={Colors.light.danger} />
                  <Text style={styles.mailTitle}>
                    {mailProblemCount} {mailProblemCount === 1 ? 'email' : 'emails'} didn&apos;t send
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.icon} />
                </View>
                <Text style={styles.mailBlurb}>
                  Order receipts or support alerts that never reached anyone.
                </Text>
              </Card>
            </AnimatedPressable>
          </Animated.View>
        )}

        <View style={styles.grid}>
          {gridItems.map((item, index) => {
            const statusLabel = item.error
              ? 'unavailable'
              : item.loading
              ? 'loading'
              : item.caption ?? item.count;
            return (
              <Animated.View
                key={item.title}
                style={styles.gridItemWrap}
                entering={
                  reduceMotion
                    ? undefined
                    : FadeInDown.duration(240)
                        .delay(80 + index * 40)
                        .easing(EASE_OUT_QUART)
                }
              >
                <AnimatedPressable
                  onPress={() => handleNavigate(item.screen)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${statusLabel}`}
                  accessibilityHint={`Opens ${item.title} management`}
                >
                  <Card variant="flat" style={styles.gridCard}>
                    <View style={styles.gridIconWrap}>
                      <Ionicons name={item.icon} size={20} color={Colors.light.icon} />
                      {item.badge && (
                        <View style={styles.badgeDot}>
                          <Text style={styles.badgeDotText} numberOfLines={1}>
                            {item.count > 99 ? '99+' : item.count}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.gridTextGroup}>
                      <Text style={styles.gridTitle} numberOfLines={1}>{item.title}</Text>
                      {item.loading ? (
                        <SkeletonBlock style={styles.gridSkeleton} />
                      ) : item.error ? (
                        <Pressable
                          onPress={item.onRetry}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Retry loading ${item.title}`}
                          style={styles.errorRowCompact}
                        >
                          {({ pressed }) => (
                            <>
                              <Ionicons name="alert-circle-outline" size={13} color={Colors.light.danger} />
                              <Text
                                style={[styles.retryTextCompact, pressed && styles.retryTextPressed]}
                              >
                                Retry
                              </Text>
                            </>
                          )}
                        </Pressable>
                      ) : item.caption ? (
                        // A tile can carry a caption instead of a number
                        // when counting isn't meaningful — formatCount()
                        // would render a missing count as "0", which reads
                        // as "nothing here" rather than "not a count".
                        <Text style={styles.gridCaption}>{item.caption}</Text>
                      ) : (
                        <Text style={styles.gridCount}>{formatCount(item.count)}</Text>
                      )}
                    </View>
                  </Card>
                </AnimatedPressable>
              </Animated.View>
            );
          })}
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.light.icon,
    marginTop: 2,
  },
  logoutButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
  modalMessage: { fontSize: 15, color: Colors.light.icon, textAlign: 'center', marginBottom: Spacing.lg },
  content: {
    padding: Spacing.md,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: Spacing.xs,
  },
  subtext: {
    fontSize: 14,
    color: Colors.light.icon,
    marginBottom: Spacing.lg,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light.highlight + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTextGroup: { flex: 1 },
  heroLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.icon,
    marginBottom: 2,
  },
  heroValue: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.light.highlight,
  },
  heroSkeleton: {
    width: 150,
    height: 26,
    marginTop: 2,
  },
  heroCaption: {
    fontSize: 11,
    color: Colors.light.icon,
    marginTop: 4,
    lineHeight: 15,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.danger,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.tint,
    marginLeft: Spacing.xs,
  },
  retryTextPressed: {
    opacity: 0.6,
  },
  restockCard: { marginBottom: Spacing.md, gap: Spacing.sm },
  restockHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  restockTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.light.text },
  restockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  restockName: { flex: 1, fontSize: 13, color: Colors.light.icon },
  restockCount: { fontSize: 12, fontWeight: '600' },
  // Rust for sold out, Gold for merely low. Sold out is the one actively
  // costing sales; low is a heads-up, and giving both the danger color
  // would flatten the difference the sort order exists to express.
  restockCountOut: { color: Colors.light.danger },
  restockCountLow: { color: Colors.light.highlight },
  restockMore: { fontSize: 12, color: Colors.light.icon },
  // Deliberately the same shape as the restocking card — both say "this
  // needs attention", and giving them two different treatments would imply
  // a difference in kind that isn't there.
  mailCard: { marginBottom: Spacing.md, gap: Spacing.sm },
  mailHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  mailTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.light.text },
  mailBlurb: { fontSize: 12, color: Colors.light.icon },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  gridItemWrap: {
    width: '47%',
    flexGrow: 1,
  },
  gridCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  gridIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.danger,
    borderWidth: 2,
    borderColor: Colors.light.background,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeDotText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  gridTextGroup: { flex: 1 },
  gridTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 2,
  },
  gridCount: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
  },
  // Sits where a count would so tiles keep a common baseline, but at body
  // weight — it's a label, not a figure, and shouldn't compete with the
  // real numbers beside it.
  gridCaption: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.light.icon,
    paddingVertical: 3,
  },
  gridSkeleton: {
    width: 40,
    height: 20,
    marginTop: 2,
  },
  errorRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  retryTextCompact: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.light.tint,
  },
  bottomPadding: { height: Spacing.xl },
});
