// screens/SandboxPaymentScreen.js
//
// The simulated payment step, in the approved payment/orders/account
// preview's design, and the one screen in PlainCo that must never be
// mistaken for the real thing.
//
// WHY THIS IS NOT A CARD FORM. The obvious way to mock a payment is to
// draw the form a real one would show — card number, expiry, CVC — and
// accept a magic test number. This app specifically must not: HelpScreen's
// FAQ and LandingScreen both tell customers "No Card Info Stored", and an
// earlier PaymentScreen.js was deleted from this repo precisely because it
// carried invented saved cards ("Visa •••• 4242", cardholder "John Doe")
// that contradicted that promise in the source. A reviewer greps for card
// fields; there must be none to find. So this screen asks for a SCENARIO
// instead — which is also, not coincidentally, what a test gateway
// actually gives you. (The preview's "Test wallet · 0917 •••• 567" line is
// left out for the same reason: there is no wallet to show.)
//
// WHAT IT DOES AND DOES NOT DECIDE. It collects a scenario id and hands it
// back to CheckoutScreen, which passes it to placeOrder. It does not place
// the order, does not touch Firestore, and cannot mark anything paid — the
// server reads the scenario, decides the consequence, and refuses the
// whole order if the answer is no. See functions/index.js. A refusal is
// shown on Checkout, in a sheet, because that is where the answer arrives.
//
// The "Test mode" panel is not decoration. Every state of this screen says
// no real money moves, because a screenshot of it will outlive the
// conversation that explains it.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { SANDBOX_SCENARIOS, PAYMENT_LOOK, getPaymentLabel } from '../constants/payment';
import { Colors } from '../constants/theme';
import { useStores } from '../context/StoreContext';
import Button from '../components/ui/Button';
import Reveal from '../components/shop/Reveal';
import { TopBar } from '../components/shop/TabScreen';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;

// Long enough to read as work being done, short enough that nobody taps
// twice wondering whether it registered. The button is disabled
// throughout, so the delay cannot produce a second submission.
const PROCESSING_MS = 1800;
// "No response" is shown by actually waiting, with a countdown, so the
// case it demonstrates — a gateway that never answers — is felt, not
// described.
const TIMEOUT_MS = 6000;

// The four answers as tiles: short name, what it means, and a colour.
const OUTCOME_LOOK = {
  approved: { name: 'Succeeds', line: 'Order is placed and marked Paid', icon: 'checkmark-circle-outline', color: Colors.light.secondary },
  declined: { name: 'Declined', line: 'The bank refuses the payment', icon: 'close-circle-outline', color: '#B42318' },
  insufficient_funds: { name: 'Low balance', line: 'Not enough money in the wallet', icon: 'wallet-outline', color: Colors.light.tint },
  timeout: { name: 'No response', line: 'The gateway never answers (timeout)', icon: 'time-outline', color: '#8C6D0C' },
};

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

// "Waiting for GCash…": a ring turning around the method's tile and a bar
// filling for as long as the pretend gateway takes.
function Authorizing({ visible, look, label, duration, countdown }) {
  const reduceMotion = useReducedMotion();
  const spin = useSharedValue(0);
  const bar = useSharedValue(0);
  const [left, setLeft] = useState(null);

  useEffect(() => {
    if (!visible) return undefined;
    bar.value = 0;
    bar.value = withTiming(countdown ? 1 : 0.9, { duration, easing: Easing.linear });
    spin.value = 0;
    if (!reduceMotion) spin.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1);
    if (!countdown) return undefined;
    const end = Date.now() + duration;
    setLeft(Math.round(duration / 1000));
    const timer = setInterval(() => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250);
    return () => clearInterval(timer);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const fill = useAnimatedStyle(() => ({ width: `${bar.value * 100}%` }));

  if (!visible) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => {}}>
      <View style={styles.auth} accessibilityViewIsModal accessibilityLiveRegion="polite">
        <View style={styles.orbit}>
          <Animated.View style={[styles.orbitRing, ring]} />
          <MethodTile look={look} size={52} radius={16} fontSize={22} />
        </View>
        <Text style={styles.authTitle}>Waiting for {label}…</Text>
        <Text style={styles.authText}>This is a test payment. Don&apos;t close PlainCo.</Text>
        <View style={styles.progress}>
          <Animated.View style={[styles.progressFill, fill]} />
        </View>
        <Text style={styles.authSmall}>{countdown && left ? `Timing out in ${left}s` : ' '}</Text>
      </View>
    </Modal>
  );
}

export default function SandboxPaymentScreen({ navigation, route }) {
  const amount = route.params?.amount ?? 0;
  const paymentMethod = route.params?.paymentMethod;
  const orderItems = route.params?.orderItems || [];
  const deliverTo = route.params?.deliverTo;
  const [selected, setSelected] = useState('approved');
  const [processing, setProcessing] = useState(false);
  const [testOpen, setTestOpen] = useState(true);
  const insets = useSafeAreaInsets();
  const { getStore } = useStores();
  const timer = useRef(null);
  // The overlay is a Modal, which on web outlives the navigation back to
  // Checkout; tied to focus, it goes the moment this screen is left.
  const focused = useIsFocused();

  useEffect(() => () => clearTimeout(timer.current), []);

  const label = getPaymentLabel(paymentMethod);
  const look = PAYMENT_LOOK[paymentMethod] || { tile: MUTED, icon: 'card-outline', name: label };
  const itemCount = orderItems.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const firstName = orderItems[0]?.name;
  const orderLine = firstName
    ? `${firstName}${orderItems.length > 1 ? ` + ${orderItems.length - 1} more` : ''} · ${itemCount} item${itemCount === 1 ? '' : 's'}`
    : null;
  const storeNames = [...new Set(orderItems.map((item) => getStore(item.storeId)?.name).filter(Boolean))];
  const waitFor = selected === 'timeout' ? TIMEOUT_MS : PROCESSING_MS;

  const handleSelect = (id) => {
    if (processing || id === selected) return;
    Haptics.selectionAsync();
    setSelected(id);
  };

  const handleConfirm = () => {
    if (processing) return;
    setProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Returns to Checkout rather than pushing a second copy of it.
    //
    // merge: true was originally here on the assumption that it preserved
    // what checkout was opened with. It does not: running the app showed
    // checkout REMOUNTING on the way back, losing both its params and its
    // state. Everything the order needs is therefore sent explicitly
    // below, and merge is kept only so unrelated params survive.
    timer.current = setTimeout(() => {
      navigation.navigate({
        name: 'Checkout',
        params: {
          // Returned alongside the result because checkout does not
          // reliably come back holding the lines it was opened with —
          // it can remount with only what this navigate carries. Sending
          // them back is what keeps the order that gets submitted equal
          // to the order that was reviewed.
          orderItems,
          // The method travels back for the same reason the lines do:
          // checkout's chosen-method STATE does not survive the remount
          // either, and an order submitted without one is refused with
          // "Choose a payment method" over a choice the customer plainly
          // made.
          sandboxResult: { outcome: selected, paymentMethod, at: Date.now() },
        },
        merge: true,
      });
    }, waitFor);
  };

  const handleCancel = () => {
    if (processing) return;
    navigation.goBack();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar title="Payment" onBack={handleCancel} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Reveal delay={40} style={styles.amount}>
          <View style={styles.amountRing} pointerEvents="none" />
          <Text style={styles.amountLabel}>Amount to pay</Text>
          <Text style={styles.amountValue}>₱{Number(amount).toFixed(2)}</Text>
          <View style={styles.via}>
            <MethodTile look={look} />
            <View style={{ flex: 1 }}>
              <Text style={styles.viaName}>{look.name}</Text>
              <Text style={styles.viaLine}>Test payment · no real money moves</Text>
            </View>
            <Pressable onPress={handleCancel} disabled={processing} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change payment method">
              <Text style={styles.viaChange}>Change</Text>
            </Pressable>
          </View>
        </Reveal>

        {orderLine || storeNames.length || deliverTo ? (
          <Reveal delay={100} style={styles.order}>
            {orderLine ? (
              <View style={styles.orderRow}>
                <Text style={styles.orderLabel}>Order</Text>
                <Text style={styles.orderValue} numberOfLines={1}>
                  {orderLine}
                </Text>
              </View>
            ) : null}
            {storeNames.length ? (
              <View style={styles.orderRow}>
                <Text style={styles.orderLabel}>{storeNames.length > 1 ? 'Stores' : 'Store'}</Text>
                <Text style={styles.orderValue} numberOfLines={1}>
                  {storeNames.join(', ')}
                </Text>
              </View>
            ) : null}
            {deliverTo ? (
              <View style={styles.orderRow}>
                <Text style={styles.orderLabel}>Deliver to</Text>
                <Text style={styles.orderValue} numberOfLines={1}>
                  {deliverTo}
                </Text>
              </View>
            ) : null}
          </Reveal>
        ) : null}

        <Reveal delay={160} style={styles.test}>
          <Pressable
            onPress={() => setTestOpen((open) => !open)}
            style={styles.testHead}
            accessibilityRole="button"
            accessibilityState={{ expanded: testOpen }}
            accessibilityLabel={`Test mode. No real money moves. Gateway answer: ${OUTCOME_LOOK[selected].name}`}
          >
            <Ionicons name="flask-outline" size={20} color="#6B5A2E" />
            <View style={{ flex: 1 }}>
              <Text style={styles.testTitle}>Test mode</Text>
              <Text style={styles.testSub}>No real money moves</Text>
            </View>
            <Text style={styles.testCurrent}>{OUTCOME_LOOK[selected].name}</Text>
            <Ionicons name={testOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#6B5A2E" />
          </Pressable>
          {testOpen ? (
            <View>
              <Text style={styles.testText}>
                This is a sandbox gateway. Choose how the pretend bank responds, so you can show every outcome on purpose,
                including the ones that fail.
              </Text>
              <View style={styles.outcomes} accessibilityRole="radiogroup">
                {SANDBOX_SCENARIOS.map((scenario) => {
                  const o = OUTCOME_LOOK[scenario.id];
                  const on = selected === scenario.id;
                  return (
                    <Pressable
                      key={scenario.id}
                      onPress={() => handleSelect(scenario.id)}
                      style={[styles.outcome, on && styles.outcomeOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on, disabled: processing }}
                      accessibilityLabel={`${o.name}. ${o.line}`}
                    >
                      <Ionicons name={o.icon} size={18} color={o.color} />
                      <Text style={styles.outcomeName}>{o.name}</Text>
                      <Text style={styles.outcomeLine}>{o.line}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </Reveal>

        <Reveal delay={220} style={styles.secure}>
          <Ionicons name="lock-closed-outline" size={14} color={MUTED} />
          <Text style={styles.secureText}>PlainCo never sees or stores your wallet or card details.</Text>
        </Reveal>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 14 }]}>
        <Button label={`Pay ₱${Number(amount).toFixed(2)}`} fontSize={15.5} onPress={handleConfirm} disabled={processing} fullWidth />
        <Pressable
          onPress={handleCancel}
          disabled={processing}
          style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      <Authorizing visible={processing && focused} look={look} label={label} duration={waitFor} countdown={selected === 'timeout'} />
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
  viaChange: { fontSize: 12, fontWeight: '600', color: '#F0B79E' },

  order: {
    marginHorizontal: 20,
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 3 },
  orderLabel: { fontSize: 12.5, color: MUTED },
  orderValue: { flexShrink: 1, fontSize: 12.5, fontWeight: '500', color: INK, textAlign: 'right' },

  test: {
    marginHorizontal: 20,
    marginBottom: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D9C9A6',
    borderRadius: 18,
    backgroundColor: '#FBF6EA',
    overflow: 'hidden',
  },
  testHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  testTitle: { fontSize: 13, fontWeight: '600', color: '#6B5A2E' },
  testSub: { fontSize: 11.5, color: '#6B5A2E' },
  testCurrent: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#6B5A2E',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6D9BA',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  testText: { fontSize: 11.5, lineHeight: 17, color: '#7A6A3E', marginHorizontal: 14, marginBottom: 10 },
  outcomes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  outcome: {
    width: '48%',
    flexGrow: 1,
    gap: 4,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EDE3CC',
  },
  outcomeOn: { borderColor: Colors.light.tint, backgroundColor: '#FDF6F2' },
  outcomeName: { fontSize: 12.5, fontWeight: '600', color: INK },
  outcomeLine: { fontSize: 10.5, lineHeight: 14, color: MUTED },

  secure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, marginTop: 4 },
  secureText: { flexShrink: 1, fontSize: 11.5, color: MUTED },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(250,247,242,0.97)',
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  cancel: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelText: { fontSize: 15.5, fontWeight: '600', color: MUTED },

  auth: {
    flex: 1,
    backgroundColor: 'rgba(250,247,242,0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
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
  authTitle: { fontSize: 18, fontWeight: '600', color: INK, marginBottom: 6, textAlign: 'center' },
  authText: { fontSize: 13, lineHeight: 20, color: MUTED, textAlign: 'center' },
  progress: { width: 200, height: 4, borderRadius: 2, backgroundColor: '#EDE5DA', marginTop: 20, marginBottom: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: Colors.light.tint },
  authSmall: { fontSize: 11.5, color: MUTED, minHeight: 16 },
});
