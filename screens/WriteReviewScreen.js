import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
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
import Input from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import StarRating from '../components/ui/StarRating';
import ProductImage from '../components/ui/ProductImage';
import {
  REVIEWS_COLLECTION,
  REVIEW_TEXT_MAX,
  reviewDocId,
  publicDisplayName,
} from '../utils/reviews';

// The one-word verdict under the stars. Five labels rather than a generic
// "Rating: 4" because the number alone is ambiguous at the moment of
// choosing — a shopper picking between 3 and 4 is deciding between "It was
// okay" and "Good", which is a clearer question than 3 vs. 4.
const RATING_LABELS = {
  1: 'Not what I hoped for',
  2: 'Below what I expected',
  3: 'It was okay',
  4: 'Good — I would buy again',
  5: 'Exactly what I wanted',
};

/**
 * Write (or revise) a review of ONE line of a delivered order.
 *
 * Reached from OrderDetailsScreen, which only offers it for delivered
 * orders — the same condition firestore.rules enforces on the write. That
 * is deliberate duplication: the screen keeps the button honest, and the
 * rule keeps the data honest.
 *
 * Route params: { orderId, item, storeId } where `storeId` is the order's
 * store (the review is filed with it), and `item` is the order line itself
 * (productId, name, image, size, color), not the product document. The line
 * is what was actually bought — a product's photo and name can change after
 * the sale, and a review should be anchored to the thing that arrived.
 */
export default function WriteReviewScreen({ navigation, route }) {
  const { orderId, item, storeId } = route.params || {};
  const productId = item?.productId;

  const [rating, setRating] = useState(0);
  // Tri-state on purpose: null means "not answered yet", which is different
  // from false ("it did not match"). Submitting is blocked until it is a
  // real boolean, so an untouched question can never be recorded as a
  // complaint the customer never made.
  const [matchedDescription, setMatchedDescription] = useState(null);
  const [text, setText] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [existingReview, setExistingReview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const isEditing = Boolean(existingReview);
  const canSubmit = rating > 0 && matchedDescription !== null && !submitting;

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
          setExistingReview(data);
          setRating(Number(data.rating) || 0);
          setMatchedDescription(data.matchedDescription === true);
          setText(data.text || '');
        }
        setLoadFailed(false);
      } catch (error) {
        // A failed read here is not fatal — it only means we could not tell
        // whether a review already exists. Surfaced rather than swallowed,
        // because submitting blind would hit the "document already exists"
        // denial with no explanation for it.
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

  const handleSelectMatched = (value) => {
    if (matchedDescription === value) return;
    Haptics.selectionAsync();
    setMatchedDescription(value);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!auth.currentUser) {
      showAppAlert('Login Required', 'Please sign in to write a review.', [
        { text: 'Login', onPress: () => navigation.navigate('Login') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const reviewRef = doc(db, REVIEWS_COLLECTION, reviewDocId(orderId, productId));
    const trimmedText = text.trim().slice(0, REVIEW_TEXT_MAX);

    try {
      if (isEditing) {
        // Exactly the four keys the author branch of the rule allows.
        // Sending the full document instead would change orderId/productId
        // to identical values — still a change, as far as
        // affectedKeys() is concerned, and still a denial.
        await updateDoc(reviewRef, {
          rating,
          matchedDescription,
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
          userName: publicDisplayName(auth.currentUser.displayName).slice(0, 60),
          // Copied for the same reason as the name; omitted, not blank,
          // when there is no photo.
          ...(auth.currentUser.photoURL ? { userPhotoUrl: auth.currentUser.photoURL.slice(0, 2000) } : {}),
          rating,
          matchedDescription,
          text: trimmedText,
          // Never true at creation — the rule refuses it, and a review that
          // could arrive pre-hidden would bypass moderation rather than
          // pass through it.
          hidden: false,
          // Must be serverTimestamp(): the rule requires createdAt to equal
          // request.time, so a client-supplied date is rejected outright.
          createdAt: serverTimestamp(),
          // The store that sold the item, so the review reaches its
          // moderation queue. The rule checks it against the order, so
          // it comes from the order rather than from anything editable.
          // The line's own copy covers a nav that predates the param.
          storeId: storeId || item?.storeId || null,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        isEditing ? 'Review Updated' : 'Thank You',
        isEditing
          ? 'Your review has been updated.'
          : 'Your review helps the next shopper know what to expect.',
        [{ text: 'Done', onPress: () => navigation.goBack() }]
      );
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
    }
  };

  // A malformed navigation (a stale link, a param drop) gets the same
  // shared EmptyState treatment as OrderDetails and Product, rather than a
  // form that submits into nothing.
  if (!orderId || !productId) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader navigation={navigation} title="Write a Review" />
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

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader navigation={navigation} title={isEditing ? 'Edit Your Review' : 'Write a Review'} />

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
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* What is being reviewed — the order line, image included, so
              there is no doubt which of several similar items this is. */}
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)}>
            <Card variant="flat" style={styles.itemCard}>
              {item?.image ? (
                <ProductImage uri={item.image} style={styles.itemImage} />
              ) : (
                <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                  <Ionicons name="shirt-outline" size={24} color={Colors.light.icon} />
                </View>
              )}
              <View style={styles.itemDetails}>
                <Text style={styles.itemName} numberOfLines={2}>{item?.name || 'This item'}</Text>
                <Text style={styles.itemSpecs}>
                  {item?.size ? `Size: ${item.size}` : ''}
                  {item?.size && item?.color ? '  ·  ' : ''}
                  {item?.color ? `Color: ${item.color}` : ''}
                </Text>
                <View style={styles.verifiedRow}>
                  <Ionicons name="checkmark-circle" size={13} color={Colors.light.success} />
                  <Text style={styles.verifiedText}>Verified purchase</Text>
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

          {/* Rating */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(220).delay(40).easing(EASE_OUT_QUART)}
          >
            <Text style={styles.sectionTitle}>How was it?</Text>
            <StarRating
              rating={rating}
              size={34}
              editable
              onChange={setRating}
              label={item?.name}
              style={styles.starRow}
            />
            {/* Height is reserved whether or not a label is showing, so
                choosing a rating doesn't shove the rest of the form down. */}
            <View style={styles.ratingLabelSlot}>
              {rating > 0 ? <Text style={styles.ratingLabel}>{RATING_LABELS[rating]}</Text> : null}
            </View>
          </Animated.View>

          {/* The ukay-ukay question. This is the field the whole feature is
              built around: secondhand items are often one of a kind, so a
              per-product average may never have more than one review — but
              "did it match?" is the same question about every item in the
              store, so it aggregates into a number that means something on
              day one. See summarizeReviews() in utils/reviews.js. */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(220).delay(80).easing(EASE_OUT_QUART)}
          >
            <Text style={styles.sectionTitle}>Did it match the description?</Text>
            <Text style={styles.sectionHelp}>
              Condition, size, and colour — was the item what the listing said it was?
            </Text>
            <View style={styles.choiceRow}>
              <ChoiceChip
                label="Yes, it matched"
                icon="checkmark-circle-outline"
                selected={matchedDescription === true}
                color={Colors.light.success}
                onPress={() => handleSelectMatched(true)}
              />
              <ChoiceChip
                label="Not quite"
                icon="alert-circle-outline"
                selected={matchedDescription === false}
                color={Colors.light.danger}
                onPress={() => handleSelectMatched(false)}
              />
            </View>
          </Animated.View>

          {/* Optional detail */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(220).delay(120).easing(EASE_OUT_QUART)}
          >
            <Text style={styles.sectionTitle}>Anything else? (optional)</Text>
            <Input
              value={text}
              onChangeText={(value) => setText(value.slice(0, REVIEW_TEXT_MAX))}
              placeholder="How does it fit? How's the fabric? Anything the photos didn't show?"
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              maxLength={REVIEW_TEXT_MAX}
              style={styles.textArea}
              accessibilityLabel="Write the details of your review"
            />
            <Text style={styles.counter}>
              {text.length} / {REVIEW_TEXT_MAX}
            </Text>
          </Animated.View>

          <Text style={styles.disclosureText}>
            {"Your review is public and shows your first name and last initial. Only the item is reviewed — PlainCo doesn't rate customers."}
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            variant="primary"
            fullWidth
            label={isEditing ? 'Update Review' : 'Post Review'}
            onPress={handleSubmit}
            loading={submitting || loading}
            disabled={!canSubmit}
          />
          {/* Says which step is missing rather than leaving a disabled
              button unexplained — the two required answers are a star
              rating and the match question, in that order. */}
          {!canSubmit && !submitting && !loading ? (
            <Text style={styles.footerHint}>
              {rating === 0
                ? 'Tap a star to rate this item.'
                : 'Let us know whether it matched the description.'}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Same header shape as OrderDetailsScreen — back arrow, centred title, a
// 40pt spacer holding the title centred where that screen has an action.
function ScreenHeader({ navigation, title }) {
  return (
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
      <Text style={styles.headerTitle} accessibilityRole="header">{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

// A two-option selector, not a toggle: "not answered" has to stay visibly
// distinct from "no", so neither chip may start in a selected-looking state.
function ChoiceChip({ label, icon, selected, color, onPress }) {
  // The flex lives on a plain wrapper, not on the chip's own style:
  // AnimatedPressable applies `style` to an inner Animated.View, so a
  // `flex: 1` handed to it would size that inner view inside a Pressable
  // that never grew — leaving two chips hugging their text at the left
  // instead of splitting the row.
  return (
    <View style={styles.choiceChipWrap}>
      <AnimatedPressable
        style={[
          styles.choiceChip,
          selected && { borderColor: color, backgroundColor: color + '12' },
        ]}
        onPress={onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
      >
        <Ionicons name={icon} size={18} color={selected ? color : Colors.light.icon} />
        <Text style={[styles.choiceChipText, selected && { color, fontWeight: '600' }]}>
          {label}
        </Text>
      </AnimatedPressable>
    </View>
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

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.light.danger + '12',
  },
  offlineBannerText: { flex: 1, fontSize: 12, color: Colors.light.danger },

  content: { padding: 20, paddingBottom: 32 },

  itemCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  itemImage: { width: 60, height: 60, borderRadius: 8, backgroundColor: Colors.light.border },
  itemImagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  itemDetails: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 15, fontWeight: '600', color: Colors.light.text, marginBottom: 2 },
  itemSpecs: { fontSize: 12, color: Colors.light.icon },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  verifiedText: { fontSize: 11, fontWeight: '600', color: Colors.light.success },

  warningNote: {
    backgroundColor: Colors.light.highlight + '12',
    borderRadius: Radius.sm,
    padding: 12,
    marginBottom: 20,
  },
  warningNoteText: { fontSize: 12, color: Colors.light.highlight, lineHeight: 17 },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text, marginBottom: 6 },
  sectionHelp: { fontSize: 13, color: Colors.light.icon, lineHeight: 18, marginBottom: 12 },

  starRow: { marginTop: 4 },
  ratingLabelSlot: { minHeight: 26, justifyContent: 'center', marginBottom: 20 },
  ratingLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text },

  choiceRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  choiceChipWrap: { flex: 1 },
  choiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  choiceChipText: { fontSize: 13, color: Colors.light.text },

  textArea: { minHeight: 120, paddingTop: 12 },
  counter: {
    fontSize: 11,
    color: Colors.light.icon,
    textAlign: 'right',
    marginTop: -8,
    marginBottom: 20,
  },

  disclosureText: { fontSize: 12, color: Colors.light.icon, lineHeight: 18 },

  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  footerHint: { fontSize: 12, color: Colors.light.icon, textAlign: 'center', marginTop: 8 },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyActionWrap: { marginTop: Spacing.md, width: 200, alignSelf: 'center' },
});
