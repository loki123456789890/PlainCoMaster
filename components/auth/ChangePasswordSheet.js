// components/auth/ChangePasswordSheet.js
//
// Change password while signed in: Profile for shoppers, the Store Manager
// dashboard and Manage Users for staff. Firebase wants the current password
// again before it changes one, which also keeps someone holding an
// unlocked phone from taking the account. No email is involved, so it
// works for an account whose address can't receive a reset link — the
// case Forgot Password can't cover.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from '../../firebaseConfig';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors } from '../../constants/theme';
import Button from '../ui/Button';
import Sheet from '../shop/Sheet';
import { Field, AuthAlert, useShakes, PASSWORD_MIN } from './AuthKit';

const EMPTY = { current: '', next: '', confirm: '' };
const FIELDS = ['current', 'next', 'confirm'];

// Each returns the problem, or '' when the value is fine. Same wording as
// Sign Up where the rule is the same.
const RULES = {
  current: (v) => (!v ? 'Please enter your current password.' : ''),
  next: (v, form) =>
    v.length < PASSWORD_MIN
      ? `Use at least ${PASSWORD_MIN} characters.`
      : v === form.current
        ? 'Choose a password different from your current one.'
        : '',
  confirm: (v, form) => (!v ? 'Please confirm your new password.' : v !== form.next ? "Passwords don't match." : ''),
};

const WRONG_PASSWORD = ['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'];
const WEAK_PASSWORD = ['auth/weak-password', 'auth/password-does-not-meet-requirements'];

// What isn't one field's fault goes in the box above the form.
function alertForError(code) {
  switch (code) {
    case 'auth/too-many-requests':
      return { kind: 'err', title: 'Too many attempts.', body: 'Please wait a few minutes and try again.' };
    case 'auth/network-request-failed':
      return { kind: 'err', title: 'No internet connection.', body: 'Check your connection and try again.' };
    default:
      return { kind: 'err', title: "Couldn't change your password.", body: 'Something went wrong. Please try again.' };
  }
}

export default function ChangePasswordSheet({ visible, onClose }) {
  const { isConnected } = useNetworkStatus();
  const [form, setForm] = useState(EMPTY);
  const [fieldError, setFieldError] = useState({});
  const [alert, setAlert] = useState(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [shakes, shake] = useShakes();
  const currentRef = useRef(null);
  const nextRef = useRef(null);
  const confirmRef = useRef(null);

  // Every opening starts clean: no password left over from last time.
  useEffect(() => {
    if (visible) {
      setForm(EMPTY);
      setFieldError({});
      setAlert(null);
      setDone(false);
    }
  }, [visible]);

  const setField = (key) => (text) => {
    setForm((prev) => ({ ...prev, [key]: text }));
    if (fieldError[key]) setFieldError((prev) => ({ ...prev, [key]: '' }));
  };

  const handleSave = async () => {
    if (saving || !isConnected) return;
    const errors = {};
    FIELDS.forEach((key) => {
      const problem = RULES[key](form[key], form);
      if (problem) errors[key] = problem;
    });
    setFieldError(errors);
    setAlert(null);
    const bad = Object.keys(errors);
    if (bad.length) {
      bad.forEach(shake);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    const user = auth.currentUser;
    if (!user?.email) {
      setAlert(alertForError());
      return;
    }

    setSaving(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, form.current));
      await updatePassword(user, form.next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setForm(EMPTY);
      setDone(true);
    } catch (error) {
      console.error('Change password failed:', error?.code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (WRONG_PASSWORD.includes(error?.code)) {
        setFieldError({ current: "That isn't your current password." });
        shake('current');
        setForm((prev) => ({ ...prev, current: '' }));
        currentRef.current?.focus();
      } else if (WEAK_PASSWORD.includes(error?.code)) {
        setFieldError({ next: 'Choose a stronger password.' });
        shake('next');
      } else {
        setAlert(alertForError(error?.code));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} locked={saving}>
      {done ? (
        <View style={styles.done}>
          <View style={styles.doneIcon}>
            <Ionicons name="checkmark" size={22} color="#fff" />
          </View>
          <Text style={[styles.title, styles.center]} accessibilityRole="header">
            Password changed
          </Text>
          <Text style={[styles.sub, styles.center]}>Use your new password the next time you log in.</Text>
          <Button variant="primary" label="Done" fontSize={15.5} onPress={onClose} fullWidth />
        </View>
      ) : (
        <>
          <Text style={styles.title} accessibilityRole="header">
            Change password
          </Text>
          <Text style={styles.sub}>
            Enter your current password, then the new one. Forgot it? Log out and use Forgot password? on the
            login screen.
          </Text>
          <AuthAlert alert={alert} />

          <Field
            label="Current password"
            inputRef={currentRef}
            secure
            toggleLabel="current password"
            value={form.current}
            onChangeText={setField('current')}
            status={fieldError.current ? 'bad' : null}
            message={fieldError.current || ''}
            shakeKey={shakes.current}
            editable={!saving}
            textContentType="password"
            autoComplete="current-password"
            autoCapitalize="none"
            returnKeyType="next"
            onSubmitEditing={() => nextRef.current?.focus()}
          />
          <Field
            label="New password"
            inputRef={nextRef}
            secure
            toggleLabel="new password"
            value={form.next}
            onChangeText={setField('next')}
            status={fieldError.next ? 'bad' : null}
            message={fieldError.next || `At least ${PASSWORD_MIN} characters.`}
            shakeKey={shakes.next}
            editable={!saving}
            textContentType="newPassword"
            autoComplete="new-password"
            autoCapitalize="none"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <Field
            label="Confirm new password"
            inputRef={confirmRef}
            secure
            toggleLabel="new password"
            value={form.confirm}
            onChangeText={setField('confirm')}
            status={fieldError.confirm ? 'bad' : null}
            message={fieldError.confirm || ''}
            shakeKey={shakes.confirm}
            editable={!saving}
            textContentType="newPassword"
            autoComplete="new-password"
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={handleSave}
          />

          {!isConnected ? (
            <Text style={styles.offline} accessibilityLiveRegion="polite">
              No internet connection. Connect to change your password.
            </Text>
          ) : null}
          <Button
            variant="primary"
            label={!isConnected ? 'Offline' : 'Change password'}
            fontSize={15.5}
            onPress={handleSave}
            loading={saving}
            disabled={saving || !isConnected}
            fullWidth
          />
          <Pressable
            onPress={onClose}
            disabled={saving}
            style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Text style={styles.ghostText}>Cancel</Text>
          </Pressable>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: Colors.light.text, marginBottom: 4 },
  sub: { fontSize: 13, lineHeight: 19, color: Colors.light.icon, marginBottom: 16 },
  offline: { fontSize: 12.5, color: Colors.light.danger, marginBottom: 10 },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ghostText: { fontSize: 15.5, fontWeight: '600', color: Colors.light.icon },
  done: { alignItems: 'center' },
  center: { textAlign: 'center' },
  doneIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.light.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
});
