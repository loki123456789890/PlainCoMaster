// utils/reviews.js
//
// Shared vocabulary for product reviews. Everything that more than one
// review surface needs to agree on lives here — the document id, the shape
// a review doc is read into, and the summary arithmetic — because those are
// exactly the three things that go quietly wrong when each screen rolls its
// own copy.
//
// SCOPE NOTE, since "reviews" usually means something broader: a review is
// always about ONE PRODUCT, written by someone whose own order containing
// it reached 'delivered'. It also names the store that sold it, and a
// store's seller rating is those reviews summarised (useStoreRatings in
// context/StoreContext.js) — there is no separate "rate the seller" form.
// There is no customer rating (see the /reviews block in firestore.rules).
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebaseConfig';

export const REVIEWS_COLLECTION = 'reviews';

// Matches the cap in firestore.rules. Kept here so the composer can count
// down against the same number the backend will reject on, rather than
// letting a customer type 1,400 characters and then lose them to a denial.
export const REVIEW_TEXT_MAX = 1000;

export const MIN_RATING = 1;
export const MAX_RATING = 5;

// How many reviews a store's seller rating is computed from. Bounded
// on purpose: this is a phone on mobile data, and the number it produces
// ("9 in 10 said the item matched") is a recent-behaviour signal, not a
// lifetime statistic. A store's first hundred reviews and its last hundred
// are different claims, and the recent one is the useful one.
export const STORE_SUMMARY_LIMIT = 100;

// Below this, a percentage is more noise than signal — one unhappy buyer
// out of two reads as "50% of customers", which is true and useless. The
// summary surfaces the raw count instead until there are enough to average.
export const MIN_REVIEWS_FOR_PERCENT = 3;

// The document id is derived rather than random, and firestore.rules
// requires it to match the orderId/productId fields inside — that is what
// makes "one review per order line" a structural fact instead of a
// client-side promise. Buying the same product again on a later order
// produces a different id, and so earns a second review.
export function reviewDocId(orderId, productId) {
  return `${orderId}_${productId}`;
}

// Firestore snapshot -> the shape every review surface renders. Defaults
// are applied here so no screen has to defend against a partially written
// document a second time.
export function mapReviewDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    orderId: data.orderId || '',
    productId: data.productId || '',
    productName: data.productName || '',
    userId: data.userId || '',
    userName: data.userName || 'PlainCo shopper',
    rating: Number(data.rating) || 0,
    // Compared to true rather than coerced: this field is the whole point
    // of the feature, and a missing one must not quietly become "did not
    // match the description" on a review that never said so.
    matchedDescription: data.matchedDescription === true,
    text: data.text || '',
    hidden: data.hidden === true,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : null,
  };
}

// Moderation is a `hidden` flag rather than a delete (firestore.rules keeps
// the document), so every customer-facing list has to filter. Centralised
// so "we forgot to filter on this one screen" isn't a way for hidden
// content to reappear.
export function visibleReviews(reviews) {
  return reviews.filter((review) => !review.hidden);
}

// One product's reviews. Deliberately NOT combined with orderBy(createdAt)
// in the query: an equality filter plus an order-by on a different field
// needs a composite index, which would mean the reviews section renders an
// error until someone opens the Firebase console. Sorting a handful of
// documents on the client costs nothing and keeps the feature deployable
// with the rules alone.
export function productReviewsQuery(productId) {
  return query(collection(db, REVIEWS_COLLECTION), where('productId', '==', productId));
}

// One store's reviews, newest first — the Store Manager's moderation
// queue, and the sample behind the store's seller rating. Each review names the store that sold the item (checked against
// the order by firestore.rules), and only that store may hide it. Unlike
// the query above this one needs a composite index, (storeId,
// createdAt desc), declared in firestore.indexes.json.
export function storeReviewsQuery(storeId, max = STORE_SUMMARY_LIMIT) {
  return query(
    collection(db, REVIEWS_COLLECTION),
    where('storeId', '==', storeId),
    orderBy('createdAt', 'desc'),
    limit(max)
  );
}

export function sortByNewest(reviews) {
  return [...reviews].sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
}

/**
 * The arithmetic every summary on every screen shares.
 *
 * `matchedPercent` is the number that carries this feature for ukay-ukay.
 * Secondhand items are frequently one-of-a-kind — stock 1, sold once, so a
 * per-product average is a sample of one forever. "Did it match the
 * description?" is the same question about every item in the store, so it
 * aggregates store-wide and is meaningful from the first handful of
 * reviews, which is exactly when a per-product average is not.
 *
 * Returns nulls rather than zeros for the derived figures when there is
 * nothing to derive from: 0.0 stars and 0% are real, alarming claims, and a
 * product nobody has reviewed has made neither.
 */
export function summarizeReviews(reviews) {
  const list = visibleReviews(reviews);
  const count = list.length;
  if (count === 0) {
    return { count: 0, average: null, matchedCount: 0, matchedPercent: null };
  }

  const total = list.reduce((sum, review) => sum + review.rating, 0);
  const matchedCount = list.filter((review) => review.matchedDescription).length;

  return {
    count,
    average: total / count,
    matchedCount,
    // Withheld below the floor for the same reason as above — a percentage
    // computed from two reviews describes those two people, not the store.
    matchedPercent:
      count >= MIN_REVIEWS_FOR_PERCENT ? Math.round((matchedCount / count) * 100) : null,
  };
}

// "4.3" but "5" — a trailing ".0" on a perfect score reads like a
// measurement rather than a verdict.
export function formatAverage(average) {
  if (average === null || average === undefined) return '';
  return Number.isInteger(average) ? String(average) : average.toFixed(1);
}

// Plain-spoken over promotional, per PRODUCT.md: no "⭐ 4.8 EXCELLENT"
// banner grammar. The sentence states what buyers reported and stops.
export function matchedDescriptionSentence(summary) {
  if (!summary || summary.count === 0) return '';
  if (summary.matchedPercent === null) {
    const { matchedCount, count } = summary;
    return `${matchedCount} of ${count} said the item matched its description.`;
  }
  return `${summary.matchedPercent}% said the item matched its description.`;
}

// A review is public to every signed-in shopper, so the name attached to
// it is published data about a real person. Full legal names are more than
// the reader needs to trust the review — "Hans V." carries the same weight
// as "Hans Rafael Villanueva" and discloses less. Applied at write time
// rather than at render, so the full name is never stored in a document
// anyone can read in the first place.
//
// Single-word names are left alone: "Mia" abbreviates to nothing useful,
// and an initial-only display would read as a redaction rather than a
// courtesy.
export function publicDisplayName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PlainCo shopper';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

export function reviewCountLabel(count) {
  if (count === 0) return 'No reviews yet';
  return count === 1 ? '1 review' : `${count} reviews`;
}

// The order-level half of the review rule: status 'delivered'. The rule
// also requires the product to appear in the order's own productIds, and
// that half is per-line rather than per-order, so it is checked at the call
// site against order.productIds (see OrderDetailsScreen). Both halves are
// evaluated before the row renders, so the button is offered in precisely
// the cases the backend will accept — orders placed before productIds
// existed fall out there rather than at submit time, which is the
// difference between a button that isn't there and a button that fails.
export function isOrderReviewable(order) {
  return (order?.status || '').toLowerCase() === 'delivered';
}
