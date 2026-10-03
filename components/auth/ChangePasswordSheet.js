// components/auth/ChangePasswordSheet.js
//
// Change password while signed in: Profile for shoppers, the Store Manager
// dashboard and Manage Users for staff. Firebase wants the current password
// again before it changes one, which also keeps someone holding an
// unlocked phone from taking the account. Forgot it? sends the reset link
// from here, to the address on the account, without logging out first.
//
// Layout from the approved change-password preview: a lock that closes once
// every check passes, floating labels, a strength meter, three rule chips,
// and a button that stays off until the form is right.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeIn,
  FadeOut,
  ZoomIn,
} from 'react-native-reanimated';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';
import Button from '../ui/Button';
import Sheet from '../shop/Sheet';
import { AuthAlert, FadeUp, useShakeOn, useShakes, PASSWORD_MIN } from './AuthKit';

const EMPTY = { current: '', next: '', confirm: '' };

const WRONG_PASSWORD = ['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'];
const WEAK_PASSWORD = ['auth/weak-password', 'auth/password-does-not-meet-requirements'];

const C = Colors.light;
const ERR = '#B3402A';
const MUTED_LABEL = '#8B8279';
const CHIP_BG = '#F1EBE2';
const CLAY_TINT = '#F6E6DE';

// What isn't one field's fault goes in the box above the form.
function alertForError(code) {
  switch (code) {
    case 'auth/too-many-requests':
      return { kind: 'err', title: 'Too many attempts.', body: 'Wait a few minutes, or reset your password by email instead.' };
    case 'auth/network-request-failed':
      return { kind: 'err', title: 'Network connection lost.', body: 'Please check your connection and try again.' };
    default:
      return { kind: 'err', title: "Couldn't change your password.", body: 'Something went wrong. Please try again.' };
  }
}

function alertForResetError(code) {
  switch (code) {
    case 'auth/network-request-failed':
      return { kind: 'err', title: 'No internet connection.', body: 'Check your connection and try again.' };
    case 'auth/too-many-requests':
      return { kind: 'err', title: 'Too many requests.', body: 'Please wait a few minutes and try again.' };
    default:
      return { kind: 'err', title: "Couldn't send the link.", body: 'Something went wrong. Please try again.' };
  }
}

// "sunflower@gmail.com" -> "s•••••••r@gmail.com"
function maskEmail(email) {
  if (!email) return 'your email';
  const [name, domain] = email.split('@');
  if (!domain || name.length < 3) return email;
  return `${name[0]}${'•'.repeat(Math.min(name.length - 2, 8))}${name[name.length - 1]}@${domain}`;
}

// 0–4 bars, a word, and the bars' color. Short passwords get one Clay bar;
// past the minimum it's never fewer than two, so a valid one never reads red.
function strength(v) {
  if (!v) return [0, ' ', C.tint];
  if (v.length < PASSWORD_MIN) return [1, 'Too short', C.tint];
  let s = 1;
  if (v.length >= 12) s += 1;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s += 1;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s += 1;
  else if (/\d|[^A-Za-z0-9]/.test(v) && s < 2) s += 0.5;
  s = Math.min(4, Math.max(2, Math.round(s + 0.4)));
  return [s, ['', '', 'Okay', 'Good', 'Strong'][s], ['', '', '#8E8A5A', '#6F7F5C', C.success][s]];
}

// A password field whose label sits inside the box and floats up once
// there's something typed (or it's focused).
function FloatField({ label, value, status, inputRef, shakeKey, toggleLabel, ...inputProps }) {
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const good = status === 'good';
  const bad = status === 'bad';

  const lift = useSharedValue(value ? 1 : 0);
  const up = focused || !!value;
  useEffect(() => {
    lift.value = reduceMotion ? (up ? 1 : 0) : withTiming(up ? 1 : 0, { duration: 200, easing: EASE_OUT_QUINT });
  }, [up]); // eslint-disable-line react-hooks/exhaustive-deps
  const labelStyle = useAnimatedStyle(() => ({
    top: 17 - lift.value * 10,
    fontSize: 14 - lift.value * 3.5,
  }));

  const tick = useSharedValue(0);
  useEffect(() => {
    tick.value = reduceMotion ? (good ? 1 : 0) : withTiming(good ? 1 : 0, { duration: 300, easing: EASE_OUT_QUINT });
  }, [good]); // eslint-disable-line react-hooks/exhaustive-deps
  const tickStyle = useAnimatedStyle(() => ({ transform: [{ scale: tick.value }] }));
  const shakeStyle = useShakeOn(shakeKey);

  const borderColor = bad ? ERR : focused ? C.tint : C.border;
  const labelColor = bad ? ERR : focused ? C.tint : up ? C.icon : MUTED_LABEL;

  return (
    <Animated.View style={[styles.fieldWrap, shakeStyle]}>
      {focused || bad ? (
        <View style={[styles.ring, { backgroundColor: bad ? 'rgba(179,64,42,0.12)' : 'rgba(196,98,62,0.13)' }]} />
      ) : null}
      <View style={[styles.box, { borderColor }]}>
        <TextInput
          {...inputProps}
          ref={inputRef}
          value={value}
          style={[styles.input, !revealed && value ? styles.inputHidden : null]}
          secureTextEntry={!revealed}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
        />
        <Animated.View style={[styles.ok, tickStyle]} pointerEvents="none">
          <Ionicons name="checkmark" size={13} color="#fff" />
        </Animated.View>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            setRevealed((v) => !v);
          }}
          style={styles.eye}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`${revealed ? 'Hide' : 'Show'} ${toggleLabel}`}
        >
          <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={revealed ? C.tint : '#7A7168'} />
        </Pressable>
      </View>
      <Animated.Text style={[styles.floatLabel, { color: labelColor }, up && styles.floatLabelUp, labelStyle]} pointerEvents="none">
        {label}
      </Animated.Text>
    </Animated.View>
  );
}

function FieldError({ text }) {
  if (!text) return null;
  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.msg} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" size={14} color={ERR} style={styles.msgIcon} />
      <Text style={styles.msgText}>{text}</Text>
    </Animated.View>
  );
}

function StepLabel({ children, action }) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepText}>{children}</Text>
      <View style={styles.stepLine} />
      {action}
    </View>
  );
}

function Rule({ on, no, label }) {
  return (
    <View
      style={[styles.rule, on && styles.ruleOn, no && styles.ruleNo]}
      accessible
      accessibilityLabel={`${label}: ${on ? 'done' : 'not yet'}`}
    >
      <View style={[styles.ruleDot, on && styles.ruleDotOn, no && styles.ruleDotNo]}>
        {on ? <Ionicons name="checkmark" size={10} color="#fff" /> : null}
      </View>
      <Text style={[styles.ruleText, on && styles.ruleTextOn, no && styles.ruleTextNo]}>{label}</Text>
    </View>
  );
}

function StrengthMeter({ value }) {
  const [score, word, color] = strength(value);
  return (
    <View style={styles.str}>
      <View style={styles.bars}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.bar, i < score && { backgroundColor: color }]} />
        ))}
      </View>
      <Text style={[styles.strText, score ? { color } : null]} accessibilityLiveRegion="polite">
        {word}
      </Text>
    </View>
  );
}

// The big tile on the finished panels: pops in, Moss for done, Clay tint
// for the reset-by-email question.
function BigIcon({ name, clay }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : ZoomIn.duration(550).easing(EASE_OUT_QUINT)}
      style={[styles.big, clay && styles.bigClay]}
    >
      <Ionicons name={name} size={38} color={clay ? C.tint : '#fff'} />
    </Animated.View>
  );
}

function CloseButton({ onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.x, pressed && { opacity: 0.6 }]}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Close"
    >
      <Ionicons name="close" size={17} color="#5F564E" />
    </Pressable>
  );
}

export default function ChangePasswordSheet({ visible, onClose }) {
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();
  const [panel, setPanel] = useState('form'); // form | done | reset | sent
  const [form, setForm] = useState(EMPTY);
  const [currentError, setCurrentError] = useState('');
  const [nextError, setNextError] = useState('');
  const [alert, setAlert] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);
  const [shakes, shake] = useShakes();
  const currentRef = useRef(null);
  const nextRef = useRef(null);
  const confirmRef = useRef(null);
  const email = auth.currentUser?.email;

  // Every opening starts clean: no password left over from last time.
  useEffect(() => {
    if (visible) {
      setForm(EMPTY);
      setCurrentError('');
      setNextError('');
      setAlert(null);
      setResent(false);
      setPanel('form');
    }
  }, [visible]);

  const setField = (key) => (text) => {
    setForm((prev) => ({ ...prev, [key]: text }));
    if (key === 'current' && currentError) setCurrentError('');
    if (key === 'next' && nextError) setNextError('');
  };

  const { current, next, confirm } = form;
  const longEnough = next.length >= PASSWORD_MIN;
  const same = !!next && !!current && next === current;
  const notOld = !!next && !!current && !same;
  const matches = !!confirm && confirm === next;
  const mismatch = !!confirm && confirm.length >= next.length && confirm !== next;
  const ready = !!current && longEnough && notOld && matches;

  const show = (id) => {
    setAlert(null);
    setPanel(id);
  };

  const handleSave = async () => {
    if (saving || !isConnected) return;
    if (!ready) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    const user = auth.currentUser;
    if (!user?.email) {
      setAlert(alertForError());
      return;
    }

    setAlert(null);
    setCurrentError('');
    setNextError('');
    setSaving(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await updatePassword(user, next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setForm(EMPTY);
      setPanel('done');
    } catch (error) {
      console.error('Change password failed:', error?.code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (WRONG_PASSWORD.includes(error?.code)) {
        setCurrentError("That's not your current password. Try again, or tap Forgot it? to reset by email.");
        shake('current');
        setForm((prev) => ({ ...prev, current: '' }));
        currentRef.current?.focus();
      } else if (WEAK_PASSWORD.includes(error?.code)) {
        setNextError('Choose a stronger password.');
        shake('next');
      } else {
        setAlert(alertForError(error?.code));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSendReset = async (again) => {
    if (sending || !email) return;
    setAlert(null);
    setSending(true);
    try {
      await sendPasswordResetEmail(auth, email);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (again) setResent(true);
      else setPanel('sent');
    } catch (error) {
      console.error('Reset email failed:', error?.code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAlert(alertForResetError(error?.code));
    } finally {
      setSending(false);
    }
  };

  const busy = saving || sending;
  const d = (ms) => ({ delay: ms, skip: reduceMotion });

  let body;
  if (panel === 'done') {
    body = (
      <View style={styles.cen} key="done">
        <BigIcon name="checkmark" />
        <FadeUp {...d(380)}>
          <Text style={styles.cenTitle} accessibilityRole="header">
            Password changed
          </Text>
          <Text style={styles.cenSub}>{"You're still logged in here. Use your new password the next time you log in."}</Text>
        </FadeUp>
        <FadeUp {...d(480)} style={styles.tip}>
          <Ionicons name="mail-outline" size={18} color={C.success} />
          <Text style={styles.tipText}>{"Didn't do this? Reset it right away from the login screen."}</Text>
        </FadeUp>
        <FadeUp {...d(560)} style={styles.full}>
          <Button variant="success" label="Done" fontSize={15.5} onPress={onClose} fullWidth />
        </FadeUp>
      </View>
    );
  } else if (panel === 'reset') {
    body = (
      <View style={styles.cen} key="reset">
        <BigIcon name="mail-outline" clay />
        <FadeUp {...d(340)}>
          <Text style={styles.cenTitle} accessibilityRole="header">
            Forgot your password?
          </Text>
          <Text style={styles.cenSub}>
            {"We'll email a reset link to "}<Text style={styles.cenStrong}>{maskEmail(email)}</Text>. No need to log out
            first.
          </Text>
        </FadeUp>
        <View style={styles.full}>
          <AuthAlert alert={alert} />
        </View>
        <FadeUp {...d(440)} style={styles.full}>
          <Button
            variant="primary"
            label={!isConnected ? 'Offline' : 'Email me a reset link'}
            fontSize={15.5}
            onPress={() => handleSendReset(false)}
            loading={sending}
            disabled={sending || !isConnected || !email}
            fullWidth
          />
          <GhostButton label="Back" onPress={() => show('form')} disabled={sending} />
        </FadeUp>
      </View>
    );
  } else if (panel === 'sent') {
    body = (
      <View style={styles.cen} key="sent">
        <BigIcon name="checkmark" />
        <FadeUp {...d(380)}>
          <Text style={styles.cenTitle} accessibilityRole="header">
            Check your inbox
          </Text>
          <Text style={styles.cenSub}>
            The link is on its way to <Text style={styles.cenStrong}>{maskEmail(email)}</Text>. It can take a minute,
            and it may land in Spam.
          </Text>
        </FadeUp>
        <View style={styles.full}>
          <AuthAlert alert={alert} />
        </View>
        <FadeUp {...d(480)} style={styles.full}>
          <Button variant="success" label="Done" fontSize={15.5} onPress={onClose} fullWidth />
          <GhostButton
            label={sending ? 'Sending…' : resent ? 'Sent again' : 'Send it again'}
            onPress={() => handleSendReset(true)}
            disabled={sending || resent || !isConnected}
          />
        </FadeUp>
      </View>
    );
  } else {
    body = (
      <View key="form">
        <FadeUp {...d(100)} style={styles.head}>
          <View style={styles.lock}>
            <Animated.View
              key={ready ? 'shut' : 'open'}
              entering={reduceMotion ? undefined : FadeIn.duration(220)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}
            >
              <Ionicons name={ready ? 'lock-closed-outline' : 'lock-open-outline'} size={23} color={C.tint} />
            </Animated.View>
          </View>
          <View style={styles.flex}>
            <Text style={styles.title} accessibilityRole="header">
              Change password
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {"Confirm it's you, then set a new one."}
            </Text>
          </View>
          <CloseButton onPress={onClose} disabled={busy} />
        </FadeUp>

        <AuthAlert alert={alert} />

        <FadeUp {...d(160)}>
          <StepLabel
            action={
              <Text
                style={styles.stepLink}
                onPress={() => {
                  if (saving) return;
                  Haptics.selectionAsync();
                  show('reset');
                }}
                accessibilityRole="link"
                suppressHighlighting
              >
                Forgot it?
              </Text>
            }
          >
            {"1 · Confirm it's you"}
          </StepLabel>
          <FloatField
            label="Current password"
            toggleLabel="current password"
            inputRef={currentRef}
            value={current}
            onChangeText={setField('current')}
            status={currentError ? 'bad' : null}
            shakeKey={shakes.current}
            editable={!saving}
            textContentType="password"
            autoComplete="current-password"
            autoCapitalize="none"
            returnKeyType="next"
            onSubmitEditing={() => nextRef.current?.focus()}
          />
          <FieldError text={currentError} />
        </FadeUp>

        <FadeUp {...d(240)} style={styles.section}>
          <StepLabel>2 · New password</StepLabel>
          <FloatField
            label="New password"
            toggleLabel="new password"
            inputRef={nextRef}
            value={next}
            onChangeText={setField('next')}
            status={nextError ? 'bad' : null}
            shakeKey={shakes.next}
            editable={!saving}
            textContentType="newPassword"
            autoComplete="new-password"
            autoCapitalize="none"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <FieldError text={nextError} />
          <StrengthMeter value={next} />
        </FadeUp>

        <FadeUp {...d(320)} style={styles.confirmWrap}>
          <FloatField
            label="Confirm new password"
            toggleLabel="new password"
            inputRef={confirmRef}
            value={confirm}
            onChangeText={setField('confirm')}
            status={mismatch ? 'bad' : matches && longEnough ? 'good' : null}
            editable={!saving}
            textContentType="newPassword"
            autoComplete="new-password"
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />
          <View style={styles.rules}>
            <Rule on={longEnough} label={`${PASSWORD_MIN}+ characters`} />
            <Rule on={notOld} no={same} label="Not your old one" />
            <Rule on={matches} no={mismatch} label="Both match" />
          </View>
        </FadeUp>

        <FadeUp {...d(400)}>
          {!isConnected ? (
            <Text style={styles.offline} accessibilityLiveRegion="polite">
              No internet connection. Connect to change your password.
            </Text>
          ) : null}
          <Button
            variant="primary"
            label={!isConnected ? 'Offline' : saving ? 'Changing…' : 'Change password'}
            fontSize={15.5}
            onPress={handleSave}
            loading={saving}
            disabled={!ready || saving || !isConnected}
            fullWidth
          />
          <GhostButton label="Cancel" onPress={onClose} disabled={saving} />
        </FadeUp>
      </View>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} locked={busy}>
      {panel !== 'form' ? (
        <View style={styles.xFloat}>
          <CloseButton onPress={onClose} disabled={busy} />
        </View>
      ) : null}
      {body}
    </Sheet>
  );
}

function GhostButton({ label, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
    >
      <Text style={[styles.ghostText, disabled && { opacity: 0.6 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  full: { alignSelf: 'stretch' },

  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  lock: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: CLAY_TINT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, lineHeight: 24, fontWeight: '600', letterSpacing: -0.3, color: C.text },
  sub: { fontSize: 12.5, marginTop: 2, color: C.icon },
  x: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F0E9DF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  xFloat: { position: 'absolute', top: 0, right: 0, zIndex: 3 },

  step: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 2, marginBottom: 8 },
  stepText: { fontSize: 10.5, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase', color: C.success },
  stepLine: { flex: 1, height: 1, backgroundColor: C.border },
  stepLink: { fontSize: 12.5, fontWeight: '600', color: C.tint },
  section: { marginTop: 14 },
  confirmWrap: { marginTop: 10 },

  fieldWrap: { position: 'relative' },
  ring: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 20 },
  box: {
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 6,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    paddingTop: 18,
    paddingBottom: 4,
    fontSize: 15,
    fontWeight: '500',
    color: C.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  inputHidden: { letterSpacing: 2 },
  floatLabel: { position: 'absolute', left: 15.5, fontSize: 14 },
  floatLabelUp: { fontWeight: '500' },
  ok: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eye: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  msg: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 6, marginHorizontal: 2 },
  msgIcon: { marginTop: 2 },
  msgText: { flex: 1, fontSize: 12, lineHeight: 17, color: ERR },

  str: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginHorizontal: 2 },
  bars: { flex: 1, flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#E7DFD4' },
  strText: { minWidth: 64, textAlign: 'right', fontSize: 11.5, fontWeight: '600', color: C.icon },

  rules: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 10, marginBottom: 12 },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 8,
    borderRadius: 999,
    backgroundColor: CHIP_BG,
  },
  ruleOn: { backgroundColor: '#E9EDE4' },
  ruleNo: { backgroundColor: '#F7E4DE' },
  ruleDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#B9AFA3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleDotOn: { backgroundColor: C.success, borderColor: C.success },
  ruleDotNo: { borderColor: ERR },
  ruleText: { fontSize: 10.5, fontWeight: '500', color: C.icon },
  ruleTextOn: { color: '#3F4B36' },
  ruleTextNo: { color: ERR },

  offline: { fontSize: 12.5, color: C.danger, marginBottom: 10 },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ghostText: { fontSize: 14.5, fontWeight: '500', color: C.icon },

  cen: { alignItems: 'center', paddingTop: 14, paddingHorizontal: 6 },
  big: {
    width: 84,
    height: 84,
    borderRadius: 28,
    backgroundColor: C.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  bigClay: { backgroundColor: CLAY_TINT },
  cenTitle: { fontSize: 22, fontWeight: '600', letterSpacing: -0.3, color: C.text, textAlign: 'center', marginBottom: 6 },
  cenSub: { fontSize: 13.5, lineHeight: 21, color: C.icon, textAlign: 'center', maxWidth: 300, marginBottom: 18 },
  cenStrong: { color: C.text, fontWeight: '600' },
  tip: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  tipText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: C.icon },
});
