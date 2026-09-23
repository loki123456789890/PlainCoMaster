import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { useAdmin } from '../../context/AdminContext';
import { useStores } from '../../context/StoreContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { showAppAlert } from '../../utils/appAlert';
import { pickAndUploadImage, uploadErrorMessage } from '../../utils/imageUpload';
import { Colors, Spacing } from '../../constants/theme';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';

// Matches the cap in firestore.rules.
const DESCRIPTION_MAX = 300;

/**
 * What shoppers see about this store: its logo and a short description,
 * shown on the store page, in "Shop by store", and in order chat. The
 * name is not editable here — renaming a store rewrites what every past
 * order and review says it was, so it stays with the Platform Admin.
 */
export default function AdminStoreProfileScreen({ navigation }) {
  const { storeId } = useAdmin();
  const { getStore } = useStores();
  const store = getStore(storeId);
  const { isConnected } = useNetworkStatus();

  const [logoUrl, setLogoUrl] = useState(null);
  const [description, setDescription] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seeded once from the live store, then the form owns the values —
  // a snapshot arriving mid-edit must not overwrite what is being typed.
  useEffect(() => {
    if (loaded || !store) return;
    setLogoUrl(store.logoUrl || null);
    setDescription(store.description || '');
    setLoaded(true);
  }, [store, loaded]);

  const dirty =
    loaded && ((logoUrl || null) !== (store?.logoUrl || null) || description.trim() !== (store?.description || ''));

  const pickLogo = async (source) => {
    setUploading(true);
    const result = await pickAndUploadImage({ source, folder: `stores/${storeId}` });
    setUploading(false);
    if (result.cancelled) return;
    if (!result.success) {
      showAppAlert('Logo not uploaded', uploadErrorMessage(result.error));
      return;
    }
    setLogoUrl(result.url);
  };

  const handleLogoPress = () => {
    if (uploading || !isConnected) return;
    Haptics.selectionAsync();
    const options =
      Platform.OS === 'web'
        ? [{ text: 'Choose an Image', onPress: () => pickLogo('library') }]
        : [
            { text: 'Take Photo', onPress: () => pickLogo('camera') },
            { text: 'Choose from Library', onPress: () => pickLogo('library') },
          ];
    if (logoUrl) options.push({ text: 'Remove Logo', style: 'destructive', onPress: () => setLogoUrl(null) });
    options.push({ text: 'Cancel', style: 'cancel' });
    showAppAlert('Store logo', 'A square image works best.', options);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert('Store profile saved', 'Shoppers see the update right away.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
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

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.backButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Store Profile</Text>
      <View style={styles.backButton} />
    </View>
  );

  if (!storeId) {
    return (
      <SafeAreaView style={styles.container}>
        {header}
        <View style={styles.center}>
          <EmptyState
            icon="storefront-outline"
            title="No store assigned"
            subtitle="A Platform Admin needs to assign you a store before you can edit its profile."
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!loaded) {
    return (
      <SafeAreaView style={styles.container}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={Colors.light.tint} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* What the store page header will look like with these values. */}
          <Text style={styles.sectionTitle}>How shoppers see your store</Text>
          <Card variant="flat" style={styles.preview}>
            <Avatar uri={logoUrl} size={56} icon="storefront-outline" />
            <View style={styles.previewText}>
              <Text style={styles.previewName} numberOfLines={1}>{store?.name}</Text>
              <Text style={[styles.previewDescription, !description.trim() && styles.previewEmpty]} numberOfLines={3}>
                {description.trim() || 'No description yet'}
              </Text>
            </View>
          </Card>

          <Text style={styles.sectionTitle}>Logo</Text>
          <Card variant="flat" style={styles.logoCard}>
            <TouchableOpacity
              onPress={handleLogoPress}
              disabled={uploading || !isConnected}
              style={styles.logoButton}
              accessibilityRole="button"
              accessibilityLabel={logoUrl ? 'Change store logo' : 'Add a store logo'}
            >
              <Avatar uri={logoUrl} size={72} icon="storefront-outline" />
              {uploading ? (
                <View style={styles.logoBusy}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </TouchableOpacity>
            <View style={styles.logoText}>
              <Text style={styles.logoTitle}>{logoUrl ? 'Change logo' : 'Add a logo'}</Text>
              <Text style={styles.logoHint}>Shown on your store page, in Shop by store, and in order chats.</Text>
            </View>
          </Card>

          <Text style={styles.sectionTitle}>About your store</Text>
          <Input
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Preloved jackets and denim, hand-picked and washed before listing."
            multiline
            maxLength={DESCRIPTION_MAX}
            style={styles.descriptionInput}
            accessibilityLabel="Store description"
          />
          <Text style={styles.counter}>{description.length}/{DESCRIPTION_MAX}</Text>

          <Text style={styles.nameNote}>
            To rename {store?.name || 'your store'}, ask a Platform Admin.
          </Text>

          <View style={styles.saveWrap}>
            <Button
              variant="primary"
              label={!isConnected ? 'Offline' : 'Save Store Profile'}
              onPress={handleSave}
              loading={saving}
              disabled={!dirty || saving || uploading || !isConnected}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  content: { padding: 20, paddingBottom: 48 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.light.text, marginBottom: 12 },

  preview: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: Spacing.lg },
  previewText: { flex: 1 },
  previewName: { fontSize: 16, fontWeight: '700', color: Colors.light.text },
  previewDescription: { fontSize: 13, color: Colors.light.icon, marginTop: 2, lineHeight: 18 },
  previewEmpty: { fontStyle: 'italic' },

  logoCard: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: Spacing.lg },
  logoButton: { width: 72, height: 72 },
  logoBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36,
    backgroundColor: 'rgba(28,27,26,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: { flex: 1 },
  logoTitle: { fontSize: 15, fontWeight: '600', color: Colors.light.tint },
  logoHint: { fontSize: 12, color: Colors.light.icon, marginTop: 2, lineHeight: 17 },

  descriptionInput: { minHeight: 96, textAlignVertical: 'top' },
  counter: { alignSelf: 'flex-end', fontSize: 12, color: Colors.light.icon, marginTop: 4 },
  nameNote: { fontSize: 12, color: Colors.light.icon, marginTop: Spacing.md },
  saveWrap: { marginTop: Spacing.lg },
});
