// screens/OnlinePaymentScreen.js
//
// The real payment step: sends the customer to PayMongo's hosted page and
// waits for the answer. The sandbox screen's counterpart when
// config/payments.gateway is 'paymongo'.
//
// WHAT DECIDES THE OUTCOME. Not the browser. Coming back from PayMongo
// with "success" in the URL proves nothing, because anyone can type a URL.
// The order exists only once the server has it from PayMongo, either
// through the webhook or by asking PayMongo itself (resolveCheckout). This
// screen watches the checkout document, which only the server writes, and
// moves on when that says 'paid' or 'released'.
//
// WHY BACKING OUT ASKS THE SERVER FIRST. A customer can pay and then close
// the browser before it returns, which looks the same as giving up. So
// "cancel" goes through resolveCheckout with abandon, which checks PayMongo
// for a payment before giving the stock back. If there was one, the order
// is placed and this screen shows the confirmation instead.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebaseConfig';
import { PAYMENT_LOOK, getPaymentLabel } from '../constants/payment';
import { Colors } from '../constants/theme';
import { paymentReturnUrl } from '../utils/paymentReturn';
import { showAppAlert } from '../utils/appAlert';
import Button from '../components/ui/Button';
import Reveal from '../components/shop/Reveal';
import { TopBar } from '../components/shop/TabScreen';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;

// How long "Confirming your payment" waits after a successful return before
// it admits the answer is slow. Wallets usually confirm in seconds; past
// this the customer deserves to know what is going on and what they can do.
const CONFIRM_PATIENCE_MS = 40000;

function MethodTile({ look, size = 36, radius = 11, fontSize = 15 }) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: radius, backgroundColor: look.tile }]}>
      {look.letter ? (
        <Text style={[styles.tileLetter, { fontSize }]}>{look.letter}</Text>
      ) : (
        <Ionicons name={look.icon} size={fontSize + 4} color="#fff" />
      )}
    </View>
  );
}

function Spinner({ look }) {
  const reduceMotion = useReducedMotion();
  const spin = useSharedValue(0);
  useEffect(() => {
    if (!reduceMotion) spin.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1);
  }, [reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  return (
    <View style={styles.orbit}>
      <Animated.View style={[styles.orbitRing, ring]} />
      <MethodTile look={look} size={52} radius={16} fontSize={22} />
    </View>
  );
}

const holdTime = (ms) => {
  if (!ms) return null;
  const date = new Date(ms);
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
};

export default function OnlinePaymentScreen({ navigation, route }) {
  const { checkoutId, checkoutUrl, total = 0, paymentMethod, orderItems = [], expiresAt } = route.params || {};
  const insets = useSafeAreaInsets();
  // 'paying'     — the page is open, or ready to open again
  // 'confirming' — back from PayMongo, asking whether it went through
  // 'slow'       — confirming is taking longer than it should
  // 'cancelling' — backing out, which first checks nothing was paid
  const [phase, setPhase] = useState('paying');
  const [browserOpen, setBrowserOpen] = useState(false);
  // Set once this screen hands over to the next one, so the leave guard
  // below lets that navigation through.
  const finished = useRef(false);
  const slowTimer = useRef(null);

  const label = getPaymentLabel(paymentMethod);
  const look = PAYMENT_LOOK[paymentMethod] || { tile: MUTED, icon: 'card-outline', name: label };

  const finishPaid = useCallback(
    (receipt) => {
      if (finished.current) return;
      finished.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Same as Checkout does for COD: the order exists, so back must not
      // lead into a checkout that would place it again.
      navigation.reset({
        index: 1,
        routes: [
          { name: 'Home' },
          { name: 'OrderConfirmation', params: { order: receipt } },
        ],
      });
    },
    [navigation]
  );

  const finishUnpaid = useCallback(
    (outcome) => {
      if (finished.current) return;
      finished.current = true;
      // Back to Checkout with the lines and method, for the same remount
      // reason SandboxPaymentScreen spells out, and `at` so a second
      // identical outcome still registers there.
      navigation.navigate({
        name: 'Checkout',
        params: { orderItems, onlineResult: { outcome, paymentMethod, at: Date.now() } },
        merge: true,
      });
    },
    [navigation, orderItems, paymentMethod]
  );

  // The server's word, live. Everything else on this screen is a guess
  // about what the customer did; this is what actually happened.
  useEffect(() => {
    if (!checkoutId) return undefined;
    return onSnapshot(
      doc(db, 'checkouts', checkoutId),
      (snap) => {
        const checkout = snap.data();
        if (!checkout) return;
        if (checkout.status === 'paid' && checkout.receipt) finishPaid(checkout.receipt);
        else if (checkout.status === 'released') {
          finishUnpaid(checkout.releaseReason === 'expired' ? 'expired' : 'cancelled');
        }
      },
      (error) => console.warn('Watching checkout failed:', error)
    );
  }, [checkoutId, finishPaid, finishUnpaid]);

  useEffect(() => () => clearTimeout(slowTimer.current), []);

  const resolve = useCallback(
    async (abandon) => {
      try {
        const { data } = await httpsCallable(functions, 'resolveCheckout')({ checkoutId, abandon });
        if (data?.status === 'paid' && data.receipt) finishPaid(data.receipt);
        else if (data?.status === 'released') finishUnpaid(abandon ? 'cancelled' : 'expired');
        return data?.status || 'pending';
      } catch (error) {
        console.warn('resolveCheckout failed:', error);
        return 'pending';
      }
    },
    [checkoutId, finishPaid, finishUnpaid]
  );

  const confirm = useCallback(async () => {
    setPhase('confirming');
    clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setPhase((p) => (p === 'confirming' ? 'slow' : p)), CONFIRM_PATIENCE_MS);
    await resolve(false);
    // Still pending: the snapshot listener takes it from here when the
    // webhook lands.
  }, [resolve]);

  const cancel = useCallback(async () => {
    setPhase('cancelling');
    const status = await resolve(true);
    // Could not confirm PayMongo stopped taking payment (or could not
    // reach it). The hold stays and the customer can try again or wait.
    if (status === 'pending' && !finished.current) {
      setPhase('paying');
      showAppAlert(
        "Couldn't cancel yet",
        `We couldn't confirm with ${label} that the payment was stopped, so your items are still held. Try again in a moment — if you did pay, your order will appear in My Orders.`
      );
    }
  }, [resolve, label]);

  const openPage = useCallback(async () => {
    if (!checkoutUrl || browserOpen) return;
    setBrowserOpen(true);
    setPhase('paying');
    let result;
    try {
      result = await WebBrowser.openAuthSessionAsync(checkoutUrl, paymentReturnUrl());
    } catch (error) {
      console.warn('Opening PayMongo failed:', error);
      result = { type: 'dismiss' };
    } finally {
      setBrowserOpen(false);
    }
    if (finished.current) return;

    const url = result?.type === 'success' ? result.url || '' : '';
    if (/[?&]result=success\b/.test(url)) {
      confirm();
    } else if (/[?&]result=cancel\b/.test(url)) {
      // PayMongo's own "back" link: a clear decision to stop.
      cancel();
    } else {
      // Closed the browser. Could be a change of mind, could be a payment
      // that finished just before — find out, without cancelling anything.
      const status = await resolve(false);
      if (status === 'pending' && !finished.current) setPhase('paying');
    }
  }, [checkoutUrl, browserOpen, confirm, cancel, resolve]);

  // Straight to PayMongo on arrival: the customer already pressed Pay.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    openPage();
  }, [openPage]);

  const askCancel = useCallback(() => {
    showAppAlert('Cancel this payment?', 'Your items will go back on sale and nothing will be charged.', [
      { text: 'Keep paying', style: 'cancel' },
      { text: 'Cancel payment', style: 'destructive', onPress: cancel },
    ]);
  }, [cancel]);

  // Back — the arrow, the gesture, Android's button — means cancel, and a
  // cancel has to go through the server or the stock stays held for half
  // an hour. So leaving is intercepted until the server has answered.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (finished.current) return;
        event.preventDefault();
        if (phase !== 'cancelling') askCancel();
      }),
    [navigation, askCancel, phase]
  );

  const busy = phase === 'confirming' || phase === 'cancelling';
  const until = holdTime(expiresAt);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar title="Payment" onBack={askCancel} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Reveal delay={40} style={styles.amount}>
          <View style={styles.amountRing} pointerEvents="none" />
          <Text style={styles.amountLabel}>Amount to pay</Text>
          <Text style={styles.amountValue}>₱{Number(total).toFixed(2)}</Text>
          <View style={styles.via}>
            <MethodTile look={look} />
            <View style={{ flex: 1 }}>
              <Text style={styles.viaName}>{look.name}</Text>
              <Text style={styles.viaLine}>Secure checkout by PayMongo</Text>
            </View>
          </View>
        </Reveal>

        {busy || phase === 'slow' ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <Spinner look={look} />
            <Text style={styles.statusTitle}>
              {phase === 'cancelling'
                ? 'Cancelling…'
                : phase === 'slow'
                ? `Still waiting for ${label}`
                : 'Confirming your payment…'}
            </Text>
            <Text style={styles.statusText}>
              {phase === 'cancelling'
                ? `Checking with ${label} that nothing was charged.`
                : phase === 'slow'
                ? `${label} hasn't confirmed yet. If you paid, your order will appear in My Orders as soon as it does. You can leave this screen.`
                : "This usually takes a few seconds. Don't close PlainCo."}
            </Text>
          </View>
        ) : (
          <Reveal delay={100} style={styles.card}>
            <View style={styles.cardRow}>
              <Ionicons name="open-outline" size={18} color={Colors.light.tint} />
              <Text style={styles.cardText}>
                {browserOpen
                  ? `Finish paying on the ${label} page. You'll come back here when you're done.`
                  : `Pay on PayMongo's secure page. If you closed it by mistake, open it again below.`}
              </Text>
            </View>
            {until ? (
              <View style={styles.cardRow}>
                <Ionicons name="time-outline" size={18} color={MUTED} />
                <Text style={styles.cardText}>
                  We&apos;re holding your items until {until}. After that they go back on sale.
                </Text>
              </View>
            ) : null}
          </Reveal>
        )}

        <Reveal delay={160} style={styles.secure}>
          <Ionicons name="lock-closed-outline" size={14} color={MUTED} />
          <Text style={styles.secureText}>PlainCo never sees or stores your wallet or card details.</Text>
        </Reveal>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 14 }]}>
        {phase === 'slow' ? (
          <Button
            label="Go to My Orders"
            fontSize={15.5}
            onPress={() => {
              finished.current = true;
              navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Orders' }] });
            }}
            fullWidth
          />
        ) : (
          <Button
            label={browserOpen ? 'Paying…' : 'Open payment page'}
            fontSize={15.5}
            onPress={openPage}
            disabled={busy || browserOpen}
            fullWidth
          />
        )}
        <Button
          variant="secondary"
          label="Cancel payment"
          fontSize={15.5}
          onPress={askCancel}
          disabled={busy}
          fullWidth
          style={{ marginTop: 8 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scroll: { paddingBottom: 24 },

  tile: { alignItems: 'center', justifyContent: 'center' },
  tileLetter: { fontWeight: '700', color: '#fff' },

  amount: {
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 14,
    padding: 20,
    borderRadius: 24,
    backgroundColor: INK,
    overflow: 'hidden',
  },
  amountRing: {
    position: 'absolute',
    right: -40,
    top: -50,
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.1)',
  },
  amountLabel: { fontSize: 12, color: '#BDB3A9' },
  amountValue: { fontSize: 34, fontWeight: '600', letterSpacing: -0.7, color: '#F1D98A', marginTop: 2, marginBottom: 14 },
  via: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,247,242,0.12)',
  },
  viaName: { fontSize: 14, fontWeight: '600', color: Colors.light.background },
  viaLine: { fontSize: 11.5, color: '#BDB3A9' },

  card: {
    marginHorizontal: 20,
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    borderRadius: 18,
    padding: 14,
    gap: 12,
  },
  cardRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  cardText: { flex: 1, fontSize: 13, lineHeight: 19, color: INK },

  status: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 24 },
  orbit: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  orbitRing: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: '#EDE5DA',
    borderTopColor: Colors.light.tint,
  },
  statusTitle: { fontSize: 18, fontWeight: '600', color: INK, marginBottom: 6, textAlign: 'center' },
  statusText: { fontSize: 13, lineHeight: 20, color: MUTED, textAlign: 'center' },

  secure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, marginTop: 4 },
  secureText: { flexShrink: 1, fontSize: 11.5, color: MUTED },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(250,247,242,0.97)',
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
});
