// functions/index.js
//
// PlainCo's first server-side code, and it exists to close two holes that
// security rules provably cannot.
//
// WHY RULES ARE NOT ENOUGH, since every other guarantee in this project is
// enforced in firestore.rules and that has been the right call until now:
//
//   1. ORDER TOTALS. The order create rule can check that `total` is a
//      non-negative number. It cannot check that the number is CORRECT,
//      because verifying it means reading every product in the order and
//      multiplying — and rules cannot loop over a list of maps. So a
//      modified client could place an order for real goods at any price it
//      liked, including zero.
//
//   2. THE STOCK DECREMENT. The customer branch on products/{id} permits
//      any signed-in, active user to lower any product's stock, as long as
//      stock is the only field changed and the new value is smaller. That
//      is what let CheckoutScreen decrement atomically — but rules cannot
//      tie the write to an order, so nothing stopped a script from walking
//      the catalog and setting every product to zero.
//
// Both dissolve the same way: the client stops writing orders and stock at
// all, and asks the server to do it. The server reads prices from the
// product documents rather than trusting the request, so the total is a
// fact about the catalog instead of a claim by the caller.
//
// WHAT THE CLIENT SENDS, and what it deliberately does NOT: it sends
// product ids, quantities, and the chosen size/colour — the things only the
// customer knows. It does not send prices, the subtotal, the total, or the
// delivery address. Every one of those is looked up here. A field the
// client cannot supply is a field the client cannot forge.
//
// DEPLOY ORDER MATTERS. This function has to be live and working before
// firestore.rules is tightened to remove the client's order-create and
// stock-decrement permissions. Tighten first and checkout breaks with no
// fallback; deploy this first and the two paths simply coexist for a while.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// Should match the region Firestore lives in — a function in one region
// talking to a database in another pays a round trip on every read, and
// this one does several before it writes anything. us-central1 is the
// default rather than a considered choice; change it to match the project's
// actual Firestore location, and change the matching region in
// firebaseConfig.js at the same time or the client will call an endpoint
// that does not exist.
const REGION = 'us-central1';

// The only methods the checkout picker offers. Validated here rather than
// trusted, because paymentMethod is stored on the order and read back by
// AdminOrdersScreen — an unrecognised value would render as "Not
// specified" forever with no way to tell what was meant.
const PAYMENT_METHODS = ['gcash', 'maya', 'card', 'cod'];

// Free shipping, and now in ONE place. The client had this hardcoded in
// both Cartscreen and Checkoutscreen, which meant changing the shipping
// policy was a code deploy touching two files that had to agree. The
// server owning it is what makes a real shipping calculation — by weight,
// by province, by order value — a change to this function rather than a
// change to the app.
const SHIPPING_FEE = 0;

// Orders cannot be unbounded: a request naming ten thousand line items
// would read ten thousand documents inside one transaction. Firestore
// would refuse it eventually, but slowly and with a confusing error.
const MAX_LINE_ITEMS = 50;
const MAX_QUANTITY_PER_LINE = 99;

// Products may still store price and stock as strings, written before the
// admin forms saved them as numbers. Parsed defensively in both cases —
// and note that because this function writes with admin privileges, the
// decremented stock goes back as a real number. A legacy product therefore
// migrates itself the first time it is bought, which is the case
// CheckoutScreen currently has to refuse outright.
function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseStock(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : Math.floor(value);
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// Money is compared and stored to two decimal places. Accumulating
// floating point across many lines and then storing the raw result is how
// an order total ends up at 1049.9999999999998.
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Validates the request payload's SHAPE only. Whether the products exist,
// cost what the client thinks, or have stock is a question for the
// transaction, which is the only place those answers are trustworthy.
function normaliseLines(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpsError('invalid-argument', 'An order needs at least one item.');
  }
  if (rawItems.length > MAX_LINE_ITEMS) {
    throw new HttpsError('invalid-argument', `An order cannot have more than ${MAX_LINE_ITEMS} lines.`);
  }

  return rawItems.map((item) => {
    const productId = typeof item?.productId === 'string' ? item.productId.trim() : '';
    if (!productId) {
      throw new HttpsError('invalid-argument', 'Every line must name a product.');
    }

    const quantity = Number(item?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_LINE) {
      throw new HttpsError('invalid-argument', `Quantity for ${productId} is not a whole number between 1 and ${MAX_QUANTITY_PER_LINE}.`);
    }

    return {
      productId,
      quantity,
      // Presentational, and the only two fields taken from the client as
      // given: they record what the customer chose, and there is nothing
      // to verify them against beyond the product's own option lists.
      // Capped so a crafted request cannot store unbounded strings.
      size: typeof item?.size === 'string' ? item.size.slice(0, 40) : null,
      color: typeof item?.color === 'string' ? item.color.slice(0, 40) : null,
      // Which cart document this line came from, so the transaction can
      // clear it. Absent for a Buy Now line, which never had one.
      cartItemId: typeof item?.cartItemId === 'string' ? item.cartItemId : null,
    };
  });
}

// A product can legitimately appear on several lines of one order — the
// same shirt in two sizes is two lines, and the cart never dedupes. Stock
// therefore has to be checked and decremented per PRODUCT using the
// combined quantity, or two lines could each pass a check they fail
// together. This mirrors totalQuantityByProductId in the app's
// utils/stock.js, and the two have to agree.
function totalQuantityByProductId(lines) {
  const totals = new Map();
  for (const line of lines) {
    totals.set(line.productId, (totals.get(line.productId) || 0) + line.quantity);
  }
  return totals;
}

exports.placeOrder = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Please sign in to place an order.');
  }

  const lines = normaliseLines(request.data?.items);

  const paymentMethod = request.data?.paymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', 'Choose a payment method.');
  }

  const quantityByProductId = totalQuantityByProductId(lines);
  const productIds = [...quantityByProductId.keys()];

  const orderRef = db.collection('users').doc(uid).collection('orders').doc();

  const placed = await db.runTransaction(async (tx) => {
    // Every read first — Firestore allows no read after the first write in
    // a transaction.
    const userRef = db.collection('users').doc(uid);
    const productRefs = productIds.map((id) => db.collection('products').doc(id));
    const [userSnap, ...productSnaps] = await tx.getAll(userRef, ...productRefs);

    if (!userSnap.exists) {
      throw new HttpsError('failed-precondition', 'We could not load your account details.');
    }
    const userData = userSnap.data();

    // Same check isActiveOwner() makes in the rules. Enforced here too
    // because this function writes with admin privileges and the rules do
    // not run against it at all — everything they used to guarantee about
    // this write is now this function's responsibility.
    if (userData.isActive === false) {
      throw new HttpsError('permission-denied', 'This account has been deactivated.');
    }

    // Read from the user document rather than accepted from the request.
    // The address is the customer's own and they can edit it freely, so
    // this is not about trust so much as about there being one source of
    // truth — an order should ship where the account says, not where a
    // request claimed at a moment that may already be stale.
    const shippingAddress = userData.shippingAddress;
    if (!shippingAddress || !shippingAddress.address) {
      throw new HttpsError('failed-precondition', 'Add a delivery address before placing your order.', {
        reason: 'no-address',
      });
    }

    const priceByProductId = new Map();
    const missing = [];
    const insufficient = [];

    productSnaps.forEach((snap, index) => {
      const productId = productIds[index];
      const requested = quantityByProductId.get(productId);

      if (!snap.exists) {
        missing.push(productId);
        return;
      }

      const data = snap.data();
      const price = parsePrice(data.price);
      const stock = parseStock(data.stock);

      // An unreadable price is not "free" — it is a listing too broken to
      // sell, and guessing either direction would be worse than refusing.
      if (price === null || price < 0) {
        missing.push(productId);
        return;
      }

      // A missing or unreadable stock value is treated as none. The app
      // shows unrecorded stock to customers as unlimited, which is the
      // right call for a badge and the wrong one for a decrement.
      const available = stock === null ? 0 : stock;
      if (available < requested) {
        insufficient.push({
          productId,
          name: data.name || 'This item',
          available,
          requested,
        });
        return;
      }

      priceByProductId.set(productId, { price, stock: available, name: data.name || '', imageUrl: data.imageUrl || null });
    });

    if (missing.length > 0) {
      throw new HttpsError('failed-precondition', 'Some items are no longer available.', {
        reason: 'unavailable',
        productIds: missing,
      });
    }

    if (insufficient.length > 0) {
      throw new HttpsError('failed-precondition', 'Some items do not have enough stock.', {
        reason: 'insufficient-stock',
        items: insufficient,
      });
    }

    // THE POINT OF THIS WHOLE FUNCTION: prices come from the documents
    // just read, never from the request. The client cannot make an item
    // cost less by saying so.
    const items = lines.map((line) => {
      const product = priceByProductId.get(line.productId);
      return {
        productId: line.productId,
        name: product.name,
        price: round2(product.price),
        quantity: line.quantity,
        size: line.size,
        color: line.color,
        image: product.imageUrl,
      };
    });

    const subtotal = round2(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
    const total = round2(subtotal + SHIPPING_FEE);

    // Writes start here.
    for (let index = 0; index < productIds.length; index += 1) {
      const productId = productIds[index];
      const { stock } = priceByProductId.get(productId);
      // Written as a number regardless of how it was stored, which quietly
      // migrates a legacy string-typed product the first time it sells.
      tx.update(productRefs[index], { stock: stock - quantityByProductId.get(productId) });
    }

    const orderData = {
      customerId: uid,
      customerEmail: request.auth.token?.email || userData.email || 'unknown',
      items,
      // Denormalised because rules cannot read a field out of each map in
      // a list, and the reviews rule needs to answer "is this product on
      // this order?" to accept a verified purchase.
      productIds,
      subtotal,
      shipping: SHIPPING_FEE,
      total,
      paymentMethod,
      shippingAddress: {
        fullName: shippingAddress.fullName || '',
        phone: shippingAddress.phone || '',
        address: shippingAddress.address || '',
        city: shippingAddress.city || '',
        province: shippingAddress.province || '',
        zipCode: shippingAddress.zipCode || '',
      },
      // Pinned, exactly as the rules pinned it. 'delivered' is what the
      // reviews rule treats as proof of purchase, and only a seller may
      // move an order there.
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    };

    tx.set(orderRef, orderData);

    // Clear the cart lines this order consumed. Buy Now lines carry no
    // cartItemId and are correctly skipped.
    for (const line of lines) {
      if (!line.cartItemId) continue;
      tx.delete(db.collection('users').doc(uid).collection('cart').doc(line.cartItemId));
    }

    // Returned to the client so the confirmation screen can render without
    // a follow-up read. createdAt is deliberately absent — it is a
    // sentinel at this point, not a date.
    return {
      orderId: orderRef.id,
      items,
      subtotal,
      shipping: SHIPPING_FEE,
      total,
      paymentMethod,
      shippingAddress: orderData.shippingAddress,
    };
  });

  return placed;
});
