import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { Colors, Radius, Spacing, Shadow } from '../../constants/theme';
import { EASE_OUT_QUART } from '../../constants/motion';
import Button, { ButtonVariant } from './Button';
import { registerAlertHandler } from '../../utils/appAlert';

interface AlertButton {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface AlertState {
  title: string;
  message?: string;
  buttons: AlertButton[];
}

// Some call sites pass a plain { text: 'Cancel' } without style: 'cancel'
// (harmless under the OS's plain-text Alert buttons, but this modal renders
// variants with real color — so an unstyled "Cancel" needs the same
// secondary treatment as an explicitly-styled one to avoid two Clay-filled
// buttons competing as if both were the primary action).
function variantForButton(button: AlertButton): ButtonVariant {
  if (button.style === 'destructive') return 'danger';
  if (button.style === 'cancel') return 'secondary';
  if ((button.text || '').trim().toLowerCase() === 'cancel') return 'secondary';
  return 'primary';
}

/**
 * Renders the app's on-brand replacement for the OS's Alert.alert — same
 * Card/Button visual language as ConfirmDialog, since a native alert's
 * button colors can't be themed and default to the platform accent
 * regardless of PlainCo's palette. Mounted once at the app root; screens
 * trigger it via showAppAlert(title, message, buttons) instead of
 * importing Alert from react-native.
 */
export default function AppAlertHost() {
  const [alert, setAlert] = useState<AlertState | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    return registerAlertHandler((title: string, message?: string, buttons?: AlertButton[]) => {
      setAlert({
        title,
        message,
        buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
      });
    });
  }, []);

  if (!alert) return null;

  const handlePress = (button: AlertButton) => {
    setAlert(null);
    button.onPress?.();
  };

  const stacked = alert.buttons.length > 2;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => setAlert(null)}>
      <View style={styles.overlay}>
        <Animated.View
          style={styles.content}
          entering={reduceMotion ? undefined : FadeIn.duration(200).easing(EASE_OUT_QUART)}
        >
          <Text style={styles.title}>{alert.title}</Text>
          {alert.message ? <Text style={styles.message}>{alert.message}</Text> : null}
          <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
            {alert.buttons.map((button, index) => (
              <View
                key={`${button.text ?? 'button'}-${index}`}
                style={stacked ? styles.buttonStackedWrap : styles.buttonWrap}
              >
                <Button
                  variant={variantForButton(button)}
                  label={button.text || 'OK'}
                  onPress={() => handlePress(button)}
                />
              </View>
            ))}
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
  title: { fontSize: 18, fontWeight: '700', marginBottom: 10, color: Colors.light.text, textAlign: 'center' },
  message: { fontSize: 15, color: Colors.light.icon, textAlign: 'center', marginBottom: Spacing.lg },
  buttons: { flexDirection: 'row', width: '100%', gap: 12 },
  buttonsStacked: { flexDirection: 'column' },
  buttonWrap: { flex: 1 },
  buttonStackedWrap: { width: '100%' },
});
