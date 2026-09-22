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
  LinearTransition,
} from 'react-native-reanimated';
import { useProducts } from '../../context/ProductContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import {
  COLOR_PALETTE,
  SIZE_OPTIONS,
  MEASUREMENT_TYPES,
  MEASUREMENT_TYPE_OPTIONS,
  emptyMeasurementEntry,
  buildMeasurementsPayload,
} from '../../constants/productOptions';
import { Colors, Spacing, Radius } from '../../constants/theme';
import { EASE_OUT_QUART } from '../../constants/motion';
import { pickAndUploadProductImage, uploadErrorMessage } from '../../utils/imageUpload';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const TYPE_OPTIONS = [
  { key: 'ready-to-wear', label: 'Ready to Wear' },
  { key: 'ukay-ukay', label: 'Ukay-Ukay' },
];

const EMPTY_FORM = {
  name: '',
  price: '',
  type: 'ready-to-wear',
  stock: '',
  description: '',
  imageUrl: '',
  colors: [],
  sizes: [],
  measurements: {},
  measurementType: null,
};

// A blank form, or a copy of an existing product when arriving via
// Duplicate on AdminProductsScreen.
//
// price and stock are stringified because this form holds them as text —
// they are TextInput values here and only become numbers at save, so a
// prefill that handed them through as numbers would break .trim() in
// validate() on the very first render.
//
// The name gets a "(Copy)" suffix rather than arriving identical. Two
// products with the same name is a real state a manager could save
// without noticing, and the suffix is both a flag and a cursor position:
// it says what happened and it is the first thing they will edit.
//
// colors, sizes and measurements are copied by value, not by reference.
// The source object here is the live one out of ProductContext's array,
// so editing sizes on the duplicate would otherwise mutate the product
// being copied FROM — silently, in every other screen holding that same
// array.
function buildInitialForm(source) {
  if (!source) return EMPTY_FORM;
  return {
    name: source.name ? `${source.name} (Copy)` : '',
    price: source.price != null ? String(source.price) : '',
    type: source.type || 'ready-to-wear',
    stock: source.stock != null ? String(source.stock) : '',
    description: source.description || '',
    imageUrl: source.imageUrl || '',
    colors: [...(source.colors || [])],
    sizes: [...(source.sizes || [])],
    measurements: Object.entries(source.measurements || {}).reduce((acc, [size, entry]) => {
      acc[size] = { ...entry };
      return acc;
    }, {}),
    measurementType: source.measurementType || null,
  };
}

export default function AdminAddProductScreen({ navigation, route }) {
  const { addProduct } = useProducts();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  // Set when arriving via Duplicate on AdminProductsScreen. Read once into
  // initial state rather than watched: this form is the manager's working
  // copy from the first render on, and re-syncing it to the source product
  // would throw away edits if that product changed underneath.
  //
  // `formData` holds the same shape it always did — see EMPTY_FORM and
  // buildInitialForm above. The measurements map is keyed by size, only
  // for sizes currently selected in `sizes`, and its field keys depend on
  // measurementType (see MEASUREMENT_TYPES in constants/productOptions.js).
  const duplicateFrom = route.params?.duplicateFrom;

  const [formData, setFormData] = useState(() => buildInitialForm(duplicateFrom));
  // Opened by default when duplicating a product that has a size guide,
  // so the copied measurements are visible rather than hidden behind a
  // collapsed section the manager has no reason to suspect is populated.
  const [measurementsExpanded, setMeasurementsExpanded] = useState(
    Boolean(duplicateFrom?.measurements)
  );
  const [pendingMeasurementType, setPendingMeasurementType] = useState(null);
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

  // Upload runs alongside the URL field rather than replacing it: products
  // created before Storage existed carry an external URL, and a manager
  // who already has a hosted image shouldn't be made to re-upload it.
  // Both paths end in the same `imageUrl` string.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

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

  // Chevron rotation for the collapsible Measurements section — same
  // rotate-on-expand treatment HelpScreen.js's FAQItem uses.
  const measurementsChevronRotation = useSharedValue(0);
  useEffect(() => {
    measurementsChevronRotation.value = withTiming(measurementsExpanded ? 1 : 0, {
      duration: 200,
      easing: EASE_OUT_QUART,
    });
  }, [measurementsExpanded]);
  const measurementsChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${measurementsChevronRotation.value * 180}deg` }],
  }));

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

  // Pick and upload, then write the resulting download URL into the same
  // imageUrl field a pasted link goes into — so the debounced preview,
  // validate(), and handleSubmit() all keep working untouched.
  const handleUploadImage = async (source) => {
    if (uploading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    setUploading(true);
    setUploadProgress(0);

    const result = await pickAndUploadProductImage({
      source,
      onProgress: setUploadProgress,
    });

    setUploading(false);
    setUploadProgress(0);

    // Backing out of the picker is a decision, not a failure — saying
    // nothing is the correct response to it.
    if (result.cancelled) return;

    if (!result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Upload Failed', uploadErrorMessage(result.error));
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFormData((prev) => ({ ...prev, imageUrl: result.url }));
    clearFieldError('imageUrl');
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
    setFormData((prev) => {
      const isSelected = prev.sizes.includes(size);
      // Deselecting drops the size's measurement entry entirely, so it can
      // never be written even if the admin had partially filled it in.
      const nextMeasurements = { ...prev.measurements };
      if (isSelected) {
        delete nextMeasurements[size];
      } else {
        nextMeasurements[size] = emptyMeasurementEntry(prev.measurementType);
      }
      return {
        ...prev,
        sizes: isSelected ? prev.sizes.filter((s) => s !== size) : [...prev.sizes, size],
        measurements: nextMeasurements,
      };
    });
    clearFieldError('sizes');
  };

  // True if any size has a non-empty value for any field, regardless of
  // which type's keys those fields belong to — used to decide whether
  // switching measurementType needs a confirmation (the field keys differ
  // between types, so entered data can never carry over).
  const hasMeasurementValues = (measurements) =>
    Object.values(measurements || {}).some((entry) =>
      Object.values(entry || {}).some((value) => typeof value === 'string' && value.trim() !== '')
    );

  // Re-keys every selected size's measurement entry to the new type's blank
  // field set. Always safe to call directly when there's nothing to lose;
  // routed through the confirm dialog otherwise (see handleMeasurementTypeChange).
  const applyMeasurementType = (type) => {
    setFormData((prev) => {
      const nextMeasurements = {};
      prev.sizes.forEach((size) => {
        nextMeasurements[size] = emptyMeasurementEntry(type);
      });
      return { ...prev, measurementType: type, measurements: nextMeasurements };
    });
  };

  const handleMeasurementTypeChange = (type) => {
    if (formData.measurementType === type) return;
    Haptics.selectionAsync();
    if (hasMeasurementValues(formData.measurements)) {
      setPendingMeasurementType(type);
      return;
    }
    applyMeasurementType(type);
  };

  const confirmMeasurementTypeChange = () => {
    if (pendingMeasurementType) applyMeasurementType(pendingMeasurementType);
    setPendingMeasurementType(null);
  };

  const cancelMeasurementTypeChange = () => {
    setPendingMeasurementType(null);
  };

  // Numeric-only at the input layer (measurements are optional and never
  // block submission — see validate()), but decimals like 17.5" are valid
  // garment measurements so a single "." is allowed through.
  const sanitizeMeasurementInput = (text) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot === -1) return cleaned;
    return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  };

  const handleMeasurementChange = (size, fieldKey, text) => {
    const sanitized = sanitizeMeasurementInput(text);
    setFormData((prev) => ({
      ...prev,
      measurements: {
        ...prev.measurements,
        [size]: { ...prev.measurements[size], [fieldKey]: sanitized },
      },
    }));
  };

  const toggleMeasurementsExpanded = () => {
    Haptics.selectionAsync();
    setMeasurementsExpanded((prev) => !prev);
  };

  const isDirty =
    Boolean(formData.name.trim()) ||
    Boolean(formData.price.trim()) ||
    Boolean(formData.stock.trim()) ||
    Boolean(formData.description.trim()) ||
    Boolean(formData.imageUrl.trim()) ||
    formData.colors.length > 0 ||
    formData.sizes.length > 0 ||
    Boolean(formData.measurementType) ||
    Boolean(buildMeasurementsPayload(formData.measurements, formData.measurementType));

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

    const measurementsResult = buildMeasurementsPayload(formData.measurements, formData.measurementType);

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
      // Optional — omitted entirely (not even as null) when nothing was
      // filled in, so ProductContext.js never writes an empty field.
      // measurementType always travels with measurements, never alone.
      ...(measurementsResult
        ? { measurements: measurementsResult.measurements, measurementType: measurementsResult.measurementType }
        : {}),
    });

    setLoading(false);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        'Success',
        'Product added successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } else if (result.error === 'NO_STORE') {
      // A manager promoted before stores existed, or one whose store was
      // never set. Nothing on this screen can fix it, so say who can.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert(
        'No Store Assigned',
        "Your account isn't assigned to a store yet, so there's nowhere to list this product. Ask a Platform Admin to assign you one in Manage Users."
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
          {duplicateFrom ? 'Duplicate Product' : 'Add New Product'}
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

              {/* Upload sits above the URL field because it is the path
                  almost every listing will take — a manager photographs
                  the item in front of them. The URL field stays for the
                  products already hosted elsewhere and for anyone who
                  prefers it; both write the same imageUrl string. */}
              <View style={styles.uploadRow}>
                <AnimatedPressable
                  style={[styles.uploadButton, (uploading || !isConnected) && styles.uploadButtonDisabled]}
                  onPress={() => handleUploadImage('camera')}
                  disabled={uploading || !isConnected}
                  accessibilityRole="button"
                  accessibilityLabel="Take a photo"
                  accessibilityState={{ disabled: uploading || !isConnected }}
                >
                  <Ionicons name="camera-outline" size={18} color={Colors.light.tint} />
                  <Text style={styles.uploadButtonText}>Take Photo</Text>
                </AnimatedPressable>

                <AnimatedPressable
                  style={[styles.uploadButton, (uploading || !isConnected) && styles.uploadButtonDisabled]}
                  onPress={() => handleUploadImage('library')}
                  disabled={uploading || !isConnected}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a photo from your library"
                  accessibilityState={{ disabled: uploading || !isConnected }}
                >
                  <Ionicons name="images-outline" size={18} color={Colors.light.tint} />
                  <Text style={styles.uploadButtonText}>Choose Photo</Text>
                </AnimatedPressable>
              </View>

              {uploading && (
                <View style={styles.uploadProgressWrap} accessibilityLiveRegion="polite">
                  <View style={styles.uploadProgressTrack}>
                    <View
                      style={[
                        styles.uploadProgressFill,
                        { width: `${Math.round(uploadProgress * 100)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.uploadProgressText}>
                    Uploading… {Math.round(uploadProgress * 100)}%
                  </Text>
                </View>
              )}

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

            {/* Measurements */}
            <Animated.View
              style={styles.sectionWrap}
              layout={reduceMotion ? undefined : LinearTransition.duration(200).easing(EASE_OUT_QUART)}
            >
              <AnimatedPressable
                onPress={toggleMeasurementsExpanded}
                style={styles.measurementsHeader}
                accessibilityRole="button"
                accessibilityLabel="Measurements (Optional)"
                accessibilityHint={
                  measurementsExpanded ? 'Collapses the measurement inputs' : 'Expands the measurement inputs'
                }
                accessibilityState={{ expanded: measurementsExpanded }}
              >
                <Text style={styles.sectionTitle}>Measurements (Optional)</Text>
                <Animated.View style={measurementsChevronStyle}>
                  <Ionicons name="chevron-down" size={20} color={Colors.light.icon} />
                </Animated.View>
              </AnimatedPressable>

              {measurementsExpanded && (
                <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180).easing(EASE_OUT_QUART)}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>What kind of item is this?</Text>
                    <View style={styles.sizeChipsRow}>
                      {MEASUREMENT_TYPE_OPTIONS.map((option) => {
                        const isActive = formData.measurementType === option.key;
                        return (
                          <AnimatedPressable
                            key={option.key}
                            onPress={() => handleMeasurementTypeChange(option.key)}
                            style={[styles.sizeChip, isActive && styles.sizeChipActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isActive }}
                            accessibilityLabel={option.label}
                          >
                            <Text style={[styles.sizeChipText, isActive && styles.sizeChipTextActive]}>
                              {option.label}
                            </Text>
                          </AnimatedPressable>
                        );
                      })}
                    </View>
                  </View>

                  {!formData.measurementType ? (
                    <Text style={styles.helperText}>Choose an item type to add measurements.</Text>
                  ) : (
                    <>
                      <Text style={styles.helperText}>
                        {MEASUREMENT_TYPES[formData.measurementType].helper}
                      </Text>
                      {formData.sizes.length === 0 ? (
                        <Text style={styles.helperText}>Select at least one size to add measurements.</Text>
                      ) : (
                        SIZE_OPTIONS.filter((size) => formData.sizes.includes(size)).map((size) => (
                          <View key={size} style={styles.measurementGroup}>
                            <Text style={styles.measurementGroupTitle}>{size}</Text>
                            <View style={styles.measurementInputsRow}>
                              {MEASUREMENT_TYPES[formData.measurementType].fields.map((field) => (
                                <View key={field.key} style={styles.measurementFieldWrap}>
                                  <Input
                                    label={`${field.label} (${MEASUREMENT_TYPES[formData.measurementType].unit})`}
                                    value={formData.measurements[size]?.[field.key] ?? ''}
                                    onChangeText={(text) => handleMeasurementChange(size, field.key, text)}
                                    placeholder="0"
                                    keyboardType="numeric"
                                    accessibilityLabel={`${size} ${field.label} in ${MEASUREMENT_TYPES[formData.measurementType].unit}`}
                                  />
                                </View>
                              ))}
                            </View>
                          </View>
                        ))
                      )}
                    </>
                  )}
                </Animated.View>
              )}
            </Animated.View>

            <ConfirmDialog
              visible={Boolean(pendingMeasurementType)}
              onClose={cancelMeasurementTypeChange}
              title="Change item type?"
              confirmLabel="Change Type"
              onConfirm={confirmMeasurementTypeChange}
            >
              <Text style={styles.modalMessage}>
                The measurements you&apos;ve entered will be cleared.
              </Text>
            </ConfirmDialog>

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
  uploadRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  // Outline treatment rather than a filled Clay button: these sit above a
  // form whose one filled primary action is Save. Two Clay buttons here
  // would compete with it, which DESIGN.md's one-accent rule rules out.
  uploadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    backgroundColor: 'transparent',
  },
  uploadButtonDisabled: { opacity: 0.5 },
  uploadButtonText: { fontSize: 14, fontWeight: '600', color: Colors.light.tint },
  uploadProgressWrap: { marginBottom: Spacing.md, gap: Spacing.xs },
  uploadProgressTrack: {
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.border,
    overflow: 'hidden',
  },
  uploadProgressFill: { height: '100%', backgroundColor: Colors.light.tint },
  uploadProgressText: { fontSize: 12, color: Colors.light.icon },
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
  measurementsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  measurementGroup: {
    marginTop: Spacing.md,
  },
  measurementGroupTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: Spacing.xs,
  },
  measurementInputsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  measurementFieldWrap: {
    width: '47%',
  },
  modalMessage: {
    fontSize: 15,
    color: Colors.light.icon,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
});
