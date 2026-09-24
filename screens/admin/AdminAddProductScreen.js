// Add a product, from the approved store-manager preview: step chips under
// the bar that jump to each section and turn Moss when it's complete, an
// ink "shopper preview" of the listing that updates as the manager types,
// five numbered cards (photo, details, price & stock, variants, optional
// measurements), and a footer with progress and the save button. Leaving
// with unsaved work asks first and lists exactly what would be lost.
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeIn,
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
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUART, EASE_OUT_QUINT } from '../../constants/motion';
import { pickAndUploadProductImage, uploadErrorMessage } from '../../utils/imageUpload';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { TopBar, OfflineNotice } from '../../components/shop/TabScreen';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const CREAM = Colors.light.background;
const LINE = Colors.light.border;
const CARD_LINE = '#EEE7DD';
const ERR = '#B42318';
const ERR_BG = '#FFF8F7';

// Light swatches get a dark tick so it shows.
const LIGHT_SWATCHES = ['White', 'Beige', 'Yellow'];

const TYPE_OPTIONS = [
  {
    key: 'ready-to-wear',
    label: 'Ready-to-Wear',
    detail: 'Brand-new items',
    icon: 'pricetag-outline',
    color: CLAY,
    bg: '#FDF6F2',
  },
  {
    key: 'ukay-ukay',
    label: 'Ukay-Ukay',
    detail: 'Pre-loved, one of a kind',
    icon: 'leaf-outline',
    color: MOSS,
    bg: '#F3F5EF',
  },
];

const SECTIONS = [
  { key: 'photo', label: 'Photo' },
  { key: 'details', label: 'Details' },
  { key: 'price', label: 'Price & stock' },
  { key: 'variants', label: 'Variants' },
  { key: 'measurements', label: 'Measurements' },
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
// they are TextInput values here and only become numbers at save.
//
// The name gets a "(Copy)" suffix rather than arriving identical: it says
// what happened and it is the first thing the manager will edit.
//
// colors, sizes and measurements are copied by value, not by reference.
// The source object here is the live one out of ProductContext's array,
// so editing sizes on the duplicate would otherwise mutate the product
// being copied FROM.
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

const peso = (value) => `₱${(Number(value) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

// True if any size has a non-empty value for any field — used both for
// the item-type-change confirmation and for "you'll lose: Measurements".
const hasMeasurementValues = (measurements) =>
  Object.values(measurements || {}).some((entry) =>
    Object.values(entry || {}).some((value) => typeof value === 'string' && value.trim() !== '')
  );

function Card({ number, title, hint, done, right, onLayout, children }) {
  return (
    <View style={styles.card} onLayout={onLayout}>
      <View style={styles.cardHead}>
        <View style={[styles.num, done && styles.numDone]}>
          {done ? <Ionicons name="checkmark" size={13} color="#fff" /> : <Text style={styles.numText}>{number}</Text>}
        </View>
        <Text style={styles.cardTitle} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function FieldLabel({ children, note }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {note ? <Text style={styles.labelNote}>{note}</Text> : null}
    </View>
  );
}

function FieldError({ children }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

// A plain text field in the form's style: cream until focused, white and
// Clay-edged while typing, red-edged with a message when invalid.
function Field({ value, onChangeText, error, prefix, multiline, style, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.input,
        multiline && styles.inputMulti,
        focused && styles.inputFocused,
        Boolean(error) && styles.inputBad,
        style,
      ]}
    >
      {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor="#A69D93"
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.inputText, multiline && styles.inputTextMulti]}
        {...rest}
      />
    </View>
  );
}

export default function AdminAddProductScreen({ navigation, route }) {
  const { addProduct } = useProducts();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  // Set when arriving via Duplicate on AdminProductsScreen. Read once into
  // initial state rather than watched: this form is the manager's working
  // copy from the first render on.
  const duplicateFrom = route.params?.duplicateFrom;

  const [formData, setFormData] = useState(() => buildInitialForm(duplicateFrom));
  // Opened by default when duplicating a product that has a size guide,
  // so the copied measurements are visible rather than hidden.
  const [measurementsExpanded, setMeasurementsExpanded] = useState(Boolean(duplicateFrom?.measurements));
  const [pendingMeasurementType, setPendingMeasurementType] = useState(null);
  const [errors, setErrors] = useState({
    name: '',
    price: '',
    stock: '',
    imageUrl: '',
    colors: '',
    sizes: '',
  });
  // Set by the first save attempt; from then on the step chips show which
  // sections still need something, in red.
  const [tried, setTried] = useState(false);
  const [loading, setLoading] = useState(false);
  // Choosing Ukay-Ukay on an empty stock fills in 1, since ukay pieces are
  // usually one of a kind. That 1 is the form's doing, not the manager's,
  // so on its own it doesn't count as unsaved work.
  const [autoStock, setAutoStock] = useState(false);

  // Debounced preview: the raw imageUrl updates on every keystroke, but
  // previewUri only catches up after typing pauses, so a partial URL never
  // gets sent to Image mid-type.
  const [previewUri, setPreviewUri] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  // Upload runs alongside the URL field rather than replacing it: products
  // hosted elsewhere keep working, and both paths end in `imageUrl`.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const scrollRef = useRef(null);
  const sectionY = useRef({});
  const [leaveAction, setLeaveAction] = useState(null);
  const saved = useRef(false);

  useEffect(() => {
    const trimmed = formData.imageUrl.trim();
    if (!trimmed) {
      setPreviewUri('');
      setImageFailed(false);
      return undefined;
    }
    setImageFailed(false);
    const timer = setTimeout(() => setPreviewUri(trimmed), 500);
    return () => clearTimeout(timer);
  }, [formData.imageUrl]);

  const clearFieldError = (field) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: '' } : prev));
  };

  const setField = (field) => (text) => {
    setFormData((prev) => ({ ...prev, [field]: text }));
    if (field === 'stock') setAutoStock(false);
    clearFieldError(field);
  };

  // Pick and upload, then write the resulting download URL into the same
  // imageUrl field a pasted link goes into.
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

  const handleTypeChange = (type) => {
    if (formData.type === type) return;
    Haptics.selectionAsync();
    const fillStock = type === 'ukay-ukay' && !formData.stock.trim();
    setFormData((prev) => ({
      ...prev,
      type,
      ...(fillStock ? { stock: '1' } : {}),
    }));
    if (fillStock) {
      setAutoStock(true);
      clearFieldError('stock');
    } else if (type !== 'ukay-ukay' && autoStock) {
      // Switching back takes the form's own 1 away again.
      setFormData((prev) => ({ ...prev, stock: '' }));
      setAutoStock(false);
    }
  };

  const stepStock = (delta) => {
    Haptics.selectionAsync();
    const current = parseInt(formData.stock, 10);
    const next = Math.max(0, (Number.isNaN(current) ? 0 : current) + delta);
    setField('stock')(String(next));
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
      // never be written even if it was partially filled in.
      const nextMeasurements = { ...prev.measurements };
      if (isSelected) delete nextMeasurements[size];
      else nextMeasurements[size] = emptyMeasurementEntry(prev.measurementType);
      return {
        ...prev,
        sizes: isSelected ? prev.sizes.filter((s) => s !== size) : [...prev.sizes, size],
        measurements: nextMeasurements,
      };
    });
    clearFieldError('sizes');
  };

  // Re-keys every selected size's measurement entry to the new type's blank
  // field set (the field keys differ between types, so nothing carries over).
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

  // Numeric-only, but decimals like 17.5" are valid garment measurements,
  // so a single "." is allowed through.
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

  // What leaving now would throw away, named, for the discard dialog.
  // Empty means there's nothing to lose and leaving needn't ask.
  const lostList = [];
  if (formData.imageUrl.trim()) lostList.push('Photo');
  if (formData.name.trim()) lostList.push('Name');
  if (formData.price.trim()) lostList.push('Price');
  if (formData.stock.trim() && !autoStock) lostList.push('Stock');
  if (formData.description.trim()) lostList.push('Description');
  if (formData.colors.length) lostList.push(`${formData.colors.length} color${formData.colors.length > 1 ? 's' : ''}`);
  if (formData.sizes.length) lostList.push(`${formData.sizes.length} size${formData.sizes.length > 1 ? 's' : ''}`);
  if (hasMeasurementValues(formData.measurements)) lostList.push('Measurements');
  const isDirty = lostList.length > 0;

  // Every way off this screen — the back arrow, Android's back button, the
  // iOS swipe — goes through here, so none of them can drop a half-filled
  // listing without asking. Saving sets `saved` first so it leaves freely.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (saved.current || !dirtyRef.current) return;
        event.preventDefault();
        Haptics.selectionAsync();
        setLeaveAction(event.data.action);
      }),
    [navigation]
  );

  // Which required sections are complete. Measurements are optional and
  // never block saving.
  const checks = {
    photo: Boolean(formData.imageUrl.trim()) && !imageFailed,
    details: Boolean(formData.name.trim()),
    price: parseFloat(formData.price) > 0 && formData.stock.trim() !== '' && Number(formData.stock) >= 0,
    variants: formData.colors.length > 0 && formData.sizes.length > 0,
  };
  const measurementsDone = Boolean(buildMeasurementsPayload(formData.measurements, formData.measurementType));
  const doneCount = Object.values(checks).filter(Boolean).length;

  const progress = useSharedValue(doneCount / 4);
  useEffect(() => {
    progress.value = reduceMotion
      ? doneCount / 4
      : withTiming(doneCount / 4, { duration: 400, easing: EASE_OUT_QUINT });
  }, [doneCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  const jumpTo = (key) => {
    const y = sectionY.current[key];
    if (y == null) return;
    if (key === 'measurements' && !measurementsExpanded) setMeasurementsExpanded(true);
    scrollRef.current?.scrollTo({
      y: Math.max(0, y - 12),
      animated: !reduceMotion,
    });
  };

  // Validates every field at once and marks every problem, so a form with
  // several mistakes can be fixed in one pass.
  const validate = () => {
    const nextErrors = {
      name: '',
      price: '',
      stock: '',
      imageUrl: '',
      colors: '',
      sizes: '',
    };
    if (!formData.imageUrl.trim()) nextErrors.imageUrl = 'Add a photo or an image link.';
    else if (imageFailed) nextErrors.imageUrl = "This image couldn't load. Try a different one.";
    if (!formData.name.trim()) nextErrors.name = 'Give the product a name.';
    if (!formData.price.trim()) {
      nextErrors.price = 'Enter a price.';
    } else {
      const parsedPrice = parseFloat(formData.price);
      // parseFloat("abc") is NaN, and NaN <= 0 is false, so NaN is checked
      // explicitly rather than relying on the comparison alone.
      if (Number.isNaN(parsedPrice) || parsedPrice <= 0) nextErrors.price = 'Enter a price above ₱0.';
    }
    if (!formData.stock.trim()) {
      nextErrors.stock = 'Enter how many you have.';
    } else {
      const parsedStock = Number(formData.stock);
      // Validated explicitly so a typo doesn't quietly zero out inventory.
      if (Number.isNaN(parsedStock) || parsedStock < 0) nextErrors.stock = 'Enter a whole number, 0 or more.';
    }
    if (formData.colors.length === 0) nextErrors.colors = 'Pick at least one color.';
    if (formData.sizes.length === 0) nextErrors.sizes = 'Pick at least one size.';

    setErrors(nextErrors);
    setTried(true);
    const firstBad = nextErrors.imageUrl
      ? 'photo'
      : nextErrors.name
        ? 'details'
        : nextErrors.price || nextErrors.stock
          ? 'price'
          : nextErrors.colors || nextErrors.sizes
            ? 'variants'
            : null;
    if (firstBad) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      jumpTo(firstBad);
    }
    return !firstBad;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const measurementsResult = buildMeasurementsPayload(formData.measurements, formData.measurementType);

    const result = await addProduct({
      name: formData.name,
      // Real numbers, not the TextInput strings, so firestore.rules can
      // validate checkout's stock decrement with a numeric comparison.
      // Both were validated above.
      price: parseFloat(formData.price),
      type: formData.type,
      stock: Number(formData.stock),
      description: formData.description,
      imageUrl: formData.imageUrl,
      colors: formData.colors,
      sizes: formData.sizes,
      // Optional — omitted entirely when nothing was filled in.
      // measurementType always travels with measurements, never alone.
      ...(measurementsResult
        ? {
            measurements: measurementsResult.measurements,
            measurementType: measurementsResult.measurementType,
          }
        : {}),
    });

    setLoading(false);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      saved.current = true;
      // Back to the list, which says the product is live and highlights it.
      navigation.popTo('AdminProducts', {
        added: formData.name.trim(),
        addedAt: Date.now(),
      });
    } else if (result.error === 'NO_STORE') {
      // A manager whose store was never set. Nothing here can fix it.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert(
        'No Store Assigned',
        "Your account isn't assigned to a store yet, so there's nowhere to list this product. Ask a Platform Admin to assign you one in Manage Users."
      );
    } else if (!isConnected) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('No Internet Connection', 'Network connection lost. Please check your connection and try again.');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Error', 'Failed to add product: ' + result.error);
    }
  };

  const onSectionLayout = (key) => (event) => {
    sectionY.current[key] = event.nativeEvent.layout.y;
  };

  const trimmedName = formData.name.trim();
  const priceValue = parseFloat(formData.price);
  const measurementType = MEASUREMENT_TYPES[formData.measurementType];
  const selectedSizes = SIZE_OPTIONS.filter((size) => formData.sizes.includes(size));
  const ukay = formData.type === 'ukay-ukay';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title={duplicateFrom ? 'Duplicate product' : 'New product'} onBack={() => navigation.goBack()} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stepsBar}
        contentContainerStyle={styles.steps}
      >
        {SECTIONS.map((section, i) => {
          const done = section.key === 'measurements' ? measurementsDone : checks[section.key];
          const bad = tried && section.key !== 'measurements' && !done;
          return (
            <Pressable
              key={section.key}
              onPress={() => jumpTo(section.key)}
              style={[styles.step, done && styles.stepDone, bad && styles.stepBad]}
              accessibilityRole="button"
              accessibilityLabel={`${section.label}${done ? ', done' : bad ? ', needs attention' : ''}`}
            >
              <View style={[styles.stepNum, done && { backgroundColor: MOSS }, bad && { backgroundColor: ERR }]}>
                {done ? (
                  <Ionicons name="checkmark" size={11} color="#fff" />
                ) : (
                  <Text style={[styles.stepNumText, bad && { color: '#fff' }]}>{i + 1}</Text>
                )}
              </View>
              <Text style={[styles.stepText, done && { color: '#37412F' }, bad && { color: ERR }]}>
                {section.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {!isConnected ? (
            <View style={{ marginBottom: 12 }}>
              <OfflineNotice>
                No internet connection. You can fill this in, but saving needs a connection.
              </OfflineNotice>
            </View>
          ) : null}

          {/* How the listing will look in the shop, as it's typed. */}
          <View style={styles.preview} accessibilityLabel="Shopper preview">
            <Text style={styles.previewLabel}>SHOPPER PREVIEW</Text>
            <View style={styles.previewImage}>
              {previewUri && !imageFailed ? (
                <Image
                  key={previewUri}
                  source={{ uri: previewUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <Ionicons
                  name={imageFailed ? 'alert-circle-outline' : 'image-outline'}
                  size={26}
                  color={imageFailed ? '#F2A99F' : MUTED}
                />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.previewTag, { backgroundColor: ukay ? MOSS : CLAY }]}>{ukay ? 'UKAY' : 'RTW'}</Text>
              <Text style={[styles.previewName, !trimmedName && styles.previewPlaceholder]} numberOfLines={1}>
                {trimmedName || 'Product name'}
              </Text>
              <Text style={[styles.previewPrice, !(priceValue > 0) && styles.previewPlaceholder]}>
                {priceValue > 0 ? peso(priceValue) : '₱0.00'}
              </Text>
              {formData.colors.length ? (
                <View style={styles.previewSwatches}>
                  {formData.colors.slice(0, 6).map((name) => (
                    <View
                      key={name}
                      style={[
                        styles.previewSwatch,
                        {
                          backgroundColor: COLOR_PALETTE.find((c) => c.name === name)?.hex,
                        },
                      ]}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </View>

          <Card
            number={1}
            title="Photo"
            hint="One photo per product. Shoppers see it first."
            done={checks.photo}
            onLayout={onSectionLayout('photo')}
          >
            <View style={styles.photoRow}>
              {[
                {
                  source: 'camera',
                  icon: 'camera-outline',
                  label: 'Take photo',
                },
                {
                  source: 'library',
                  icon: 'images-outline',
                  label: 'From gallery',
                },
              ].map((b) => (
                <Pressable
                  key={b.source}
                  onPress={() => handleUploadImage(b.source)}
                  disabled={uploading || !isConnected}
                  style={({ pressed }) => [
                    styles.photoButton,
                    (uploading || !isConnected) && { opacity: 0.5 },
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={b.label}
                  accessibilityState={{ disabled: uploading || !isConnected }}
                >
                  <Ionicons name={b.icon} size={17} color={CLAY} />
                  <Text style={styles.photoButtonText}>{b.label}</Text>
                </Pressable>
              ))}
            </View>
            {uploading ? (
              <View style={styles.upload} accessibilityLiveRegion="polite">
                <View style={styles.uploadTrack}>
                  <View style={[styles.uploadFill, { width: `${Math.round(uploadProgress * 100)}%` }]} />
                </View>
                <Text style={styles.uploadText}>Uploading… {Math.round(uploadProgress * 100)}%</Text>
              </View>
            ) : null}
            <View style={styles.or}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>or paste an image link</Text>
              <View style={styles.orLine} />
            </View>
            <Field
              value={formData.imageUrl}
              onChangeText={setField('imageUrl')}
              error={errors.imageUrl}
              placeholder="https://example.com/image.jpg"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Product image link"
            />
            <FieldError>
              {errors.imageUrl ||
                (imageFailed && !errors.imageUrl ? "This image couldn't load. Try a different one." : '')}
            </FieldError>
            {formData.imageUrl.trim() ? (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setFormData((prev) => ({ ...prev, imageUrl: '' }));
                }}
                hitSlop={6}
                style={styles.removePhoto}
                accessibilityRole="button"
              >
                <Ionicons name="close-circle-outline" size={15} color={MUTED} />
                <Text style={styles.removePhotoText}>Remove photo</Text>
              </Pressable>
            ) : null}
          </Card>

          <Card
            number={2}
            title="Details"
            hint="What is it, and what kind of clothing?"
            done={checks.details}
            onLayout={onSectionLayout('details')}
          >
            <FieldLabel>Product name</FieldLabel>
            <Field
              value={formData.name}
              onChangeText={setField('name')}
              error={errors.name}
              placeholder="e.g. Vintage Denim Jacket"
              accessibilityLabel="Product name"
            />
            <FieldError>{errors.name}</FieldError>

            <FieldLabel>Type</FieldLabel>
            <View style={styles.types}>
              {TYPE_OPTIONS.map((option) => {
                const on = formData.type === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => handleTypeChange(option.key)}
                    style={[
                      styles.type,
                      on && {
                        borderColor: option.color,
                        backgroundColor: option.bg,
                      },
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${option.label}, ${option.detail}`}
                  >
                    <Ionicons name={option.icon} size={22} color={option.color} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.typeTitle}>{option.label}</Text>
                      <Text style={styles.typeDetail}>{option.detail}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {ukay ? (
              <Animated.View
                style={styles.hint}
                entering={reduceMotion ? undefined : FadeIn.duration(250).easing(EASE_OUT_QUART)}
              >
                <Ionicons name="information-circle-outline" size={16} color="#37412F" />
                <Text style={styles.hintText}>
                  Ukay items are usually one of a kind, so stock starts at <Text style={{ fontWeight: '700' }}>1</Text>.
                  Change it if you have more than one of the same piece.
                </Text>
              </Animated.View>
            ) : null}

            <View style={{ marginTop: 14 }}>
              <FieldLabel note="Optional">Description</FieldLabel>
              <Field
                value={formData.description}
                onChangeText={setField('description')}
                multiline
                placeholder="Condition, material, fit… A clear description helps shoppers trust what they're buying."
                accessibilityLabel="Product description"
              />
            </View>
          </Card>

          <Card
            number={3}
            title="Price & stock"
            hint="Stock goes down automatically when someone orders."
            done={checks.price}
            onLayout={onSectionLayout('price')}
          >
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <FieldLabel>Price</FieldLabel>
                <Field
                  value={formData.price}
                  onChangeText={setField('price')}
                  error={errors.price}
                  prefix="₱"
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  accessibilityLabel="Price in pesos"
                />
                <FieldError>{errors.price}</FieldError>
              </View>
              <View style={{ flex: 1 }}>
                <FieldLabel>Stock</FieldLabel>
                <View style={[styles.stepper, Boolean(errors.stock) && styles.inputBad]}>
                  <Pressable
                    onPress={() => stepStock(-1)}
                    style={styles.stepperButton}
                    accessibilityRole="button"
                    accessibilityLabel="One less"
                  >
                    <Text style={styles.stepperSign}>−</Text>
                  </Pressable>
                  <TextInput
                    value={formData.stock}
                    onChangeText={setField('stock')}
                    keyboardType="number-pad"
                    style={styles.stepperInput}
                    accessibilityLabel="Stock quantity"
                  />
                  <Pressable
                    onPress={() => stepStock(1)}
                    style={styles.stepperButton}
                    accessibilityRole="button"
                    accessibilityLabel="One more"
                  >
                    <Text style={styles.stepperSign}>+</Text>
                  </Pressable>
                </View>
                <FieldError>{errors.stock}</FieldError>
              </View>
            </View>
          </Card>

          <Card
            number={4}
            title="Variants"
            hint="Pick every color and size you're selling."
            done={checks.variants}
            onLayout={onSectionLayout('variants')}
          >
            <FieldLabel note={formData.colors.length ? formData.colors.join(', ') : 'None selected'}>Colors</FieldLabel>
            <View style={styles.wrap}>
              {COLOR_PALETTE.map((color) => {
                const on = formData.colors.includes(color.name);
                return (
                  <Pressable
                    key={color.name}
                    onPress={() => toggleColor(color.name)}
                    style={[
                      styles.colorPill,
                      on && styles.colorPillOn,
                      Boolean(errors.colors) && !on && styles.pillBad,
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={color.name}
                  >
                    <View style={[styles.swatch, { backgroundColor: color.hex }]}>
                      {on ? (
                        <Ionicons
                          name="checkmark"
                          size={12}
                          color={LIGHT_SWATCHES.includes(color.name) ? INK : '#fff'}
                        />
                      ) : null}
                    </View>
                    <Text style={styles.colorName}>{color.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <FieldError>{errors.colors}</FieldError>

            <View style={{ marginTop: 14 }}>
              <FieldLabel note={formData.sizes.length ? `${formData.sizes.length} selected` : 'None selected'}>
                Sizes
              </FieldLabel>
              <View style={styles.wrap}>
                {SIZE_OPTIONS.map((size) => {
                  const on = formData.sizes.includes(size);
                  return (
                    <Pressable
                      key={size}
                      onPress={() => toggleSize(size)}
                      style={({ pressed }) => [
                        styles.size,
                        on && styles.sizeOn,
                        Boolean(errors.sizes) && !on && styles.pillBad,
                        pressed && { transform: [{ scale: 0.94 }] },
                      ]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Size ${size}`}
                    >
                      <Text style={[styles.sizeText, on && { color: CREAM }]}>{size}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <FieldError>{errors.sizes}</FieldError>
            </View>
          </Card>

          <View style={styles.card} onLayout={onSectionLayout('measurements')}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setMeasurementsExpanded((v) => !v);
              }}
              style={styles.cardHead}
              accessibilityRole="button"
              accessibilityState={{ expanded: measurementsExpanded }}
              accessibilityLabel="Measurements, optional"
            >
              <View style={[styles.num, measurementsDone && styles.numDone]}>
                {measurementsDone ? (
                  <Ionicons name="checkmark" size={13} color="#fff" />
                ) : (
                  <Text style={styles.numText}>5</Text>
                )}
              </View>
              <Text style={styles.cardTitle}>Measurements</Text>
              <Text style={styles.optional}>Optional</Text>
              <Ionicons
                name={measurementsExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={MUTED}
                style={{ marginLeft: 'auto' }}
              />
            </Pressable>

            {measurementsExpanded ? (
              <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220).easing(EASE_OUT_QUART)}>
                <View style={[styles.wrap, { marginTop: 12, marginBottom: 10 }]}>
                  {MEASUREMENT_TYPE_OPTIONS.map((option) => {
                    const on = formData.measurementType === option.key;
                    return (
                      <Pressable
                        key={option.key}
                        onPress={() => handleMeasurementTypeChange(option.key)}
                        style={[styles.mType, on && styles.mTypeOn]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.mTypeText, on && { color: '#fff' }]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.mNote}>
                  {measurementType
                    ? `${measurementType.helper} Blank sizes aren't saved.`
                    : 'Pick what kind of item this is to see the right measurements.'}
                </Text>
                {measurementType ? (
                  selectedSizes.length === 0 ? (
                    <Text style={styles.mEmpty}>Select sizes in Variants first. Each size gets its own row here.</Text>
                  ) : (
                    <View>
                      <View style={styles.mRow}>
                        <View style={styles.mSizeCell} />
                        {measurementType.fields.map((field) => (
                          <View key={field.key} style={styles.mCell}>
                            <Text style={styles.mHead} numberOfLines={1}>
                              {field.label.toUpperCase()}
                            </Text>
                            <Text style={styles.mUnit}>{measurementType.unit}</Text>
                          </View>
                        ))}
                      </View>
                      {selectedSizes.map((size) => (
                        <View key={size} style={styles.mRow}>
                          <Text style={styles.mSizeCell}>{size}</Text>
                          {measurementType.fields.map((field) => (
                            <View key={field.key} style={styles.mCell}>
                              <TextInput
                                value={formData.measurements[size]?.[field.key] ?? ''}
                                onChangeText={(text) => handleMeasurementChange(size, field.key, text)}
                                placeholder="—"
                                placeholderTextColor="#C9C0B6"
                                keyboardType="decimal-pad"
                                style={styles.mInput}
                                accessibilityLabel={`${size} ${field.label} in ${measurementType.unit}`}
                              />
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  )
                ) : null}
              </Animated.View>
            ) : null}
          </View>
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>{doneCount} of 4 required sections done</Text>
            <Text style={styles.progressText}>Measurements optional</Text>
          </View>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
          <Button
            label={!isConnected ? 'No internet connection' : duplicateFrom ? 'Add copy' : 'Add product'}
            fontSize={15.5}
            onPress={handleSubmit}
            loading={loading}
            disabled={loading || !isConnected}
            fullWidth
          />
        </View>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={Boolean(pendingMeasurementType)}
        onClose={() => setPendingMeasurementType(null)}
        title="Change item type?"
        confirmLabel="Change type"
        onConfirm={() => {
          if (pendingMeasurementType) applyMeasurementType(pendingMeasurementType);
          setPendingMeasurementType(null);
        }}
      >
        <Text style={styles.dialogText}>The measurements you&apos;ve entered will be cleared.</Text>
      </ConfirmDialog>

      <ConfirmDialog
        visible={Boolean(leaveAction)}
        onClose={() => setLeaveAction(null)}
        title="Discard this product?"
        icon="warning-outline"
        iconTone="warning"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        confirmVariant="danger"
        onConfirm={() => {
          const action = leaveAction;
          saved.current = true;
          setLeaveAction(null);
          navigation.dispatch(action);
        }}
      >
        <Text style={styles.dialogText}>It isn&apos;t saved yet. If you leave now, you&apos;ll lose:</Text>
        <View style={styles.lost}>
          {lostList.map((item) => (
            <Text key={item} style={styles.lostItem}>
              {item}
            </Text>
          ))}
        </View>
      </ConfirmDialog>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },

  stepsBar: { flexGrow: 0 },
  steps: { gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
  },
  stepDone: { borderColor: '#C9D3BE' },
  stepBad: { borderColor: '#F1CFCB' },
  stepNum: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F1EBE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { fontSize: 10.5, fontWeight: '600', color: MUTED },
  stepText: { fontSize: 12, fontWeight: '500', color: MUTED },

  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },

  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: INK,
    marginBottom: 14,
  },
  previewLabel: {
    position: 'absolute',
    top: 10,
    right: 12,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1,
    color: '#8B8178',
  },
  previewImage: {
    width: 78,
    height: 90,
    borderRadius: 14,
    backgroundColor: '#3A332E',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewTag: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  previewName: {
    fontSize: 14.5,
    fontWeight: '600',
    color: CREAM,
    marginTop: 6,
    marginBottom: 2,
    maxWidth: 210,
  },
  previewPrice: { fontSize: 15, fontWeight: '600', color: '#F1D98A' },
  previewPlaceholder: { color: MUTED },
  previewSwatches: { flexDirection: 'row', gap: 4, marginTop: 6 },
  previewSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.3)',
  },

  card: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  num: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F3EEE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numDone: { backgroundColor: MOSS },
  numText: { fontSize: 11, fontWeight: '600', color: INK },
  cardTitle: { fontSize: 15, fontWeight: '600', color: INK },
  cardHint: {
    fontSize: 12,
    color: MUTED,
    marginLeft: 30,
    marginTop: 2,
    marginBottom: 14,
  },
  optional: { fontSize: 11.5, color: MUTED },

  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 6,
    marginLeft: 2,
  },
  label: { fontSize: 12.5, fontWeight: '500', color: INK },
  labelNote: {
    flexShrink: 1,
    fontSize: 11.5,
    color: MUTED,
    textAlign: 'right',
  },
  error: { fontSize: 11.5, color: ERR, marginTop: 5, marginLeft: 2 },

  input: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
    paddingHorizontal: 14,
  },
  inputMulti: { minHeight: 88, alignItems: 'flex-start', paddingVertical: 10 },
  inputFocused: { borderColor: CLAY, backgroundColor: '#fff' },
  inputBad: { borderColor: ERR, backgroundColor: ERR_BG },
  inputText: {
    flex: 1,
    fontSize: 14.5,
    color: INK,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  inputTextMulti: { minHeight: 66, paddingVertical: 0, lineHeight: 21 },
  prefix: { fontSize: 14.5, fontWeight: '600', color: MUTED, marginRight: 4 },

  photoRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  photoButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D9B3A3',
    backgroundColor: '#FBF1EC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoButtonText: { fontSize: 12.5, fontWeight: '600', color: CLAY },
  upload: { gap: 4, marginBottom: 12 },
  uploadTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#EDE5DA',
    overflow: 'hidden',
  },
  uploadFill: { height: '100%', backgroundColor: CLAY },
  uploadText: { fontSize: 11.5, color: MUTED },
  or: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 10,
  },
  orLine: { flex: 1, height: 1, backgroundColor: LINE },
  orText: { fontSize: 11, color: MUTED },
  removePhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  removePhotoText: { fontSize: 12, fontWeight: '500', color: MUTED },

  types: { flexDirection: 'row', gap: 8, marginTop: 10 },
  type: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
  },
  typeTitle: { fontSize: 13, fontWeight: '600', color: INK },
  typeDetail: { fontSize: 11, color: MUTED },
  hint: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#EEF0EA',
  },
  hintText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: '#37412F' },

  two: { flexDirection: 'row', gap: 10 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
  },
  stepperButton: {
    width: 42,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperSign: { fontSize: 18, fontWeight: '500', color: INK },
  stepperInput: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontSize: 14.5,
    fontWeight: '600',
    color: INK,
    paddingVertical: 0,
    outlineStyle: 'none',
  },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
  },
  colorPillOn: { borderColor: INK, backgroundColor: '#fff' },
  pillBad: { borderColor: '#F1CFCB' },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorName: { fontSize: 12, fontWeight: '500', color: INK },
  size: {
    minWidth: 52,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeOn: { backgroundColor: INK, borderColor: INK },
  sizeText: { fontSize: 14, fontWeight: '600', color: INK },

  mType: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
    justifyContent: 'center',
  },
  mTypeOn: { backgroundColor: CLAY, borderColor: CLAY },
  mTypeText: { fontSize: 12, fontWeight: '500', color: INK },
  mNote: { fontSize: 11.5, lineHeight: 17, color: MUTED, marginBottom: 10 },
  mEmpty: {
    fontSize: 12,
    color: MUTED,
    padding: 12,
    borderRadius: 12,
    backgroundColor: CREAM,
    textAlign: 'center',
  },
  mRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  mSizeCell: {
    width: 34,
    fontSize: 13,
    fontWeight: '600',
    color: INK,
    paddingLeft: 4,
  },
  mCell: { flex: 1, minWidth: 0 },
  mHead: { fontSize: 9.5, fontWeight: '600', letterSpacing: 0.3, color: MUTED },
  mUnit: { fontSize: 10, color: MUTED },
  mInput: {
    height: 40,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
    textAlign: 'center',
    fontSize: 13.5,
    fontWeight: '500',
    color: INK,
    paddingVertical: 0,
    outlineStyle: 'none',
  },

  foot: {
    paddingTop: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(250,247,242,0.97)',
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 4,
    marginBottom: 8,
  },
  progressText: { fontSize: 11.5, color: MUTED },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#EDE5DA',
    marginHorizontal: 4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: MOSS },

  dialogText: {
    fontSize: 13.5,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 12,
  },
  lost: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 16,
  },
  lostItem: {
    fontSize: 11.5,
    fontWeight: '500',
    color: INK,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
  },
});
