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
  ActivityIndicator,
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
import { deleteField } from 'firebase/firestore';
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

// Builds one measurement entry per size already selected on the product,
// filled in from product.measurements where present and blank otherwise —
// correctly handles products saved before this field existed (no
// `measurements` key at all) by defaulting every size to blank.
//
// Backward compatibility: products saved before measurementType existed
// carry `measurements` with the old five keys (chest, length, shoulder,
// sleeve, waist) and no `measurementType` at all. Those are preselected as
// "tops" — the closest match — which only has room for four of the five old
// keys; the legacy `waist` value has no home in tops and is silently
// dropped on the next save (never hydrated into any field, so it can't
// round-trip back out). A product with neither field just gets type: null,
// same as a brand new product.
const hydrateMeasurements = (product) => {
  const type = product.measurementType || (product.measurements ? 'tops' : null);
  const fields = type ? MEASUREMENT_TYPES[type]?.fields || [] : [];
  const measurements = {};
  (product.sizes || []).forEach((size) => {
    const existing = product.measurements?.[size];
    measurements[size] = existing
      ? fields.reduce((acc, field) => {
          acc[field.key] = existing[field.key] || '';
          return acc;
        }, {})
      : emptyMeasurementEntry(type);
  });
  return { measurements, measurementType: type };
};

const measurementsEqual = (a, aType, b, bType) => {
  if (aType !== bType) return false;
  const fields = (aType && MEASUREMENT_TYPES[aType]?.fields) || [];
  const sizesA = Object.keys(a);
  const sizesB = Object.keys(b);
  if (sizesA.length !== sizesB.length) return false;
  return sizesA.every((size) => {
    const entryB = b[size];
    if (!entryB) return false;
    const entryA = a[size];
    return fields.every((field) => (entryA[field.key] || '') === (entryB[field.key] || ''));
  });
};

export default function AdminEditProductScreen({ navigation, route }) {
  const { product } = route.params;
  const { updateProduct, deleteProduct } = useProducts();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

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
    ...hydrateMeasurements(product),
  });
  const [measurementsExpanded, setMeasurementsExpanded] = useState(false);
  const [pendingMeasurementType, setPendingMeasurementType] = useState(null);
  const [errors, setErrors] = useState({
    name: '',
    price: '',
    stock: '',
    imageUrl: '',
    colors: '',
    sizes: '',
  });

  // Separate from `deleting` — sharing one flag previously meant deleting a
  // product flipped the Save button's label to "Saving..." mid-delete.
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Snapshot of what's actually saved, so "unsaved changes" can be judged
  // against the loaded product rather than "is any field non-empty" (every
  // field starts non-empty here, unlike a blank Add form).
  const originalRef = useRef({
    name: product.name,
    price: product.price.toString(),
    type: product.type,
    stock: product.stock.toString(),
    description: product.description || '',
    imageUrl: product.imageUrl,
    colors: product.colors || [],
    sizes: product.sizes || [],
    ...hydrateMeasurements(product),
  });

  // The existing photo is already a known-good URL, so it's shown
  // immediately on open instead of waiting through the debounce meant for
  // in-progress typing.
  const [previewUri, setPreviewUri] = useState(product.imageUrl || '');
  const [imageLoading, setImageLoading] = useState(Boolean(product.imageUrl));
  const [imageFailed, setImageFailed] = useState(false);

  // Upload runs alongside the URL field rather than replacing it. That
  // matters more on this screen than on Add: every product edited here
  // predates Storage and carries an external URL, and opening the editor
  // must not imply that URL is now invalid. Both paths write the same
  // imageUrl string, so replacing a photo is a normal edit like any other.
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
    // Already showing this exact URL (true on mount, since previewUri
    // starts equal to the loaded product's imageUrl) — nothing to debounce.
    if (trimmed === previewUri) {
      return undefined;
    }
    setImageFailed(false);
    const timer = setTimeout(() => {
      setPreviewUri(trimmed);
      setImageLoading(true);
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.imageUrl, previewUri]);

  // Shake targets — one per validated field, same shake shape
  // AdminAddProductScreen.js / AdminLoginScreen.js use on an invalid field.
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

  // Writes the download URL into the same imageUrl field a pasted link
  // goes into, so the debounced preview, the isDirty comparison against
  // `original`, validate(), and handleSave() all keep working untouched.
  //
  // Note the old photo is deliberately NOT deleted when one replaces it:
  // nothing has been saved yet at this point, the manager may still back
  // out, and a product that keeps pointing at a file we removed is worse
  // than an orphan in the bucket. See the note in storage.rules about
  // reaping those being a server-side job.
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

    // Backing out of the picker is a decision, not a failure.
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
      // never be written even if it had values loaded from the product.
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

  const original = originalRef.current;
  const isDirty =
    formData.name !== original.name ||
    formData.price !== original.price ||
    formData.type !== original.type ||
    formData.stock !== original.stock ||
    formData.description !== original.description ||
    formData.imageUrl !== original.imageUrl ||
    formData.colors.length !== original.colors.length ||
    formData.colors.some((c) => !original.colors.includes(c)) ||
    formData.sizes.length !== original.sizes.length ||
    formData.sizes.some((s) => !original.sizes.includes(s)) ||
    !measurementsEqual(
      formData.measurements,
      formData.measurementType,
      original.measurements,
      original.measurementType
    );

  const handleBack = () => {
    if (!isDirty) {
      navigation.goBack();
      return;
    }
    Haptics.selectionAsync();
    showAppAlert(
      'Discard changes?',
      'You have unsaved changes to this product. Going back will discard them.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  };

  // Validates every field at once and surfaces every error inline instead
  // of stopping at the first Alert — matches AdminAddProductScreen.js so
  // the two forms behave identically.
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

    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const measurementsResult = buildMeasurementsPayload(formData.measurements, formData.measurementType);

    const result = await updateProduct(product.id, {
      name: formData.name,
      // Stored as a real number, same reasoning as stock below —
      // parseFloat rather than parseInt/Number since price needs to
      // support decimals (e.g. 299.50). Already validated as a non-NaN,
      // positive number above, so no further fallback is needed here.
      // Saving any existing product here also migrates a legacy
      // string-typed price to a number, same as stock does.
      price: parseFloat(formData.price),
      type: formData.type,
      // Stored as a real number (not the raw TextInput string) so
      // firestore.rules can validate checkout's stock decrement with a
      // plain numeric comparison — see CheckoutScreen.js / firestore.rules.
      // Already validated as a non-NaN, non-negative number above; saving
      // any existing product here also migrates its stock field from the
      // old string format to a number.
      stock: Number(formData.stock),
      description: formData.description,
      imageUrl: formData.imageUrl,
      colors: formData.colors,
      sizes: formData.sizes,
      // updateDoc (unlike addDoc) needs an explicit deleteField() to
      // remove a field the product previously had — omitting the key here
      // would silently leave a stale `measurements` map (or `measurementType`)
      // in place. Both sentinels pass straight through updateProduct(),
      // which forwards this object to updateDoc() untouched.
      measurements: measurementsResult?.measurements || deleteField(),
      measurementType: measurementsResult?.measurementType || deleteField(),
    });

    setSaving(false);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        'Success',
        'Product updated successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } else if (!isConnected) {
      // Same reasoning as AdminAddProductScreen.js: updateProduct()
      // resolves { success: false, error } rather than throwing, and only
      // passes along error.message (no error.code), so isConnected is the
      // only reliable offline signal available in this shape.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert(
        'No Internet Connection',
        'Network connection lost. Please check your connection and try again.'
      );
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Error', 'Failed to update product: ' + result.error);
    }
  };

  const handleDelete = () => {
    Haptics.selectionAsync();
    showAppAlert(
      'Delete Product',
      `Are you sure you want to delete "${formData.name.trim() || product.name}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const result = await deleteProduct(product.id);
            setDeleting(false);

            if (result.success) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              showAppAlert('Success', 'Product deleted successfully!', [
                { text: 'OK', onPress: () => navigation.goBack() },
              ]);
            } else if (!isConnected) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              showAppAlert(
                'No Internet Connection',
                'Network connection lost. Please check your connection and try again.'
              );
            } else {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              showAppAlert('Error', 'Failed to delete product: ' + result.error);
            }
          },
        },
      ]
    );
  };

  const trimmedImageUrl = formData.imageUrl.trim();
  const pending = Boolean(trimmedImageUrl) && previewUri !== trimmedImageUrl;
  const busy = saving || deleting;

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
          Edit Product
        </Text>
        <AnimatedPressable
          onPress={handleDelete}
          style={styles.deleteButton}
          disabled={busy}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Delete product"
        >
          {deleting ? (
            <ActivityIndicator size="small" color={Colors.light.danger} />
          ) : (
            <Ionicons name="trash-outline" size={22} color={Colors.light.danger} />
          )}
        </AnimatedPressable>
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

              {/* Replacing a photo is the common edit here, so upload
                  leads. The URL field stays because every product that
                  predates Storage carries an external link, and opening
                  this screen must not suggest that link has stopped
                  working. Both write the same imageUrl string. */}
              <View style={styles.uploadRow}>
                <AnimatedPressable
                  style={[styles.uploadButton, (uploading || !isConnected) && styles.uploadButtonDisabled]}
                  onPress={() => handleUploadImage('camera')}
                  disabled={uploading || !isConnected}
                  accessibilityRole="button"
                  accessibilityLabel="Take a new photo"
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
                  accessibilityLabel="Choose a new photo from your library"
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
                  saving
                    ? 'Saving...'
                    : !isConnected
                    ? 'No Internet Connection'
                    : 'Save Changes'
                }
                onPress={handleSubmit}
                disabled={busy || !isConnected}
                loading={saving}
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
  deleteButton: {
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
  // Outline rather than filled Clay, matching AdminAddProductScreen: the
  // one filled primary action on this form is Save, and two Clay buttons
  // above it would compete with it.
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
