// components/auth/StaffLoggedOut.js
//
// What staff see after logging out of the portal, from the approved
// store-manager preview: on ink like the rest of the Staff Portal, the
// wordmark, the STAFF PORTAL pill, a Moss tick, "You're logged out", and
// one way on — "Sign in again", which uncovers the sign-in form underneath.
import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/theme';
import Reveal from '../shop/Reveal';

const WORDMARK = require('../../assets/images/splash-wordmark-cream.png');
const INK = '#2B2622';
const CREAM = Colors.light.background;
const PILL_INK = '#E9A385';

export default function StaffLoggedOut({ visible, onSignIn }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal visible animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onSignIn}>
      <View style={[styles.screen, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
        <Reveal delay={40}>
          <Image source={WORDMARK} style={styles.wordmark} contentFit="contain" accessibilityLabel="PlainCo" />
        </Reveal>
        <Reveal delay={100} style={styles.pill}>
          <Ionicons name="shield-outline" size={13} color={PILL_INK} />
          <Text style={styles.pillText}>STAFF PORTAL</Text>
        </Reveal>
        <Reveal delay={180} style={styles.ok}>
          <Ionicons name="checkmark" size={34} color="#CFE0BF" />
        </Reveal>
        <Reveal delay={260}>
          <Text style={styles.title} accessibilityRole="header">
            You&apos;re logged out
          </Text>
          <Text style={styles.body}>
            Your store keeps running while you&apos;re away. Sign in again any time to pick up where you left off.
          </Text>
        </Reveal>
        <Reveal delay={340} style={{ alignSelf: 'stretch', alignItems: 'center' }}>
          <Pressable
            onPress={onSignIn}
            style={({ pressed }) => [styles.button, pressed && { transform: [{ scale: 0.97 }] }]}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Sign in again</Text>
          </Pressable>
        </Reveal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: INK, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  wordmark: { width: 107, height: 30 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(196,98,62,0.55)',
    backgroundColor: 'rgba(196,98,62,0.12)',
    marginTop: 18,
    marginBottom: 22,
  },
  pillText: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1.7, color: PILL_INK },
  ok: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: 'rgba(143,163,125,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 22, fontWeight: '600', color: CREAM, textAlign: 'center', marginTop: 18, marginBottom: 6 },
  body: { fontSize: 13, lineHeight: 20, color: '#BDB3A9', textAlign: 'center', maxWidth: 300, marginBottom: 22 },
  button: {
    width: '100%',
    maxWidth: 320,
    height: 54,
    borderRadius: 16,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15.5, fontWeight: '600', color: '#fff' },
});
