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
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

// PlainCo's Firestore is in asia-southeast1, and this function reads
// several documents before it writes anything, so it belongs in the same
// region — a function in one region talking to a database in another pays
// a full round trip on every one of those reads.
//
// It was first deployed to us-central1, which was the SDK default rather
// than a considered choice, and every read in the transaction below
// crossed the Pacific. Moving it here also matters for the email triggers
// in emails.js, which have no choice at all: a v2 Firestore trigger must
// live in the database's region or the deploy is rejected.
//
// The matching region in firebaseConfig.js must change with this one, or
// the client calls an endpoint where nothing is deployed and reports a
// bare "not-found" that says nothing about regions.
const REGION = 'asia-southeast1';

// The only methods the checkout picker offers. Validated here rather than
// trusted, because paymentMethod is stored on the order and read back by
// AdminOrdersScreen — an unrecognised value would render as "Not
// specified" forever with no way to tell what was meant.
const PAYMENT_METHODS = ['gcash', 'maya', 'card', 'cod'];

// THE SANDBOX GATEWAY, server side.
//
// Everything about the simulation is here rather than in the app, for one
// reason: the app may ASK for an outcome but must not be able to impose
// one. A sandbox where the client says "paid" and the server writes it
// down is not a payment step, it is a spelling of `paymentStatus: 'paid'`
// with extra screens — and it would be indistinguishable from the bug
// this whole file exists to prevent.
//
// So the request carries a scenario id and nothing else. This function
// decides what that scenario means, and the decision happens INSIDE the
// order transaction, after the total is computed from the catalogue. A
// refusal therefore aborts the transaction: no order document, no stock
// decrement, nothing to clean up. That is the whole reason the gateway
// runs here and not in a second callable after the order exists — an
// authorise-then-capture split would leave a written order and spent
// stock to unwind every time a demo declines a payment.
//
// NO NETWORK CALL IS MADE. There is no gateway account behind this and no
// card number is accepted anywhere in the app; see constants/payment.js.
const SANDBOX_DECLINES = {
  declined: 'Your payment was declined. Try another payment method.',
  insufficient_funds: 'There was not enough balance to cover this order.',
  timeout: 'The payment gateway did not respond. Your order was not placed and you were not charged.',
};
const SANDBOX_OUTCOMES = ['approved', ...Object.keys(SANDBOX_DECLINES)];

// Mirrors isPayOnDelivery() in constants/payment.js. Duplicated rather
// than imported because functions/ is a separate package with its own
// node_modules and does not share the app's module graph — the two are
// one line each and a drift here is caught by test-checkout.mjs.
const isPayOnDelivery = (method) => method === 'cod';

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

// RATE LIMITING, and why this function has any.
//
// A callable is a public HTTPS endpoint. Requiring auth stops anonymous
// traffic but not a script holding one real account's credentials, and
// nothing here can tell that script apart from the app — that is exactly
// the gap Firebase App Check exists to close, and App Check is not
// available on this stack (no React Native build of @firebase/app-check;
// see TODO.md). So the endpoint is reachable by anything that can sign in.
//
// What that buys an attacker is not a stolen product but an emptied shop:
// every accepted order decrements real stock, and a Cash-on-Delivery order
// costs the person placing it nothing at all. A loop could book the entire
// catalogue to a fake address in seconds, leaving the store to discover
// its inventory was gone and every order fraudulent.
//
// Eight attempts per ten minutes is far above what a person does — placing
// two orders in a sitting is already unusual — and far below what makes
// scripted abuse worthwhile.
const RATE_LIMIT_MAX_ATTEMPTS = 8;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

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

// The whole decision, as arithmetic — no Firestore, no clock of its own,
// no I/O. Pulled out of the transaction below so it can be tested
// directly: window rollover and the boundary between the last allowed
// attempt and the first refused one are exactly the parts that are easy to
// get wrong by one and impossible to observe through a transaction without
// waiting ten real minutes.
//
// Returns the new counter state when the attempt is allowed, or how long
// to wait when it is not.
function rateLimitDecision(windowStartedAtMs, storedAttempts, now) {
  const windowIsOpen = now - windowStartedAtMs < RATE_LIMIT_WINDOW_MS;
  // A closed window is indistinguishable from never having attempted:
  // both start a fresh count from zero at the current instant.
  const attempts = windowIsOpen ? storedAttempts : 0;

  if (attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    return {
      allowed: false,
      // Floors at one second so a caller is never told to wait zero and
      // invited to retry immediately.
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowStartedAtMs + RATE_LIMIT_WINDOW_MS - now) / 1000)
      ),
    };
  }

  return {
    allowed: true,
    nextAttempts: attempts + 1,
    // A refusal never reaches here, which is the point: the window start
    // is only ever advanced by an ALLOWED attempt opening a new one. A
    // caller who keeps hammering after being refused cannot push their own
    // unlock further away, so an impatient customer tapping twice does not
    // convert a rate limit into an escalating lockout.
    windowStartedAtMs: windowIsOpen ? windowStartedAtMs : now,
  };
}

// Counts an attempt against the caller's window and refuses once the
// window is full.
//
// COUNTS ATTEMPTS, NOT ORDERS, and runs in its OWN transaction rather than
// inside the order's. That combination is the whole design, and the
// obvious-looking alternative is broken: fold this into the order
// transaction and a refused order rolls the counter back with it, so an
// attacker loops forever on a deliberately out-of-stock item at zero cost
// while every read and write still happens. Quota has to be spent on the
// attempt, whatever becomes of it.
//
// The cost is real and is accepted: a shopper whose order legitimately
// fails — an item sold out between opening the cart and confirming — burns
// quota too. At eight per ten minutes there is ample room to fix a cart
// and retry, and the alternative leaves the door open.
//
// A fixed window, not a sliding one. A sliding window means storing a
// timestamp per attempt and pruning on read; a fixed window is two fields
// and one transaction. What that concedes is a burst across a boundary —
// up to sixteen attempts spanning two adjacent windows — which is well
// inside what this is meant to stop.
//
// rateLimits/{uid} has NO rule in firestore.rules, and that file has no
// catch-all match, so no client can read or reset its own counter. Only
// the Admin SDK reaches it. RATE-1 in scripts/test-rules.mjs pins that,
// because a permissive rule added here later would quietly undo all of it.
async function countAttemptAgainstRateLimit(uid) {
  const ref = db.collection('rateLimits').doc(uid);
  // The function instance's own clock. Skew between instances is
  // irrelevant at ten-minute granularity, and serverTimestamp() cannot be
  // used for the comparison below — it is a sentinel, not a value, and
  // reads back as null within the transaction that writes it.
  const now = Date.now();

  const retryAfterSeconds = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.exists ? snapshot.data() : null;

    const decision = rateLimitDecision(
      data?.windowStartedAt?.toMillis?.() ?? 0,
      data?.attempts || 0,
      now
    );

    if (!decision.allowed) return decision.retryAfterSeconds;

    tx.set(ref, {
      attempts: decision.nextAttempts,
      windowStartedAt: Timestamp.fromMillis(decision.windowStartedAtMs),
      // Not read by anything here. Written so that someone looking at this
      // collection while investigating abuse can see when it last happened
      // without decoding the window arithmetic.
      lastAttemptAt: FieldValue.serverTimestamp(),
    });
    return 0;
  });

  if (retryAfterSeconds > 0) {
    throw new HttpsError(
      'resource-exhausted',
      'Too many order attempts. Please wait a moment and try again.',
      { reason: 'rate-limited', retryAfterSeconds }
    );
  }
}

// Named rather than inline so scripts/test-checkout.mjs can call it with a
// plain object instead of a constructed callable request. What it does —
// price from the catalogue, decrement stock, write the order, clear the
// cart, all in one transaction — is the most consequential logic in the
// project and should not need a deployed endpoint to exercise.
async function handlePlaceOrder(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Please sign in to place an order.');
  }

  const lines = normaliseLines(request.data?.items);

  const paymentMethod = request.data?.paymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', 'Choose a payment method.');
  }

  // COD never goes through the sandbox, so a scenario sent alongside it is
  // a confused client rather than a harmless extra — refused rather than
  // ignored, so the mistake surfaces in testing instead of leaving an
  // order that looks authorised and was not.
  const sandboxOutcome = request.data?.sandboxOutcome;
  if (isPayOnDelivery(paymentMethod)) {
    if (sandboxOutcome !== undefined && sandboxOutcome !== null) {
      throw new HttpsError('invalid-argument', 'Cash on Delivery is not paid online.');
    }
  } else if (!SANDBOX_OUTCOMES.includes(sandboxOutcome)) {
    throw new HttpsError('invalid-argument', 'Complete the payment step before placing your order.');
  }

  // Placed here on purpose: AFTER the shape checks above, BEFORE the
  // transaction below.
  //
  // After, because a malformed payload is rejected by normaliseLines()
  // without touching Firestore at all — flooding with junk already costs
  // the attacker more than it costs us, and spending a transactional write
  // to record each one would invert that.
  //
  // Before, because everything past this point is the expensive part: a
  // multi-document read, a stock decrement, an order write. The limit
  // exists to keep a flood away from exactly that.
  await countAttemptAgainstRateLimit(uid);

  const quantityByProductId = totalQuantityByProductId(lines);
  const productIds = [...quantityByProductId.keys()];

  // ONE CHECKOUT, ONE ORDER PER STORE. Each store's manager owns the status
  // of their own order — two managers sharing one status field would mean
  // neither owns it, and cancelling one store's half would have to restore
  // stock the other store still means to ship.
  //
  // Refs are allocated here, before the transaction, for the same reason
  // the payment reference is derived from an id rather than generated:
  // the callback may run more than once, and the ids the customer is shown
  // must be the ids finally written. A cart never spans more stores than it
  // has lines, so MAX_LINE_ITEMS bounds this too. Refs that go unused (the
  // cart spans fewer stores) cost nothing — nothing is written to them.
  const ordersRef = db.collection('users').doc(uid).collection('orders');
  const orderRefPool = productIds.map(() => ordersRef.doc());

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

      // A product with no store has no one to fulfil it, and no manager
      // could ever move its order past 'pending'. Refused as unavailable,
      // the same as a product that has stopped existing — the fix is the
      // migration script, not a guess at which store should ship it.
      if (typeof data.storeId !== 'string' || data.storeId === '') {
        missing.push(productId);
        return;
      }
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

      priceByProductId.set(productId, {
        price, stock: available, name: data.name || '', imageUrl: data.imageUrl || null,
        storeId: data.storeId,
      });
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

    // Store names, for the order and the customer's confirmation. Still in
    // the read phase — no write has happened yet. A store document that is
    // missing does not refuse the order: the product's storeId is what
    // assigns ownership, and the name is only a label.
    const storeIds = [...new Set([...priceByProductId.values()].map((p) => p.storeId))];
    const storeSnaps = await tx.getAll(...storeIds.map((id) => db.collection('stores').doc(id)));
    const storeNameById = new Map(
      storeSnaps.map((snap, i) => [storeIds[i], (snap.exists && snap.data().name) || ''])
    );

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
        storeId: product.storeId,
      };
    });

    // Grouped in the order each store first appears in the cart, so the
    // confirmation lists stores the way the customer added them.
    const groups = [];
    for (const item of items) {
      let group = groups.find((g) => g.storeId === item.storeId);
      if (!group) {
        group = { storeId: item.storeId, storeName: storeNameById.get(item.storeId), items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    for (const [index, group] of groups.entries()) {
      group.orderRef = orderRefPool[index];
      group.subtotal = round2(group.items.reduce((sum, item) => sum + item.price * item.quantity, 0));
      // Per order, because each store ships its own parcel. Zero today;
      // when shipping costs something this is where per-store rates go.
      group.shipping = SHIPPING_FEE;
      group.total = round2(group.subtotal + group.shipping);
    }

    const subtotal = round2(groups.reduce((sum, g) => sum + g.subtotal, 0));
    const shipping = round2(groups.reduce((sum, g) => sum + g.shipping, 0));
    const total = round2(subtotal + shipping);

    // Links the orders one checkout produced. The first order's id, which
    // is fixed before the transaction opens and so stable across retries.
    const checkoutId = groups[0].orderRef.id;

    // THE AUTHORISATION, and note where it sits: after the total is known
    // from the catalogue, before the first write. A gateway cannot charge
    // an amount nobody has computed yet, and a refusal must not leave a
    // half-placed order behind — this is the only point that satisfies
    // both.
    //
    // Throwing here aborts the transaction, so the stock decrements below
    // and the order document never happen. The customer is told what the
    // gateway said and their cart is untouched, which is what makes
    // retrying with a different method work.
    if (!isPayOnDelivery(paymentMethod) && sandboxOutcome !== 'approved') {
      throw new HttpsError('failed-precondition', SANDBOX_DECLINES[sandboxOutcome], {
        reason: 'payment-declined',
        outcome: sandboxOutcome,
        amount: total,
      });
    }

    // Derived from the order id rather than generated randomly, because a
    // Firestore transaction may run its callback more than once under
    // contention and a fresh random value each time would mean the
    // reference printed on the confirmation is not the one finally
    // written. The id is fixed before the transaction opens, so this is
    // stable across retries.
    //
    // ONE payment for the whole checkout, whatever the number of stores:
    // the customer authorised one amount, once. Every order it produced
    // carries the same reference, which is how a store reconciles its
    // share against the gateway.
    const paymentRef = isPayOnDelivery(paymentMethod)
      ? null
      : `SBX-${checkoutId.slice(0, 10).toUpperCase()}`;

    // Writes start here.
    for (let index = 0; index < productIds.length; index += 1) {
      const productId = productIds[index];
      const { stock } = priceByProductId.get(productId);
      // Written as a number regardless of how it was stored, which quietly
      // migrates a legacy string-typed product the first time it sells.
      tx.update(productRefs[index], { stock: stock - quantityByProductId.get(productId) });
    }

    // What every order from this checkout shares. The per-store part —
    // lines, money, store — is added for each group below.
    const sharedOrderData = {
      customerId: uid,
      customerEmail: request.auth.token?.email || userData.email || 'unknown',
      checkoutId,
      paymentMethod,
      // 'unpaid' for COD is the resting state, not a failure — the rider
      // collects on arrival. A declined online payment never reaches this
      // point at all, so 'failed' is deliberately not written here; see
      // constants/payment.js for why the word exists anyway.
      paymentStatus: isPayOnDelivery(paymentMethod) ? 'unpaid' : 'paid',
      paymentRef,
      // Stamped on every order an online method produced, so nothing that
      // reads this collection later — a report, an export, a person
      // scrolling the admin dashboard — can mistake a simulated
      // authorisation for a real one.
      paymentSandbox: !isPayOnDelivery(paymentMethod),
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

    for (const group of groups) {
      tx.set(group.orderRef, {
        ...sharedOrderData,
        // Which store fulfils this order. The rules let only that store's
        // manager move its status — see managesStore() on orders.
        storeId: group.storeId,
        // A snapshot, like the line names and prices: the order records
        // who sold it at the time, and a later rename does not rewrite
        // history. Also saves every order list a read per row.
        storeName: group.storeName,
        items: group.items,
        // Denormalised because rules cannot read a field out of each map
        // in a list, and the reviews rule needs to answer "is this product
        // on this order?" to accept a verified purchase. Per order, so a
        // review is tied to the store that actually sold the item.
        productIds: [...new Set(group.items.map((item) => item.productId))],
        subtotal: group.subtotal,
        shipping: group.shipping,
        total: group.total,
      });
    }

    // Clear the cart lines this order consumed. Buy Now lines carry no
    // cartItemId and are correctly skipped.
    for (const line of lines) {
      if (!line.cartItemId) continue;
      tx.delete(db.collection('users').doc(uid).collection('cart').doc(line.cartItemId));
    }

    // Returned to the client so the confirmation screen can render without
    // a follow-up read. createdAt is deliberately absent — it is a
    // sentinel at this point, not a date.
    //
    // subtotal, shipping and total are for the WHOLE checkout — what the
    // customer paid, or will pay the rider. `orders` breaks that down by
    // store, each with the order number that store will know it by.
    return {
      checkoutId,
      orders: groups.map((group) => ({
        orderId: group.orderRef.id,
        storeId: group.storeId,
        storeName: group.storeName,
        items: group.items,
        subtotal: group.subtotal,
        shipping: group.shipping,
        total: group.total,
      })),
      items,
      subtotal,
      shipping,
      total,
      paymentMethod,
      paymentStatus: sharedOrderData.paymentStatus,
      paymentRef,
      paymentSandbox: sharedOrderData.paymentSandbox,
      shippingAddress: sharedOrderData.shippingAddress,
    };
  });

  return placed;
}

exports.placeOrder = onCall({ region: REGION }, handlePlaceOrder);

// Exported for scripts/test-checkout.mjs. A plain function, so the
// Firebase CLI's export-walking discovery ignores it and it deploys
// nothing.
exports._handlePlaceOrder = handlePlaceOrder;

// Transactional email lives in its own module — the triggers there share
// nothing with placeOrder except the region, and folding an SMTP transport
// into the file that handles money would make both harder to read.
//
// Re-exported here because the Firebase CLI discovers functions by loading
// this entry point and walking its exports; a trigger defined in a file
// nothing requires is a file that never deploys.
const { sendOrderConfirmation, notifySupportRequest, retryMail } = require('./emails');

exports.sendOrderConfirmation = sendOrderConfirmation;
exports.notifySupportRequest = notifySupportRequest;
// A callable rather than a trigger, and the only one of the three a person
// invokes directly — AdminMailLogScreen's "Send again" button. It takes a
// mailLog entry id and re-derives the recipient from the source document,
// so it cannot be aimed at an address; see the note above it in emails.js.
exports.retryMail = retryMail;

// Exported for scripts/test-rate-limit.mjs. The Firebase CLI discovers
// functions by walking this module's exports and ignores a plain function,
// so this deploys nothing.
exports._rateLimitDecision = rateLimitDecision;
exports._RATE_LIMIT = { RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_MS };
