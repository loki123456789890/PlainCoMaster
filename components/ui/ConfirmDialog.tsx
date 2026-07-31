import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { Colors, Radius, Spacing, Shadow } from '../../constants/theme';
import { EASE_OUT_QUART } from '../../constants/motion';
import Button, { ButtonVariant } from './Button';

interface ConfirmDialogProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  cancelLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
}

/**
 * Shared confirm/cancel dialog for logout, deactivate, delete, and similar
 * confirmations. Renders through Button's own variants (Rust for danger,
 * Clay for primary) instead of the OS's native Alert.alert, whose button
 * colors can't be themed and default to the platform accent (iOS system
 * blue) regardless of PlainCo's palette. Rendered only while `visible` so
 * its entrance animation replays fresh every time it opens (React Native's
 * <Modal> keeps its children mounted even while hidden, so a
 * mount-triggered `entering` prop would otherwise only ever fire once).
 */
export default function ConfirmDialog({
  visible,
  onClose,
  title,
  children,
  confirmLabel,
  confirmVariant = 'primary',
  cancelLabel = 'Cancel',
  onConfirm,
  loading = false,
  confirmDisabled = false,
  cancelDisabled = false,
}: ConfirmDialogProps) {
  const reduceMotion = useReducedMotion();
  if (!visible) return null;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={() => {
        if (!cancelDisabled) onClose();
      }}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={styles.content}
          entering={reduceMotion ? undefined : FadeIn.duration(200).easing(EASE_OUT_QUART)}
        >
          <Text style={styles.title}>{title}</Text>
          {children}
          <View style={styles.buttons}>
            <View style={styles.buttonWrap}>
              <Button variant="secondary" label={cancelLabel} onPress={onClose} disabled={cancelDisabled} />
            </View>
            <View style={styles.buttonWrap}>
              <Button
                variant={confirmVariant}
                label={confirmLabel}
                onPress={onConfirm}
                loading={loading}
                disabled={confirmDisabled}
              />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  content: {
    width: '85%',
    backgroundColor: Colors.light.background,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    ...Shadow.card,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: Colors.light.text },
  buttons: { flexDirection: 'row', width: '100%', gap: 12 },
  buttonWrap: { flex: 1 },
});
