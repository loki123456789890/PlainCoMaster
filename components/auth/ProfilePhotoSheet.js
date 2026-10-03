// components/auth/ProfilePhotoSheet.js
//
// The profile photo sheet from the approved preview, in place of the old
// "Take Photo / Choose from Library / Cancel" alert. Three panels:
//
//   - menu: the current photo (or initial) on a slowly turning dashed ring,
//     two tiles — take a photo, choose one — and "Remove current photo"
//     once there is one to remove
//   - preview: the cropped photo as it will appear, and at the two smaller
//     sizes it's shown at elsewhere; "Use this photo" uploads it with a
//     ring that fills as it goes, and a failure says the current photo
//     hasn't changed
//   - denied: camera (or photos) permission is off, with where to turn it
//     on and, for the camera, the gallery as a way round it
//
// The photo is only uploaded once it's confirmed, so backing out of the
// preview costs no data. The sheet can't be dismissed mid-upload.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Linking } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  ZoomIn,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Rect } from 'react-native-svg';

import Sheet from '../shop/Sheet';
import Reveal from '../shop/Reveal';
import Button from '../ui/Button';
import { Colors } from '../../constants/theme';
import { EASE_OUT_QUINT } from '../../constants/motion';
import { pickImage, uploadImage, uploadErrorMessage } from '../../utils/imageUpload';

const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const LINE = Colors.light.border;
const RUST = Colors.light.danger;

// The preview photo and the ring drawn just outside it.
const PV = 168;
const PV_RADIUS = 54;
const RING = PV + 18;
const RING_RADIUS = PV_RADIUS + 6;
const RING_STROKE = 4;
// The rounded square's outline, for the dash that fills as it uploads.
const RING_SIDE = RING - RING_STROKE;
const RING_LENGTH = 4 * RING_SIDE - (8 - 2 * Math.PI) * RING_RADIUS;

// The big avatar on the menu, with its turning dashed ring.
function Stage({ photoUrl, initials }) {
  const reduceMotion = useReducedMotion();
  const spin = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    spin.value = withRepeat(withTiming(360, { duration: 26000, easing: Easing.linear }), -1, false);
  }, [reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  const turning = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));

  return (
    <View style={styles.stage}>
      <View style={styles.stageHalo} />
      <Animated.View style={[StyleSheet.absoluteFill, turning]}>
        <Svg width={132} height={132}>
          <Circle cx={66} cy={66} r={65} stroke="rgba(196,98,62,0.4)" strokeWidth={1.5} strokeDasharray="5 5" fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View entering={reduceMotion ? undefined : ZoomIn.duration(550).easing(EASE_OUT_QUINT)}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.big} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.big, styles.bigInitials]}>
            {initials ? <Text style={styles.bigText}>{initials}</Text> : <Ionicons name="person" size={40} color="#fff" />}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

function Tile({ icon, title, hint, primary, onPress, delay, wide }) {
  return (
    <Reveal delay={delay} style={wide ? { flex: 1 } : styles.tileWrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={hint}
      >
        <View style={[styles.tileIcon, primary ? { backgroundColor: CLAY } : { backgroundColor: '#EEF0EA' }]}>
          <Ionicons name={icon} size={22} color={primary ? '#fff' : MOSS} />
        </View>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileHint}>{hint}</Text>
      </Pressable>
    </Reveal>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {() => void} props.onClose
 * @param {string|null} props.photoUrl  the current photo, if any
 * @param {string} props.initials       shown when there's no photo
 * @param {string} props.folder         where in Storage the photo goes
 * @param {boolean} props.isConnected
 * @param {(url: string) => Promise<void>} props.onSave  stores the uploaded
 *   photo; throwing keeps the sheet open on the "couldn't save" state
 * @param {() => void} props.onRemove
 */
export default function ProfilePhotoSheet({ visible, onClose, photoUrl, initials, folder, isConnected, onSave, onRemove }) {
  const [panel, setPanel] = useState('menu'); // 'menu' | 'preview' | 'denied'
  const [picked, setPicked] = useState(null); // { uri, mimeType }
  const [deniedSource, setDeniedSource] = useState('camera');
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const canUseCamera = Platform.OS !== 'web';

  // Every opening starts at the menu.
  useEffect(() => {
    if (visible) {
      setPanel('menu');
      setPicked(null);
      setError('');
      setProgress(0);
    }
  }, [visible]);

  const pick = async (source) => {
    if (picking) return;
    Haptics.selectionAsync();
    setPicking(true);
    const result = await pickImage({ source });
    setPicking(false);
    if (result.cancelled) return;
    if (!result.success) {
      if (result.error === 'permission-denied') {
        setDeniedSource(source);
        setPanel('denied');
      } else {
        setError(uploadErrorMessage(result.error));
      }
      return;
    }
    setPicked({ uri: result.uri, mimeType: result.mimeType });
    setError('');
    setProgress(0);
    setPanel('preview');
  };

  const use = async () => {
    if (!picked || uploading) return;
    if (!isConnected) {
      setError('offline');
      return;
    }
    setError('');
    setUploading(true);
    setProgress(0);
    const result = await uploadImage(picked.uri, { onProgress: setProgress, mimeType: picked.mimeType, folder });
    if (!result.success) {
      setUploading(false);
      setProgress(0);
      setError(
        result.error === 'too-large' || result.error === 'unsupported-format'
          ? uploadErrorMessage(result.error)
          : 'offline'
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setProgress(1);
    try {
      await onSave(result.url);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setUploading(false);
      onClose();
    } catch (e) {
      console.error('Could not save profile photo:', e);
      setUploading(false);
      setProgress(0);
      setError('offline');
    }
  };

  const percent = Math.round(progress * 100);
  const failedTitle = error ? "Couldn't save it" : null;

  return (
    <Sheet visible={visible} onClose={onClose} locked={uploading}>
      {uploading ? null : (
        <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={17} color="#5F564E" />
        </Pressable>
      )}

      {panel === 'menu' ? (
        <View key="menu" style={styles.center}>
          <Stage photoUrl={photoUrl} initials={initials} />
          <Reveal delay={150}>
            <Text style={styles.title} accessibilityRole="header">
              Profile photo
            </Text>
          </Reveal>
          <Reveal delay={200}>
            <Text style={styles.sub}>
              {photoUrl
                ? 'Looking good. Swap it for a new one, or go back to your initial.'
                : 'Add a photo, or keep your initial. You can change it any time.'}
            </Text>
          </Reveal>
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          <View style={styles.tiles}>
            {canUseCamera ? (
              <Tile icon="camera-outline" title="Take a photo" hint="Use your camera" primary onPress={() => pick('camera')} delay={250} />
            ) : null}
            <Tile
              icon="images-outline"
              title="Choose a photo"
              hint="From your gallery"
              primary={!canUseCamera}
              onPress={() => pick('library')}
              delay={300}
              wide={!canUseCamera}
            />
          </View>
          {photoUrl ? (
            <Reveal delay={350} style={{ alignSelf: 'stretch' }}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  onRemove();
                }}
                style={({ pressed }) => [styles.remove, pressed && { backgroundColor: 'rgba(196,70,62,0.08)' }]}
                accessibilityRole="button"
              >
                <Ionicons name="trash-outline" size={16} color={RUST} />
                <Text style={styles.removeText}>Remove current photo</Text>
              </Pressable>
            </Reveal>
          ) : null}
        </View>
      ) : null}

      {panel === 'preview' && picked ? (
        <View key="preview" style={styles.center}>
          <View style={styles.pv}>
            <Animated.View entering={ZoomIn.duration(500).easing(EASE_OUT_QUINT)}>
              <Image source={{ uri: picked.uri }} style={styles.pvImage} contentFit="cover" />
            </Animated.View>
            {uploading ? (
              <>
                <View style={styles.pvShade} accessibilityLiveRegion="polite" accessibilityLabel={`Uploading, ${percent} percent`}>
                  <Text style={styles.pvPercent}>{percent}%</Text>
                </View>
                <Svg width={RING} height={RING} style={styles.ring}>
                  <Rect
                    x={RING_STROKE / 2}
                    y={RING_STROKE / 2}
                    width={RING_SIDE}
                    height={RING_SIDE}
                    rx={RING_RADIUS}
                    stroke={CLAY}
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
                    strokeDashoffset={RING_LENGTH * (1 - progress)}
                    fill="none"
                  />
                </Svg>
              </>
            ) : null}
          </View>
          <Reveal delay={200}>
            <Text style={styles.title}>{uploading ? 'Saving your photo' : failedTitle || 'Looking good'}</Text>
          </Reveal>
          <Reveal delay={250}>
            <Text style={styles.sub}>
              {uploading
                ? 'Keep the app open for a moment.'
                : error
                ? 'Your current photo has not changed.'
                : 'This is how it will appear on your profile.'}
            </Text>
          </Reveal>
          {!uploading && !error ? (
            <Reveal delay={300} style={styles.minis}>
              <Image source={{ uri: picked.uri }} style={styles.mini1} contentFit="cover" />
              <Image source={{ uri: picked.uri }} style={styles.mini2} contentFit="cover" />
              <Text style={styles.minisText}>at smaller sizes</Text>
            </Reveal>
          ) : null}
          {error && !uploading ? (
            <View style={styles.banner} accessibilityLiveRegion="polite">
              <Ionicons name={error === 'offline' ? 'cloud-offline-outline' : 'alert-circle-outline'} size={17} color="#7C2A1A" />
              <Text style={styles.bannerText}>
                {error === 'offline' ? (
                  <>
                    <Text style={{ fontWeight: '600' }}>Network connection lost. </Text>
                    Please check your connection and try again.
                  </>
                ) : (
                  error
                )}
              </Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button
              variant="primary"
              label={uploading ? 'Uploading…' : error === 'offline' ? 'Try again' : 'Use this photo'}
              fontSize={15.5}
              onPress={use}
              disabled={uploading}
            />
            {!uploading ? (
              <Pressable
                onPress={() => {
                  setError('');
                  setPanel('menu');
                }}
                style={styles.ghost}
                accessibilityRole="button"
              >
                <Text style={styles.ghostText}>Choose another</Text>
              </Pressable>
            ) : (
              <View style={styles.ghost} />
            )}
          </View>
        </View>
      ) : null}

      {panel === 'denied' ? (
        <View key="denied" style={styles.center}>
          <Reveal delay={60}>
            <View style={styles.deniedIcon}>
              <Ionicons name={deniedSource === 'camera' ? 'camera-outline' : 'images-outline'} size={34} color={CLAY} />
              <View style={styles.deniedSlash} />
            </View>
          </Reveal>
          <Reveal delay={150}>
            <Text style={styles.title} accessibilityRole="header">
              {deniedSource === 'camera' ? 'Camera access is off' : 'Photo access is off'}
            </Text>
          </Reveal>
          <Reveal delay={200}>
            <Text style={styles.sub}>
              {deniedSource === 'camera'
                ? "PlainCo needs your permission to take a photo. You can turn it on in your phone's settings."
                : "PlainCo needs your permission to open your photos. You can turn it on in your phone's settings."}
            </Text>
          </Reveal>
          <Reveal delay={250} style={styles.steps}>
            <View style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>1</Text>
              </View>
              <Text style={styles.stepText}>
                Open <Text style={styles.stepStrong}>Settings</Text> and find <Text style={styles.stepStrong}>PlainCo</Text>
              </Text>
            </View>
            <View style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>2</Text>
              </View>
              <Text style={styles.stepText}>
                Turn on <Text style={styles.stepStrong}>{deniedSource === 'camera' ? 'Camera' : 'Photos'}</Text>, then come back
              </Text>
            </View>
          </Reveal>
          <View style={styles.actions}>
            <Button variant="primary" label="Open Settings" fontSize={15.5} onPress={() => Linking.openSettings()} />
            {deniedSource === 'camera' ? (
              <Button
                variant="secondary"
                label="Choose from gallery instead"
                fontSize={15}
                onPress={() => pick('library')}
                style={{ marginTop: 10 }}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  close: {
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F0E9DF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center' },

  stage: { width: 132, height: 132, marginTop: 10, marginBottom: 14, alignItems: 'center', justifyContent: 'center' },
  stageHalo: {
    position: 'absolute',
    top: -14,
    left: -14,
    right: -14,
    bottom: -14,
    borderRadius: 80,
    borderWidth: 1.5,
    borderColor: 'rgba(196,98,62,0.1)',
  },
  big: { width: 104, height: 104, borderRadius: 34 },
  bigInitials: { backgroundColor: CLAY, alignItems: 'center', justifyContent: 'center' },
  bigText: { fontSize: 40, fontWeight: '600', color: '#fff' },

  title: { fontSize: 20, fontWeight: '600', letterSpacing: -0.3, color: INK, textAlign: 'center' },
  sub: { fontSize: 13, lineHeight: 19.5, color: MUTED, textAlign: 'center', maxWidth: 290, marginTop: 4, marginBottom: 18 },
  inlineError: { fontSize: 12.5, color: RUST, textAlign: 'center', marginTop: -8, marginBottom: 12 },

  tiles: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  tileWrap: { flex: 1 },
  tile: {
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  tilePressed: { transform: [{ scale: 0.96 }], borderColor: CLAY },
  tileIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  tileTitle: { fontSize: 14.5, fontWeight: '600', color: INK },
  tileHint: { fontSize: 11.5, color: MUTED, marginTop: 1 },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    marginTop: 8,
    borderRadius: 14,
  },
  removeText: { fontSize: 13.5, fontWeight: '600', color: RUST },

  pv: { width: PV, height: PV, marginTop: 16, marginBottom: 14 },
  pvImage: { width: PV, height: PV, borderRadius: PV_RADIUS, backgroundColor: LINE },
  pvShade: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: PV_RADIUS,
    backgroundColor: 'rgba(28,27,26,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pvPercent: { fontSize: 22, fontWeight: '600', color: '#fff' },
  ring: { position: 'absolute', left: -(RING - PV) / 2, top: -(RING - PV) / 2, transform: [{ rotate: '-90deg' }] },
  minis: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 18 },
  mini1: { width: 44, height: 44, borderRadius: 15 },
  mini2: { width: 30, height: 30, borderRadius: 10 },
  minisText: { fontSize: 11.5, color: MUTED },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    alignSelf: 'stretch',
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: '#F7E4DE',
  },
  bannerText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: '#7C2A1A' },
  actions: { alignSelf: 'stretch' },
  ghost: { height: 46, marginTop: 4, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 14.5, fontWeight: '500', color: MUTED },

  deniedIcon: {
    width: 84,
    height: 84,
    borderRadius: 28,
    marginTop: 18,
    marginBottom: 16,
    backgroundColor: '#F6E6DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deniedSlash: { position: 'absolute', width: 46, height: 2.5, borderRadius: 2, backgroundColor: CLAY, transform: [{ rotate: '45deg' }] },
  steps: { alignSelf: 'stretch', gap: 8, marginBottom: 16 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EEE7DD',
    backgroundColor: '#fff',
  },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: INK, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontSize: 11, fontWeight: '600', color: Colors.light.background },
  stepText: { flex: 1, fontSize: 12.5, color: MUTED },
  stepStrong: { fontWeight: '600', color: INK },
});
