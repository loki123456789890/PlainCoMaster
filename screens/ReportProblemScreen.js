// screens/ReportProblemScreen.js
//
// Report a problem with a delivered order: what went wrong, which item,
// photos that show it, and — for a Cash on Delivery order — where the
// refund should go. Four store-fault reasons only (constants/returns.js);
// a change of mind is not one.
//
// Sent through requestReturn (functions/returns.js), never written
// directly: the server checks the 7-day window, works out the amount from
// the order, and stores the report where only this customer and the store
// that sold the order can read it. The amount shown here is the same sum,
// for the customer's benefit — the server's is the one that counts.
//
// Same shape as WriteReviewScreen, deliberately: numbered steps, photos
// that upload as they are picked, a footer that says what is still
// missing, and a sheet before leaving with something unsent.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { httpsCallable } from 'firebase/functions';

import { auth, functions } from '../firebaseConfig';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { showAppAlert } from '../utils/appAlert';
import { Colors, Radius, Spacing } from '../constants/theme';
import { EASE_OUT_QUART } from '../constants/motion';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import ProductImage from '../components/ui/ProductImage';
import Sheet from '../components/shop/Sheet';
import { pickAndUploadImage, uploadErrorMessage, CHAT_PICKER_OPTIONS } from '../utils/imageUpload';
import { formatOrderNumber } from '../utils/orderNumber';
import {
  RETURN_REASONS,
  RETURN_PHOTOS_MAX,
  RETURN_NOTE_MAX,
  PAYOUT_METHODS,
  returnImageFolder,
  wasPaidOnline,
} from '../constants/returns';
import { getPaymentLabel } from '../constants/payment';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const LINE = Colors.light.border;
const CLAY = Colors.light.tint;
const GOLD = Colors.light.highlight;
const CARD = '#FFFFFF';
const CLAY_TINT = '#FCF3EE';
const SOFT = '#F4EEE6';

const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

const formatDeadline = (ms) =>
  ms ? new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';

// The one upload refusal a customer can hit here is about the order.
function returnUploadErrorMessage(code) {
  if (code === 'storage/unauthorized') {
    return 'Photos can only be added to a delivered order of your own.';
  }
  return uploadErrorMessage(code);
}

export default function ReportProblemScreen({ navigation, route }) {
  const { order, deadline } = route.params || {};
  const items = useMemo(() => (Array.isArray(order?.items) ? order.items : []), [order]);
  const paidOnline = wasPaidOnline(order);
  const storeName = order?.storeName || 'The store';

  const [reason, setReason] = useState(null);
  // index -> quantity for each line being reported. A one-line order
  // starts with that line chosen: there is nothing else it could be about.
  const [chosen, setChosen] = useState(() => (items.length === 1 ? { 0: Number(items[0].quantity) || 1 } : {}));
  const [photos, setPhotos] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [note, setNote] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('gcash');
  const [accountName, setAccountName] = useState(auth.currentUser?.displayName || '');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(null);
  const [leaveAction, setLeaveAction] = useState(null);

  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef(null);

  const chosenLines = Object.entries(chosen).map(([index, quantity]) => ({ index: Number(index), quantity }));
  const amount = chosenLines.reduce((sum, { index, quantity }) => sum + Number(items[index]?.price || 0) * quantity, 0);
  const uploading = uploadProgress !== null;
  const reasonInfo = RETURN_REASONS.find((r) => r.key === reason);

  const payoutReady =
    paidOnline ||
    (accountName.trim() && accountNumber.trim() && (payoutMethod === 'gcash' || bankName.trim()));
  const missing = !reason
    ? 'Choose what went wrong.'
    : chosenLines.length === 0
      ? 'Choose the item the problem is about.'
      : photos.length === 0
        ? 'Add at least one photo.'
        : !payoutReady
          ? 'Fill in where the refund should go.'
          : null;
  const canSubmit = !missing && !submitting && !uploading && isConnected;

  const isDirty =
    !sent && Boolean(reason || photos.length || note.trim() || accountNumber.trim() || (items.length > 1 && chosenLines.length));

  // Every way off the screen comes through here, so a half-written report
  // is never dropped without asking. Sending sets `leaving` first.
  const leaving = useRef(false);
  const guardRef = useRef(false);
  guardRef.current = isDirty;
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (leaving.current || !guardRef.current) return;
        event.preventDefault();
        Haptics.selectionAsync();
        setLeaveAction(event.data.action);
      }),
    [navigation]
  );

  const leaveNow = (action) => {
    leaving.current = true;
    setLeaveAction(null);
    if (action) navigation.dispatch(action);
    else navigation.goBack();
  };

  const chooseReason = (key) => {
    if (reason === key) return;
    Haptics.selectionAsync();
    setReason(key);
  };

  const toggleLine = (index) => {
    Haptics.selectionAsync();
    setChosen((current) => {
      const next = { ...current };
      if (next[index]) delete next[index];
      else next[index] = Number(items[index]?.quantity) || 1;
      return next;
    });
  };

  const stepQuantity = (index, delta) => {
    const max = Number(items[index]?.quantity) || 1;
    Haptics.selectionAsync();
    setChosen((current) => ({ ...current, [index]: Math.min(max, Math.max(1, (current[index] || 1) + delta)) }));
  };

  const addPhoto = async (source) => {
    const uid = auth.currentUser?.uid;
    if (!uid || photos.length >= RETURN_PHOTOS_MAX) return;
    setUploadProgress(0);
    const result = await pickAndUploadImage({
      source,
      folder: returnImageFolder(uid, order.id),
      pickerOptions: CHAT_PICKER_OPTIONS,
      onProgress: setUploadProgress,
    });
    setUploadProgress(null);
    if (result.cancelled) return;
    if (!result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Photo not added', returnUploadErrorMessage(result.error));
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhotos((list) => [...list, result.url].slice(0, RETURN_PHOTOS_MAX));
  };

  const handleAddPhoto = () => {
    Haptics.selectionAsync();
    if (Platform.OS === 'web') {
      addPhoto('library');
      return;
    }
    setPhotoSheet(true);
  };

  // iOS won't present the picker while the sheet is still sliding away.
  const pickFrom = (source) => {
    Haptics.selectionAsync();
    setPhotoSheet(false);
    setTimeout(() => addPhoto(source), 350);
  };

  const removePhoto = (url) => {
    Haptics.selectionAsync();
    setPhotos((list) => list.filter((u) => u !== url));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return false;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const payload = {
      orderId: order.id,
      reason,
      note: note.trim().slice(0, RETURN_NOTE_MAX),
      lines: chosenLines,
      photoUrls: photos,
    };
    // Omitted rather than sent empty for an order paid online: the server
    // ignores it there, and there is no reason to send an account at all.
    if (!paidOnline) {
      payload.payout = {
        method: payoutMethod,
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        ...(payoutMethod === 'bank' ? { bankName: bankName.trim() } : {}),
      };
    }

    try {
      const result = await httpsCallable(functions, 'requestReturn')(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSent({ refundAmount: result.data?.refundAmount ?? amount });
      setSubmitting(false);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      return true;
    } catch (error) {
      console.error('Could not send problem report:', error?.code, error?.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSubmitting(false);
      // requestReturn's refusals are written for the customer — the window
      // closing, a report already sent, a missing photo — so they are shown
      // as they are. Anything else is a connection or a server problem.
      const spoken = ['functions/failed-precondition', 'functions/invalid-argument', 'functions/already-exists', 'functions/not-found', 'functions/permission-denied'];
      if (!isConnected || error?.code === 'functions/unavailable') {
        showAppAlert('No Internet Connection', 'Your report was not sent. Check your connection and try again.');
      } else if (spoken.includes(error?.code) && error?.message) {
        showAppAlert('Report not sent', error.message);
      } else {
        showAppAlert('Report not sent', 'Something went wrong on our side. Please try again in a moment.');
      }
      return false;
    }
  };

  const sendAndLeave = async () => {
    const action = leaveAction;
    if (await handleSubmit()) leaveNow(action);
  };

  const openStoreChat = () => {
    Haptics.selectionAsync();
    navigation.navigate('OrderChat', {
      customerId: auth.currentUser?.uid,
      orderId: order.id,
      side: 'customer',
      storeId: order.storeId,
      title: storeName,
    });
  };

  if (!order?.id || items.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader onBack={() => navigation.goBack()} title="Report a problem" />
        <View style={styles.centerContainer}>
          <EmptyState
            icon="alert-circle-outline"
            title="Report unavailable"
            subtitle="We couldn't tell which order this is about. Open the order again and tap Report a problem."
          />
          <View style={styles.emptyActionWrap}>
            <Button variant="secondary" label="Back to Orders" onPress={() => navigation.navigate('Orders')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (sent) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader onBack={() => leaveNow()} title="Report sent" subtitle={`Order ${formatOrderNumber(order.id)}`} />
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(260).easing(EASE_OUT_QUART)}>
            <Card variant="flat" style={styles.okCard}>
              <View style={styles.okBadge}>
                <Ionicons name="paper-plane-outline" size={26} color="#fff" />
              </View>
              <Text style={styles.okTitle} accessibilityRole="header">{storeName} has your report</Text>
              <Text style={styles.okBody}>
                {"They'll look at your photos and decide. We'll email you when they do, and you can follow it on the order."}
              </Text>
              <View style={styles.okAmount}>
                <Text style={styles.okAmountLabel}>Refund if approved</Text>
                <Text style={styles.okAmountValue}>{peso(sent.refundAmount)}</Text>
              </View>
            </Card>
          </Animated.View>
          <Pressable
            onPress={openStoreChat}
            style={({ pressed }) => [styles.nextCard, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`Message ${storeName} about this order`}
          >
            <View style={styles.nextIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.light.secondary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.nextTitle}>Anything else to add?</Text>
              <Text style={styles.nextBody}>Message the store from this order.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.light.secondary} />
          </Pressable>
        </ScrollView>
        <View style={styles.footer}>
          <Button variant="primary" fullWidth label="Done" onPress={() => leaveNow()} />
        </View>
      </SafeAreaView>
    );
  }

  const enter = (delay) => (reduceMotion ? undefined : FadeInDown.duration(220).delay(delay).easing(EASE_OUT_QUART));
  const totalSteps = paidOnline ? 3 : 4;

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        onBack={() => navigation.goBack()}
        title="Report a problem"
        subtitle={deadline ? `Order ${formatOrderNumber(order.id)} · until ${formatDeadline(deadline)}` : `Order ${formatOrderNumber(order.id)}`}
      />

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>{"No internet connection — your report can't be sent right now."}</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)}>
            <Text style={styles.intro}>
              {`For a problem that's the store's to fix. ${storeName} sees your report and photos, and nobody else does.`}
            </Text>
          </Animated.View>

          {/* 1 — What went wrong */}
          <Animated.View style={styles.section} entering={enter(40)}>
            <Text style={styles.step}>{`STEP 1 OF ${totalSteps}`}</Text>
            <Text style={styles.sectionTitle}>What went wrong?</Text>
            <View style={styles.reasons} accessibilityRole="radiogroup">
              {RETURN_REASONS.map((option) => {
                const selected = reason === option.key;
                return (
                  <AnimatedPressable
                    key={option.key}
                    onPress={() => chooseReason(option.key)}
                    style={[styles.reason, selected && styles.reasonOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.label}. ${option.hint}`}
                  >
                    <View style={[styles.reasonIcon, selected && { backgroundColor: CLAY }]}>
                      <Ionicons name={option.icon} size={17} color={selected ? '#fff' : MUTED} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.reasonTitle}>{option.label}</Text>
                      <Text style={styles.reasonHint}>{option.hint}</Text>
                    </View>
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                  </AnimatedPressable>
                );
              })}
            </View>
            <Text style={styles.fineprint}>
              Changed your mind? Most pieces here are one of a kind and sold as described, so those can&apos;t be returned.
            </Text>
          </Animated.View>

          {/* 2 — Which item */}
          <Animated.View style={styles.section} entering={enter(80)}>
            <Text style={styles.step}>{`STEP 2 OF ${totalSteps}`}</Text>
            <Text style={styles.sectionTitle}>{items.length === 1 ? 'The item' : 'Which items?'}</Text>
            {items.map((item, index) => {
              const on = Boolean(chosen[index]);
              const ordered = Number(item.quantity) || 1;
              const chips = [item.size, item.color].filter(Boolean);
              return (
                <Card key={`${item.productId}-${index}`} variant="flat" style={[styles.lineCard, on && styles.lineCardOn]}>
                  <Pressable
                    onPress={() => toggleLine(index)}
                    style={styles.lineRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${item.name}${item.size ? `, size ${item.size}` : ''}, ${peso(item.price)}`}
                  >
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                    </View>
                    {item.image ? (
                      <ProductImage uri={item.image} style={styles.lineImage} />
                    ) : (
                      <View style={[styles.lineImage, styles.lineImagePlaceholder]}>
                        <Ionicons name="shirt-outline" size={20} color={MUTED} />
                      </View>
                    )}
                    <View style={styles.flex}>
                      <Text style={styles.lineName} numberOfLines={2}>{item.name}</Text>
                      {chips.length ? <Text style={styles.lineMeta}>{chips.join(' · ')}</Text> : null}
                    </View>
                    <Text style={styles.linePrice}>{peso(item.price)}</Text>
                  </Pressable>
                  {on && ordered > 1 ? (
                    <View style={styles.qtyRow}>
                      <Text style={styles.qtyLabel}>{`How many of the ${ordered}?`}</Text>
                      <Stepper
                        value={chosen[index]}
                        max={ordered}
                        onMinus={() => stepQuantity(index, -1)}
                        onPlus={() => stepQuantity(index, 1)}
                        label={item.name}
                      />
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </Animated.View>

          {/* 3 — Photos and a note */}
          <Animated.View style={styles.section} entering={enter(120)}>
            <Text style={styles.step}>{`STEP 3 OF ${totalSteps}`}</Text>
            <View style={styles.titleRow}>
              <Text style={[styles.sectionTitle, styles.flex]}>Show the store</Text>
              <Text style={styles.optional}>{photos.length}/{RETURN_PHOTOS_MAX}</Text>
            </View>
            <Text style={styles.sectionHelp}>
              {reasonInfo?.photoHint || 'Photos of the item as it arrived. At least one is needed.'}
            </Text>
            <View style={styles.photoRow}>
              {photos.map((url, i) => (
                <View key={url} style={styles.photoSlot}>
                  <ProductImage uri={url} style={styles.photoSlotImage} accessibilityLabel={`Your photo ${i + 1}`} />
                  <Pressable
                    onPress={() => removePhoto(url)}
                    style={styles.photoRemove}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove photo ${i + 1}`}
                  >
                    <Ionicons name="close" size={14} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {photos.length < RETURN_PHOTOS_MAX ? (
                <Pressable
                  onPress={handleAddPhoto}
                  disabled={uploading}
                  style={({ pressed }) => [styles.photoSlot, styles.photoAdd, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Add a photo of the problem"
                  accessibilityState={{ busy: uploading, disabled: uploading }}
                >
                  {uploading ? (
                    <>
                      <ActivityIndicator color={CLAY} />
                      <Text style={styles.photoAddText}>{Math.round(uploadProgress * 100)}%</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="camera-outline" size={22} color={CLAY} />
                      <Text style={styles.photoAddText}>Add</Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </View>

            {/* Hand-rolled for the same reason as WriteReviewScreen's note. */}
            <View style={styles.noteBox}>
              <TextInput
                value={note}
                onChangeText={(value) => setNote(value.slice(0, RETURN_NOTE_MAX))}
                placeholder="Anything the photos don't show (optional)"
                placeholderTextColor={MUTED}
                multiline
                textAlignVertical="top"
                maxLength={RETURN_NOTE_MAX}
                style={styles.noteInput}
                accessibilityLabel="A note for the store, optional"
              />
              <Text
                style={[styles.counter, note.length > RETURN_NOTE_MAX * 0.9 && { color: Colors.light.danger }]}
                accessibilityLabel={`${note.length} of ${RETURN_NOTE_MAX} characters`}
              >
                {note.length}/{RETURN_NOTE_MAX}
              </Text>
            </View>
          </Animated.View>

          {/* 4 — Where the refund goes. Only Cash on Delivery asks: an
              order paid online goes back the way it came. */}
          {paidOnline ? (
            <Animated.View style={styles.section} entering={enter(160)}>
              <Card variant="flat" style={styles.refundTo}>
                <Ionicons name="return-down-back-outline" size={18} color={Colors.light.secondary} />
                <Text style={styles.refundToText}>
                  {`If approved, the refund goes back to your ${getPaymentLabel(order.paymentMethod)} payment.`}
                </Text>
              </Card>
            </Animated.View>
          ) : (
            <Animated.View style={styles.section} entering={enter(160)}>
              <Text style={styles.step}>{`STEP 4 OF ${totalSteps}`}</Text>
              <Text style={styles.sectionTitle}>Where should the refund go?</Text>
              <Text style={styles.sectionHelp}>You paid cash on delivery, so the store sends it to you directly.</Text>
              <View style={styles.segment} accessibilityRole="radiogroup">
                {PAYOUT_METHODS.map((method) => {
                  const on = payoutMethod === method.key;
                  return (
                    <Pressable
                      key={method.key}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setPayoutMethod(method.key);
                      }}
                      style={[styles.segmentOption, on && styles.segmentOptionOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{method.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.payoutFields}>
                {payoutMethod === 'bank' ? (
                  <Input label="Bank" value={bankName} onChangeText={setBankName} placeholder="e.g. BPI, BDO" maxLength={60} />
                ) : null}
                <Input
                  label="Account name"
                  value={accountName}
                  onChangeText={setAccountName}
                  placeholder="Name on the account"
                  maxLength={80}
                  autoCapitalize="words"
                />
                <Input
                  label={payoutMethod === 'gcash' ? 'GCash number' : 'Account number'}
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  placeholder={payoutMethod === 'gcash' ? '09XX XXX XXXX' : 'Account number'}
                  keyboardType="number-pad"
                  maxLength={40}
                />
              </View>
              <View style={styles.privacy}>
                <Ionicons name="lock-closed-outline" size={14} color={MUTED} />
                <Text style={styles.privacyText}>
                  {`Only ${storeName} sees this account, and only to send your refund.`}
                </Text>
              </View>
            </Animated.View>
          )}

          {chosenLines.length ? (
            <View style={styles.total}>
              <Text style={styles.totalLabel}>Refund if approved</Text>
              <Text style={styles.totalValue}>{peso(amount)}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            variant="primary"
            fullWidth
            label="Send report"
            onPress={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
          />
          {!submitting ? (
            <Text style={styles.footerHint}>{uploading ? 'Adding your photo…' : missing || `${storeName} will reply by email and on the order.`}</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <Sheet visible={Boolean(leaveAction)} onClose={() => setLeaveAction(null)} locked={submitting}>
        <Text style={styles.sheetTitle} accessibilityRole="header">Leave without sending?</Text>
        <Text style={styles.sheetBody}>
          {`Your report hasn't been sent. If you leave now, what you've filled in is lost. You can report this order until ${formatDeadline(deadline) || 'the window closes'}.`}
        </Text>
        <View style={styles.sheetButtons}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              leaveNow(leaveAction);
            }}
            disabled={submitting}
            style={({ pressed }) => [styles.sheetBtn, styles.sheetBtnGhost, pressed && { backgroundColor: SOFT }]}
            accessibilityRole="button"
          >
            <Text style={styles.sheetBtnText}>Discard</Text>
          </Pressable>
          {!missing ? (
            <Pressable
              onPress={sendAndLeave}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.sheetBtn,
                styles.sheetBtnPrimary,
                pressed && { opacity: 0.88 },
                !canSubmit && !submitting && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ busy: submitting, disabled: !canSubmit }}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.sheetBtnText, { color: '#fff' }]}>Send & leave</Text>
              )}
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setLeaveAction(null)}
          disabled={submitting}
          style={({ pressed }) => [styles.keepEditing, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={styles.keepEditingText}>Keep going</Text>
        </Pressable>
      </Sheet>

      {/* Camera first: a fresh photo of the piece in hand is the useful one. */}
      <Sheet visible={photoSheet} onClose={() => setPhotoSheet(false)}>
        <Text style={styles.sheetTitle} accessibilityRole="header">Add a photo</Text>
        <Text style={styles.sheetBody}>{`Only ${storeName} will see it.`}</Text>
        <View style={styles.photoTiles}>
          <Pressable
            onPress={() => pickFrom('camera')}
            style={({ pressed }) => [styles.photoTile, styles.photoTileCamera, pressed && styles.photoTilePressed]}
            accessibilityRole="button"
            accessibilityLabel="Camera, take a new photo"
          >
            <View style={[styles.photoTileIcon, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
              <Ionicons name="camera-outline" size={22} color="#fff" />
            </View>
            <View>
              <Text style={[styles.photoTileTitle, { color: '#fff' }]}>Camera</Text>
              <Text style={[styles.photoTileText, { color: 'rgba(255,255,255,0.8)' }]}>Take a new photo</Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => pickFrom('library')}
            style={({ pressed }) => [styles.photoTile, pressed && styles.photoTilePressed]}
            accessibilityRole="button"
            accessibilityLabel="Library, choose from your photos"
          >
            <View style={styles.photoTileIcon}>
              <Ionicons name="images-outline" size={22} color="#A94F2F" />
            </View>
            <View>
              <Text style={styles.photoTileTitle}>Library</Text>
              <Text style={styles.photoTileText}>Choose from your photos</Text>
            </View>
          </Pressable>
        </View>
        <Pressable
          onPress={() => setPhotoSheet(false)}
          style={({ pressed }) => [styles.keepEditing, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={styles.keepEditingText}>Cancel</Text>
        </Pressable>
      </Sheet>
    </SafeAreaView>
  );
}

function ScreenHeader({ onBack, title, subtitle }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        style={styles.backButton}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={INK} />
      </TouchableOpacity>
      <View style={styles.flex}>
        <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function Stepper({ value, max, onMinus, onPlus, label }) {
  return (
    <View style={styles.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={`${value} of ${max} ${label}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => (event.nativeEvent.actionName === 'increment' ? onPlus() : onMinus())}
    >
      <Pressable onPress={onMinus} disabled={value <= 1} style={[styles.stepBtn, value <= 1 && styles.stepBtnOff]} hitSlop={6}>
        <Ionicons name="remove" size={16} color={INK} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable onPress={onPlus} disabled={value >= max} style={[styles.stepBtn, value >= max && styles.stepBtnOff]} hitSlop={6}>
        <Ionicons name="add" size={16} color={INK} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: INK },
  headerSub: { fontSize: 11.5, color: MUTED, marginTop: 1 },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.light.danger + '12',
  },
  offlineBannerText: { flex: 1, fontSize: 12, color: Colors.light.danger },

  content: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 32 },
  intro: { fontSize: 13, color: MUTED, lineHeight: 19 },
  section: { marginTop: 24 },
  step: { fontSize: 10.5, fontWeight: '700', color: CLAY, letterSpacing: 1, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: INK },
  sectionHelp: { fontSize: 12.5, color: MUTED, lineHeight: 18, marginTop: 3 },
  optional: { fontSize: 11, fontWeight: '500', color: MUTED },
  fineprint: { fontSize: 11.5, color: MUTED, lineHeight: 17, marginTop: 10 },

  reasons: { gap: 8, marginTop: 12 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CARD,
  },
  reasonOn: { borderColor: CLAY, backgroundColor: CLAY_TINT },
  reasonIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: SOFT, alignItems: 'center', justifyContent: 'center' },
  reasonTitle: { fontSize: 14, fontWeight: '600', color: INK },
  reasonHint: { fontSize: 12, color: MUTED, lineHeight: 16, marginTop: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#D8CDBF', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: CLAY },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: CLAY },

  lineCard: { padding: 12, marginTop: 10, backgroundColor: CARD },
  lineCardOn: { borderColor: CLAY },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: '#D8CDBF', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: CLAY, borderColor: CLAY },
  lineImage: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: LINE },
  lineImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  lineName: { fontSize: 14, fontWeight: '600', color: INK },
  lineMeta: { fontSize: 12, color: MUTED, marginTop: 2 },
  linePrice: { fontSize: 13.5, fontWeight: '600', color: GOLD, fontVariant: ['tabular-nums'] },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  qtyLabel: { fontSize: 12.5, color: MUTED },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: SOFT, alignItems: 'center', justifyContent: 'center' },
  stepBtnOff: { opacity: 0.4 },
  stepValue: { minWidth: 18, textAlign: 'center', fontSize: 14, fontWeight: '600', color: INK, fontVariant: ['tabular-nums'] },

  photoRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  photoSlot: { width: 84, height: 84, borderRadius: 14 },
  photoSlotImage: { width: '100%', height: '100%', borderRadius: 14, backgroundColor: LINE },
  photoRemove: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(34,28,24,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#E2C3B3',
    backgroundColor: CLAY_TINT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoAddText: { fontSize: 11.5, fontWeight: '600', color: '#A9502F', fontVariant: ['tabular-nums'] },

  noteBox: {
    marginTop: 12,
    borderRadius: Radius.lg,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: LINE,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  noteInput: { minHeight: 80, fontSize: 14, lineHeight: 21, color: INK, padding: 0 },
  counter: { alignSelf: 'flex-end', fontSize: 11, color: MUTED, fontVariant: ['tabular-nums'], marginTop: 4 },

  refundTo: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: CARD },
  refundToText: { flex: 1, fontSize: 13, color: INK, lineHeight: 19 },
  segment: { flexDirection: 'row', gap: 8, marginTop: 12 },
  segmentOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOptionOn: { borderColor: CLAY, backgroundColor: CLAY_TINT },
  segmentText: { fontSize: 14, fontWeight: '600', color: MUTED },
  segmentTextOn: { color: CLAY },
  payoutFields: { marginTop: 14 },
  privacy: { flexDirection: 'row', gap: 8 },
  privacyText: { flex: 1, fontSize: 11.5, color: MUTED, lineHeight: 17 },

  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 24,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: INK },
  totalValue: { fontSize: 20, fontWeight: '600', color: GOLD, fontVariant: ['tabular-nums'] },

  footer: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: LINE,
    backgroundColor: Colors.light.background,
  },
  footerHint: { fontSize: 11.5, color: MUTED, textAlign: 'center', marginTop: 8 },

  sheetTitle: { fontSize: 18, fontWeight: '600', color: INK, textAlign: 'center' },
  sheetBody: { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19, marginTop: 4, paddingHorizontal: 8 },
  sheetButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  sheetBtn: { flex: 1, height: 52, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sheetBtnGhost: { backgroundColor: CARD, borderWidth: 1, borderColor: '#E2D8CB' },
  sheetBtnPrimary: { backgroundColor: CLAY },
  sheetBtnText: { fontSize: 15, fontWeight: '600', color: INK },
  keepEditing: { height: 40, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  keepEditingText: { fontSize: 13.5, fontWeight: '600', color: MUTED },

  photoTiles: { flexDirection: 'row', gap: 12, marginTop: 16 },
  photoTile: {
    flex: 1,
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CARD,
  },
  photoTileCamera: { backgroundColor: CLAY, borderColor: CLAY },
  photoTilePressed: { transform: [{ scale: 0.98 }] },
  photoTileIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#F6E6DE', alignItems: 'center', justifyContent: 'center' },
  photoTileTitle: { fontSize: 15, fontWeight: '600', color: INK },
  photoTileText: { fontSize: 12, color: MUTED, marginTop: 1 },

  okCard: { alignItems: 'center', backgroundColor: CARD, paddingVertical: 22, borderRadius: Radius.xl },
  okBadge: { width: 60, height: 60, borderRadius: 20, backgroundColor: CLAY, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  okTitle: { fontSize: 19, fontWeight: '600', color: INK, textAlign: 'center', paddingHorizontal: 12 },
  okBody: { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19, marginTop: 4, paddingHorizontal: 12 },
  okAmount: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 16,
    marginHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  okAmountLabel: { fontSize: 13, color: MUTED },
  okAmountValue: { fontSize: 18, fontWeight: '600', color: GOLD, fontVariant: ['tabular-nums'] },
  nextCard: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: Radius.lg,
    backgroundColor: '#E7ECE1',
  },
  nextIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  nextTitle: { fontSize: 13.5, fontWeight: '600', color: INK },
  nextBody: { fontSize: 12, color: '#465339', lineHeight: 17, marginTop: 2 },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyActionWrap: { marginTop: Spacing.md, width: 200, alignSelf: 'center' },
});
