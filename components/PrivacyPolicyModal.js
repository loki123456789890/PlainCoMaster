import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal } from 'react-native';

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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '75%',
  },
  modalHeader: { marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#000' },
  modalParagraph: { fontSize: 14, color: '#333', lineHeight: 21, marginBottom: 14 },
  modalCloseButton: {
    backgroundColor: '#8B6F47',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  modalCloseText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
