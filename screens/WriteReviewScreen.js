// screens/WriteReviewScreen.js
//
// Write (or revise) a review of ONE line of a delivered order, from the
// approved review-editor preview: three numbered steps — rate it, say
// whether it matched (and if not, what was different), add a note — then a
// live card showing exactly what other shoppers will read. Posting is held
// until the two required answers are in; updating is held until something
// actually changed. Leaving with unsaved changes asks first, in a sheet
// that lists them. Once saved, the screen turns into a calm confirmation
// with the review as posted, and a "Not quite" review points to messaging
// the store — a review is public, and an exchange is a conversation.
import React, { useState, useEffect, useRef } from 'react';
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
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

import { auth, db } from '../firebaseConfig';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { showAppAlert } from '../utils/appAlert';
import { Colors, Radius, Spacing } from '../constants/theme';
import { EASE_OUT_QUART } from '../constants/motion';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import StarRating from '../components/ui/StarRating';
import ProductImage from '../components/ui/ProductImage';
import Avatar from '../components/ui/Avatar';
import Sheet from '../components/shop/Sheet';
import {
  REVIEWS_COLLECTION,
  REVIEW_TEXT_MAX,
  MISMATCH_REASONS,
  mismatchReasonLabel,
  normalizeMismatchReasons,
  reviewDocId,
  publicDisplayName,
} from '../utils/reviews';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const LINE = Colors.light.border;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const CARD = '#FFFFFF';
const CLAY_TINT = '#FCF3EE';
const MOSS_TINT = '#F3F6EF';
const SOFT = '#F4EEE6';

// The verdict under the stars. Words rather than "4/5" alone, because a
// shopper choosing between 3 and 4 is deciding between "It was okay" and
// "Good", which is a clearer question than a number.
const RATING_LABELS = ['', 'Poor', 'Not great', 'It was okay', 'Good', 'Loved it'];

// Sentence starters under the note — for the customer who has something to
// say but no first line for it. Each one appends; none replaces.
const NUDGES = [
  ['Fit', 'Fit: '],
  ['Fabric', 'The fabric feels '],
  ['Store', 'The store '],
];

const BLANK = { rating: 0, matched: null, reasons: [], text: '' };

const formatDay = (date) =>
  date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

// What differs between the answers on screen and `from` (the review as
// posted, or BLANK for a new one), in the customer's words. Drives the
// header's count, the Update button, and the leave-without-saving sheet.
function listChanges(current, from, isEditing) {
  const changes = [];
  if (current.rating !== from.rating) {
    changes.push([
      'Rating',
      from.rating ? `${from.rating} → ${current.rating} stars` : `${current.rating} star${current.rating === 1 ? '' : 's'}`,
    ]);
  }
  if (current.matched !== from.matched && current.matched !== null) {
    changes.push(['Matched listing', current.matched ? 'Yes' : 'Not quite']);
  }
  if (current.reasons.join() !== from.reasons.join()) {
    changes.push(['What was different', current.reasons.map(mismatchReasonLabel).join(', ') || '—']);
  }
  if (current.text.trim() !== from.text.trim()) {
    changes.push([
      'Your note',
      !current.text.trim() ? 'Removed' : isEditing && from.text.trim() ? 'Edited' : 'Written',
    ]);
  }
  return changes;
}

/**
 * Reached from OrderDetailsScreen and OrdersScreen, which only offer it for
 * delivered orders — the same condition firestore.rules enforces on the
 * write. That is deliberate duplication: the screens keep the button honest,
 * and the rule keeps the data honest.
 *
 * Route params: { orderId, item, storeId, storeName? } where `storeId` is
 * the order's store (the review is filed with it), and `item` is the order
 * line itself (productId, name, image, size, color), not the product
 * document. The line is what was actually bought — a product's photo and
 * name can change after the sale, and a review should be anchored to the
 * thing that arrived.
 */
export default function WriteReviewScreen({ navigation, route }) {
  const { orderId, item, storeId, storeName } = route.params || {};
  const productId = item?.productId;

  const [rating, setRating] = useState(0);
  // Tri-state on purpose: null means "not answered yet", which is different
  // from false ("it did not match"). Posting is blocked until it is a real
  // boolean, so an untouched question can never be recorded as a complaint
  // the customer never made.
  const [matched, setMatched] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [text, setText] = useState('');

  // The review as it stands in Firestore — what "unsaved changes" are
  // measured against. BLANK until one is loaded or posted.
  const [posted, setPosted] = useState(null);
  const [postedAt, setPostedAt] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState('edit');
  const [leaveAction, setLeaveAction] = useState(null);

  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef(null);
  const noteRef = useRef(null);

  const isEditing = Boolean(posted);
  const current = { rating, matched, reasons, text };
  const changes = listChanges(current, posted || BLANK, isEditing);
  const isDirty = changes.length > 0;
  const answered = rating > 0 && matched !== null;
  const canSubmit = answered && (!isEditing || isDirty) && !submitting && !loading;

  const author = publicDisplayName(auth.currentUser?.displayName);
  const firstName = author.split(' ')[0];

  // A review already written for this line is loaded and edited in place
  // rather than refused. The rule allows the author to revise their own
  // review, and the alternative — a dead end reading "you already reviewed
  // this" — punishes someone for coming back to say something more useful.
  useEffect(() => {
    let cancelled = false;

    async function loadExisting() {
      if (!orderId || !productId || !auth.currentUser) {
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, REVIEWS_COLLECTION, reviewDocId(orderId, productId)));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          const loaded = {
            rating: Number(data.rating) || 0,
            matched: data.matchedDescription === true,
            reasons: data.matchedDescription === true ? [] : normalizeMismatchReasons(data.mismatchReasons),
            text: data.text || '',
          };
          setPosted(loaded);
          setPostedAt(data.createdAt?.toDate ? data.createdAt.toDate() : null);
          setRating(loaded.rating);
          setMatched(loaded.matched);
          setReasons(loaded.reasons);
          setText(loaded.text);
        }
        setLoadFailed(false);
      } catch (error) {
        // Not fatal — it only means we could not tell whether a review
        // already exists. Surfaced rather than swallowed, because posting
        // blind would hit the "document already exists" denial with no
        // explanation for it.
        console.error('Could not load existing review:', error);
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadExisting();
    return () => {
      cancelled = true;
    };
  }, [orderId, productId]);

  // Every way off this screen — the back arrow, Android's back button, the
  // iOS swipe — comes through here, so none of them can drop the customer's
  // edits without asking. Saving sets `leaving` first so it leaves freely.
  const leaving = useRef(false);
  const guardRef = useRef(false);
  guardRef.current = isDirty && view === 'edit';
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

  const handleSelectMatched = (value) => {
    if (matched === value) return;
    Haptics.selectionAsync();
    setMatched(value);
    // "It matched" and "the colour was off" can't both be the answer.
    if (value) setReasons([]);
  };

  const toggleReason = (key) => {
    Haptics.selectionAsync();
    setReasons((list) =>
      normalizeMismatchReasons(list.includes(key) ? list.filter((k) => k !== key) : [...list, key])
    );
  };

  const addNudge = (starter) => {
    Haptics.selectionAsync();
    setText((value) => ((value.trim() ? `${value.trim()} ` : '') + starter).slice(0, REVIEW_TEXT_MAX));
    noteRef.current?.focus();
  };

  // Resolves true once saved, so "Save & leave" knows whether to leave.
  const handleSubmit = async () => {
    if (!canSubmit) return false;
    if (!auth.currentUser) {
      showAppAlert('Login Required', 'Please sign in to write a review.', [
        { text: 'Login', onPress: () => navigation.navigate('Login') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return false;
    }

    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const reviewRef = doc(db, REVIEWS_COLLECTION, reviewDocId(orderId, productId));
    const trimmedText = text.trim().slice(0, REVIEW_TEXT_MAX);
    const mismatchReasons = matched ? [] : reasons;

    try {
      if (isEditing) {
        // Only the keys the author branch of the rule allows. Sending the
        // full document instead would change orderId/productId to identical
        // values — still a change, as far as affectedKeys() is concerned,
        // and still a denial.
        await updateDoc(reviewRef, {
          rating,
          matchedDescription: matched,
          mismatchReasons,
          text: trimmedText,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(reviewRef, {
          orderId,
          productId,
          // Snapshots, not joins: /users is unreadable to other shoppers
          // and a product can be renamed after the sale, so both are copied
          // at write time. See the /reviews block in firestore.rules.
          productName: (item?.name || '').slice(0, 120),
          userId: auth.currentUser.uid,
          userName: author.slice(0, 60),
          // Copied for the same reason as the name; omitted, not blank,
          // when there is no photo.
          ...(auth.currentUser.photoURL ? { userPhotoUrl: auth.currentUser.photoURL.slice(0, 2000) } : {}),
          rating,
          matchedDescription: matched,
          mismatchReasons,
          text: trimmedText,
          // Never true at creation — the rule refuses it, and a review that
          // could arrive pre-hidden would bypass moderation rather than
          // pass through it.
          hidden: false,
          // Must be serverTimestamp(): the rule requires createdAt to equal
          // request.time, so a client-supplied date is rejected outright.
          createdAt: serverTimestamp(),
          // The store that sold the item, so the review reaches its
          // moderation queue. The rule checks it against the order, so it
          // comes from the order rather than from anything editable. The
          // line's own copy covers a nav that predates the param.
          storeId: storeId || item?.storeId || null,
        });
        setPostedAt(new Date());
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPosted({ rating, matched, reasons: mismatchReasons, text: trimmedText });
      setText(trimmedText);
      setSubmitting(false);
      setView(isEditing ? 'updated' : 'posted');
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      return true;
    } catch (error) {
      console.error('Error saving review:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
      } else if (error.code === 'permission-denied') {
        // The rule's most likely refusal, in the customer's terms rather
        // than Firestore's. Orders placed before productIds was written
        // land here too, which is why the message talks about the order
        // rather than about permissions.
        showAppAlert(
          'Could Not Post Review',
          'Reviews can only be written for items from an order that has been delivered. If this order was delivered, please contact support.'
        );
      } else {
        showAppAlert('Error', 'Could not save your review. Please try again.');
      }
      setSubmitting(false);
      return false;
    }
  };

  const saveAndLeave = async () => {
    const action = leaveAction;
    if (await handleSubmit()) leaveNow(action);
  };

  const discardAndLeave = () => {
    Haptics.selectionAsync();
    leaveNow(leaveAction);
  };

  const openStoreChat = () => {
    Haptics.selectionAsync();
    navigation.navigate('OrderChat', {
      customerId: auth.currentUser?.uid,
      orderId,
      side: 'customer',
      storeId: storeId || item?.storeId,
      title: storeName || 'The store',
    });
  };

  // A malformed navigation (a stale link, a param drop) gets the same
  // shared EmptyState treatment as OrderDetails and Product, rather than a
  // form that submits into nothing.
  if (!orderId || !productId) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader onBack={() => navigation.goBack()} title="Write a review" />
        <View style={styles.centerContainer}>
          <EmptyState
            icon="chatbox-outline"
            title="Review unavailable"
            subtitle="We couldn't tell which item this review is for. Open the order again and tap Write a review."
          />
          <View style={styles.emptyActionWrap}>
            <Button variant="secondary" label="Back to Orders" onPress={() => navigation.navigate('Orders')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (view !== 'edit') {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader onBack={() => leaveNow()} title="Your review" subtitle={item?.name} />
        <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(260).easing(EASE_OUT_QUART)}>
            <Card variant="flat" style={styles.okCard}>
              <View style={styles.okBadge}>
                <Ionicons name="sparkles" size={26} color="#fff" />
              </View>
              <Text style={styles.okTitle} accessibilityRole="header">
                {view === 'updated' ? 'Review updated' : 'Review posted'}
              </Text>
              <Text style={styles.okBody}>
                {`Thanks, ${firstName}. Honest notes like yours help the next buyer choose well.`}
              </Text>
            </Card>
          </Animated.View>

          <Card variant="flat" style={styles.mineCard}>
            <View style={styles.mineHead}>
              {item?.image ? <ProductImage uri={item.image} style={styles.mineThumb} /> : null}
              <Text style={styles.mineTitle}>Your review</Text>
              {view === 'updated' ? <Text style={styles.editedTag}>EDITED</Text> : null}
              <TouchableOpacity
                onPress={() => {
                  Haptics.selectionAsync();
                  setView('edit');
                }}
                style={styles.mineEdit}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Edit your review"
              >
                <Ionicons name="create-outline" size={14} color={CLAY} />
                <Text style={styles.mineEditText}>Edit</Text>
              </TouchableOpacity>
            </View>
            <StarRating rating={rating} size={16} color={CLAY} label={item?.name} style={styles.mineStars} />
            <Text style={[styles.mineText, !text.trim() && styles.mineTextEmpty]}>
              {text.trim() || 'No written note, just the rating.'}
            </Text>
          </Card>

          {matched === false ? (
            <Pressable
              onPress={openStoreChat}
              style={({ pressed }) => [styles.nextCard, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`Message ${storeName || 'the store'} about this order`}
            >
              <View style={styles.nextIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={MOSS} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.nextTitle}>Want to tell the store directly?</Text>
                <Text style={styles.nextBody}>
                  A review is public. For an exchange or refund, message the store from this order.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={MOSS} />
            </Pressable>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button variant="primary" fullWidth label="Done" onPress={() => leaveNow()} />
        </View>
      </SafeAreaView>
    );
  }

  const subtitle = isEditing
    ? postedAt
      ? `Posted ${formatDay(postedAt)}`
      : 'Posted'
    : item?.name;

  const footerHint = (() => {
    if (submitting || loading) return null;
    if (rating === 0) return 'Tap a star to rate this item.';
    if (matched === null) return 'Say whether it matched the listing.';
    if (isEditing) return isDirty ? 'Shoppers will see an “Edited” label.' : 'Change anything above to update.';
    return null;
  })();

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        onBack={() => navigation.goBack()}
        title={isEditing ? 'Edit your review' : 'Write a review'}
        subtitle={subtitle}
        badge={isEditing && isDirty ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : null}
      />

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            {"No internet connection — your review can't be posted right now."}
          </Text>
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
          {/* What is being reviewed — the order line, photo included, so
              there is no doubt which of several similar items this is. */}
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)}>
            <Card variant="flat" style={styles.itemCard}>
              {item?.image ? (
                <ProductImage uri={item.image} style={styles.itemImage} />
              ) : (
                <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                  <Ionicons name="shirt-outline" size={26} color={MUTED} />
                </View>
              )}
              <View style={styles.itemDetails}>
                <Text style={styles.itemName} numberOfLines={2}>{item?.name || 'This item'}</Text>
                <View style={styles.pills}>
                  <View style={[styles.pill, styles.pillVerified]}>
                    <Ionicons name="checkmark-circle" size={12} color={MOSS} />
                    <Text style={[styles.pillText, { color: MOSS, fontWeight: '600' }]}>Verified purchase</Text>
                  </View>
                  {item?.size ? <Pill label={`Size ${item.size}`} /> : null}
                  {item?.color ? <Pill label={item.color} /> : null}
                  {storeName ? <Pill label={storeName} tone="clay" /> : null}
                </View>
              </View>
            </Card>
          </Animated.View>

          {loadFailed && (
            <View style={styles.warningNote}>
              <Text style={styles.warningNoteText}>
                {"We couldn't check whether you've already reviewed this item. You can still write one — if you've reviewed it before, this will replace it."}
              </Text>
            </View>
          )}

          {/* 1 — Rating */}
          <Animated.View
            style={styles.section}
            entering={reduceMotion ? undefined : FadeInDown.duration(220).delay(40).easing(EASE_OUT_QUART)}
          >
            <Text style={styles.step}>STEP 1 OF 3</Text>
            <Text style={styles.sectionTitle}>How was it overall?</Text>
            <Card variant="flat" style={styles.rateCard}>
              <StarRating
                rating={rating}
                size={34}
                editable
                onChange={setRating}
                label={item?.name}
                color={CLAY}
                style={styles.starRow}
              />
              {/* Height is reserved whether or not a label is showing, so
                  choosing a rating doesn't shove the rest of the form down. */}
              <View style={styles.ratingLabelSlot}>
                {rating > 0 ? (
                  <>
                    <Text style={styles.ratingLabel}>{RATING_LABELS[rating]}</Text>
                    <Text style={styles.ratingFace}>{rating}/5</Text>
                  </>
                ) : (
                  <Text style={styles.ratingPrompt}>Tap a star</Text>
                )}
              </View>
            </Card>
          </Animated.View>

          {/* 2 — The ukay-ukay question. This is the field the whole feature
              is built around: secondhand items are often one of a kind, so a
              per-product average may never have more than one review — but
              "did it match?" is the same question about every item in the
              store, so it aggregates into a number that means something on
              day one. See summarizeReviews() in utils/reviews.js. */}
          <Animated.View
            style={styles.section}
            entering={reduceMotion ? undefined : FadeInDown.duration(220).delay(80).easing(EASE_OUT_QUART)}
          >
            <Text style={styles.step}>STEP 2 OF 3</Text>
            <Text style={styles.sectionTitle}>Did it match the listing?</Text>
            <Text style={styles.sectionHelp}>Think condition, size, colour, and how it looked in the photos.</Text>
            <View style={styles.choiceRow} accessibilityRole="radiogroup">
              <ChoiceCard
                title="Yes, it matched"
                caption="What I saw is what I got"
                icon="checkmark"
                selected={matched === true}
                color={MOSS}
                tint={MOSS_TINT}
                onPress={() => handleSelectMatched(true)}
              />
              {/* Clay, not Rust: a mismatch is useful feedback, not an error. */}
              <ChoiceCard
                title="Not quite"
                caption="Something was different"
                icon="alert-circle-outline"
                selected={matched === false}
                color={CLAY}
                tint={CLAY_TINT}
                onPress={() => handleSelectMatched(false)}
              />
            </View>
            {matched === false ? (
              <Animated.View
                entering={reduceMotion ? undefined : FadeInDown.duration(200).easing(EASE_OUT_QUART)}
                style={styles.whatBox}
              >
                <Text style={styles.whatTitle}>What was different? Pick any that apply.</Text>
                <View style={styles.chips}>
                  {MISMATCH_REASONS.map(([key, label]) => {
                    const on = reasons.includes(key);
                    return (
                      <Pressable
                        key={key}
                        onPress={() => toggleReason(key)}
                        style={[styles.chip, on && styles.chipOn]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={label}
                      >
                        {on ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Animated.View>
            ) : null}
          </Animated.View>

          {/* 3 — Optional note. A hand-rolled TextInput for the same reason
              as the product forms' Description (see DESIGN.md): Input can't
              be widened into a textarea without losing its base style. */}
          <Animated.View
            style={styles.section}
            entering={reduceMotion ? undefined : FadeInDown.duration(220).delay(120).easing(EASE_OUT_QUART)}
          >
            <Text style={styles.step}>STEP 3 OF 3</Text>
            <View style={styles.titleRow}>
              <Text style={[styles.sectionTitle, { flex: 1 }]}>Tell other shoppers</Text>
              <Text style={styles.optional}>Optional</Text>
            </View>
            <View style={styles.noteBox}>
              <TextInput
                ref={noteRef}
                value={text}
                onChangeText={(value) => setText(value.slice(0, REVIEW_TEXT_MAX))}
                placeholder="What should the next buyer know?"
                placeholderTextColor={MUTED}
                multiline
                textAlignVertical="top"
                maxLength={REVIEW_TEXT_MAX}
                style={styles.noteInput}
                accessibilityLabel="Tell other shoppers about this item"
              />
              <View style={styles.noteFoot}>
                {NUDGES.map(([label, starter]) => (
                  <Pressable
                    key={label}
                    onPress={() => addNudge(starter)}
                    style={styles.nudge}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Start a sentence about ${label.toLowerCase()}`}
                  >
                    <Text style={styles.nudgeText}>+ {label}</Text>
                  </Pressable>
                ))}
                <Text
                  style={[styles.counter, text.length > REVIEW_TEXT_MAX * 0.9 && { color: Colors.light.danger }]}
                  accessibilityLabel={`${text.length} of ${REVIEW_TEXT_MAX} characters`}
                >
                  {text.length}/{REVIEW_TEXT_MAX}
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* The review exactly as other shoppers will read it — the same
              fields, in the same order, as the list on the product page.
              Replaces the paragraph that described it. */}
          <View style={styles.section}>
            <View style={styles.titleRow}>
              <Text style={[styles.sectionTitle, { flex: 1 }]}>How shoppers will see it</Text>
              <View style={styles.liveTag}>
                <Ionicons name="eye-outline" size={12} color={MUTED} />
                <Text style={styles.optional}>Live</Text>
              </View>
            </View>
            <PublicPreview
              author={author}
              photoUrl={auth.currentUser?.photoURL}
              rating={rating}
              matched={matched}
              reasons={reasons}
              text={text}
              dateLabel={isEditing && isDirty ? 'Edited just now' : postedAt ? formatDay(postedAt) : 'Today'}
            />
            <View style={styles.privacy}>
              <Ionicons name="lock-closed-outline" size={14} color={MUTED} />
              <Text style={styles.privacyText}>
                {"Only your first name and last initial are shown. You're reviewing the item — PlainCo doesn't rate customers."}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            variant="primary"
            fullWidth
            label={isEditing ? (isDirty ? 'Update review' : 'No changes yet') : 'Post review'}
            onPress={handleSubmit}
            loading={submitting || loading}
            disabled={!canSubmit}
          />
          {footerHint ? <Text style={styles.footerHint}>{footerHint}</Text> : null}
        </View>
      </KeyboardAvoidingView>

      <Sheet visible={Boolean(leaveAction)} onClose={() => setLeaveAction(null)} locked={submitting}>
        <Text style={styles.sheetTitle} accessibilityRole="header">Leave without saving?</Text>
        <Text style={styles.sheetBody}>
          {isEditing
            ? `You have ${changes.length} unsaved change${changes.length === 1 ? '' : 's'}. Your posted review stays as it was.`
            : "Your review hasn't been posted. If you leave now, what you've written is lost."}
        </Text>
        <View style={styles.changes}>
          {changes.map(([label, value], index) => (
            <View key={label} style={[styles.changeRow, index > 0 && styles.changeRowRule]}>
              <Text style={styles.changeLabel}>{label}</Text>
              <Text style={styles.changeValue}>{value}</Text>
            </View>
          ))}
        </View>
        {/* Sheet-sized buttons, as in the preview, rather than the screen
            Button: its 19pt label is sized for a footer, not a pair. */}
        <View style={styles.sheetButtons}>
          <Pressable
            onPress={discardAndLeave}
            disabled={submitting}
            style={({ pressed }) => [styles.sheetBtn, styles.sheetBtnGhost, pressed && { backgroundColor: SOFT }]}
            accessibilityRole="button"
          >
            <Text style={styles.sheetBtnText}>Discard</Text>
          </Pressable>
          {/* A new review can only be saved once both answers are in; until
              then the choice is discard or keep going. */}
          {answered ? (
            <Pressable
              onPress={saveAndLeave}
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
                <>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={[styles.sheetBtnText, { color: '#fff' }]}>
                    {isEditing ? 'Save & leave' : 'Post & leave'}
                  </Text>
                </>
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
          <Text style={styles.keepEditingText}>Keep editing</Text>
        </Pressable>
      </Sheet>
    </SafeAreaView>
  );
}

// Back button, title with a small line under it, and an optional count of
// unsaved changes where the other headers keep their trailing action.
function ScreenHeader({ onBack, title, subtitle, badge }) {
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
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {badge ? (
        <View style={styles.dirtyBadge}>
          <View style={styles.dirtyDot} />
          <Text style={styles.dirtyText}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Pill({ label, tone }) {
  return (
    <View style={[styles.pill, tone === 'clay' && { backgroundColor: CLAY_TINT }]}>
      <Text style={[styles.pillText, tone === 'clay' && { color: CLAY }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// One of the two answers to "did it match?". Neither starts selected:
// "not answered" has to stay visibly distinct from "no".
function ChoiceCard({ title, caption, icon, selected, color, tint, onPress }) {
  // The flex lives on a plain wrapper: AnimatedPressable applies `style` to
  // an inner Animated.View, so a `flex: 1` handed to it would size that
  // inner view inside a Pressable that never grew.
  return (
    <View style={styles.flex}>
      <AnimatedPressable
        style={[styles.choice, selected && { borderColor: color, backgroundColor: tint }]}
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${title}. ${caption}`}
      >
        <View style={[styles.choiceIcon, selected && { backgroundColor: color }]}>
          <Ionicons name={icon} size={16} color={selected ? '#fff' : MUTED} />
        </View>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceCaption}>{caption}</Text>
      </AnimatedPressable>
    </View>
  );
}

function PublicPreview({ author, photoUrl, rating, matched, reasons, text, dateLabel }) {
  const note = text.trim();
  return (
    <View style={styles.preview} accessible accessibilityLabel={`Preview: ${rating} stars from ${author}. ${note}`}>
      <View style={styles.previewHead}>
        <Avatar uri={photoUrl} size={32} />
        <View style={styles.flex}>
          <Text style={styles.previewName} numberOfLines={1}>{author}</Text>
          <Text style={styles.previewSub}>{dateLabel}</Text>
        </View>
        <StarRating rating={rating} size={14} color="#E58A66" />
      </View>
      <Text style={[styles.previewText, !note && styles.previewTextEmpty]}>
        {note || 'No written note, just the rating.'}
      </Text>
      <View style={styles.previewTags}>
        {matched === true ? <PreviewTag icon="checkmark" label="Matched the description" tone="ok" /> : null}
        {matched === false ? <PreviewTag icon="alert-circle-outline" label="Didn't match the description" tone="off" /> : null}
        {matched === false
          ? reasons.map((key) => <PreviewTag key={key} label={mismatchReasonLabel(key)} tone="off" />)
          : null}
      </View>
    </View>
  );
}

const PREVIEW_TONES = {
  plain: { bg: 'rgba(255,255,255,0.08)', fg: '#D9CFC3' },
  ok: { bg: 'rgba(157,190,138,0.18)', fg: '#BFD6B1' },
  off: { bg: 'rgba(196,98,62,0.22)', fg: '#F4BFA9' },
};

function PreviewTag({ icon, label, tone = 'plain' }) {
  const { bg, fg } = PREVIEW_TONES[tone];
  return (
    <View style={[styles.previewTag, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={fg} /> : null}
      <Text style={[styles.previewTagText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
  },
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
  headerText: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: INK },
  headerSub: { fontSize: 11.5, color: MUTED, marginTop: 1 },
  dirtyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: '#F7E7DF',
  },
  dirtyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CLAY },
  dirtyText: { fontSize: 11, fontWeight: '600', color: '#A9502F' },

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
  section: { marginTop: 24 },

  itemCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, padding: 12, borderRadius: Radius.lg },
  itemImage: { width: 76, height: 76, borderRadius: 12, backgroundColor: LINE },
  itemImagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  itemDetails: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 15, fontWeight: '600', color: INK },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: SOFT,
    maxWidth: '100%',
  },
  pillVerified: { backgroundColor: '#E7ECE1' },
  pillText: { fontSize: 11, fontWeight: '500', color: MUTED },

  warningNote: {
    backgroundColor: Colors.light.highlight + '12',
    borderRadius: Radius.sm,
    padding: 12,
    marginTop: 16,
  },
  warningNoteText: { fontSize: 12, color: Colors.light.highlight, lineHeight: 17 },

  step: { fontSize: 10.5, fontWeight: '700', color: CLAY, letterSpacing: 1, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: INK },
  sectionHelp: { fontSize: 12.5, color: MUTED, lineHeight: 18, marginTop: 3 },
  optional: { fontSize: 11, fontWeight: '500', color: MUTED },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: SOFT,
  },

  rateCard: { marginTop: 12, backgroundColor: CARD, borderRadius: Radius.lg, paddingVertical: 14, paddingHorizontal: 10 },
  starRow: { justifyContent: 'space-between' },
  ratingLabelSlot: {
    minHeight: 26,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ratingLabel: { fontSize: 14, fontWeight: '600', color: INK },
  ratingFace: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A9502F',
    backgroundColor: CLAY_TINT,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  ratingPrompt: { fontSize: 13, color: MUTED },

  choiceRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  choice: {
    padding: 12,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: CARD,
    gap: 4,
    minHeight: 104,
  },
  choiceIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  choiceTitle: { fontSize: 14, fontWeight: '600', color: INK },
  choiceCaption: { fontSize: 11.5, color: MUTED, lineHeight: 15 },

  whatBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: Radius.lg,
    backgroundColor: CLAY_TINT,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#EBC9B8',
  },
  whatTitle: { fontSize: 12, fontWeight: '600', color: '#A9502F', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#E2D8CB',
    backgroundColor: CARD,
  },
  chipOn: { backgroundColor: INK, borderColor: INK },
  chipText: { fontSize: 12.5, fontWeight: '500', color: MUTED },
  chipTextOn: { color: '#fff' },

  noteBox: {
    marginTop: 12,
    borderRadius: Radius.lg,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: LINE,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  noteInput: { minHeight: 96, fontSize: 14, lineHeight: 21, color: INK, padding: 0 },
  noteFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 9,
    marginTop: 6,
  },
  nudge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.pill, backgroundColor: SOFT },
  nudgeText: { fontSize: 11, fontWeight: '500', color: MUTED },
  counter: { marginLeft: 'auto', fontSize: 11, color: MUTED, fontVariant: ['tabular-nums'] },

  preview: { marginTop: 12, borderRadius: Radius.lg, padding: 14, backgroundColor: '#221C18', gap: 10 },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewName: { fontSize: 13, fontWeight: '600', color: '#F3ECE3' },
  previewSub: { fontSize: 11, color: '#A99E94', marginTop: 1 },
  previewText: { fontSize: 13, lineHeight: 19, color: '#E9E1D6' },
  previewTextEmpty: { color: '#8C8077', fontStyle: 'italic' },
  previewTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  previewTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  previewTagText: { fontSize: 10.5, fontWeight: '500' },
  privacy: { flexDirection: 'row', gap: 8, marginTop: 10 },
  privacyText: { flex: 1, fontSize: 11.5, color: MUTED, lineHeight: 17 },

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
  sheetBody: {
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
    paddingHorizontal: 8,
  },
  changes: {
    marginTop: 14,
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: LINE,
    paddingVertical: 4,
    paddingHorizontal: 14,
  },
  changeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  // Solid, not the preview's dashed rule: Android draws a one-sided dashed
  // border as solid or not at all.
  changeRowRule: { borderTopWidth: 1, borderTopColor: LINE },
  // The label keeps its width; a long value wraps under itself, right-aligned.
  changeLabel: { fontSize: 12.5, color: MUTED, flexShrink: 0 },
  changeValue: { flex: 1, fontSize: 12.5, fontWeight: '600', color: INK, textAlign: 'right' },
  sheetButtons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  sheetBtn: {
    flex: 1,
    height: 52,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sheetBtnGhost: { backgroundColor: CARD, borderWidth: 1, borderColor: '#E2D8CB' },
  sheetBtnPrimary: { backgroundColor: CLAY },
  sheetBtnText: { fontSize: 15, fontWeight: '600', color: INK },
  keepEditing: { height: 40, marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  keepEditingText: { fontSize: 13.5, fontWeight: '600', color: MUTED },

  okCard: { alignItems: 'center', backgroundColor: CARD, paddingVertical: 22, borderRadius: Radius.xl },
  okBadge: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: CLAY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  okTitle: { fontSize: 19, fontWeight: '600', color: INK },
  okBody: { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19, marginTop: 4, paddingHorizontal: 12 },
  mineCard: { marginTop: 14, backgroundColor: CARD, borderRadius: Radius.lg, padding: 14 },
  mineHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mineThumb: { width: 34, height: 34, borderRadius: 10, backgroundColor: LINE },
  mineTitle: { fontSize: 13.5, fontWeight: '600', color: INK },
  editedTag: {
    fontSize: 10,
    fontWeight: '600',
    color: MUTED,
    backgroundColor: SOFT,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  mineEdit: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 },
  mineEditText: { fontSize: 12.5, fontWeight: '600', color: CLAY },
  mineStars: { marginTop: 8 },
  mineText: { fontSize: 13, color: INK, lineHeight: 19, marginTop: 8 },
  mineTextEmpty: { color: MUTED, fontStyle: 'italic' },
  nextCard: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: Radius.lg,
    backgroundColor: '#E7ECE1',
  },
  nextIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextTitle: { fontSize: 13.5, fontWeight: '600', color: INK },
  nextBody: { fontSize: 12, color: '#465339', lineHeight: 17, marginTop: 2 },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyActionWrap: { marginTop: Spacing.md, width: 200, alignSelf: 'center' },
});
