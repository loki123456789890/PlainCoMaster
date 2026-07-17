import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useProducts } from '../../context/ProductContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { COLOR_PALETTE, SIZE_OPTIONS } from '../../constants/productOptions';

export default function AdminEditProductScreen({ navigation, route }) {
  const { product } = route.params;
  const { updateProduct, deleteProduct } = useProducts();
  const { isConnected } = useNetworkStatus();

  const [formData, setFormData] = useState({
    name: product.name,
    price: product.price.toString(),
    type: product.type,
    stock: product.stock.toString(),
    description: product.description || '',
    // Was reading product.image, but products are stored with an
    // imageUrl field (see ProductContext.js / AdminAddProductScreen.js) —
    // that mismatch was silently leaving this field blank on edit.
    imageUrl: product.imageUrl,
    // Legacy products predating per-product colors/sizes have no such
    // field on their doc — pre-select nothing rather than guessing, so
    // the admin has to make a real choice for them on next save.
    colors: product.colors || [],
    sizes: product.sizes || [],
  });
  const [loading, setLoading] = useState(false);

  const toggleColor = (colorName) => {
    setFormData((prev) => ({
      ...prev,
      colors: prev.colors.includes(colorName)
        ? prev.colors.filter((c) => c !== colorName)
        : [...prev.colors, colorName],
    }));
  };

  const toggleSize = (size) => {
    setFormData((prev) => ({
      ...prev,
      sizes: prev.sizes.includes(size)
        ? prev.sizes.filter((s) => s !== size)
        : [...prev.sizes, size],
    }));
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter product name');
      return;
    }
    if (!formData.price.trim()) {
      Alert.alert('Error', 'Please enter product price');
      return;
    }
    const parsedPrice = parseFloat(formData.price);
    // parseFloat("abc") is NaN, and NaN <= 0 is false — a bare <= 0 check
    // alone would silently let non-numeric input through, so NaN is
    // checked explicitly rather than relying on the comparison alone.
    if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Error', 'Please enter a valid price');
      return;
    }
    if (!formData.stock.trim()) {
      Alert.alert('Error', 'Please enter stock quantity');
      return;
    }
    if (!formData.imageUrl.trim()) {
      Alert.alert('Error', 'Please enter an image URL');
      return;
    }
    if (formData.colors.length === 0) {
      Alert.alert('Error', 'Please select at least one color');
      return;
    }
    if (formData.sizes.length === 0) {
      Alert.alert('Error', 'Please select at least one size');
      return;
    }

    setLoading(true);

    const result = await updateProduct(product.id, {
      name: formData.name,
      // Stored as a real number, same reasoning as stock below —
      // parseFloat rather than parseInt/Number since price needs to
      // support decimals (e.g. 299.50). Already validated as a non-NaN,
      // positive number above, so no further fallback is needed here.
      // Saving any existing product here also migrates a legacy
      // string-typed price to a number, same as stock does.
      price: parsedPrice,
      type: formData.type,
      // Stored as a real number (not the raw TextInput string) so
      // firestore.rules can validate checkout's stock decrement with a
      // plain numeric comparison — see CheckoutScreen.js / firestore.rules.
      // Saving any existing product here also migrates its stock field
      // from the old string format to a number.
      stock: Number(formData.stock) || 0,
      description: formData.description,
      imageUrl: formData.imageUrl,
      colors: formData.colors,
      sizes: formData.sizes,
    });

    setLoading(false);

    if (result.success) {
      Alert.alert(
        'Success',
        'Product updated successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } else if (!isConnected) {
      // Same reasoning as AdminAddProductScreen.js: updateProduct()
      // resolves { success: false, error } rather than throwing, and only
      // passes along error.message (no error.code), so isConnected is the
      // only reliable offline signal available in this shape.
      Alert.alert(
        'No Internet Connection',
        'Network connection lost. Please check your connection and try again.'
      );
    } else {
      Alert.alert('Error', 'Failed to update product: ' + result.error);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Product',
      'Are you sure you want to delete this product?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const result = await deleteProduct(product.id);
            setLoading(false);

            if (result.success) {
              Alert.alert('Success', 'Product deleted successfully!', [
                { text: 'OK', onPress: () => navigation.goBack() }
              ]);
            } else {
              Alert.alert('Error', 'Failed to delete product: ' + result.error);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Product</Text>
        <TouchableOpacity onPress={handleDelete}>
          <Ionicons name="trash-outline" size={24} color="#FF3B30" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Image URL Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Image URL *</Text>
          <TextInput
            style={styles.input}
            placeholder="https://example.com/image.jpg"
            placeholderTextColor="#999"
            value={formData.imageUrl}
            onChangeText={(text) => setFormData({ ...formData, imageUrl: text })}
            autoCapitalize="none"
          />
        </View>

        {/* Image Preview */}
        {formData.imageUrl ? (
          <View style={styles.imagePreview}>
            <Image
              source={{ uri: formData.imageUrl }}
              style={styles.previewImage}
              onError={() => Alert.alert('Error', 'Invalid image URL')}
            />
          </View>
        ) : null}

        {/* Product Name */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Product Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter product name"
            placeholderTextColor="#999"
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
          />
        </View>

        {/* Product Type */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Product Type *</Text>
          <View style={styles.typeSelector}>
            <TouchableOpacity
              style={[
                styles.typeButton,
                formData.type === 'ready-to-wear' && styles.typeButtonActive,
              ]}
              onPress={() => setFormData({ ...formData, type: 'ready-to-wear' })}
            >
              <Text style={[
                styles.typeButtonText,
                formData.type === 'ready-to-wear' && styles.typeButtonTextActive,
              ]}>
                Ready to Wear
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.typeButton,
                formData.type === 'ukay-ukay' && styles.typeButtonActive,
              ]}
              onPress={() => setFormData({ ...formData, type: 'ukay-ukay' })}
            >
              <Text style={[
                styles.typeButtonText,
                formData.type === 'ukay-ukay' && styles.typeButtonTextActive,
              ]}>
                Ukay-Ukay
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Price and Stock Row */}
        <View style={styles.rowInput}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 12 }]}>
            <Text style={styles.inputLabel}>Price (₱) *</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor="#999"
              value={formData.price}
              onChangeText={(text) => setFormData({ ...formData, price: text })}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.inputLabel}>Stock *</Text>
            <TextInput
              style={styles.input}
              placeholder="Quantity"
              placeholderTextColor="#999"
              value={formData.stock}
              onChangeText={(text) => setFormData({ ...formData, stock: text })}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Description */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Enter product description"
            placeholderTextColor="#999"
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Colors */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Colors *</Text>
          <View style={styles.colorSwatchesRow}>
            {COLOR_PALETTE.map((color) => {
              const isSelected = formData.colors.includes(color.name);
              return (
                <TouchableOpacity
                  key={color.name}
                  onPress={() => toggleColor(color.name)}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color.hex },
                    isSelected && styles.colorSwatchSelected,
                  ]}
                >
                  {isSelected && (
                    <View style={styles.colorCheckBadge}>
                      <Ionicons name="checkmark" size={10} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Sizes */}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Sizes *</Text>
          <View style={styles.sizeChipsRow}>
            {SIZE_OPTIONS.map((size) => {
              const isSelected = formData.sizes.includes(size);
              return (
                <TouchableOpacity
                  key={size}
                  onPress={() => toggleSize(size)}
                  style={[styles.sizeChip, isSelected && styles.sizeChipActive]}
                >
                  <Text style={[styles.sizeChipText, isSelected && styles.sizeChipTextActive]}>
                    {size}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            (loading || !isConnected) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={loading || !isConnected}
        >
          <Text style={styles.submitButtonText}>
            {loading
              ? 'Saving...'
              : !isConnected
              ? 'No Internet Connection'
              : 'Save Changes'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  content: {
    padding: 20,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#F9F9FB',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  rowInput: {
    flexDirection: 'row',
    gap: 12,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  typeButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  typeButtonText: {
    fontSize: 14,
    color: '#666',
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  colorSwatchesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    // Every swatch always keeps this neutral border, not just an
    // unselected-state default — otherwise White has no visible edge
    // against the form's own white/near-white background.
    borderWidth: 1,
    borderColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  colorSwatchSelected: {
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  colorCheckBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  sizeChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  sizeChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#fff',
  },
  sizeChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  sizeChipText: {
    fontSize: 14,
    color: '#666',
  },
  sizeChipTextActive: {
    color: '#fff',
  },
  submitButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
