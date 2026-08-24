// utils/stock.js
//
// Stock arithmetic shared by the two halves of the inventory ledger:
// CheckoutScreen decrements stock when an order is placed, AdminOrdersScreen
// restores it when that order is cancelled. Those two have to agree exactly
// on how a stored stock value is read and how per-product quantities are
// totalled, or a cancellation could restore a different number than checkout
// took away — so both live here rather than being written twice.

// Some products still have "stock" stored as a string, left over from before
// AdminAddProductScreen/AdminEditProductScreen started saving it as a number.
// Parsed defensively so old and new data both work; anything unparseable
// reads as 0, which is the safe direction for a decrement and a no-op floor
// for a restore.
export const parseStock = (stock) => {
  const parsed = parseInt(stock, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

// The SAME parse, with the opposite answer for unusable input, and a
// different name so the two can never be confused at a call site.
//
// parseStock() above is for ARITHMETIC — how many units to take or give
// back — where an unreadable value has to floor at 0 or a decrement
// invents inventory. This one is for a LIMIT — how high a quantity
// stepper may go — where 0 is the wrong answer in the other direction:
// it pins the stepper at 1 for exactly the products least likely to have
// had inventory entered. null means "no limit known", which callers
// treat as unlimited.
//
// Both existed already; this one was a private copy inside Cartscreen
// under the name parseStock, so two functions with one name returned
// opposite values for the same input. Productscreen keeps its own inline
// handling because it needs the third distinction as well — whether
// stock is KNOWN, which is what separates "out of stock" from "not
// recorded" for the badge it renders.
export const parseStockLimit = (stock) => {
  const parsed = parseInt(stock, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

// Totals quantity per product id across a list of line items.
//
// A single product can legitimately appear as SEVERAL lines in one order —
// the same shirt in two sizes is two cart lines (see CartContext.addToCart,
// which never dedupes). Both stock paths therefore have to work per unique
// product using the combined quantity:
//
//   - on checkout, because two lines could each pass a stock check
//     individually while together exceeding what's in stock;
//   - on cancellation, because two transaction.update() calls against the
//     same product doc would silently drop one of them (last write wins),
//     restoring only part of what was taken.
//
// `getProductId` differs between the two callers: cart lines carry the
// product id in `productId` alongside their own cart-doc `id`, while a
// stored order line has only `productId`.
//
// A missing or unusable quantity counts as 1 — the same `item.quantity || 1`
// default CheckoutScreen applies when it writes the line onto the order. The
// two must agree: if the decrement treated a quantity-less line as 1, the
// restore has to give back 1, not 0.
export const totalQuantityByProductId = (items, getProductId) => {
  const totals = new Map();
  (items || []).forEach((item) => {
    const productId = getProductId(item);
    if (!productId) return;
    const parsed = Number(item.quantity);
    const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    totals.set(productId, (totals.get(productId) || 0) + quantity);
  });
  return totals;
};
