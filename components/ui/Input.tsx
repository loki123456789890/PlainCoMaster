import React, { forwardRef } from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps, StyleProp, TextStyle } from 'react-native';
import { Colors, Radius, Spacing } from '../../constants/theme';

interface InputProps extends Omit<TextInputProps, 'value' | 'onChangeText' | 'style'> {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  /** Merged onto the field's own base style (background/border/radius/
   * padding stay intact) instead of replacing it — use this to widen the
   * field into a textarea (e.g. `{ minHeight: 96 }` with `multiline`) or
   * adjust one-off layout without hand-rolling a separate TextInput. */
  style?: StyleProp<TextStyle>;
}

const Input = forwardRef<TextInput, InputProps>(function Input(
  { value, onChangeText, placeholder, label, error, style, ...rest },
  ref
) {
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        style={[styles.field, error && styles.fieldError, style]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.light.icon}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
});

export default Input;

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: Spacing.xs,
  },
  field: {
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.light.text,
  },
  fieldError: {
    borderColor: Colors.light.danger,
  },
  error: {
    fontSize: 12,
    color: Colors.light.danger,
    marginTop: Spacing.xs,
  },
});
