// A row of photo tiles for Add and Edit Product: one per shot the listing
// asks for (front, back, label…) or per flaw photo. An empty tile says
// whether it's required; a filled one shows the photo. Tapping either opens
// a sheet to take a photo, pick one, paste a link, or remove it, so every
// slot is filled the same way the single product photo used to be.
//
// The parent owns the URLs. This owns the sheet, the upload in flight, and
// which photos failed to load, which it reports up so the form can refuse
// to save a listing with a broken photo.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/theme';
import { pickAndUploadProductImage, uploadErrorMessage } from '../../utils/imageUpload';
import { showAppAlert } from '../../utils/appAlert';
import ProductImage from '../ui/ProductImage';
import Button from '../ui/Button';
import Sheet from '../shop/Sheet';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const CREAM = Colors.light.background;
const LINE = Colors.light.border;
const ERR = '#B42318';

const COLUMNS = 4;
const GAP = 8;

function Tile({ slot, size, flagMissing, uploading, progress, onPress, onBroken }) {
  const [failed, setFailed] = useState(false);
  const url = slot.url?.trim() || '';

  useEffect(() => setFailed(false), [url]);
  // A tile that goes away (a removed flaw photo) takes its failure with it.
  useEffect(() => () => onBroken(slot.id, false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onBroken(slot.id, Boolean(url) && failed);
  }, [url, failed]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = flagMissing && slot.required && !url;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ width: size }, pressed && { transform: [{ scale: 0.96 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`${slot.label}${url ? (failed ? ", couldn't load" : ', added') : slot.required ? ', required' : ', optional'}`}
      accessibilityHint={url ? 'Replace or remove this photo' : 'Add this photo'}
    >
      <View
        style={[
          styles.tile,
          { width: size, height: size },
          !url && (slot.required ? styles.tileRequired : styles.tileOptional),
          missing && styles.tileMissing,
          failed && styles.tileMissing,
        ]}
      >
        {url ? (
          <ProductImage key={url} uri={url} style={StyleSheet.absoluteFill} onError={() => setFailed(true)} />
        ) : (
          <Ionicons name={slot.icon || 'camera-outline'} size={20} color={missing ? ERR : slot.required ? CLAY : MUTED} />
        )}
        {failed ? (
          <View style={styles.failed}>
            <Ionicons name="alert-circle" size={20} color={ERR} />
          </View>
        ) : null}
        {uploading ? (
          <View style={styles.uploading}>
            <Text style={styles.uploadingText}>{Math.round(progress * 100)}%</Text>
          </View>
        ) : null}
        {slot.changed ? <View style={styles.changedDot} /> : null}
      </View>
      <Text style={[styles.tileLabel, missing && { color: ERR }]} numberOfLines={2}>
        {slot.label}
      </Text>
      {!url ? (
        <Text style={[styles.tileNote, missing && { color: ERR }]}>{slot.required ? 'Required' : 'Suggested'}</Text>
      ) : null}
    </Pressable>
  );
}

export default function PhotoSlots({ slots, onSet, onRemove, onBrokenChange, flagMissing, disabled }) {
  const [width, setWidth] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [link, setLink] = useState('');

  const open = slots.find((slot) => slot.id === openId) || null;
  const size = width ? Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS) : 0;

  const openSlot = (slot) => {
    Haptics.selectionAsync();
    setLink('');
    setOpenId(slot.id);
  };

  // The old photo is never deleted from the bucket here: nothing is saved
  // yet, and a product pointing at a removed file is worse than an orphan
  // (see storage.rules).
  const upload = async (source) => {
    if (!open || uploadingId) return;
    const id = open.id;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUploadingId(id);
    setProgress(0);
    const result = await pickAndUploadProductImage({ source, onProgress: setProgress });
    setUploadingId(null);
    setProgress(0);
    // Backing out of the picker is a decision, not a failure.
    if (result.cancelled) return;
    if (!result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Upload Failed', uploadErrorMessage(result.error));
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSet(id, result.url);
    setOpenId(null);
  };

  const applyLink = () => {
    const trimmed = link.trim();
    if (!open || !trimmed) return;
    Haptics.selectionAsync();
    onSet(open.id, trimmed);
    setOpenId(null);
  };

  const remove = () => {
    if (!open) return;
    Haptics.selectionAsync();
    onRemove(open.id);
    setOpenId(null);
  };

  const uploadingHere = Boolean(open) && uploadingId === open?.id;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {size ? (
        <View style={styles.grid}>
          {slots.map((slot) => (
            <Tile
              key={slot.id}
              slot={slot}
              size={size}
              flagMissing={flagMissing}
              uploading={uploadingId === slot.id}
              progress={progress}
              onPress={() => openSlot(slot)}
              onBroken={onBrokenChange}
            />
          ))}
        </View>
      ) : null}

      <Sheet visible={Boolean(open)} onClose={() => setOpenId(null)} locked={Boolean(uploadingId)}>
        {open ? (
          <>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {open.label}
            </Text>
            {open.hint ? <Text style={styles.sheetText}>{open.hint}</Text> : null}
            <View style={styles.buttons}>
              {[
                { source: 'camera', icon: 'camera-outline', label: open.url ? 'Retake' : 'Take photo' },
                { source: 'library', icon: 'images-outline', label: 'From gallery' },
              ].map((b) => (
                <Pressable
                  key={b.source}
                  onPress={() => upload(b.source)}
                  disabled={Boolean(uploadingId) || disabled}
                  style={({ pressed }) => [
                    styles.uploadButton,
                    (uploadingId || disabled) && { opacity: 0.5 },
                    pressed && { transform: [{ scale: 0.97 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(uploadingId) || disabled }}
                >
                  <Ionicons name={b.icon} size={17} color={CLAY} />
                  <Text style={styles.uploadButtonText}>{b.label}</Text>
                </Pressable>
              ))}
            </View>
            {uploadingHere ? (
              <View style={styles.progress} accessibilityLiveRegion="polite">
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <Text style={styles.progressText}>Uploading… {Math.round(progress * 100)}%</Text>
              </View>
            ) : null}
            <View style={styles.or}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>or paste an image link</Text>
              <View style={styles.orLine} />
            </View>
            <View style={styles.linkRow}>
              <TextInput
                value={link}
                onChangeText={setLink}
                placeholder="https://example.com/image.jpg"
                placeholderTextColor="#A69D93"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onSubmitEditing={applyLink}
                style={styles.linkInput}
                accessibilityLabel={`${open.label} image link`}
              />
              <Pressable
                onPress={applyLink}
                disabled={!link.trim()}
                style={[styles.linkButton, !link.trim() && { opacity: 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel="Use this link"
              >
                <Text style={styles.linkButtonText}>Use</Text>
              </Pressable>
            </View>
            <View style={{ height: 16 }} />
            {open.url ? (
              <Pressable
                onPress={remove}
                disabled={Boolean(uploadingId)}
                style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
              >
                <Text style={styles.ghostText}>Remove photo</Text>
              </Pressable>
            ) : null}
            <Button label="Done" fontSize={15.5} variant="secondary" onPress={() => setOpenId(null)} disabled={Boolean(uploadingId)} fullWidth />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, rowGap: 12 },
  tile: {
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CREAM,
  },
  tileRequired: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D9B3A3', backgroundColor: '#FBF1EC' },
  tileOptional: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: LINE },
  tileMissing: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: ERR, backgroundColor: '#FFF8F7' },
  failed: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,248,247,0.85)' },
  uploading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(28,27,26,0.45)' },
  uploadingText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  changedDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: CLAY,
    borderWidth: 2,
    borderColor: '#fff',
  },
  tileLabel: { fontSize: 11, lineHeight: 14, fontWeight: '500', color: INK, marginTop: 5 },
  tileNote: { fontSize: 10.5, color: MUTED },

  sheetTitle: { fontSize: 19, fontWeight: '600', color: INK, marginTop: 2 },
  sheetText: { fontSize: 13, lineHeight: 20, color: MUTED, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 12 },
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
  progress: { gap: 4, marginBottom: 12 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: '#EDE5DA', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: CLAY },
  progressText: { fontSize: 11.5, color: MUTED },
  or: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2, marginBottom: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: LINE },
  orText: { fontSize: 11, color: MUTED },
  linkRow: { flexDirection: 'row', gap: 8 },
  linkInput: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    fontSize: 14.5,
    color: INK,
    outlineStyle: 'none',
  },
  linkButton: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButtonText: { fontSize: 14, fontWeight: '600', color: CREAM },
  ghost: { height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  ghostText: { fontSize: 14.5, fontWeight: '600', color: ERR },
});
