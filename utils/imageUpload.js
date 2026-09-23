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
import * as ImagePicker from 'expo-image-picker';
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

// What the file extension says it is, for when the picker reports no
// mimeType of its own — which it does not always do.
//
// HEIC and HEIF are mapped deliberately, even though they are refused a
// moment later: naming them is what lets them be REFUSED rather than
// falling past an empty type into the JPEG default further down. An
// unknown type relabelled as JPEG passes storage.rules, because the rule
// checks the contentType the client declares and not the bytes behind it
// — so the relabelling was the one path that could put a HEIC in the
// bucket under a name that makes it look fine on the iPhone that uploaded
// it and broken on every Android.
const EXTENSION_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

function mimeTypeFromUri(uri) {
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri || '');
  return match ? EXTENSION_MIME[match[1].toLowerCase()] || '' : '';
}

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
 * @param {string} [options.mimeType]  the picker's own reported type, which
 *   is more trustworthy than the blob's — see the note at the fallback below
 * @param {string} [options.folder]  where in the bucket it goes — must be a
 *   path storage.rules has a match for, or the upload is refused
 * @returns {Promise<{success: boolean, url?: string, path?: string, error?: string}>}
 */
export function uploadProductImage(uri, options = {}) {
  return uploadImage(uri, { ...options, folder: PRODUCT_IMAGE_PATH });
}

export async function uploadImage(uri, { onProgress, mimeType: declaredType, folder } = {}) {
  if (!folder) return { success: false, error: 'no-folder' };
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

    // Preference order: what the picker declared, then what the file
    // extension says, then what the blob reports. The picker's own
    // mimeType is the most reliable, and blob.type comes back empty for
    // some URI schemes on both platforms, which is why the extension sits
    // between them rather than last.
    const candidate = declaredType || mimeTypeFromUri(uri) || blob.type || '';

    // A type we can name and do not accept is refused outright. It used to
    // fall through to the JPEG default below, which put the wrong label on
    // real bytes: storage.rules checks the declared contentType, so a HEIC
    // called image/jpeg is stored happily and then fails to render for
    // every Android customer. Refusing costs the manager one message;
    // relabelling costs them a photo that looks right to them and is
    // broken for half the shop.
    if (candidate && !ACCEPTED_MIME.test(candidate)) {
      return { success: false, error: 'unsupported-format' };
    }

    // Only a genuinely unidentifiable type still defaults to JPEG, which is
    // what PICKER_OPTIONS forces the picker to produce.
    const mimeType = ACCEPTED_MIME.test(candidate) ? candidate : 'image/jpeg';

    const path = `${folder}/${generateImageName(mimeType)}`;
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

// Picker options shared by both sources.
//
// `quality` and `allowsEditing` are not cosmetic here — they are what
// forces iOS to re-encode to JPEG. iOS shoots HEIC by default, which
// React Native's Image renders on iOS and NOT on Android, so a HEIC
// upload would look correct to the manager who made it and be broken for
// half the customers. storage.rules refuses the type outright, so without
// this the upload would simply fail on an iPhone.
//
// 0.7 rather than 1: the whole file is read into memory as a blob (see
// uploadProductImage), the manager is usually on mobile data, and every
// byte uploaded is a byte a shopper downloads later. A square crop also
// matches how the catalog grid and product page already frame photos.
const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  quality: 0.7,
  allowsEditing: true,
  aspect: [1, 1],
};

// Chat photos keep the re-encode but not the square crop: a photo of a
// stain or a torn seam is framed by whoever took it, not by the catalog.
export const CHAT_PICKER_OPTIONS = {
  mediaTypes: ['images'],
  quality: 0.7,
  allowsEditing: true,
};

/**
 * Pick a product photo and upload it in one step.
 *
 * Returns the same { success, url, path, error } shape as
 * uploadProductImage, plus `cancelled: true` when the manager backed out
 * of the picker — which is not a failure and must not be reported as one.
 *
 * @param {object} [options]
 * @param {'library'|'camera'} [options.source]
 * @param {(progress: number) => void} [options.onProgress]  0..1
 */
export function pickAndUploadProductImage(options = {}) {
  return pickAndUploadImage({ ...options, folder: PRODUCT_IMAGE_PATH, pickerOptions: PICKER_OPTIONS });
}

export async function pickAndUploadImage({
  source = 'library',
  onProgress,
  folder,
  pickerOptions = PICKER_OPTIONS,
} = {}) {
  try {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    // Distinguished from a generic failure because the remedy is
    // different and lives outside the app: the caller tells them to grant
    // it in Settings rather than to try again.
    if (!permission.granted) {
      return { success: false, error: 'permission-denied' };
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (result.canceled) return { success: false, cancelled: true };

    const asset = result.assets?.[0];
    if (!asset?.uri) return { success: false, error: 'no-asset' };

    // Belt and braces over PICKER_OPTIONS above: if a platform ever hands
    // back a type the app cannot render, refuse it here with something a
    // manager can act on rather than letting storage.rules reject it
    // after the upload has already spent their data.
    // Falls back to the extension for the same reason uploadProductImage
    // does: asset.mimeType is not always populated, and this check is only
    // worth having if it still fires when that happens.
    const assetType = asset.mimeType || mimeTypeFromUri(asset.uri);
    if (assetType && !ACCEPTED_MIME.test(assetType)) {
      return { success: false, error: 'unsupported-format' };
    }

    return uploadImage(asset.uri, { onProgress, mimeType: assetType, folder });
  } catch (error) {
    console.error('Error picking product image:', error?.code, error?.message);
    return { success: false, error: error?.code || 'picker-failed' };
  }
}

// Turns any of the above failure codes into something worth showing a
// Store Manager. Centralised so both product screens say the same thing
// about the same failure, rather than drifting into two vocabularies for
// one set of outcomes.
export function uploadErrorMessage(code) {
  switch (code) {
    case 'permission-denied':
      return 'PlainCo needs permission to use your photos or camera. You can grant it in your device Settings.';
    case 'too-large':
      return 'That photo is too large. Please choose one under 5 MB.';
    case 'unsupported-format':
      return 'That image format isn’t supported. Please use a JPEG, PNG, or WebP.';
    case 'storage/unauthorized':
      return 'Your account doesn’t have permission to upload product photos. Check with a Platform Admin that your Store Manager access is still active.';
    case 'storage/retry-limit-exceeded':
      return 'The upload timed out. Please check your connection and try again.';
    default:
      return 'Could not upload that photo. Please try again.';
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
