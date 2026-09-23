import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';
import { Colors } from '../constants/theme';
import { EASE_OUT_QUINT } from '../constants/motion';
import Button from './ui/Button';

// The policy itself. Every statement here was checked against what the app
// actually does — keep it that way when features change: a privacy policy
// that describes a different app is worse than a short one.
const UPDATED = 'September 2026';
const LEAD = [
  'PlainCo connects you with local Ukay-Ukay and Ready-to-Wear stores. This policy explains what personal information we collect, why we need it, and the rights you have under the ',
  { b: 'Data Privacy Act of 2012 (Republic Act No. 10173)' },
  '.',
];
const SECTIONS = [
  {
    id: 's1',
    chip: 'What we collect',
    title: 'Information we collect',
    items: [
      [{ b: 'Account details:' }, ' your name, email address, and password (passwords are handled by Firebase Authentication and are never visible to PlainCo or store staff).'],
      [{ b: 'Profile photo (optional):' }, ' a picture you choose to add. It appears on your profile and next to your reviews.'],
      [{ b: 'Delivery details:' }, ' recipient name, phone number, street address, city, province, and ZIP code.'],
      [{ b: 'Location (optional):' }, ' only when you tap "Use Current Location," to fill in your address. We do not track your location in the background.'],
      [{ b: 'Shopping activity:' }, ' your cart, favorites, orders, reviews, and the messages and photos you send to a store about an order.'],
    ],
  },
  {
    id: 's2',
    chip: 'How we use it',
    title: 'How we use your information',
    items: [
      ['To create and secure your account.'],
      ['To process your orders and deliver them to you.'],
      ['To email you a confirmation when you place an order.'],
      ['To show your order status and let you message the store about an order.'],
      ['To display your reviews on products you have purchased.'],
    ],
    after: [['We do not sell your personal information or use it for advertising.']],
  },
  {
    id: 's3',
    chip: 'Who sees it',
    title: 'Who can see your information',
    paragraphs: [
      ['When you place an order, the ', { b: 'store you ordered from' }, ' sees your name, delivery address, phone number, order details, and your messages about that order, so they can fulfil it. Stores cannot see your orders from other stores.'],
      ['PlainCo platform administrators can access account records to manage users and resolve issues.'],
      ['Your reviews are shown to other PlainCo shoppers with your first name and last initial (for example, "Juan D.") and your profile photo. Your full name is not shown.'],
    ],
  },
  {
    id: 's4',
    title: 'Payments',
    paragraphs: [
      ['Payments in this version are simulated. You can choose GCash, Maya, Card, or Cash on Delivery, but no money is charged in the app, and PlainCo does not collect or store card or e-wallet details.'],
    ],
  },
  {
    id: 's5',
    chip: 'Storage',
    title: 'How your data is stored and protected',
    paragraphs: [
      ['Your data is stored on Google Firebase (Authentication, Cloud Firestore, and Cloud Storage for photos). Data is encrypted in transit, and access is limited by security rules so that each user and store can only reach the records they are allowed to see. Firebase servers may be located outside the Philippines.'],
    ],
  },
  {
    id: 's6',
    title: 'How long we keep it',
    paragraphs: [
      ['We keep your information while your account is active. If you deactivate your account, you can no longer sign in, but your past order records are kept for transaction history.'],
    ],
  },
  {
    id: 's7',
    chip: 'Your rights',
    title: 'Your rights',
    paragraphs: [['Under the Data Privacy Act, you have the right to:']],
    items: [
      ['Be informed about how your data is processed.'],
      ['Access the personal data we hold about you.'],
      ['Correct inaccurate information.'],
      ['Object to processing, or request that your data be blocked or erased, subject to legal and transaction-record requirements.'],
      ['Obtain a copy of your data in a portable format.'],
      ['File a complaint with the National Privacy Commission.'],
    ],
  },
  {
    id: 's8',
    chip: 'Contact',
    title: 'Contact us',
    paragraphs: [
      ['For privacy questions or requests, send us a message through the ', { b: 'Contact Support' }, ' form in the Help Center (tap the ? at the top of your Profile). We will respond within a reasonable time.'],
    ],
  },
  {
    id: 's9',
    title: 'Changes to this policy',
    paragraphs: [['If we make significant changes, we will update the date above and let you know in the app.']],
  },
];

function Rich({ parts, style }) {
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        typeof part === 'string' ? part : (
          <Text key={i} style={styles.bold}>
            {part.b}
          </Text>
        )
      )}
    </Text>
  );
}

/**
 * The Privacy Policy, as a sheet that slides up over the screen.
 *
 * Shared by Sign Up (where `onAgree` adds an "I Agree" button that ticks
 * the consent box) and Profile (read-only: just Close). Tapping the scrim,
 * the X, or Android's back button closes it without agreeing.
 */
export default function PrivacyPolicyModal({ visible, onClose, onAgree }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheetHeight = Math.round(height * 0.88);

  // Stays mounted through the closing slide, then unmounts.
  const [mounted, setMounted] = useState(visible);
  const open = useSharedValue(0);
  const progress = useSharedValue(0);
  const scrollRef = useRef(null);
  const sectionY = useRef({});

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = 0;
      open.value = reduceMotion ? 1 : withTiming(1, { duration: 500, easing: EASE_OUT_QUINT });
    } else if (mounted) {
      const unmount = () => setMounted(false);
      if (reduceMotion) {
        open.value = 0;
        unmount();
      } else {
        open.value = withTiming(0, { duration: 350, easing: EASE_OUT_QUINT }, (finished) => {
          if (finished) runOnJS(unmount)();
        });
      }
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrimStyle = useAnimatedStyle(() => ({ opacity: open.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - open.value) * sheetHeight * 1.02 }],
  }));
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const handleScroll = (e) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const max = contentSize.height - layoutMeasurement.height;
    progress.value = max > 0 ? Math.min(1, Math.max(0, contentOffset.y / max)) : 1;
  };

  const jumpTo = (id) => {
    Haptics.selectionAsync();
    const y = sectionY.current[id];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: !reduceMotion });
  };

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close Privacy Policy" />
      </Animated.View>

      <Animated.View
        style={[styles.sheet, { height: sheetHeight }, sheetStyle]}
        accessibilityViewIsModal
        accessibilityLabel="Privacy Policy"
      >
        <View style={styles.grab} />
        <View style={styles.head}>
          <View>
            <Text style={styles.title} accessibilityRole="header">
              Privacy Policy
            </Text>
            <Text style={styles.updated}>Last updated: {UPDATED}</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.x, pressed && styles.xPressed]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={20} color={Colors.light.text} />
          </Pressable>
          {/* How far through the policy you are. */}
          <Animated.View style={[styles.progress, progressStyle]} />
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <Rich parts={LEAD} style={styles.lead} />

          <View style={styles.toc}>
            {SECTIONS.filter((s) => s.chip).map((s) => (
              <Pressable
                key={s.id}
                onPress={() => jumpTo(s.id)}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                accessibilityRole="link"
                accessibilityLabel={`Jump to ${s.title}`}
              >
                <Text style={styles.chipText}>{s.chip}</Text>
              </Pressable>
            ))}
          </View>

          {SECTIONS.map((s, index) => (
            <View
              key={s.id}
              style={styles.section}
              onLayout={(e) => {
                sectionY.current[s.id] = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.sectionHead}>
                <Text style={styles.sectionNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  {s.title}
                </Text>
              </View>
              {(s.paragraphs || []).map((p, i) => (
                <Rich key={`p${i}`} parts={p} style={styles.paragraph} />
              ))}
              {(s.items || []).map((item, i) => (
                <View key={`i${i}`} style={styles.item}>
                  <Text style={styles.bullet}>•</Text>
                  <Rich parts={item} style={styles.itemText} />
                </View>
              ))}
              {(s.after || []).map((p, i) => (
                <Rich key={`a${i}`} parts={p} style={[styles.paragraph, styles.afterList]} />
              ))}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 12) + 14 }]}>
          {onAgree ? (
            <>
              <Button variant="secondary" label="Close" fontSize={15} onPress={onClose} style={styles.footClose} />
              <Button variant="primary" label="I Agree" fontSize={15} onPress={onAgree} style={styles.footAgree} />
            </>
          ) : (
            <Button variant="primary" label="Close" fontSize={15} onPress={onClose} style={styles.footAgree} />
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const BODY_INK = '#453E38';

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(28,27,26,0.42)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8CFC4', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2, color: Colors.light.text },
  updated: { fontSize: 11.5, color: Colors.light.icon, marginTop: 1 },
  x: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(28,27,26,0.06)', alignItems: 'center', justifyContent: 'center' },
  xPressed: { backgroundColor: 'rgba(28,27,26,0.12)' },
  progress: { position: 'absolute', left: 0, bottom: -1, height: 2, backgroundColor: Colors.light.tint },

  body: { flex: 1 },
  bodyContent: { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 24 },
  lead: { fontSize: 13.5, lineHeight: 21, color: Colors.light.text, marginBottom: 14 },
  bold: { fontWeight: '600', color: Colors.light.text },
  toc: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 18 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  chipPressed: { backgroundColor: Colors.light.border },
  chipText: { fontSize: 11.5, fontWeight: '500', color: Colors.light.text },

  section: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.light.border },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 6 },
  sectionNumber: { fontSize: 11, fontWeight: '600', letterSpacing: 0.7, color: Colors.light.tint },
  sectionTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.light.text },
  paragraph: { fontSize: 13, lineHeight: 21, color: BODY_INK, marginBottom: 8 },
  afterList: { marginTop: 6 },
  item: { flexDirection: 'row', paddingLeft: 4, marginBottom: 4 },
  bullet: { width: 14, fontSize: 13, lineHeight: 21, color: BODY_INK },
  itemText: { flex: 1, fontSize: 13, lineHeight: 21, color: BODY_INK },

  foot: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  footClose: { flexBasis: '38%', flexGrow: 0, minHeight: 50 },
  footAgree: { flex: 1, minHeight: 50 },
});
