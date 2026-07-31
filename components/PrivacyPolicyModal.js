import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { Colors, Radius, Spacing } from '../constants/theme';

// Shared between SignupScreen (consent flow) and ProfileScreen (read-only
// re-read) — same content/visual style either way, only the caller decides
// what happens around it (consent checkbox + Firestore write vs. just a
// menu row that opens/closes this).
export default function PrivacyPolicyModal({ visible, onClose }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Privacy Policy</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalParagraph}>
              PlainCo collects the information you provide while using the
              app, including your name, email address, shipping address,
              order history, shopping cart contents, and saved favorites.
              This data is used solely to operate your account and process
              your orders.
            </Text>
            <Text style={styles.modalParagraph}>
              Your data is stored and processed using Firebase, which runs
              on Google Cloud infrastructure. All communication between
              this app and our servers is encrypted over HTTPS. Access to
              your data is restricted through role-based Firestore
              security rules — only your own account and authorized
              administrators can read or modify it.
            </Text>
            <Text style={styles.modalParagraph}>
              This app is committed to handling your personal data in
              accordance with the Philippine Data Privacy Act of 2012
              (Republic Act No. 10173).
            </Text>
          </ScrollView>

          <TouchableOpacity style={styles.modalCloseButton} onPress={onClose}>
            <Text style={styles.modalCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(28, 27, 26, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.light.background,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    width: '90%',
    maxHeight: '75%',
  },
  modalHeader: { marginBottom: Spacing.md },
  modalTitle: { fontSize: 18, fontWeight: '600', color: Colors.light.text },
  modalParagraph: { fontSize: 14, color: Colors.light.icon, lineHeight: 21, marginBottom: Spacing.md },
  modalCloseButton: {
    backgroundColor: Colors.light.tint,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  modalCloseText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
