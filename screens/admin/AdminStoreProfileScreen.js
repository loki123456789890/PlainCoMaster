// Store profile, from the approved store-tools preview: a live preview of
// the store's header as shoppers see it, a logo card, an "About your store"
// box with a character ring, the store's locked details, and a save button
// pinned to the bottom. Each edited card is tagged "Changed", and leaving
// with unsaved edits asks first.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { useAdmin } from '../../context/AdminContext';
import { useStores } from '../../context/StoreContext';
import { useProducts } from '../../context/ProductContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { showAppAlert } from '../../utils/appAlert';
import { pickAndUploadImage, uploadErrorMessage } from '../../utils/imageUpload';
import { Colors } from '../../constants/theme';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import StoreLogo from '../../components/shop/StoreLogo';
import Reveal from '../../components/shop/Reveal';
import { TopBar, OfflineNotice, BigEmpty, UndoToast, useAutoClear } from '../../components/shop/TabScreen';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const GOLD = '#8C6D0C';
const ERR = '#B42318';
const LINE = Colors.light.border;
const CARD_LINE = '#EEE7DD';

// Matches the cap in firestore.rules.
const DESCRIPTION_MAX = 300;
const DESCRIPTION_WARN = 260;
const COUNT_R = 8;
const COUNT_C = 2 * Math.PI * COUNT_R;

function ChangedTag({ on }) {
  if (!on) return null;
  return <Text style={styles.changed}>Changed</Text>;
}

/**
 * What shoppers see about this store: its logo and a short description,
 * shown on the store page, in "Shop by store", and in order chat. The
 * name is not editable here — renaming a store rewrites what every past
 * order and review says it was, so it stays with the Platform Admin.
 */
export default function AdminStoreProfileScreen({ navigation }) {
  const { storeId } = useAdmin();
  const { getStore } = useStores();
  const { storeProducts } = useProducts();
  const store = getStore(storeId);
  const { isConnected } = useNetworkStatus();
  const insets = useSafeAreaInsets();

  const [logoUrl, setLogoUrl] = useState(null);
  const [description, setDescription] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [leaveAction, setLeaveAction] = useState(null);
  const [toast, setToast] = useState('');
  useAutoClear(toast, () => setToast(''), 3200);

  // Seeded once from the live store, then the form owns the values —
  // a snapshot arriving mid-edit must not overwrite what is being typed.
  useEffect(() => {
    if (loaded || !store) return;
    setLogoUrl(store.logoUrl || null);
    setDescription(store.description || '');
    setLoaded(true);
  }, [store, loaded]);

  // Compared against the live store, so once a save lands and the snapshot
  // catches up, both go back to false on their own.
  const logoChanged = loaded && (logoUrl || null) !== (store?.logoUrl || null);
  const aboutChanged = loaded && description.trim() !== (store?.description || '');
  const dirty = logoChanged || aboutChanged;

  // Every way off this screen — the back arrow, Android's back button, the
  // iOS swipe — asks before dropping unsaved edits.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leaving = useRef(false);
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

  const pickLogo = async (source) => {
    if (uploading || !isConnected) return;
    Haptics.selectionAsync();
    setUploading(true);
    const result = await pickAndUploadImage({ source, folder: `stores/${storeId}` });
    setUploading(false);
    if (result.cancelled) return;
    if (!result.success) {
      showAppAlert('Logo not uploaded', uploadErrorMessage(result.error));
      return;
    }
    setLogoUrl(result.url);
    setToast('New logo selected. Save to publish it.');
  };

  const handleSave = async () => {
    if (!dirty || saving) return;
    const trimmed = description.trim();
    setSaving(true);
    try {
      // Exactly the two fields the manager branch of the rule allows.
      await updateDoc(doc(db, 'stores', storeId), {
        logoUrl: logoUrl || deleteField(),
        description: trimmed || deleteField(),
      });
      setDescription(trimmed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToast('Store profile updated. Shoppers see it now.');
    } catch (error) {
      console.error('Could not save store profile:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert(
        'Not saved',
        error?.code === 'permission-denied'
          ? 'Your account can’t edit this store. Check with a Platform Admin that you still manage it.'
          : 'Please check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const topBar = <TopBar title="Store profile" onBack={() => navigation.goBack()} stuck={stuck} />;

  if (!storeId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {topBar}
        <BigEmpty
          icon="storefront-outline"
          title="No store assigned"
          text="A Platform Admin needs to assign you a store before you can edit its profile."
        />
      </SafeAreaView>
    );
  }

  if (!loaded) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {topBar}
        <View style={styles.center}>
          <ActivityIndicator color={CLAY} />
        </View>
      </SafeAreaView>
    );
  }

  const count = description.length;
  const countColor = count >= DESCRIPTION_MAX ? ERR : count >= DESCRIPTION_WARN ? GOLD : MOSS;
  const since = store?.createdAt
    ? ` · On PlainCo since ${store.createdAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
    : '';
  const saveLabel = !isConnected ? 'Offline' : dirty ? 'Save store profile' : 'No changes to save';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {topBar}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScroll={(e) => setStuck(e.nativeEvent.contentOffset.y > 4)}
          scrollEventThrottle={32}
        >
          {!isConnected ? (
            <OfflineNotice>No internet connection. You can edit, but saving needs a connection.</OfflineNotice>
          ) : null}

          {/* The store page's header, drawn with the values being edited. */}
          <Reveal delay={20} style={styles.preview}>
            <Text style={styles.previewLabel}>Live preview</Text>
            <View style={styles.band}>
              <View style={[styles.ringDeco, { width: 160, height: 160, right: -50, top: -60 }]} />
              <View style={[styles.ringDeco, { width: 90, height: 90, left: -30, top: 30 }]} />
            </View>
            <View style={styles.previewBody}>
              <View style={styles.previewLogo}>
                <StoreLogo uri={logoUrl} size={54} radius={14} />
              </View>
              <Text style={styles.previewName} numberOfLines={1}>
                {store?.name}
              </Text>
              <Text style={styles.previewMeta}>
                {storeProducts.length} item{storeProducts.length === 1 ? '' : 's'}
                {since}
              </Text>
              <Text style={[styles.previewAbout, !description.trim() && { color: '#B3AAA0' }]} numberOfLines={3}>
                {description.trim() || 'Tell shoppers about your store…'}
              </Text>
            </View>
          </Reveal>

          <Reveal delay={80} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Logo</Text>
              <ChangedTag on={logoChanged} />
            </View>
            <View style={styles.logoRow}>
              <View>
                <StoreLogo uri={logoUrl} size={64} radius={18} />
                {uploading ? (
                  <View style={styles.logoBusy}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable
                    onPress={() => pickLogo('library')}
                    disabled={uploading || !isConnected}
                    style={({ pressed }) => [styles.logoBtn, { flex: 1 }, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      logoUrl ? 'Change store logo from your photos' : 'Add a store logo from your photos'
                    }
                  >
                    <Ionicons name="image-outline" size={15} color={INK} />
                    <Text style={styles.logoBtnText}>{logoUrl ? 'Change' : 'Add logo'}</Text>
                  </Pressable>
                  {Platform.OS !== 'web' ? (
                    <Pressable
                      onPress={() => pickLogo('camera')}
                      disabled={uploading || !isConnected}
                      style={({ pressed }) => [styles.logoBtn, { width: 44 }, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Take a photo for the logo"
                    >
                      <Ionicons name="camera-outline" size={16} color={INK} />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.hint}>
                  Square image works best. Shown on your store page, in Shop by store, and in order chats.
                </Text>
                {logoUrl ? (
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync();
                      setLogoUrl(null);
                    }}
                    hitSlop={8}
                    style={{ alignSelf: 'flex-start' }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.remove}>Remove logo</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </Reveal>

          <Reveal delay={140} style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>About your store</Text>
              <ChangedTag on={aboutChanged} />
            </View>
            <View>
              <TextInput
                value={description}
                onChangeText={setDescription}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="e.g. Preloved jackets and denim, hand-picked and washed before listing."
                placeholderTextColor={MUTED}
                multiline
                maxLength={DESCRIPTION_MAX}
                style={[styles.textarea, focused && styles.textareaFocused]}
                accessibilityLabel="Store description"
                accessibilityHint={`${count} of ${DESCRIPTION_MAX} characters`}
              />
              <View style={styles.counter} pointerEvents="none">
                <Svg width={20} height={20} viewBox="0 0 20 20">
                  <Circle cx={10} cy={10} r={COUNT_R} fill="none" stroke="#E9E1D6" strokeWidth={2.5} />
                  <Circle
                    cx={10}
                    cy={10}
                    r={COUNT_R}
                    fill="none"
                    stroke={countColor}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeDasharray={COUNT_C}
                    strokeDashoffset={COUNT_C * (1 - count / DESCRIPTION_MAX)}
                    transform="rotate(-90 10 10)"
                  />
                </Svg>
                <Text style={[styles.counterText, count >= DESCRIPTION_WARN && { color: countColor }]}>
                  {count}/{DESCRIPTION_MAX}
                </Text>
              </View>
            </View>
            <View style={styles.tip}>
              <Ionicons name="information-circle-outline" size={14} color={MUTED} style={{ marginTop: 2 }} />
              <Text style={styles.tipText}>
                The first two lines show in Shop by store. Lead with what makes your store different.
              </Text>
            </View>
          </Reveal>

          <Reveal delay={200} style={styles.card}>
            <Text style={[styles.cardTitle, { marginBottom: 12 }]}>Store details</Text>
            <View style={styles.readonly} accessible accessibilityLabel={`Store name, ${store?.name}, locked`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.roLabel}>Store name</Text>
                <Text style={styles.roValue}>{store?.name}</Text>
              </View>
              <Ionicons name="lock-closed-outline" size={16} color={MUTED} />
            </View>
            <View style={styles.tip}>
              <Ionicons name="shield-outline" size={14} color={MUTED} style={{ marginTop: 2 }} />
              <Text style={styles.tipText}>Only a Platform Admin can rename your store.</Text>
            </View>
          </Reveal>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          <Button
            variant="primary"
            label={saveLabel}
            onPress={handleSave}
            loading={saving}
            disabled={!dirty || saving || uploading || !isConnected}
          />
        </View>
      </KeyboardAvoidingView>

      <UndoToast text={toast} lift={20} />

      <ConfirmDialog
        visible={Boolean(leaveAction)}
        onClose={() => setLeaveAction(null)}
        title="Discard your changes?"
        icon="warning-outline"
        iconTone="warning"
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        confirmVariant="danger"
        onConfirm={() => {
          const action = leaveAction;
          leaving.current = true;
          setLeaveAction(null);
          navigation.dispatch(action);
        }}
      >
        <Text style={styles.dialogText}>
          Your {[logoChanged && 'new logo', aboutChanged && 'store description'].filter(Boolean).join(' and ')}{' '}
          {logoChanged && aboutChanged ? "aren't" : "isn't"} saved. Shoppers will keep seeing the current profile.
        </Text>
      </ConfirmDialog>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 24 },

  preview: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginBottom: 14,
  },
  previewLabel: {
    position: 'absolute',
    top: 10,
    right: 12,
    zIndex: 2,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  band: { height: 92, backgroundColor: MOSS, overflow: 'hidden' },
  ringDeco: { position: 'absolute', borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)' },
  previewBody: { paddingHorizontal: 14, paddingBottom: 14 },
  previewLogo: {
    alignSelf: 'flex-start',
    marginTop: -32,
    borderRadius: 18,
    borderWidth: 4,
    borderColor: '#fff',
    backgroundColor: '#fff',
    shadowColor: INK,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  previewName: { fontSize: 17, fontWeight: '600', color: INK, marginTop: 6 },
  previewMeta: { fontSize: 11.5, color: MUTED, marginTop: 2 },
  previewAbout: { fontSize: 12.5, lineHeight: 19, color: '#453E38', marginTop: 8, minHeight: 38 },

  card: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { flex: 1, fontSize: 14.5, fontWeight: '600', color: INK },
  changed: {
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#F6E6DE',
    color: '#A94F2F',
  },

  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logoBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    backgroundColor: 'rgba(28,27,26,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoBtn: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: Colors.light.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  logoBtnText: { fontSize: 12.5, fontWeight: '600', color: INK },
  pressed: { transform: [{ scale: 0.97 }] },
  hint: { fontSize: 11, lineHeight: 15.5, color: MUTED },
  remove: { fontSize: 12, fontWeight: '600', color: ERR },

  textarea: {
    height: 150,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: Colors.light.background,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 30,
    fontSize: 14,
    lineHeight: 21,
    color: INK,
    textAlignVertical: 'top',
    outlineStyle: 'none',
  },
  textareaFocused: { borderColor: CLAY, backgroundColor: '#fff' },
  counter: { position: 'absolute', right: 10, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  counterText: { fontSize: 11, color: MUTED },
  tip: { flexDirection: 'row', gap: 8, marginTop: 10 },
  tipText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: MUTED },

  readonly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#F3EEE6',
  },
  roLabel: { fontSize: 11, color: MUTED },
  roValue: { fontSize: 13.5, fontWeight: '600', color: INK },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  dialogText: { fontSize: 14, lineHeight: 20, color: MUTED, textAlign: 'center' },
});
