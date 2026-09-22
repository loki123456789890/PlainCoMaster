// screens/SandboxPaymentScreen.js
//
// The simulated payment step, and the one screen in PlainCo that must
// never be mistaken for the real thing.
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
// actually gives you.
//
// WHAT IT DOES AND DOES NOT DECIDE. It collects a scenario id and hands it
// back to CheckoutScreen, which passes it to placeOrder. It does not place
// the order, does not touch Firestore, and cannot mark anything paid — the
// server reads the scenario, decides the consequence, and refuses the
// whole order if the answer is no. See functions/index.js.
//
// The banner at the top is not decoration. Every state of this screen says
// no real money moves, because a screenshot of it will outlive the
// conversation that explains it.
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  SANDBOX_SCENARIOS,
  getPaymentLabel,
  getPaymentIcon,
} from '../constants/payment';
import { Colors, Spacing, Radius } from '../constants/theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import { EASE_OUT_QUART } from '../constants/motion';

// Long enough to read as work being done, short enough that nobody taps
// twice wondering whether it registered. The button is disabled
// throughout, so the delay cannot produce a second submission.
const PROCESSING_MS = 1400;

export default function SandboxPaymentScreen({ navigation, route }) {
  const amount = route.params?.amount ?? 0;
  const paymentMethod = route.params?.paymentMethod;
  const [selected, setSelected] = useState('approved');
  const [processing, setProcessing] = useState(false);
  const reduceMotion = useReducedMotion();

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
    setTimeout(() => {
      navigation.navigate({
        name: 'Checkout',
        params: {
          // Returned alongside the result because checkout does not
          // reliably come back holding the lines it was opened with —
          // it can remount with only what this navigate carries. Sending
          // them back is what keeps the order that gets submitted equal
          // to the order that was reviewed.
          orderItems: route.params?.orderItems || [],
          // The method travels back for the same reason the lines do:
          // checkout's chosen-method STATE does not survive the remount
          // either, and an order submitted without one is refused with
          // "Choose a payment method" over a choice the customer plainly
          // made.
          sandboxResult: { outcome: selected, paymentMethod, at: Date.now() },
        },
        merge: true,
      });
    }, PROCESSING_MS);
  };

  const handleCancel = () => {
    if (processing) return;
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Payment</Text>
        <Text style={styles.headerSubtitle}>{getPaymentLabel(paymentMethod)}</Text>
      </View>

      <View style={styles.sandboxBanner}>
        <Ionicons name="flask-outline" size={16} color={Colors.light.highlight} />
        <Text style={styles.sandboxBannerText}>
          Sandbox mode — this is a simulation. No real money moves and no card details are collected.
        </Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.amountCard}>
          <Ionicons name={getPaymentIcon(paymentMethod)} size={22} color={Colors.light.tint} />
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <Text style={styles.amountLabel}>Amount due</Text>
            <Text style={styles.amountValue}>₱{Number(amount).toFixed(2)}</Text>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>What should the test gateway answer?</Text>
        <Text style={styles.sectionHint}>
          You still press Pay below. This only sets what the pretend bank replies,
          so every outcome — including the ones that go wrong — can be shown on purpose.
        </Text>

        {SANDBOX_SCENARIOS.map((scenario) => {
          const isSelected = selected === scenario.id;
          return (
            <AnimatedPressable
              key={scenario.id}
              onPress={() => handleSelect(scenario.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled: processing }}
              accessibilityLabel={`${scenario.label}. ${scenario.detail}`}
            >
              <Card
                variant="flat"
                style={[styles.scenarioCard, isSelected && styles.scenarioCardActive]}
              >
                <Ionicons
                  name={scenario.icon}
                  size={20}
                  color={scenario.approves ? Colors.light.success : Colors.light.danger}
                />
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <Text style={styles.scenarioLabel}>{scenario.label}</Text>
                  <Text style={styles.scenarioDetail}>{scenario.detail}</Text>
                </View>
                <Ionicons
                  name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={isSelected ? Colors.light.tint : Colors.light.border}
                />
              </Card>
            </AnimatedPressable>
          );
        })}

        {processing && (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(220).easing(EASE_OUT_QUART)}
            style={styles.processingRow}
          >
            <ActivityIndicator size="small" color={Colors.light.tint} />
            <Text style={styles.processingText}>Contacting the sandbox gateway…</Text>
          </Animated.View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={processing ? 'Processing…' : `Pay ₱${Number(amount).toFixed(2)}`}
          onPress={handleConfirm}
          loading={processing}
        />
        <Button
          label="Cancel"
          variant="outline"
          onPress={handleCancel}
          disabled={processing}
          style={styles.cancelButton}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  headerTitle: { fontSize: 24, fontWeight: '700', color: Colors.light.text },
  headerSubtitle: { fontSize: 14, color: Colors.light.icon, marginTop: 2 },
  sandboxBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.highlight + '55',
    backgroundColor: Colors.light.highlight + '12',
  },
  sandboxBannerText: { flex: 1, fontSize: 12, lineHeight: 17, color: Colors.light.highlight },
  content: { flex: 1, paddingHorizontal: Spacing.md, marginTop: Spacing.md },
  amountCard: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.lg },
  amountLabel: { fontSize: 12, color: Colors.light.icon },
  amountValue: { fontSize: 22, fontWeight: '700', color: Colors.light.text, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  sectionHint: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.light.icon,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  scenarioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  scenarioCardActive: { borderColor: Colors.light.tint },
  scenarioLabel: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  scenarioDetail: { fontSize: 12, lineHeight: 17, color: Colors.light.icon, marginTop: 2 },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  processingText: { fontSize: 13, color: Colors.light.icon },
  footer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  cancelButton: { marginTop: Spacing.sm, marginBottom: Spacing.sm },
});
