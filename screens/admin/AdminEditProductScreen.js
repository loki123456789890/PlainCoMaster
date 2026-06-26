import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  Platform,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function AdminEditProductScreen({ navigation, route }) {
  const { product } = route.params;
  
  const [formData, setFormData] = useState({
    name: product.name,
    price: product.price.toString(),
    type: product.type,
    stock: product.stock.toString(),
    description: product.description || '',
    imageUrl: product.image,
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = () => {
    // Validation
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Please enter product name');
      return;
    }
    if (!formData.price.trim()) {
      Alert.alert('Error', 'Please enter product price');
      return;
    }
    if (parseFloat(formData.price) <= 0) {
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

    setLoading(true);
    
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Success',
        'Product updated successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    }, 1000);
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
          onPress: () => {
            setLoading(true);
            setTimeout(() => {
              setLoading(false);
              Alert.alert('Success', 'Product deleted successfully!', [
                { text: 'OK', onPress: () => navigation.goBack() }
              ]);
            }, 1000);
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
            <Text style={styles.inputLabel}>Price *</Text>
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

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <Text style={styles.submitButtonText}>
            {loading ? 'Saving...' : 'Save Changes'}
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