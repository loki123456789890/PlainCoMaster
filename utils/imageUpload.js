// utils/imageUpload.js
//
// Uploading a product photo to Cloud Storage and getting back the URL that
// goes into a product's `imageUrl` field.
//
// Deliberately NO schema change: the download URL is a string and lands in
// the same `imageUrl` field a pasted URL always did. That matters because
// isNewProductShape() in firestore.rules allowlists an exact key set, and
// productFieldsAreWellTyped() caps imageUrl at 2000 characters — a
// Firebase download URL runs about 150, so both rules keep applying
// unchanged. Products created before this existed keep working, and a
// manager who would rather paste a URL still can.
//
// Shaped like the rest of the app's async helpers (ProductContext,
// CartContext): resolves to { success, ... } rather than throwing, so call
// sites branch instead of wrapping every call in try/catch.
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../firebaseConfig';

export const PRODUCT_IMAGE_PATH = 'products';

// Matches the cap in storage.rules. Kept here so the client can refuse an
// oversized file with a useful message instead of letting the upload run
// and fail server-side — the same reason REVIEW_TEXT_MAX lives beside the
// composer in utils/reviews.js rather than only in the rules.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Also matches storage.rules. HEIC is absent on purpose: iOS shoots it by
// default, React Native's Image renders it on iOS and not on Android, so
// accepting it would let a manager upload a photo that looks correct on
// their own phone and is broken for half the customers.
export const ACCEPTED_MIME = /^image\/(jpeg|png|webp)$/;

// Storage has no auto-id the way Firestore's doc() does, so object names
// are generated here. Time-prefixed so the bucket sorts chronologically
// when someone browses it in the console, with a random suffix because two
// managers uploading in the same millisecond is not worth a collision.
function generateImageName(mimeType) {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${random}.${extension}`;
}

/**
 * Upload a local image URI and resolve to its public download URL.
 *
 * @param {string} uri        local file URI from the image picker
 * @param {object} [options]
 * @param {(progress: number) => void} [options.onProgress]  0..1
 * @returns {Promise<{success: boolean, url?: string, path?: string, error?: string}>}
 */
export async function uploadProductImage(uri, { onProgress } = {}) {
  if (!uri) return { success: false, error: 'no-uri' };

  try {
    // React Native has no File object, so the local URI is read through
    // fetch() and handed over as a blob. This is the standard RN path and
    // the reason the whole file is bytes-in-memory rather than streamed —
    // acceptable because the picker has already compressed to well under
    // MAX_IMAGE_BYTES by the time it gets here.
    const response = await fetch(uri);
    const blob = await response.blob();

    // Checked before the upload starts rather than after it fails: on
    // mobile data, spending a manager's bandwidth on a file the rules will
    // reject at the end is the worst possible order to find out.
    if (blob.size > MAX_IMAGE_BYTES) {
      return { success: false, error: 'too-large' };
    }

    // blob.type can come back empty for some URI schemes, in which case
    // the picker's own JPEG output is the safe assumption — storage.rules
    // is the authority either way and will refuse anything else.
    const mimeType = ACCEPTED_MIME.test(blob.type || '') ? blob.type : 'image/jpeg';

    const path = `${PRODUCT_IMAGE_PATH}/${generateImageName(mimeType)}`;
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, blob, { contentType: mimeType });

    await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snapshot) => {
          if (!onProgress || !snapshot.totalBytes) return;
          onProgress(snapshot.bytesTransferred / snapshot.totalBytes);
        },
        reject,
        resolve
      );
    });

    const url = await getDownloadURL(task.snapshot.ref);
    return { success: true, url, path };
  } catch (error) {
    console.error('Error uploading product image:', error?.code, error?.message);
    // storage/unauthorized is what a non-seller (or a deactivated one)
    // gets back, and it is the one failure here that is not worth telling
    // someone to retry — same reasoning as the unsellable-listing branch
    // in Checkoutscreen.
    return { success: false, error: error?.code || 'upload-failed' };
  }
}

/**
 * Remove a previously uploaded object.
 *
 * Best-effort by design, and never surfaced as a failure of whatever
 * prompted it: an orphaned object costs storage, while a product edit that
 * refuses to save because a stale photo could not be deleted costs the
 * manager their work. Note nothing calls this automatically on replace —
 * see the note in storage.rules about why reaping orphans is a
 * server-side job rather than something the client should pretend to do.
 */
export async function deleteProductImage(path) {
  if (!path) return { success: false, error: 'no-path' };
  try {
    await deleteObject(ref(storage, path));
    return { success: true };
  } catch (error) {
    console.error('Could not delete product image:', error?.code, error?.message);
    return { success: false, error: error?.code || 'delete-failed' };
  }
}
