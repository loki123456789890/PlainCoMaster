// utils/orderNumber.js
//
// The short, human order number shown instead of a raw Firestore document
// id, in one place.
//
// This was written out FOUR times — OrderConfirmationScreen,
// OrderDetailsScreen, AdminOrdersScreen, and functions/mailer.js — and two
// of those copies carried a comment saying they matched the others, which
// is the surest sign of something about to drift.
//
// It had already drifted. AdminOrdersScreen's copy has no "#" and no guard
// for a missing id, because it stores the bare value and prefixes the hash
// at each of its six render sites — it needs the unprefixed form to search
// against. That is a real requirement, not a mistake, so both shapes are
// exported here rather than forcing one on everybody.
//
// WHY IT MATTERS MORE THAN THE USUAL DUPLICATION ARGUMENT: this is the one
// string a customer reads off a screen (or an email) and quotes to support,
// who then types it into AdminOrdersScreen's search box. The whole value of
// the number is that it is character-for-character identical in all four
// places. A copy that drifts by a character does not look broken anywhere —
// it just quietly stops matching, and the failure surfaces as a customer
// insisting an order exists while a manager cannot find it.
//
// functions/mailer.js is the one copy that CANNOT import this: functions/
// is a separate CommonJS package with its own dependency tree, and this is
// an ESM module in the app package. Its copy is marked as such and must be
// changed in step with this file.

// Firestore auto-ids are 20 characters of mixed case. Eight is short
// enough to read aloud over the phone and long enough that a collision
// within one store's order history is not a practical concern.
export const ORDER_NUMBER_LENGTH = 8;

// The bare number, for storing and searching: "ABCDEF12".
//
// Returns an empty string rather than a dash for a missing id, because the
// callers of this form are comparing and filtering, and a dash would be a
// value that could match a search.
export const orderNumber = (id) =>
  (id ? String(id).slice(0, ORDER_NUMBER_LENGTH).toUpperCase() : '');

// The display form, for showing to a person: "#ABCDEF12".
//
// An em dash for a missing id, matching how the rest of the app renders an
// absent value rather than printing a bare "#".
export const formatOrderNumber = (id) => (id ? `#${orderNumber(id)}` : '—');

// Cleans up a number as a HUMAN typed or pasted it, for matching against
// the stored bare form.
//
// This exists because the two forms above meet in one place and did not
// agree there. AdminOrdersScreen stores the bare "ABCDEF12" and searches
// it with a plain substring match — but every place a customer SEES their
// number shows "#ABCDEF12", hash included, on a line deliberately made
// selectable so it can be copied rather than transcribed. So the most
// likely thing anyone pastes into that search box is the one string it
// could not match, and the result was silence rather than an error.
//
// Strips leading hashes and surrounding whitespace (a copy-paste routinely
// brings a trailing space) and upper-cases, since the stored form is
// upper-case. Everything else is left alone: this normalises a formatting
// convention, it does not try to guess at typos.
export const normalizeOrderNumberQuery = (query) =>
  String(query ?? '').trim().replace(/^#+/, '').toUpperCase();
