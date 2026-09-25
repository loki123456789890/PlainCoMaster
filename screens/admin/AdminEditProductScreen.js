// Edit a product, from the approved edit-product preview: an ink "shopper
// view" of the listing (old price crossed out while it's being changed),
// section cards that mark every edited field with a dot, its saved value
// and an Undo, a "Remove from the shop" area (mark sold out, or delete with
// a press-and-hold button), and a footer that counts unsaved changes.
// Leaving with unsaved edits lists them, old → new, before discarding.
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
import Animated, { useReducedMotion, FadeIn } from 'react-native-reanimated';
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
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUART } from '../../constants/motion';
import { pickAndUploadProductImage, uploadErrorMessage } from '../../utils/imageUpload';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Sheet from '../../components/shop/Sheet';
import DeleteProductPanel from '../../components/admin/DeleteProductPanel';
import { TopBar, OfflineNotice, UndoToast, useAutoClear } from '../../components/shop/TabScreen';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const CREAM = Colors.light.background;
const LINE = Colors.light.border;
const CARD_LINE = '#EEE7DD';
const ERR = '#B42318';
const CHANGED_LINE = '#E6B9A5';
const CHANGED_BG = '#FFFBF9';

// Light swatches get a dark tick so it shows.
const LIGHT_SWATCHES = ['White', 'Beige', 'Yellow'];

const TYPE_OPTIONS = [
  { key: 'ukay-ukay', label: 'Ukay-Ukay', color: MOSS, bg: '#F3F5EF' },
  { key: 'ready-to-wear', label: 'Ready-to-Wear', color: CLAY, bg: '#FDF6F2' },
];
const typeLabel = (type) => (type === 'ukay-ukay' ? 'Ukay-Ukay' : 'Ready-to-Wear');

const peso = (value) => `₱${(Number(value) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

// Builds one measurement entry per size already selected on the product,
// filled in from product.measurements where present and blank otherwise.
//
// Backward compatibility: products saved before measurementType existed
// carry `measurements` with the old five keys and no `measurementType`.
// Those are preselected as "tops" — the closest match — which has room for
// four of the five old keys; the legacy `waist` value is never hydrated, so
// it drops on the next save. A product with neither field gets type: null.
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

// Compared by what a save would write, not by the working rows: adding a
// size adds a blank row, and picking a type with nothing typed writes
// nothing, so neither counts as a measurement change on its own.
// Sizes are sorted first so the order they were ticked in doesn't matter.
const savedMeasurements = (measurements, type) => {
  const payload = buildMeasurementsPayload(measurements, type);
  if (!payload) return 'none';
  const sizes = Object.keys(payload.measurements).sort();
  return JSON.stringify([payload.measurementType, sizes.map((size) => [size, payload.measurements[size]])]);
};
const measurementsEqual = (a, aType, b, bType) => savedMeasurements(a, aType) === savedMeasurements(b, bType);

const hasMeasurementValues = (measurements) =>
  Object.values(measurements || {}).some((entry) =>
    Object.values(entry || {}).some((value) => typeof value === 'string' && value.trim() !== '')
  );

// The form as loaded from the product. Used twice: as the working copy,
// and as the snapshot every change is judged (and undone) against.
const formFromProduct = (product) => ({
  name: product.name || '',
  price: product.price != null ? String(product.price) : '',
  type: product.type || 'ready-to-wear',
  stock: product.stock != null ? String(product.stock) : '',
  description: product.description || '',
  // Products are stored with imageUrl (see ProductContext.js).
  imageUrl: product.imageUrl || '',
  // Legacy products predating per-product colors/sizes pre-select nothing
  // rather than guessing, so the manager makes a real choice on next save.
  colors: product.colors || [],
  sizes: product.sizes || [],
  ...hydrateMeasurements(product),
});

// Everything that differs from what's saved, in the order the form shows
// it. Drives the dots, the footer count, the discard list and the toast.
function diffForm(form, original) {
  const changes = [];
  if (form.imageUrl !== original.imageUrl) changes.push({ key: 'imageUrl', label: 'Photo', edited: true });
  if (form.name !== original.name)
    changes.push({ key: 'name', label: 'Name', from: original.name || '—', to: form.name || '—' });
  if (form.type !== original.type)
    changes.push({ key: 'type', label: 'Type', from: typeLabel(original.type), to: typeLabel(form.type) });
  if (form.description !== original.description)
    changes.push({ key: 'description', label: 'Description', edited: true });
  if (form.price !== original.price)
    changes.push({ key: 'price', label: 'Price', from: peso(original.price), to: form.price ? peso(form.price) : '—' });
  if (form.stock !== original.stock)
    changes.push({ key: 'stock', label: 'Stock', from: original.stock || '—', to: form.stock || '—' });
  const setDiff = (key, label) => {
    const added = form[key].filter((x) => !original[key].includes(x));
    const removed = original[key].filter((x) => !form[key].includes(x));
    if (added.length || removed.length) changes.push({ key, label, added, removed });
  };
  setDiff('colors', 'Colors');
  setDiff('sizes', 'Sizes');
  if (!measurementsEqual(form.measurements, form.measurementType, original.measurements, original.measurementType))
    changes.push({ key: 'measurements', label: 'Measurements', edited: true });
  return changes;
}

function Card({ title, edited, children, right }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          {title}
        </Text>
        {right}
        {edited ? (
          <Animated.Text entering={FadeIn.duration(200)} style={styles.editedPill}>
            EDITED
          </Animated.Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

// A field's label. Once the field differs from what's saved: a Clay dot,
// and underneath, what it was and an Undo.
function FieldLabel({ children, changed, was, onUndo, note }) {
  return (
    <View style={styles.labelWrap}>
      <View style={styles.labelRow}>
        {changed ? <View style={styles.changedDot} /> : null}
        <Text style={styles.label}>{children}</Text>
        {note ? <Text style={styles.labelNote}>{note}</Text> : null}
      </View>
      {changed ? (
        <View style={styles.wasRow}>
          <Text style={styles.was} numberOfLines={1}>
            {was}
          </Text>
          <Pressable onPress={onUndo} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Undo ${children}`}>
            <Text style={styles.undo}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FieldError({ children }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

function Field({ value, onChangeText, error, changed, prefix, multiline, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.input,
        multiline && styles.inputMulti,
        changed && styles.inputChanged,
        focused && styles.inputFocused,
        Boolean(error) && styles.inputBad,
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

export default function AdminEditProductScreen({ navigation, route }) {
  const { product } = route.params;
  const { updateProduct, deleteProduct } = useProducts();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  const [formData, setFormData] = useState(() => formFromProduct(product));
  // What's actually saved, so "changed" is judged against the loaded
  // product rather than "is any field non-empty".
  const original = useRef(formFromProduct(product)).current;

  const [measurementsExpanded, setMeasurementsExpanded] = useState(false);
  const [pendingMeasurementType, setPendingMeasurementType] = useState(null);
  const [errors, setErrors] = useState({ name: '', price: '', stock: '', imageUrl: '', colors: '', sizes: '' });
  // Separate from `deleting` — sharing one flag meant deleting flipped the
  // Save button to "Saving..." mid-delete.
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveAction, setLeaveAction] = useState(null);
  const [toast, setToast] = useState('');
  useAutoClear(toast, () => setToast(''), 3200);
  const leaving = useRef(false);

  // The existing photo is a known-good URL, so it shows immediately; only
  // a newly typed link waits for typing to pause.
  const [previewUri, setPreviewUri] = useState(product.imageUrl || '');
  const [imageFailed, setImageFailed] = useState(false);

  // Upload runs alongside the URL field: products that predate Storage
  // carry an external URL, and opening the editor must not imply it's now
  // invalid. Both paths write the same imageUrl string.
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const scrollRef = useRef(null);

  useEffect(() => {
    const trimmed = formData.imageUrl.trim();
    if (!trimmed) {
      setPreviewUri('');
      setImageFailed(false);
      return undefined;
    }
    if (trimmed === previewUri) return undefined;
    setImageFailed(false);
    const timer = setTimeout(() => setPreviewUri(trimmed), 500);
    return () => clearTimeout(timer);
  }, [formData.imageUrl, previewUri]);

  const clearFieldError = (field) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: '' } : prev));
  };

  const setField = (field) => (value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    clearFieldError(field);
  };

  // Puts one field back to what's saved.
  const revert = (key) => {
    Haptics.selectionAsync();
    if (key === 'measurements') {
      setFormData((prev) => ({
        ...prev,
        measurements: original.measurements,
        measurementType: original.measurementType,
      }));
      return;
    }
    if (key === 'sizes') {
      // Sizes carry their measurement rows with them.
      setFormData((prev) => ({
        ...prev,
        sizes: original.sizes,
        measurements: original.measurements,
        measurementType: original.measurementType,
      }));
      return;
    }
    setFormData((prev) => ({ ...prev, [key]: original[key] }));
    clearFieldError(key);
  };

  const undoAll = () => {
    Haptics.selectionAsync();
    setFormData(original);
    setErrors({ name: '', price: '', stock: '', imageUrl: '', colors: '', sizes: '' });
  };

  // Writes the download URL into the same imageUrl field a pasted link
  // goes into. The old photo is deliberately NOT deleted when one replaces
  // it: nothing is saved yet, and a product pointing at a removed file is
  // worse than an orphan in the bucket (see storage.rules).
  const handleUploadImage = async (source) => {
    if (uploading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUploading(true);
    setUploadProgress(0);
    const result = await pickAndUploadProductImage({ source, onProgress: setUploadProgress });
    setUploading(false);
    setUploadProgress(0);
    if (result.cancelled) return;
    if (!result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Upload Failed', uploadErrorMessage(result.error));
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFormData((prev) => ({ ...prev, imageUrl: result.url }));
    clearFieldError('imageUrl');
    setPhotoOpen(false);
  };

  const handleTypeChange = (type) => {
    if (formData.type === type) return;
    Haptics.selectionAsync();
    setFormData((prev) => ({ ...prev, type }));
  };

  const stepStock = (delta) => {
    Haptics.selectionAsync();
    const current = parseInt(formData.stock, 10);
    setField('stock')(String(Math.max(0, (Number.isNaN(current) ? 0 : current) + delta)));
  };

  const markSoldOut = () => {
    Haptics.selectionAsync();
    setField('stock')('0');
    setToast('Stock set to 0. Save to mark it sold out.');
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
  // field set (field keys differ between types, so nothing carries over).
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

  // Numeric-only, but decimals like 17.5" are valid, so one "." gets through.
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
      measurements: { ...prev.measurements, [size]: { ...prev.measurements[size], [fieldKey]: sanitized } },
    }));
  };

  const changes = diffForm(formData, original);
  const changed = (key) => changes.some((c) => c.key === key);
  const isDirty = changes.length > 0;

  // Every way off this screen — back arrow, Android back, iOS swipe — goes
  // through here, so unsaved edits are never dropped without the list.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (leaving.current || !dirtyRef.current) return;
        event.preventDefault();
        Haptics.selectionAsync();
        setLeaveAction(event.data.action);
      }),
    [navigation]
  );

  // Back to the product list with a message for it to show. Opened from
  // somewhere else — the shopper's view of the product, reached from
  // Reviews — it goes back there instead: popTo would otherwise swap this
  // screen for a Products list the manager never came from. After a delete
  // it goes back past that page too, since the product no longer exists.
  const leaveWith = (notice, highlight, { deleted = false } = {}) => {
    leaving.current = true;
    const { routes, index } = navigation.getState();
    const from = routes[index - 1]?.name;
    if (!from || from === 'AdminProducts') {
      navigation.popTo('AdminProducts', { notice, highlight, noticeAt: Date.now() });
    } else if (deleted && from === 'Product' && index >= 2) {
      navigation.pop(2);
    } else {
      navigation.goBack();
    }
  };

  // Validates every field at once and surfaces every error inline.
  const validate = () => {
    const nextErrors = { name: '', price: '', stock: '', imageUrl: '', colors: '', sizes: '' };
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
    const hasErrors = Object.values(nextErrors).some(Boolean);
    if (hasErrors) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (nextErrors.imageUrl) setPhotoOpen(true);
      else scrollRef.current?.scrollTo({ y: 0, animated: !reduceMotion });
    }
    return !hasErrors;
  };

  const handleSubmit = async () => {
    if (!isDirty || !validate()) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const measurementsResult = buildMeasurementsPayload(formData.measurements, formData.measurementType);
    const count = changes.length;

    const result = await updateProduct(product.id, {
      name: formData.name,
      // Real numbers, not the TextInput strings: firestore.rules validates
      // checkout's stock decrement numerically, and saving here migrates a
      // legacy string price/stock too. Both were validated above.
      price: parseFloat(formData.price),
      type: formData.type,
      stock: Number(formData.stock),
      description: formData.description,
      imageUrl: formData.imageUrl,
      colors: formData.colors,
      sizes: formData.sizes,
      // updateDoc (unlike addDoc) needs an explicit deleteField() to remove
      // a field the product had — omitting the key would leave a stale
      // `measurements` map (or `measurementType`) in place.
      measurements: measurementsResult?.measurements || deleteField(),
      measurementType: measurementsResult?.measurementType || deleteField(),
    });

    setSaving(false);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // updateProduct() writes the Store Activity entry.
      leaveWith(`Saved ${count} change${count === 1 ? '' : 's'} · logged in Store Activity`, formData.name.trim());
    } else if (!isConnected) {
      // updateProduct() resolves { success: false, error } without a code,
      // so isConnected is the only reliable offline signal here.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('No Internet Connection', 'Network connection lost. Please check your connection and try again.');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Error', 'Failed to update product: ' + result.error);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const result = await deleteProduct(product.id);
    setDeleting(false);
    if (result.success) {
      setDeleteOpen(false);
      leaveWith(`"${product.name}" deleted. It's logged in Store Activity.`, undefined, { deleted: true });
    } else if (!isConnected) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('No Internet Connection', 'Network connection lost. Please check your connection and try again.');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Error', 'Failed to delete product: ' + result.error);
    }
  };

  const busy = saving || deleting;
  const priceValue = parseFloat(formData.price);
  const stockValue = parseInt(formData.stock, 10);
  const ukay = formData.type === 'ukay-ukay';
  const measurementType = MEASUREMENT_TYPES[formData.measurementType];
  const selectedSizes = SIZE_OPTIONS.filter((size) => formData.sizes.includes(size));
  const savedStock = parseInt(original.stock, 10);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Edit product" onBack={() => navigation.goBack()} />

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
                No internet connection. You can keep editing, but saving needs a connection.
              </OfflineNotice>
            </View>
          ) : null}

          {/* How the listing looks in the shop, as it's edited. */}
          <View style={styles.shopper}>
            <Text style={styles.shopperLabel}>SHOPPER VIEW</Text>
            <View style={styles.shopperImage}>
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
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setPhotoOpen(true);
                }}
                style={({ pressed }) => [styles.photoButton, pressed && { transform: [{ scale: 0.94 }] }]}
                accessibilityRole="button"
                accessibilityLabel="Change photo"
              >
                <Ionicons name="camera-outline" size={15} color={INK} />
              </Pressable>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.tag, { backgroundColor: ukay ? MOSS : CLAY }]}>{ukay ? 'UKAY' : 'RTW'}</Text>
              <Text style={styles.shopperName} numberOfLines={1}>
                {formData.name.trim() || 'Product name'}
              </Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceNow}>{priceValue > 0 ? peso(priceValue) : '₱0.00'}</Text>
                {changed('price') && priceValue > 0 ? (
                  <Text style={styles.priceWas}>{peso(original.price)}</Text>
                ) : null}
              </View>
              <Text style={styles.shopperMeta} numberOfLines={1}>
                <Text style={styles.shopperMetaStrong}>
                  {Number.isNaN(stockValue) ? '—' : stockValue === 0 ? 'Sold out' : `${stockValue} in stock`}
                </Text>
                {' · '}
                {selectedSizes.join(', ') || 'no sizes'}
              </Text>
            </View>
          </View>
          {changed('imageUrl') || errors.imageUrl || imageFailed ? (
            <View style={styles.photoNote}>
              {errors.imageUrl || imageFailed ? (
                <Text style={styles.error}>{errors.imageUrl || "This image couldn't load. Try a different one."}</Text>
              ) : (
                <>
                  <View style={styles.changedDot} />
                  <Text style={styles.was}>New photo, not saved yet</Text>
                  <Pressable
                    onPress={() => revert('imageUrl')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Undo photo"
                  >
                    <Text style={styles.undo}>Undo</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : null}

          <Card title="Details" edited={changed('name') || changed('type') || changed('description')}>
            <FieldLabel changed={changed('name')} was={`was "${original.name}"`} onUndo={() => revert('name')}>
              Name
            </FieldLabel>
            <Field
              value={formData.name}
              onChangeText={setField('name')}
              changed={changed('name')}
              error={errors.name}
              placeholder="e.g. Vintage Denim Jacket"
              accessibilityLabel="Product name"
            />
            <FieldError>{errors.name}</FieldError>

            <View style={styles.types}>
              {TYPE_OPTIONS.map((option) => {
                const on = formData.type === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => handleTypeChange(option.key)}
                    style={[styles.type, on && { borderColor: option.color, backgroundColor: option.bg }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.typeText, on && { color: option.color }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {changed('type') ? (
              <View style={[styles.wasRow, { marginTop: -6, marginBottom: 10 }]}>
                <Text style={styles.was}>was {typeLabel(original.type)}</Text>
                <Pressable
                  onPress={() => revert('type')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Undo type"
                >
                  <Text style={styles.undo}>Undo</Text>
                </Pressable>
              </View>
            ) : null}

            <FieldLabel
              changed={changed('description')}
              was="edited"
              onUndo={() => revert('description')}
              note={changed('description') ? null : 'Optional'}
            >
              Description
            </FieldLabel>
            <Field
              value={formData.description}
              onChangeText={setField('description')}
              changed={changed('description')}
              multiline
              placeholder="Condition, material, fit…"
              accessibilityLabel="Product description"
            />
          </Card>

          <Card title="Price & stock" edited={changed('price') || changed('stock')}>
            <View style={styles.two}>
              <View style={{ flex: 1 }}>
                <FieldLabel
                  changed={changed('price')}
                  was={`was ${peso(original.price)}`}
                  onUndo={() => revert('price')}
                >
                  Price
                </FieldLabel>
                <Field
                  value={formData.price}
                  onChangeText={setField('price')}
                  changed={changed('price')}
                  error={errors.price}
                  prefix="₱"
                  keyboardType="decimal-pad"
                  accessibilityLabel="Price in pesos"
                />
                <FieldError>{errors.price}</FieldError>
              </View>
              <View style={{ flex: 1 }}>
                <FieldLabel
                  changed={changed('stock')}
                  was={`was ${original.stock || '—'}`}
                  onUndo={() => revert('stock')}
                >
                  Stock
                </FieldLabel>
                <View
                  style={[
                    styles.stepper,
                    changed('stock') && styles.inputChanged,
                    Boolean(errors.stock) && styles.inputBad,
                  ]}
                >
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
            {ukay && stockValue > 1 ? (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(250).easing(EASE_OUT_QUART)}
                style={styles.warn}
              >
                <Ionicons name="information-circle-outline" size={16} color="#6B5A2E" />
                <Text style={styles.warnText}>
                  <Text style={{ fontWeight: '700' }}>{stockValue}</Text> in stock for an ukay item? Ukay pieces are
                  usually one of a kind.{' '}
                  <Text style={styles.warnLink} onPress={() => setField('stock')('1')} accessibilityRole="button">
                    Set to 1
                  </Text>
                </Text>
              </Animated.View>
            ) : null}
          </Card>

          <Card title="Variants" edited={changed('colors') || changed('sizes')}>
            <View style={styles.listHead}>
              <Text style={styles.label}>Colors</Text>
              <Text style={styles.labelNote} numberOfLines={1}>
                {formData.colors.join(', ') || 'None'}
              </Text>
            </View>
            <View style={styles.wrap}>
              {COLOR_PALETTE.map((color) => {
                const on = formData.colors.includes(color.name);
                const isNew = on && !original.colors.includes(color.name);
                const gone = !on && original.colors.includes(color.name);
                return (
                  <Pressable
                    key={color.name}
                    onPress={() => toggleColor(color.name)}
                    style={[styles.colorPill, on && styles.colorPillOn, gone && styles.pillGone]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${color.name}${isNew ? ', added' : gone ? ', removed' : ''}`}
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
                    {isNew ? <View style={styles.newDot} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <FieldError>{errors.colors}</FieldError>

            <View style={[styles.listHead, { marginTop: 14 }]}>
              <Text style={styles.label}>Sizes</Text>
              <Text style={styles.labelNote}>{formData.sizes.length} selected</Text>
            </View>
            <View style={styles.wrap}>
              {SIZE_OPTIONS.map((size) => {
                const on = formData.sizes.includes(size);
                const isNew = on && !original.sizes.includes(size);
                const gone = !on && original.sizes.includes(size);
                return (
                  <Pressable
                    key={size}
                    onPress={() => toggleSize(size)}
                    style={[styles.size, on && styles.sizeOn, gone && styles.pillGone]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Size ${size}${isNew ? ', added' : gone ? ', removed' : ''}`}
                  >
                    <Text style={[styles.sizeText, on && { color: CREAM }]}>{size}</Text>
                    {isNew ? <View style={styles.newDot} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <FieldError>{errors.sizes}</FieldError>
            {changed('colors') || changed('sizes') ? (
              <Pressable
                onPress={() => {
                  if (changed('colors')) revert('colors');
                  if (changed('sizes')) revert('sizes');
                }}
                hitSlop={8}
                style={{ alignSelf: 'flex-start', marginTop: 10 }}
                accessibilityRole="button"
              >
                <Text style={styles.undo}>Undo variant changes</Text>
              </Pressable>
            ) : null}
          </Card>

          <View style={styles.card}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setMeasurementsExpanded((v) => !v);
              }}
              style={styles.cardHead}
              accessibilityRole="button"
              accessibilityState={{ expanded: measurementsExpanded }}
            >
              <Text style={styles.cardTitle}>Measurements</Text>
              <Text style={styles.labelNote}>
                {measurementType
                  ? `${measurementType.label} · ${measurementType.unit === 'cm' ? 'cm' : 'inches'}`
                  : 'Optional'}
              </Text>
              {changed('measurements') ? <Text style={styles.editedPill}>EDITED</Text> : null}
              <Ionicons
                name={measurementsExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={MUTED}
                style={{ marginLeft: changed('measurements') ? 0 : 'auto' }}
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
                    <Text style={styles.mEmpty}>Select sizes in Variants first.</Text>
                  ) : (
                    <View>
                      <View style={styles.mRow}>
                        <View style={styles.mSizeCell} />
                        {measurementType.fields.map((field) => (
                          <View key={field.key} style={styles.mCell}>
                            <Text style={styles.mHead} numberOfLines={1}>
                              {field.label.toUpperCase()}
                            </Text>
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
                {changed('measurements') ? (
                  <Pressable
                    onPress={() => revert('measurements')}
                    hitSlop={8}
                    style={{ alignSelf: 'flex-start', marginTop: 8 }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.undo}>Undo measurement changes</Text>
                  </Pressable>
                ) : null}
              </Animated.View>
            ) : null}
          </View>

          <View style={styles.danger}>
            <Text style={styles.dangerTitle}>Remove from the shop</Text>
            <Text style={styles.dangerText}>
              Marking it sold out keeps the listing and its reviews. Deleting removes it for good.
            </Text>
            <View style={styles.dangerRow}>
              <Pressable
                onPress={markSoldOut}
                disabled={busy || formData.stock === '0'}
                style={({ pressed }) => [
                  styles.soldOut,
                  formData.stock === '0' && { opacity: 0.5 },
                  pressed && { transform: [{ scale: 0.97 }] },
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.soldOutText}>{formData.stock === '0' ? 'Marked sold out' : 'Mark sold out'}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setDeleteOpen(true);
                }}
                disabled={busy}
                style={({ pressed }) => [styles.deleteButton, pressed && { transform: [{ scale: 0.97 }] }]}
                accessibilityRole="button"
              >
                <Text style={styles.deleteText}>Delete product</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
          <View style={styles.footRow}>
            <Text style={styles.footText}>
              {isDirty ? (
                <>
                  <Text style={styles.footStrong}>
                    {changes.length} change{changes.length === 1 ? '' : 's'}
                  </Text>{' '}
                  not saved yet
                </>
              ) : (
                'No changes yet'
              )}
            </Text>
            <Pressable onPress={undoAll} disabled={!isDirty || busy} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.undo, (!isDirty || busy) && { color: '#C9C0B6' }]}>Undo all</Text>
            </Pressable>
          </View>
          <Button
            label={!isConnected ? 'No internet connection' : 'Save changes'}
            fontSize={15.5}
            onPress={handleSubmit}
            loading={saving}
            disabled={!isDirty || busy || !isConnected}
            fullWidth
          />
        </View>
      </KeyboardAvoidingView>

      {/* Lifted clear of the footer. */}
      <UndoToast text={toast} lift={48} />

      {/* Change photo: the same two upload paths and link field as Add. */}
      <Sheet visible={photoOpen} onClose={() => setPhotoOpen(false)} locked={uploading}>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Change photo
        </Text>
        <Text style={styles.sheetText}>One photo per product. Shoppers see it first.</Text>
        <View style={styles.photoRow}>
          {[
            { source: 'camera', icon: 'camera-outline', label: 'Take photo' },
            { source: 'library', icon: 'images-outline', label: 'From gallery' },
          ].map((b) => (
            <Pressable
              key={b.source}
              onPress={() => handleUploadImage(b.source)}
              disabled={uploading || !isConnected}
              style={({ pressed }) => [
                styles.uploadButton,
                (uploading || !isConnected) && { opacity: 0.5 },
                pressed && { transform: [{ scale: 0.97 }] },
              ]}
              accessibilityRole="button"
            >
              <Ionicons name={b.icon} size={17} color={CLAY} />
              <Text style={styles.uploadButtonText}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
        {uploading ? (
          <View style={{ gap: 4, marginBottom: 12 }} accessibilityLiveRegion="polite">
            <View style={styles.uploadTrack}>
              <View style={[styles.uploadFill, { width: `${Math.round(uploadProgress * 100)}%` }]} />
            </View>
            <Text style={styles.labelNote}>Uploading… {Math.round(uploadProgress * 100)}%</Text>
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
          changed={changed('imageUrl')}
          error={errors.imageUrl}
          placeholder="https://example.com/image.jpg"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Product image link"
        />
        <FieldError>{errors.imageUrl}</FieldError>
        <View style={{ height: 14 }} />
        <Button label="Done" fontSize={15.5} onPress={() => setPhotoOpen(false)} fullWidth />
      </Sheet>

      {/* Delete: what it affects, the gentler option, then press and hold. */}
      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} locked={deleting}>
        <DeleteProductPanel
          product={{ ...product, imageUrl: original.imageUrl || product.imageUrl }}
          meta={`${typeLabel(original.type)} · ${peso(original.price)}`}
          onSoldOut={
            savedStock !== 0
              ? () => {
                  setDeleteOpen(false);
                  markSoldOut();
                }
              : null
          }
          onDelete={handleDelete}
          onKeep={() => setDeleteOpen(false)}
          deleting={deleting}
        />
      </Sheet>

      {/* Discard: exactly what would be lost, old → new. */}
      <Sheet visible={Boolean(leaveAction)} onClose={() => setLeaveAction(null)}>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          Discard your changes?
        </Text>
        <Text style={styles.sheetText}>These edits aren&apos;t saved yet:</Text>
        <View style={styles.impact}>
          {changes.map((c, i) => (
            <View key={c.key} style={[styles.diffRow, i === changes.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={styles.diffKey}>{c.label}</Text>
              {c.edited ? (
                <Text style={styles.diffTo}>Edited</Text>
              ) : c.added ? (
                <Text style={styles.diffValue}>
                  {c.added.map((x) => (
                    <Text key={`+${x}`} style={styles.diffPlus}>
                      + {x}{' '}
                    </Text>
                  ))}
                  {c.removed.map((x) => (
                    <Text key={`-${x}`} style={styles.diffMinus}>
                      − {x}{' '}
                    </Text>
                  ))}
                </Text>
              ) : (
                <Text style={styles.diffValue} numberOfLines={2}>
                  <Text style={styles.diffFrom}>{c.from}</Text>
                  <Text style={styles.diffArrow}> → </Text>
                  <Text style={styles.diffTo}>{c.to}</Text>
                </Text>
              )}
            </View>
          ))}
        </View>
        <Button label="Keep editing" fontSize={15.5} onPress={() => setLeaveAction(null)} fullWidth />
        <Pressable
          onPress={() => {
            const action = leaveAction;
            leaving.current = true;
            setLeaveAction(null);
            navigation.dispatch(action);
          }}
          style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={[styles.ghostText, { color: ERR }]}>Discard changes</Text>
        </Pressable>
      </Sheet>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },

  shopper: { flexDirection: 'row', gap: 14, padding: 14, borderRadius: 24, backgroundColor: INK, marginBottom: 8 },
  shopperLabel: {
    position: 'absolute',
    right: 14,
    top: 12,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1,
    color: '#8B8178',
  },
  shopperImage: {
    width: 86,
    height: 100,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#3A332E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoButton: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(250,247,242,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 4,
  },
  shopperName: { fontSize: 15, fontWeight: '600', color: CREAM, marginTop: 6, marginBottom: 2, maxWidth: 200 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  priceNow: { fontSize: 17, fontWeight: '600', color: '#F1D98A' },
  priceWas: { fontSize: 12.5, color: '#8B8178', textDecorationLine: 'line-through' },
  shopperMeta: { fontSize: 11.5, color: '#BDB3A9', marginTop: 4 },
  shopperMetaStrong: { color: CREAM, fontWeight: '500' },
  photoNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 4, marginBottom: 10 },

  card: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginTop: 4,
    marginBottom: 8,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: INK },
  editedPill: {
    marginLeft: 'auto',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#A94F2F',
    backgroundColor: '#F6E6DE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },

  labelWrap: { marginBottom: 6, marginLeft: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 12.5, fontWeight: '500', color: INK },
  labelNote: { flexShrink: 1, marginLeft: 'auto', fontSize: 11.5, color: MUTED },
  changedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CLAY },
  wasRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  was: { flexShrink: 1, fontSize: 11.5, color: MUTED },
  undo: { fontSize: 11.5, fontWeight: '600', color: CLAY },
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
    marginBottom: 12,
  },
  inputMulti: { minHeight: 96, alignItems: 'flex-start', paddingVertical: 10, marginBottom: 0 },
  inputChanged: { borderColor: CHANGED_LINE, backgroundColor: CHANGED_BG },
  inputFocused: { borderColor: CLAY, backgroundColor: '#fff' },
  inputBad: { borderColor: ERR, backgroundColor: '#FFF8F7' },
  inputText: { flex: 1, fontSize: 14.5, color: INK, paddingVertical: 10, outlineStyle: 'none' },
  inputTextMulti: { minHeight: 74, paddingVertical: 0, lineHeight: 22 },
  prefix: { fontSize: 14.5, fontWeight: '600', color: MUTED, marginRight: 4 },

  types: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  type: {
    flex: 1,
    height: 44,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeText: { fontSize: 13, fontWeight: '600', color: MUTED },

  two: { flexDirection: 'row', gap: 10 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CREAM,
    marginBottom: 12,
  },
  stepperButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
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
  warn: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F6EFE3',
  },
  warnText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: '#6B5A2E' },
  warnLink: { color: CLAY, fontWeight: '600', textDecorationLine: 'underline' },

  listHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, marginHorizontal: 2 },
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
  pillGone: { borderStyle: 'dashed', borderColor: CHANGED_LINE },
  newDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: CLAY,
    borderWidth: 2,
    borderColor: '#fff',
  },
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
    minWidth: 50,
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
  mEmpty: { fontSize: 12, color: MUTED, padding: 12, borderRadius: 12, backgroundColor: CREAM, textAlign: 'center' },
  mRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  mSizeCell: { width: 34, fontSize: 13, fontWeight: '600', color: INK, paddingLeft: 4 },
  mCell: { flex: 1, minWidth: 0 },
  mHead: { fontSize: 9.5, fontWeight: '600', letterSpacing: 0.3, color: MUTED },
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

  danger: {
    marginTop: 14,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#F1CFCB',
    backgroundColor: '#FFF8F7',
  },
  dangerTitle: { fontSize: 14, fontWeight: '600', color: ERR },
  dangerText: { fontSize: 12, lineHeight: 18, color: MUTED, marginTop: 4, marginBottom: 12 },
  dangerRow: { flexDirection: 'row', gap: 8 },
  soldOut: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldOutText: { fontSize: 12.5, fontWeight: '600', color: INK },
  deleteButton: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FBEDEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { fontSize: 12.5, fontWeight: '600', color: ERR },

  foot: {
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(250,247,242,0.97)',
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  footRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 4,
    marginBottom: 8,
    minHeight: 22,
  },
  footText: { fontSize: 12, color: MUTED },
  footStrong: { fontWeight: '600', color: INK },

  sheetTitle: { fontSize: 19, fontWeight: '600', color: INK, marginTop: 2 },
  sheetText: { fontSize: 13, lineHeight: 20, color: MUTED, marginTop: 4, marginBottom: 12 },
  photoRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  uploadButton: {
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
  uploadButtonText: { fontSize: 12.5, fontWeight: '600', color: CLAY },
  uploadTrack: { height: 4, borderRadius: 2, backgroundColor: '#EDE5DA', overflow: 'hidden' },
  uploadFill: { height: '100%', backgroundColor: CLAY },
  or: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2, marginBottom: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: LINE },
  orText: { fontSize: 11, color: MUTED },

  impact: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 12,
  },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ghostText: { fontSize: 15.5, fontWeight: '600', color: MUTED },

  diffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1EBE3',
  },
  diffKey: { width: 92, fontSize: 12.5, color: MUTED },
  diffValue: { flex: 1, fontSize: 12.5 },
  diffFrom: { color: '#A89F97', textDecorationLine: 'line-through' },
  diffArrow: { color: CLAY, fontWeight: '600' },
  diffTo: { flex: 1, fontSize: 12.5, fontWeight: '600', color: INK },
  diffPlus: { color: MOSS, fontWeight: '600' },
  diffMinus: { color: ERR, fontWeight: '600' },

  dialogText: { fontSize: 13.5, lineHeight: 20, color: MUTED, textAlign: 'center', marginBottom: 12 },
});
