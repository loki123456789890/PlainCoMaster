import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  ScrollView,
  Image,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import { useProducts } from '../../context/ProductContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { COLOR_PALETTE, SIZE_OPTIONS } from '../../constants/productOptions';
import { Colors, Spacing, Radius } from '../../constants/theme';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';

const TYPE_OPTIONS = [
  { key: 'ready-to-wear', label: 'Ready to Wear' },
  { key: 'ukay-ukay', label: 'Ukay-Ukay' },
];

export default function AdminAddProductScreen({ navigation }) {
  const { addProduct } = useProducts();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const [formData, setFormData] = useState({
    name: '',
    price: '',
    type: 'ready-to-wear',
    stock: '',
    description: '',
    imageUrl: '',
    colors: [],
    sizes: [],
  });
  const [errors, setErrors] = useState({
    name: '',
    price: '',
    stock: '',
    imageUrl: '',
    colors: '',
    sizes: '',
  });
  const [loading, setLoading] = useState(false);

  // Debounced preview state — the raw imageUrl field updates on every
  // keystroke, but previewUri only catches up after typing pauses, so a
  // partial/incomplete URL never gets sent to Image mid-type (that was
  // firing an "Invalid image URL" alert on every character before).
  const [previewUri, setPreviewUri] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const scrollRef = useRef(null);

  useEffect(() => {
    const trimmed = formData.imageUrl.trim();
    if (!trimmed) {
      setPreviewUri('');
      setImageFailed(false);
      setImageLoading(false);
      return undefined;
    }
    setImageFailed(false);
    const timer = setTimeout(() => {
      setPreviewUri(trimmed);
      setImageLoading(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.imageUrl]);

  // Shake targets — one per validated field, same shake shape
  // AdminLoginScreen.js uses on submit for an empty/invalid field.
  const nameShakeX = useSharedValue(0);
  const priceShakeX = useSharedValue(0);
  const stockShakeX = useSharedValue(0);
  const imageShakeX = useSharedValue(0);
  const colorsShakeX = useSharedValue(0);
  const sizesShakeX = useSharedValue(0);

  const nameShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nameShakeX.value }] }));
  const priceShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: priceShakeX.value }] }));
  const stockShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: stockShakeX.value }] }));
  const imageShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: imageShakeX.value }] }));
  const colorsShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: colorsShakeX.value }] }));
  const sizesShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sizesShakeX.value }] }));

  const triggerShake = (sharedValue) => {
    if (reduceMotion) return;
    sharedValue.value = withSequence(
      withTiming(-6, { duration: 45, easing: Easing.linear }),
      withTiming(6, { duration: 45, easing: Easing.linear }),
      withTiming(-4, { duration: 45, easing: Easing.linear }),
      withTiming(4, { duration: 45, easing: Easing.linear }),
      withTiming(0, { duration: 45, easing: Easing.linear })
    );
  };

  const clearFieldError = (field) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: '' } : prev));
  };

  const handleImageUrlChange = (text) => {
    setFormData((prev) => ({ ...prev, imageUrl: text }));
    clearFieldError('imageUrl');
  };

  const handleClearImage = () => {
    Haptics.selectionAsync();
    setFormData((prev) => ({ ...prev, imageUrl: '' }));
  };

  const handleNameChange = (text) => {
    setFormData((prev) => ({ ...prev, name: text }));
    clearFieldError('name');
  };

  const handlePriceChange = (text) => {
    setFormData((prev) => ({ ...prev, price: text }));
    clearFieldError('price');
  };

  const handleStockChange = (text) => {
    setFormData((prev) => ({ ...prev, stock: text }));
    clearFieldError('stock');
  };

  const handleDescriptionChange = (text) => {
    setFormData((prev) => ({ ...prev, description: text }));
  };

  const handleTypeChange = (type) => {
    if (formData.type === type) return;
    Haptics.selectionAsync();
    setFormData((prev) => ({ ...prev, type }));
  };

  const toggleColor = (colorName) => {
    Haptics.selectionAsync();
    setFormData((prev) => ({
      ...prev,
      colors: prev.colors.includes(colorName)
        ? prev.colors.filter((c) => c !== colorName)
        : [...prev.colors, colorName],
    }));
    clearFieldError('colors');
  };

  const toggleSize = (size) => {
    Haptics.selectionAsync();
    setFormData((prev) => ({
      ...prev,
      sizes: prev.sizes.includes(size)
        ? prev.sizes.filter((s) => s !== size)
        : [...prev.sizes, size],
    }));
    clearFieldError('sizes');
  };

  const isDirty =
    Boolean(formData.name.trim()) ||
    Boolean(formData.price.trim()) ||
    Boolean(formData.stock.trim()) ||
    Boolean(formData.description.trim()) ||
    Boolean(formData.imageUrl.trim()) ||
    formData.colors.length > 0 ||
    formData.sizes.length > 0;

  const handleBack = () => {
    if (!isDirty) {
      navigation.goBack();
      return;
    }
    Haptics.selectionAsync();
    showAppAlert(
      'Discard this product?',
      "You haven't saved this product yet. Going back will discard what you've entered.",
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  };

  // Validates every field at once and surfaces every error inline instead
  // of stopping at the first Alert — lets an admin fix a form with several
  // mistakes in one pass instead of resubmitting up to seven times.
  const validate = () => {
    const nextErrors = { name: '', price: '', stock: '', imageUrl: '', colors: '', sizes: '' };

    if (!formData.imageUrl.trim()) {
      nextErrors.imageUrl = 'Add an image URL.';
    } else if (imageFailed) {
      nextErrors.imageUrl = "This image couldn't load. Try a different URL.";
    }

    if (!formData.name.trim()) {
      nextErrors.name = 'Enter a product name.';
    }

    if (!formData.price.trim()) {
      nextErrors.price = 'Enter a price.';
    } else {
      const parsedPrice = parseFloat(formData.price);
      // parseFloat("abc") is NaN, and NaN <= 0 is false — a bare <= 0 check
      // alone would silently let non-numeric input through, so NaN is
      // checked explicitly rather than relying on the comparison alone.
      if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
        nextErrors.price = 'Enter a valid price.';
      }
    }

    if (!formData.stock.trim()) {
      nextErrors.stock = 'Enter a stock quantity.';
    } else {
      const parsedStock = Number(formData.stock);
      // Previously non-numeric stock silently saved as 0 via `|| 0` —
      // validated explicitly here so a typo doesn't quietly zero out
      // inventory on save.
      if (Number.isNaN(parsedStock) || parsedStock < 0) {
        nextErrors.stock = 'Enter a valid stock quantity.';
      }
    }

    if (formData.colors.length === 0) {
      nextErrors.colors = 'Select at least one color.';
    }

    if (formData.sizes.length === 0) {
      nextErrors.sizes = 'Select at least one size.';
    }

    setErrors(nextErrors);

    const hasErrors = Object.values(nextErrors).some(Boolean);
    if (hasErrors) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (nextErrors.imageUrl) triggerShake(imageShakeX);
      if (nextErrors.name) triggerShake(nameShakeX);
      if (nextErrors.price) triggerShake(priceShakeX);
      if (nextErrors.stock) triggerShake(stockShakeX);
      if (nextErrors.colors) triggerShake(colorsShakeX);
      if (nextErrors.sizes) triggerShake(sizesShakeX);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }

    return !hasErrors;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await addProduct({
      name: formData.name,
      // Stored as a real number, same reasoning as stock below —
      // parseFloat rather than parseInt/Number since price needs to
      // support decimals (e.g. 299.50). Already validated as a non-NaN,
      // positive number above, so no further fallback is needed here.
      price: parseFloat(formData.price),
      type: formData.type,
      // Stored as a real number (not the raw TextInput string) so
      // firestore.rules can validate checkout's stock decrement with a
      // plain numeric comparison — see CheckoutScreen.js / firestore.rules.
      // Already validated as a non-NaN, non-negative number above.
      stock: Number(formData.stock),
      description: formData.description,
      imageUrl: formData.imageUrl,
      colors: formData.colors,
      sizes: formData.sizes,
    });

    setLoading(false);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        'Success',
        'Product added successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } else if (!isConnected) {
      // addProduct() (ProductContext) resolves { success: false, error }
      // instead of throwing, and only passes along error.message, not
      // error.code — so there's no Firestore 'unavailable' code available
      // to check here the way Checkout/Location do. isConnected from our
      // own NetInfo listener is the only reliable signal in this shape.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert(
        'No Internet Connection',
        'Network connection lost. Please check your connection and try again.'
      );
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Error', 'Failed to add product: ' + result.error);
    }
  };

  const trimmedImageUrl = formData.imageUrl.trim();
  const pending = Boolean(trimmedImageUrl) && previewUri !== trimmedImageUrl;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AnimatedPressable
          onPress={handleBack}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </AnimatedPressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Add New Product
        </Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
            {/* Product Photo */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>Product Photo</Text>
              <Animated.View style={imageShakeStyle}>
                <Input
                  label="Image URL *"
                  value={formData.imageUrl}
                  onChangeText={handleImageUrlChange}
                  placeholder="https://example.com/image.jpg"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="next"
                  error={errors.imageUrl}
                  accessibilityLabel="Product image URL"
                  accessibilityHint="Paste a direct link to the product photo"
                />
              </Animated.View>

              <View style={styles.imagePreview}>
                {!trimmedImageUrl ? (
                  <View style={styles.imagePlaceholder}>
                    <Ionicons name="image-outline" size={30} color={Colors.light.icon} />
                    <Text style={styles.imagePlaceholderText}>Photo preview appears here</Text>
                  </View>
                ) : imageFailed ? (
                  <View style={styles.imagePlaceholder}>
                    <Ionicons name="alert-circle-outline" size={26} color={Colors.light.danger} />
                    <Text style={styles.imageErrorText}>Couldn&apos;t load this image</Text>
                  </View>
                ) : (
                  <>
                    {previewUri ? (
                      <Image
                        key={previewUri}
                        source={{ uri: previewUri }}
                        style={styles.previewImage}
                        onLoadStart={() => setImageLoading(true)}
                        onLoad={() => setImageLoading(false)}
                        onError={() => {
                          setImageLoading(false);
                          setImageFailed(true);
                        }}
                      />
                    ) : null}
                    {(pending || imageLoading) && (
                      <SkeletonBlock style={StyleSheet.absoluteFillObject} />
                    )}
                    {previewUri && !pending && (
                      <AnimatedPressable
                        onPress={handleClearImage}
                        style={styles.imageClearButton}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Remove image"
                      >
                        <Ionicons name="close" size={16} color="#fff" />
                      </AnimatedPressable>
                    )}
                  </>
                )}
              </View>
            </View>

            {/* Basic Details */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>Basic Details</Text>
              <Animated.View style={nameShakeStyle}>
                <Input
                  label="Product Name *"
                  value={formData.name}
                  onChangeText={handleNameChange}
                  placeholder="Enter product name"
                  error={errors.name}
                  accessibilityLabel="Product name"
                />
              </Animated.View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Product Type *</Text>
                <View style={styles.typeSelector}>
                  {TYPE_OPTIONS.map((option) => {
                    const isActive = formData.type === option.key;
                    return (
                      <AnimatedPressable
                        key={option.key}
                        onPress={() => handleTypeChange(option.key)}
                        style={[styles.typeButton, isActive && styles.typeButtonActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                        accessibilityLabel={option.label}
                      >
                        <Text
                          style={[styles.typeButtonText, isActive && styles.typeButtonTextActive]}
                        >
                          {option.label}
                        </Text>
                      </AnimatedPressable>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Pricing & Inventory */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>Pricing &amp; Inventory</Text>
              <View style={styles.rowInput}>
                <Animated.View style={[{ flex: 1 }, priceShakeStyle]}>
                  <Input
                    label="Price (₱) *"
                    value={formData.price}
                    onChangeText={handlePriceChange}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    error={errors.price}
                    accessibilityLabel="Price in pesos"
                  />
                </Animated.View>
                <Animated.View style={[{ flex: 1 }, stockShakeStyle]}>
                  <Input
                    label="Stock *"
                    value={formData.stock}
                    onChangeText={handleStockChange}
                    placeholder="Quantity"
                    keyboardType="numeric"
                    error={errors.stock}
                    accessibilityLabel="Stock quantity"
                  />
                </Animated.View>
              </View>
            </View>

            {/* Description */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>Description</Text>
              <View style={styles.inputGroup}>
                <TextInput
                  style={styles.textArea}
                  placeholder="Enter product description"
                  placeholderTextColor={Colors.light.icon}
                  value={formData.description}
                  onChangeText={handleDescriptionChange}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  accessibilityLabel="Product description"
                />
                <Text style={styles.helperText}>
                  Optional — a clear description helps shoppers trust what they&apos;re buying.
                </Text>
              </View>
            </View>

            {/* Variants */}
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionTitle}>Variants</Text>

              <Animated.View style={[styles.inputGroup, colorsShakeStyle]}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Colors *</Text>
                  {formData.colors.length > 0 && (
                    <Text style={styles.countText}>{formData.colors.length} selected</Text>
                  )}
                </View>
                <View style={styles.colorSwatchesRow}>
                  {COLOR_PALETTE.map((color) => {
                    const isSelected = formData.colors.includes(color.name);
                    return (
                      <AnimatedPressable
                        key={color.name}
                        onPress={() => toggleColor(color.name)}
                        style={[
                          styles.colorSwatch,
                          { backgroundColor: color.hex },
                          isSelected && styles.colorSwatchSelected,
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isSelected }}
                        accessibilityLabel={color.name}
                      >
                        {isSelected && (
                          <Animated.View
                            style={styles.colorCheckBadge}
                            entering={reduceMotion ? undefined : FadeIn.duration(120)}
                          >
                            <Ionicons name="checkmark" size={10} color={Colors.light.background} />
                          </Animated.View>
                        )}
                      </AnimatedPressable>
                    );
                  })}
                </View>
                {errors.colors ? <Text style={styles.fieldError}>{errors.colors}</Text> : null}
              </Animated.View>

              <Animated.View style={[styles.inputGroup, sizesShakeStyle]}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Sizes *</Text>
                  {formData.sizes.length > 0 && (
                    <Text style={styles.countText}>{formData.sizes.length} selected</Text>
                  )}
                </View>
                <View style={styles.sizeChipsRow}>
                  {SIZE_OPTIONS.map((size) => {
                    const isSelected = formData.sizes.includes(size);
                    return (
                      <AnimatedPressable
                        key={size}
                        onPress={() => toggleSize(size)}
                        style={[styles.sizeChip, isSelected && styles.sizeChipActive]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isSelected }}
                        accessibilityLabel={`Size ${size}`}
                      >
                        <Text
                          style={[styles.sizeChipText, isSelected && styles.sizeChipTextActive]}
                        >
                          {size}
                        </Text>
                      </AnimatedPressable>
                    );
                  })}
                </View>
                {errors.sizes ? <Text style={styles.fieldError}>{errors.sizes}</Text> : null}
              </Animated.View>
            </View>

            {/* Submit Button */}
            <View style={styles.submitButtonWrap}>
              <Button
                variant="primary"
                label={
                  loading
                    ? 'Adding Product...'
                    : !isConnected
                    ? 'No Internet Connection'
                    : 'Add Product'
                }
                onPress={handleSubmit}
                disabled={loading || !isConnected}
                loading={loading}
              />
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  sectionWrap: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: Spacing.sm,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: Radius.md,
    marginTop: Spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.border,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  imagePlaceholderText: {
    fontSize: 13,
    color: Colors.light.icon,
  },
  imageErrorText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.danger,
  },
  // Same dark scrim opacity Home's hero photo overlay uses (rgba(0,0,0,0.55),
  // documented in DESIGN.md) — reused here as an Ink-tinted circular control
  // instead of inventing a new overlay treatment.
  imageClearButton: {
    position: 'absolute',
    top: Spacing.xs,
    right: Spacing.xs,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(28,27,26,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputGroup: {
    marginBottom: Spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.tint,
  },
  fieldError: {
    fontSize: 12,
    color: Colors.light.danger,
    marginTop: Spacing.xs,
  },
  helperText: {
    fontSize: 12,
    color: Colors.light.icon,
    marginTop: Spacing.xs,
    lineHeight: 16,
  },
  textArea: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  rowInput: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  typeButton: {
    flex: 1,
    minHeight: 44,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.background,
  },
  typeButtonActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.icon,
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  colorSwatchesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  colorSwatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    // Every swatch always keeps this neutral border, not just an
    // unselected-state default — otherwise White has no visible edge
    // against the form's own white/near-white background.
    borderWidth: 1,
    borderColor: Colors.light.border,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  colorSwatchSelected: {
    borderWidth: 2,
    borderColor: Colors.light.tint,
  },
  colorCheckBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.light.background,
  },
  sizeChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  sizeChip: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sizeChipActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  sizeChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.icon,
  },
  sizeChipTextActive: {
    color: '#fff',
  },
  submitButtonWrap: {
    marginTop: Spacing.sm,
  },
});
