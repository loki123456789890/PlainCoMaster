# SRS Update Notes — PlainCo

What changed in the system and therefore needs changing in the SRS.
Organised by the SRS section it affects. Written to be pasted or
paraphrased into the document.

Companion files: [ROLES.md](ROLES.md) (full detail),
[SRS_AUDIT.md](SRS_AUDIT.md) (what was out of sync, and what's now fixed).

---

## 1. User characteristics / Scope — THREE roles, not two

The single "admin" role has been split into two **non-overlapping** roles.
Neither is a superset of the other; they are siblings, not a hierarchy.

| Stored value | Called | Can do | Cannot do |
|---|---|---|---|
| `customer` (or field absent) | Customer | Browse every store, order from several at once, favourite, submit support requests, review items they have received | Reach any staff screen |
| `seller` | **Store Manager** | **One store's** products, orders, support requests, review moderation | Read or modify user accounts, or anything of another store |
| `platformAdmin` | **Platform Admin** | User accounts: grant roles, activate/deactivate; open stores and assign their managers; answer general questions not about an order | Any store's products, orders, order questions, reviews |

Suggested wording:

> PlainCo defines three user roles. Customers browse, purchase from one
> or more stores, and may review items they have received. Each Store
> Manager operates one store — its products, orders, support requests,
> and review moderation — and cannot see any other store's. Platform
> Admins manage user accounts and roles, open stores, and answer general
> questions that are not about an order. The two staff roles are
> deliberately non-overlapping: a Store Manager has no access to user
> accounts, and a Platform Admin has no access to store data. This
> separation is enforced by Cloud Firestore security rules, not merely by
> hiding screens in the interface.

Anywhere the SRS says "admin", decide which of the two it means and say
that instead. The word "admin" alone is now ambiguous. Likewise "the
store": PlainCo has several now (section 10).

---

## 2. Authentication — one staff login, role-based routing

- Staff sign in through a single **Staff Portal**. The account's role
  decides the destination: Store Manager → dashboard, Platform Admin →
  Manage Users.
- The customer login **rejects staff accounts** and redirects them to the
  Staff Portal.
- Deactivated accounts (`isActive: false`) are refused at staff sign-in.

---

## 3. Staff account provisioning — NEW, previously undocumented

The SRS never stated where staff accounts come from. It should.

> Staff accounts are **granted, never self-registered.** There is no staff
> signup. A prospective staff member registers as an ordinary customer,
> and an existing Platform Admin then assigns them the Store Manager or
> Platform Admin role from the Manage Users screen.
>
> This is enforced, not conventional: security rules forbid the `role` and
> `isActive` fields from being set when a user document is created, so no
> account can be registered with a privileged role at any value. The only
> code path that can write `role` is a Platform Admin's update, and that
> path cannot target the Platform Admin's own document.
>
> The first Platform Admin is established by hand in the Firebase console.
> This is a one-time act and the system's root of trust, in the same way
> the first administrator of any permission system is created
> out-of-band.

Why there is no "create account" form, if asked: a client application
cannot create another person's Firebase Auth account —
`createUserWithEmailAndPassword` signs the *caller* in as the new user.
Doing it on someone's behalf requires the Firebase Admin SDK running
server-side, which this project does not use. Promotion also has a
security advantage: the staff member sets and owns their own password, so
it is never known to or transmitted by the Platform Admin.

---

## 4. Security — data type enforcement is now real (SRS Security, p.29)

The SRS already claims "strict data type enforcement on the backend."
Previously the only type check in the rules was the numeric comparison
guarding the checkout stock decrement. It is now implemented across every
writable collection:

- **`users` create** — exact key allowlist, string types, length caps,
  `uid` bound to the authenticated caller, and `role`/`isActive` excluded
  entirely.
- **`products` create** — exact key allowlist, types, non-empty name,
  non-negative price and stock, list types for colours and sizes,
  server-set `createdAt`. **Updates** are validated against the resulting
  document.
- **`supportRequests` create** — exact key allowlist, non-empty message
  capped at 2000 characters, `status` forced to `open`. Staff updates are
  confined to the `status` field only.
- **`orders` create** — no client may create an order at all. Orders are
  written only by the server (the `placeOrder` Cloud Function), which
  prices the cart from the database, deducts stock, and always writes
  `status: 'pending'`, one order per store (section 10). See section 9
  for why "no order can arrive already Delivered" matters more than it
  looks.
- **`orders` update** — only by the Store Manager of the order's own
  store, confined to the `status` field, restricted to the five known
  statuses, and the transition to `cancelled` is allowed only
  from `pending` or `processing`. See section 4a.
- **`reviews` create** — exact key allowlist, `userId` bound to the
  caller, `rating` an integer 1–5, `matchedDescription` a boolean, text
  capped at 1000 characters, `hidden` forced to `false`, server-set
  `createdAt`, and the document id required to match the `orderId` and
  `productId` inside it, and `storeId` required to match the order's
  store. Updates are split into two disjoint branches: the author may
  revise rating, answer, and text and nothing else; the selling store's
  manager may set `hidden` and nothing else. No role may delete. See
  section 9.
- **Activity log collections** — see section 5.

### 4a. Order cancellation restores stock

Checkout decrements product stock in an atomic transaction. Cancelling an
order is now the mirror of it: each line's quantity is added back to its
product's stock **in the same transaction that writes the new status**, so
the two either both land or neither does.

- **Which orders may be cancelled** — `pending` and `processing` only. Past
  that point the goods are with the courier or the customer, and restoring
  stock would invent inventory that doesn't physically exist; a returned
  parcel is a returns flow, not a cancellation. The staff status picker
  disables the Cancelled option for those orders rather than letting a
  manager pick a choice the backend will refuse.
- **No double-restoration** — `cancelled` is not itself a permitted source
  status, so a second cancellation is refused. This is enforced in the
  rules, not just the client, so a double tap, a stale screen, and two
  managers racing each other all land on the same denial. Because the stock
  restore is atomic with the status write, a refused transition rolls the
  restore back with it.
- **No product-rule loosening was needed.** A Store Manager could already
  write stock through the existing seller branch (that is what Edit Product
  does), and the result still has to be a well-typed, non-negative number.
  The customer branch is untouched and still admits decrements only.

**Honest limitation, stated here because the rules cannot close it:**
Firestore evaluates each write in a transaction independently, against its
own document. A rule on `products/{productId}` has no view of the sibling
order write, so "this increment must equal the quantity on the order being
cancelled" is not expressible in rules. It is enforced by the two
properties that are: the transaction computes the amount from the order's
own line items (never from client input), and the order rule admits at most
one `pending`/`processing` → `cancelled` transition per order. What remains
outside that fence — a Store Manager setting stock directly through Edit
Product — is a granted power of the role, recorded in the activity log.
Closing it would require a server-side trigger (Cloud Functions), the same
boundary section 5 draws for the audit log.

**Recommended qualification to add**, because it is more accurate than the
current claim:

> Type and length enforcement bounds what can be stored but does not
> sanitise markup. The cross-site scripting risk described here is a
> web-application concern that does not transfer directly to React Native:
> text is rendered through `<Text>` components, which never interpret
> HTML, so stored markup has no execution path in this application.

---

## 5. Audit functions — now implemented (SRS Constraint 2.4.5)

The SRS asks for logs of user activities (product updates and order
transactions) to help store managers monitor operations. Previously no
such logging existed. It now does, in two collections split along the
same line as the roles:

| Collection | Written by | Records | Readable by |
|---|---|---|---|
| `activityLogs` | Store Manager | Product create / edit / delete, order status changes, review moderation — per store | That store's Store Manager |
| `accountLogs` | Platform Admin | Role grants, account activation / deactivation | Platform Admin |

Both are surfaced in a single Activity screen that selects its collection
from the signed-in role. Store Managers open it from a dashboard tile;
Platform Admins from Manage Users.

Security rules enforce four properties on every entry:

1. **Append-only** — creation is the only permitted write, for every role.
   No entry can be edited or deleted, including by its own author.
2. **Truthful attribution** — the recorded actor must be the
   authenticated caller.
3. **Honest timestamps** — the timestamp must be the server's, so entries
   cannot be back- or post-dated.
4. **Fixed shape** — exactly seven fields, with length caps.

**State this limitation explicitly in the SRS:**

> Log entries are written by the client immediately after the action they
> describe. Security rules can guarantee that an entry is well-formed,
> correctly attributed, and never altered, but cannot compel a modified
> client to write one. This is therefore an operational activity log for
> monitoring, as this document specifies, and not a tamper-proof audit
> trail for dispute resolution. Producing the latter would require
> server-side database triggers.

---

## 6. Account deactivation — add the sole-admin consideration

Existing behaviour is unchanged: accounts are deactivated
(`isActive: false`), never deleted, so completed sales remain auditable
(SRS §2.4). Worth adding:

> Because only a Platform Admin can restore an account, the last active
> Platform Admin is a single point of failure: if that account is lost,
> account management cannot be recovered from within the application.
> Security rules prevent a Platform Admin from deactivating themselves
> through the Manage Users screen, and the interface warns whenever only
> one active Platform Admin exists. **The operational requirement is to
> maintain at least two active Platform Admin accounts.**

---

## 7. New screen to add to the module list

**Activity Log screen** — one screen serving both staff roles, showing
each its own log (Store Activity or Account Activity). Includes search and
a chronological list with actor and timestamp.

**Write a Review screen** (customer) — reached from a delivered order,
one review per item on that order. See section 9.

**Reviews screen** (Store Manager) — the moderation queue for their own
store, opening on the reviews that reported an item did not match its
description. See section 9.

**Store page** (customer) — one store's catalogue with its profile and
seller rating, opened from the Shop's "Shop by store" row or a product's
"Sold by" line. Technically the Shop screen narrowed to one store rather
than a separate screen. See section 10.

**Stores in Edit User** (Platform Admin) — not a new screen: choosing
Store Manager in Edit User now also asks which store, with "Open a new
store". See section 10.

---

## 8. Verification — worth a short section if the SRS has one

The security rules have an automated test suite: **114 tests** run against
the Firestore emulator via `npm run test:rules`. Coverage includes
privilege escalation attempts, role separation in both directions, field
validation, checkout stock rules, order cancellation, audit log
integrity, order creation, the verified-purchase chain behind reviews,
and store separation (section 10).
Notable cases:

- A signup cannot set a privileged role.
- A customer cannot promote themselves or anyone else.
- A Store Manager cannot read user accounts.
- A Platform Admin cannot modify products or read orders.
- Cancelling an order restores its stock; cancelling it twice does not.
- Cancelling a shipped or delivered order is rejected outright.
- Log entries cannot be forged, backdated, edited, or deleted.
- An order cannot be created already marked Delivered.
- A product that was not on the order cannot be reviewed through it.
- A review cannot be written against another customer's order.
- A Store Manager may hide a review but cannot edit or delete one.
- A Store Manager cannot read, change or cancel another store's products
  or orders, and cannot move a product to another store.
- A review must name the store that sold the item.
- A support request goes to the store of the order it names, or to the
  Platform Admin, and the rules check that routing against the order.

---

## 9. Reviews and seller ratings — from panel feedback

A panellist asked for "reviews for seller and customer". PlainCo now has
the first of those and deliberately not the second.

**How the answer changed.** When reviews were first built PlainCo was a
single store, and this section said so: a seller rating would have been
one number with nothing to compare it against, so the feature was built
as product reviews only. PlainCo is now multi-store (section 10), which is
what the title always described — "Ukay-Ukay and Ready-to-Wear *Stores*".
With several stores a seller rating finally carries information, so it has
been added. It is built from the same product reviews rather than from a
separate form; see "Seller ratings" below.

**Customer ratings are still declined.** A store accepts every order, so a
rating of buyers would feed no decision any store makes, while publishing
reputation data about consumers. If the SRS needs a sentence:

> PlainCo does not rate customers. Stores accept every order, so a buyer
> rating would inform no decision, and it would publish reputation data
> about private individuals.

Suggested wording for the feature:

> Customers may review a product they have purchased, once the order
> containing it has been marked Delivered. A review records a 1–5 star
> rating, an answer to "did the item match its description?", and optional
> free text. Reviews are visible to all signed-in users on the product
> page. Each review is filed with the store that sold the item, and a
> store's seller rating is the summary of those reviews: its average
> rating, how many reviews it has, and the share of buyers who said the
> item matched its description. The seller rating is shown on the store's
> page, beside the store in the Shop, and under "Sold by" on each of its
> products.

**The verified-purchase chain.** "Verified" is enforced in
`firestore.rules`, not asserted by the interface, and it is a chain of
four links:

1. Orders are created only by the server (the `placeOrder` Cloud
   Function), always in status `'pending'`. No client can create an order
   at all, so none can create one that arrives already Delivered.
2. Only the Store Manager of the store that sold an order may move it to
   `'delivered'`.
3. A review is accepted only against the author's **own** order, in status
   `'delivered'`, containing the product being reviewed.
4. The review must name the store on that order. A review cannot be filed
   against a different store's rating.

Without link 1, a client could mint its own proof of purchase and review
any product it named. Without link 4, a buyer from one store could lower
another store's rating.

**One review per order line** is structural rather than conventional: the
review's document id is derived as `orderId_productId` and the rule
requires it to match the fields inside, so a duplicate is a write to a
document that already exists. Buying the same item again on a later order
earns a second review, which is correct.

**Seller ratings.** There is no "rate this seller" form. A store's rating
is its product reviews summarised, which gives it three properties a
separate seller review would not have:

- **Only real buyers count.** Every review behind it passed the chain
  above, so every one is from a delivered order from that store.
- **One store's record never leans on another's.** Each review carries
  the store that sold the item, checked against the order.
- **It is recent, and says so.** The rating is computed from the store's
  most recent 100 reviews. Once a store has more than that, the app says
  "last 100 reviews" rather than implying that is the full history.

The average is shown with its review count beside it, so a perfect score
from one review cannot pass for a perfect score from a hundred.

**The ukay-ukay problem, and why "did it match the description?" exists.**
Secondhand pieces are frequently one of a kind — stock 1, sold once — so a
per-product average is a permanent sample of one, and most product pages
would read "No reviews yet" forever. "Did it match the description?" is
the same question about every listing a store makes, so it aggregates
across the store and says something useful about an item nobody has
reviewed yet. A product with no reviews of its own shows **its seller's**
figure instead of an empty state ("Across Tindahan ni Lola's 12 reviews,
92% said the item matched its description"). It is the seller's figure
and not the whole platform's, because one store's honesty about condition
says nothing about another's.

**Moderation is hiding, never deletion.** Only the Store Manager of the
store that sold the item may set a review's `hidden` flag, and nothing
else — the rules grant no delete on reviews to any role, no write to a
review's rating or text, and no moderation to other stores or to the
Platform Admin. Hidden reviews are left out of the seller rating, and the
rating updates immediately when one is hidden or restored. This mirrors
the existing decision that accounts are deactivated rather than deleted
(SRS §2.4), and for the same reason: a store that can erase reviews can
erase the unflattering ones, and no reader could tell a clean record from
a cleaned one. Every hide and restore is written to that store's activity
log.

State this plainly in the SRS, since it is the obvious objection: a store
can hide reviews of its own items, and hiding does lift its rating. What
the design guarantees is that the review itself survives unaltered, and
that every hide is recorded under the manager's name in the store's
activity log. Taking moderation away from the store — to the Platform
Admin, say — is the stronger answer, and a reasonable future change.

**Privacy.** A review displays the author's first name and last initial
("Hans V."), abbreviated at write time so the full name is never stored in
a document other shoppers can read.

**Honest limitations:**

- Ratings are computed on the device from the reviews themselves, not
  stored as counters on the product or store. A server-side trigger
  maintaining those counters is the production answer; the project now has
  Cloud Functions, so it is buildable, but it has not been built. A
  client-maintained counter would be tamperable, so none is kept.
- Firestore rules cannot inspect a query's filters, so a hidden review is
  still fetchable by a client querying the collection directly. The app
  leaves hidden reviews out of every list and every rating it shows, and
  the rules guarantee that hiding is the only moderation available and
  that it is logged.
- Orders placed before reviews existed carry no `productIds` field, and
  their lines cannot be reviewed. Failing in that direction is deliberate:
  the alternative would make the check optional for any write that
  omitted the field.

### 9a. New use case — Write a Review

For the SRS's use-case section, in the same shape as the existing entries:

> **Use case:** Write a Review
> **Actor:** Customer
> **Precondition:** The customer is signed in, and an order belonging to
> them containing the item has status Delivered.
> **Trigger:** The customer opens the order under My Orders and selects
> "Write a review" on one of its items.
>
> **Main flow:**
> 1. The system displays the purchased item, marked Verified purchase.
> 2. The customer selects a rating of 1 to 5 stars.
> 3. The customer answers whether the item matched its description.
> 4. The customer optionally writes up to 1000 characters of detail.
> 5. The customer submits.
> 6. The system stores the review, filed with the store that sold the
>    item, and confirms.
>
> **Postcondition:** The review is visible on the product page to all
> signed-in users, attributed to the author's first name and last initial,
> and counts toward the selling store's seller rating. The order line now
> offers "Edit your review" instead.
>
> **Alternate flows:**
> - *Already reviewed* — the form opens pre-filled with the existing
>   review and submitting replaces it, rather than refusing the customer a
>   second attempt to say something more useful.
> - *Incomplete* — submission stays disabled until both the rating and the
>   description question are answered; the free text is optional. The
>   button states which of the two is still missing.
> - *Rejected by the backend* — the customer is told reviews are limited to
>   items from a delivered order, in those terms rather than as a
>   permissions error.
> - *Offline* — submission is refused with the app's standard
>   no-connection message and nothing is written.

**Note on step 3.** The description question is a required answer with no
default, and "not yet answered" is held distinct from "no" in the
interface. A field this central must not be able to record a complaint the
customer never made by leaving it untouched.

There is no separate use case for seller ratings: nobody writes one. It is
a display that follows from Write a Review, and belongs in the Browse
Products / View Store description (section 10).

### 9b. Data model — one new collection, one changed field

**New collection: `reviews/{orderId}_{productId}`.** The document id is
derived rather than random; see the note on one review per order line
above.

| Field | Type | Notes |
|---|---|---|
| `orderId` | string | The delivered order the review was earned on. Immutable after creation. |
| `productId` | string | The item reviewed. Immutable after creation. |
| `storeId` | string | The store that sold the item. Must equal the order's `storeId`; immutable. What the seller rating is grouped by. |
| `productName` | string ≤ 120 | Snapshot at write time — a product can be renamed after the sale. |
| `userId` | string | The author. Bound to the authenticated caller; immutable. |
| `userName` | string ≤ 60 | First name and last initial. Snapshot, because `/users` is unreadable to other shoppers. |
| `rating` | integer 1–5 | Whole stars only. |
| `matchedDescription` | boolean | "Did the item match its description?" |
| `text` | string ≤ 1000 | Optional free text. |
| `hidden` | boolean | Moderation flag. Always `false` at creation; only the selling store's manager may change it. |
| `createdAt` | timestamp | Server-set; cannot be backdated. |
| `updatedAt` | timestamp | Present only on a revised review. Server-set. |

**Changed collection: `orders`** — one field added for reviews (the
multi-store fields are in section 10).

| Field | Type | Notes |
|---|---|---|
| `productIds` | array of string | The flat list of product ids appearing in `items[]`. |

This is denormalised rather than derived because Firestore security rules
cannot read a field out of each map in a list, so "is this product on this
order?" is unanswerable against `items[]` alone. The review rule needs
exactly that question answered, and membership of a flat array is the only
form the rules language can evaluate. It duplicates data already present
in `items[]`, and that duplication is the price of making the check
enforceable on the backend rather than trusting the client.

---

## 10. Multi-store — NEW, from panel feedback

The title promises an e-commerce app "for Ukay-Ukay and Ready-to-Wear
**Stores**", plural, and a panellist asked for it. PlainCo is now
multi-store: several stores sell through one app, each run by its own
Store Manager, and a shopper can buy from several in one checkout.

> **Status (22 Sep 2026):** built and tested on the `feature/multi-store`
> branch, and deliberately kept out of the UAT build, which is still
> single-store. Sections 9 and 10 describe the system **after** that
> branch ships. Do not paste them into the SRS used for the UAT.

**Replace every sentence in the SRS that says PlainCo is a single store.**
Earlier drafts of these notes said so in writing (the old section 9); the
phrases to look for are "the store", "one store", and "the seller".

Suggested wording for the scope:

> PlainCo is a multi-store platform. Independent ukay-ukay and
> ready-to-wear stores each list and sell their own products through one
> shared app. Each store is run by a Store Manager, who manages that
> store's products, orders, customer questions and reviews, and cannot see
> or change any other store's. A Platform Admin opens stores and assigns
> their managers. Customers browse all stores together or one store at a
> time, and may buy from several stores in a single checkout.

### What changed, by SRS area

**Roles (section 1).** A Store Manager now runs **one** store, named on
their account, rather than "the shop". The Platform Admin additionally
opens stores and answers general questions that are not about any store's
order. Both are still enforced in `firestore.rules`, not by hiding
screens.

**Opening a store.** Stores are opened by a Platform Admin, from the same
Edit User form that makes someone a Store Manager: choose Store Manager,
then pick an existing store or "Open a new store" and name it. The store
and its first manager are saved in one write, so there is never a store
without a manager or a manager without a store. There is **no vendor
self-signup**, for the same reason there is no staff signup (section 3).
Stores can be renamed, never deleted, because products and past orders
point at them.

**Products.** Every product belongs to the store that listed it. A Store
Manager can add, edit, restock and delete only their own store's
products, and a product cannot be moved to another store.

**Browsing (customer).** The Shop lists every store's products together,
each marked with its store, and has a "Shop by store" row showing each
store with its item count and seller rating. Tapping a store opens its
page: the same catalogue narrowed to that store, with search and filters,
and a short profile — what it sells (Ukay-Ukay, Ready-to-Wear or both,
worked out from its own listings), when it joined PlainCo, and its seller
rating. Every product page says "Sold by" and links to its store.

**Checkout: one order per store.** A cart holding items from several
stores checks out once, with one payment, and becomes **one order per
store**. This is what lets each store see and fulfil only its own part.
The split is done on the server by the `placeOrder` Cloud Function in a
single transaction:

- Every store's order is written, and every item's stock deducted, or
  nothing is. One store being short on stock stops the whole checkout,
  rather than charging the customer for half a cart.
- A declined payment writes nothing for any store.
- The orders share a checkout reference, and one payment covers them all.
- The confirmation screen and the email receipt name the store beside
  each order number, and list each store's items separately.
- Shipping is currently free and is recorded per store's order, so per-
  store shipping rates can be added later without changing the order
  shape.

Suggested addition to the Checkout use case:

> **Alternate flow — items from several stores:** the system places one
> order per store, each with its own order number, under a single payment.
> If any item is out of stock, no order is placed for any store.

**Orders (staff).** A Store Manager sees only their own store's orders,
and only they may change an order's status or cancel it. Cancelling
restores stock only to their own store's products (section 4a is
unchanged otherwise). The customer still sees all their orders together,
each labelled with its store.

**Support: routed by order.** The Help form asks "Is this about an
order?" and lists the customer's recent orders. A question about an order
goes to **that order's store**. A general question goes to the
**Platform Admin**, who answers it from an "Open questions" card in Manage
Users. The rules check that the order named really is the customer's and
really belongs to that store, so a question cannot be routed into another
store's inbox. Email notifications and "Send again" follow the same
routing.

Suggested wording:

> Customers may attach a support request to one of their orders, in which
> case it is delivered to the store that fulfilled that order. Requests
> not about an order are delivered to the Platform Admin.

**Reviews and ratings.** Section 9.

**Audit (section 5).** The store activity log is kept per store: each
entry records its store, and a Store Manager reads only their own store's
entries. The account log is unchanged.

### Data model changes

**New collection: `stores/{storeId}`.**

| Field | Type | Notes |
|---|---|---|
| `name` | string, 1–60 | Shown to shoppers. Only a Platform Admin may set or change it. |
| `createdAt` | timestamp | Server-set. Shown as "On PlainCo since". |

**New field `storeId` on existing collections.**

| Collection | Meaning | Rule |
|---|---|---|
| `users` | The store a Store Manager runs | Required for a Store Manager, absent for everyone else; set only by a Platform Admin. |
| `products` | The store that listed it | Must be the listing manager's own store; cannot change afterwards. |
| `orders` | The store fulfilling this order (also `storeName`, and `checkoutId` linking orders paid together) | Written by the server at checkout. |
| `reviews` | The store that sold the item | Must equal the order's store. |
| `activityLogs` | The store the entry is about | Must be the writer's own store. |
| `supportRequests` | The store the question is for, or `null` for the Platform Admin | Checked against the named order. |
| `mailLog` | The same routing as the request or order it is about | Written by the server. |

**Existing data.** Accounts, products and orders created before stores
existed have no `storeId`, and the rules leave them untouched rather than
guess an owner. A one-time script (`scripts/migrate-to-stores.mjs`)
assigns them to a first store. It shows what it will change before it
changes anything, and running it twice changes nothing the second time.

### Out of scope, and worth saying so in the SRS

Payouts to stores, platform commissions, vendor self-signup and per-store
shipping rates. Those make PlainCo a marketplace to *operate* rather than
one to *demonstrate*, and each is a business decision as much as a
technical one. Suggested wording:

> Payment is collected by the platform on behalf of all stores. Settlement
> between the platform and individual stores, commissions, and store
> self-registration are outside the scope of this project.

### Verification

Every rule above is covered by the automated rules test suite (section
8), including: a manager cannot change, cancel or read another store's
products, orders or activity log; a product cannot be moved between
stores; only a Platform Admin can open a store, and stores cannot be
deleted; a review must name the store that sold the item, and another
store cannot hide it; and a support request is routed by its order, and
cannot be moved into another store's inbox. The checkout tests cover the
split: a two-store cart becomes one order per store under one payment,
and a decline, or one store being short on stock, writes nothing for
either store.

---

## 11. Still outstanding — SRS-side only, no code changes needed

From [SRS_AUDIT.md](SRS_AUDIT.md). Category A (things the SRS promised
that the app didn't do) is now empty. These remain, and are all
documentation gaps:

**Category B — the app does it, the SRS doesn't mention it**
- Password reset by email (a full flow exists; the SRS documents only
  registration and login/logout).
- A Store Manager can set an order status of "Cancelled", which restores
  the stock checkout decremented, and is permitted only from Pending or
  Processing. See section 4a — the SRS documents neither the restoration
  nor the restriction.
- The Help screen offers four contact channels, a common-issues picker,
  an app-share action, and published support hours, beyond the
  "searchable FAQ" the SRS describes.

**Category C — both mention it, but describe it differently**
- Signup postcondition: the SRS says the user is redirected to the login
  page; the app signs them in and goes to Home, because account creation
  authenticates them automatically.
- "Out of Stock notification": the app disables the Add to Cart button
  and shows a badge rather than displaying a message.
- "Invalid Quantity" error: quantity is a stepper with a disabled
  decrement, so zero or negative input is structurally impossible and the
  error branch the SRS describes cannot occur.
- Order status vocabulary differs between the staff view (five statuses)
  and the customer view (pending and processing collapsed into one).

Note also that the SRS's own audit report keeps the *original* findings
alongside the resolutions, so the historical text describes the system as
it was, not as it is.
