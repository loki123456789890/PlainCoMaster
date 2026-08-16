import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { Colors, Radius, Spacing } from '../../constants/theme';
import {
  MEASUREMENT_FIELD_LABELS,
  MEASUREMENT_FIELD_ORDER,
  MEASUREMENT_TYPES,
  SIZE_OPTIONS,
} from '../../constants/productOptions';

type MeasurementEntry = Record<string, string>;
type Measurements = Record<string, MeasurementEntry>;

interface SizeGuideModalProps {
  visible: boolean;
  onClose: () => void;
  measurements?: Measurements;
  measurementType?: string;
  sizes: string[];
  selectedSize?: string;
}

const EM_DASH = '—';
const SIZE_CELL_WIDTH = 64;
const FIELD_CELL_WIDTH = 84;

// Same bottom-sheet-via-centered-Modal structure and dismissal behavior as
// PrivacyPolicyModal.js (transparent + slide + onRequestClose) — reused
// here rather than inventing a second modal pattern.
export default function SizeGuideModal({
  visible,
  onClose,
  measurements,
  measurementType,
  sizes,
  selectedSize,
}: SizeGuideModalProps) {
  // Sorted to the app's canonical S/M/L/XL/XXL order regardless of the
  // order the product's `sizes` array happens to be in (admins select
  // sizes in any order — see AdminAddProductScreen.js toggleSize).
  const orderedSizes = useMemo(() => {
    return [...sizes].sort((a, b) => {
      const ai = SIZE_OPTIONS.indexOf(a);
      const bi = SIZE_OPTIONS.indexOf(b);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [sizes]);

  // Deliberately doesn't read measurementType to decide which fields to
  // show — it renders whatever keys are actually present in `measurements`,
  // resolved through the flat key->label map. That's what makes legacy
  // products (measurements with no measurementType at all) render correctly
  // with no migration: the column set is derived from the data, not from a
  // field list keyed off a type that might not exist on the doc.
  const visibleFields = useMemo(() => {
    return MEASUREMENT_FIELD_ORDER.filter((key) =>
      orderedSizes.some((size) => Boolean(measurements?.[size]?.[key]?.trim()))
    ).map((key) => ({ key, label: MEASUREMENT_FIELD_LABELS[key] }));
  }, [orderedSizes, measurements]);

  const unitLabel = MEASUREMENT_TYPES[measurementType || '']?.unit === 'cm' ? 'centimeters' : 'inches';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Size Guide</Text>
            <Text style={styles.modalSubtitle}>All measurements in {unitLabel}, measured flat.</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {visibleFields.length === 0 ? (
              <Text style={styles.emptyText}>No measurements recorded yet.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={[styles.row, styles.headerRow]}>
                    <View style={[styles.cell, styles.sizeCell]}>
                      <Text style={styles.headerCellText}>Size</Text>
                    </View>
                    {visibleFields.map((field) => (
                      <View key={field.key} style={[styles.cell, styles.fieldCell]}>
                        <Text style={styles.headerCellText}>{field.label}</Text>
                      </View>
                    ))}
                  </View>

                  {orderedSizes.map((size) => {
                    const isSelected = size === selectedSize;
                    const entry = measurements?.[size];
                    return (
                      <View
                        key={size}
                        style={[styles.row, isSelected && styles.rowSelected]}
                        accessibilityLabel={
                          isSelected ? `Size ${size}, your selected size` : `Size ${size}`
                        }
                      >
                        <View style={[styles.cell, styles.sizeCell]}>
                          <Text style={[styles.sizeCellText, isSelected && styles.selectedText]}>
                            {size}
                          </Text>
                        </View>
                        {visibleFields.map((field) => {
                          const value = entry?.[field.key]?.trim();
                          return (
                            <View key={field.key} style={[styles.cell, styles.fieldCell]}>
                              <Text style={[styles.cellText, isSelected && styles.selectedText]}>
                                {value ? value : EM_DASH}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}
          </ScrollView>

          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close size guide"
          >
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
  modalSubtitle: {
    fontSize: 13,
    color: Colors.light.icon,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.light.icon,
    paddingVertical: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerRow: {
    borderBottomWidth: 2,
  },
  // Olive-moss surface tone at 20% opacity — same convention Homescreen.js
  // and HelpScreen.js use for a moss-tinted surface (Colors.light.secondary + '20').
  rowSelected: {
    backgroundColor: Colors.light.secondary + '20',
  },
  cell: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    justifyContent: 'center',
  },
  sizeCell: {
    width: SIZE_CELL_WIDTH,
  },
  fieldCell: {
    width: FIELD_CELL_WIDTH,
    alignItems: 'flex-start',
  },
  headerCellText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.text,
  },
  sizeCellText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
  },
  cellText: {
    fontSize: 14,
    color: Colors.light.text,
  },
  selectedText: {
    color: Colors.light.secondary,
  },
  modalCloseButton: {
    backgroundColor: Colors.light.tint,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  modalCloseText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
