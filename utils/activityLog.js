// utils/activityLog.js
//
// Activity logging for privileged actions (SRS Constraint 2.4.5, "Audit
// Functions"): product updates and order transactions for the Store
// Manager, role and status changes for the Platform Admin.
//
// Two collections, matching the two role domains — see the block comment
// above activityLogs in firestore.rules for why a single collection with a
// "domain" field cannot work under Firestore's read rules.
//
// These writes are FIRE-AND-FORGET by design. A log entry describes an
// action that has already succeeded, so failing to record it must never
// surface as a failure of the action itself: a seller who successfully
// edited a product should not be told the edit failed because a log write
// was refused offline. Every function here resolves rather than rejects,
// and the caller is not expected to await it.
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

export const STORE_ACTIVITY = 'activityLogs';
export const ACCOUNT_ACTIVITY = 'accountLogs';

// Action identifiers. Kept short and dotted so they group naturally when
// read as a list, and centralised so the log view can map them to icons
// without matching on free text.
export const ACTIONS = {
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
  ORDER_STATUS: 'order.status',
  // One action for hide and unhide alike: the summary says which way it
  // went, and splitting them would imply the two are different kinds of
  // event when they are the same decision revisited.
  REVIEW_MODERATED: 'review.moderated',
  USER_ROLE: 'user.role',
  USER_STATUS: 'user.status',
};

async function write(collectionName, { action, targetId, targetLabel, summary }, extra = {}) {
  const user = auth.currentUser;
  // No signed-in user means no attributable actor, and firestore.rules
  // would refuse the write anyway (actorId must equal request.auth.uid).
  if (!user) return;

  try {
    await addDoc(collection(db, collectionName), {
      action,
      actorId: user.uid,
      actorEmail: user.email || 'unknown',
      targetId: targetId || '',
      // Trimmed to the rules' limits rather than left to be rejected
      // server-side: a product name long enough to breach 120 characters
      // is a reason to shorten the label, not to lose the whole entry.
      targetLabel: (targetLabel || '').slice(0, 120),
      summary: (summary || '').slice(0, 200),
      // Must be serverTimestamp(): the rules require createdAt to equal
      // request.time, so a client-supplied date is rejected outright.
      createdAt: serverTimestamp(),
      ...extra,
    });
  } catch (error) {
    // Deliberately swallowed — see the fire-and-forget note above. Logged
    // to the console so a developer can still see it during development.
    console.error(`Could not write ${collectionName} entry (${action}):`, error?.code, error?.message);
  }
}

// Store operations — products and orders. Written by a seller, and
// stamped with the store it happened in: each manager reads only their own
// store's log, and firestore.rules refuses an entry for any other store.
// No store means no entry, rather than one the rules would refuse.
export function logStoreActivity({ storeId, ...entry }) {
  if (!storeId) {
    console.error(`Not logging ${entry.action}: no store assigned to this account`);
    return Promise.resolve();
  }
  return write(STORE_ACTIVITY, entry, { storeId });
}

// Account management — roles and activation. Written by a platformAdmin.
export function logAccountActivity(entry) {
  return write(ACCOUNT_ACTIVITY, entry);
}
