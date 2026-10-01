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

**Order Chat screen** (customer and Store Manager) — one conversation per
order, opened from Order Details ("Message \<store\>") or Manage Orders
("Message Buyer"). See section 11.

**Store Profile screen** (Store Manager) — the store's logo and
description, from a new dashboard tile. See section 12.

---

## 8. Verification — worth a short section if the SRS has one

The security rules have an automated test suite: **130 tests** run against
the Firestore emulator via `npm run test:rules`. Coverage includes
privilege escalation attempts, role separation in both directions, field
validation, checkout stock rules, order cancellation, audit log
integrity, order creation, the verified-purchase chain behind reviews,
store separation (section 10), order chat (section 11) and profiles
(section 12).
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
- Only an order's customer and its store can read or send in its chat;
  a message cannot be deleted, edited after 15 minutes, or sent in
  someone else's name.

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

> **Status (23 Sep 2026): LIVE.** Kept out of the UAT build on purpose,
> and released to production after the UAT: indexes, data migration,
> rules, Cloud Functions and the web app, in that order. Sections 9 and 10
> describe the system as deployed. The UAT itself was run on the
> single-store build, so any SRS text describing *what was tested in the
> UAT* should still say single store.
>
> **The live stores.** The catalogue that existed before the release was
> split by product type into two stores, named after common Filipino
> shop names rather than the app:
>
> | Store | Sells | Manager |
> |---|---|---|
> | Ukay-Ukay ni Aling Nena | the 7 ukay-ukay listings | the three original Store Managers |
> | Divisoria RTW Hub | the 8 ready-to-wear listings | estes@gmail.com |
>
> Past orders went with their items: an order of only ready-to-wear
> pieces moved to Divisoria RTW Hub, and every other order stayed with
> Ukay-Ukay ni Aling Nena. Done by a one-time script
> (`scripts/split-stores.mjs`), which shows what it will change before
> changing it and is safe to run twice.

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

## 11. Order chat — NEW, added after the UAT

Before this, a customer could send a store a support request, and the
store could only mark it resolved; any reply happened outside the app.
Order chat closes that gap, modelled on the buyer–seller chat in TikTok
Shop and on Messenger's message actions. It suits secondhand stock in
particular: every ukay-ukay piece is one of a kind, so a seller can send
a photo of the exact item before it ships, and a buyer can show how it
arrived.

> **Status (23 Sep 2026):** built and tested; security rules deployed to
> production. The screens reach the live web app and the APK with the
> next release (version 1.1.0, build 2).

### Scope — suggested wording

> Each order has a private conversation between the customer who placed
> it and the Store Manager of the store fulfilling it. Either party may
> send text and photos. Messages appear in real time while the
> conversation is open, and both order lists mark orders that have an
> unread message. A participant may react to any message with one of six
> emoji, reply to a specific message, copy a message's text, edit their
> own message within 15 minutes of sending it, and unsend their own
> message. No one else — not other stores, and not the Platform Admin —
> can read or write a conversation.

### Functional requirements

| # | Requirement |
|---|---|
| FR-C1 | The customer can open a conversation with the fulfilling store from Order Details ("Message \<store\>"). |
| FR-C2 | The Store Manager can open the same conversation from the order in Manage Orders ("Message Buyer"). |
| FR-C3 | Either party can send a text message of up to 1000 characters, a photo (JPEG, PNG or WebP, up to 5 MB), or a photo with a caption. |
| FR-C4 | New messages appear without refreshing, and the list stays on the newest message. |
| FR-C5 | An order with a message the viewer has not read shows "New message" in My Orders (customer) and in Manage Orders (Store Manager). Opening the conversation clears it. |
| FR-C6 | Long-pressing a message opens a menu with six reactions (❤️ 😆 😮 😢 😠 👍) and the actions that apply to that message. |
| FR-C7 | **React:** each participant may set one reaction per message, and change or remove it. |
| FR-C7a | **See and remove reactions:** tapping the reactions under a message lists who reacted with which emoji; the participant's own reaction has a Remove button. The long-press menu also offers "Remove your \<emoji\> reaction", and choosing the highlighted emoji again removes it. |
| FR-C8 | **Reply:** the new message shows a quote of the message it answers. |
| FR-C9 | **Copy text:** copies the message's text to the device clipboard. |
| FR-C10 | **Edit:** the sender may change the text of their own message within 15 minutes of sending it. The message is then labelled "Edited". |
| FR-C11 | **Unsend:** the sender may unsend their own message after confirming. It is replaced for both parties by "You unsent a message" / "\<name\> unsent a message". |
| FR-C12 | Tapping a photo opens it full screen. |

### New use case — Message about an Order

> **Use case:** Message about an Order
> **Actors:** Customer, Store Manager
> **Precondition:** The actor is signed in, and is either the customer who
> placed the order or the Store Manager of the store fulfilling it.
> **Trigger:** The customer selects "Message \<store\>" on Order Details,
> or the Store Manager selects "Message Buyer" on an order.
>
> **Main flow:**
> 1. The system shows the conversation for that order, newest message at
>    the bottom, and marks it read for the actor.
> 2. The actor types a message, optionally attaching a photo from the
>    camera or photo library.
> 3. The actor sends it.
> 4. The system stores the message and shows it to both parties. The
>    other party's order list shows "New message" until they open the
>    conversation.
>
> **Alternate flows:**
> - *Long-press actions* — the actor long-presses a message and chooses a
>   reaction, Reply, Copy text, Edit or Unsend (FR-C6 to FR-C11). Edit and
>   Unsend are offered only on the actor's own messages, and Edit only
>   within 15 minutes.
> - *Photo refused* — a photo over 5 MB or in an unsupported format is
>   refused before upload, with the reason.
> - *Offline* — the send button is disabled and a banner says messages
>   cannot be sent.
> - *Not a participant* — the backend refuses the read or write; the
>   screen reports that messages could not be loaded or sent.

### Business rules / security (enforced by security rules, not the UI)

- Only the customer who placed the order and the Store Manager of its
  store can read or send messages in its conversation.
- A message is stamped with the sender's account and side (customer or
  store) and the server's time; no one can send as someone else.
- Messages can never be deleted. **Unsend** removes the content but
  leaves a visible placeholder, and **Edit** leaves an "Edited" label, so
  a conversation about a disputed order remains a record of what was
  said.
- Editing is allowed only within 15 minutes, measured on the server's
  clock so a device cannot fake it.
- A participant can set or remove only their own reaction, and only one
  of the six offered.
- Opening a conversation marks it read only for the actor's own side,
  and cannot change anything else on the order (status, total, address).
- Chat photos are stored per order and can be uploaded only by the two
  participants.

### Data model changes

**New subcollection: `users/{uid}/orders/{orderId}/messages/{messageId}`.**

| Field | Type | Notes |
|---|---|---|
| `senderId` | string | The sender's account. Must be the signed-in user. |
| `sender` | `'customer'` or `'store'` | Which side sent it. |
| `text` | string, ≤ 1000 | May be empty only when there is a photo. Emptied on unsend. |
| `imageUrl` | string, optional | Download URL of the photo. Removed on unsend. |
| `createdAt` | timestamp | Server time. |
| `replyTo` | map, optional | `{ id, text (≤ 200), sender, hasImage }` — the quoted message. |
| `reactions` | map, optional | `{ <uid>: <emoji> }`, one entry per participant. |
| `editedAt` | timestamp, optional | Set when edited. |
| `deleted`, `deletedAt` | boolean, timestamp | Set when unsent. |

**New fields on `orders`** (for the "New message" marker):

| Field | Type | Notes |
|---|---|---|
| `lastMessageAt` | timestamp | Time of the latest message. |
| `lastMessageBy` | `'customer'` or `'store'` | Who sent it. |
| `customerReadAt` | timestamp | When the customer last opened the conversation. |
| `storeReadAt` | timestamp | When the store last opened it. |

**New Storage path:** `chat/{customerId}/{orderId}/{file}` for chat
photos.

### Screens — add to the module list (section 7)

- **Order Chat** (customer and Store Manager) — one screen used by both.
  Reached from Order Details ("Message \<store\>") and from Manage
  Orders ("Message Buyer").
- **Order Details** (customer) — gains the "Message \<store\>" card.
- **My Orders** / **Manage Orders** — gain the "New message" marker.

### Limitations — for the Limitations / Future Work section

- **No push notifications.** Messages arrive in real time only while the
  app is open; the phone is not notified otherwise. The "New message"
  marker is how an unread message is noticed.
- **An unsent photo is unlinked, not destroyed.** It disappears from the
  conversation, but the file stays in cloud storage, where no one can
  reach it through the app.
- A conversation shows its latest 200 messages.
- Chat is per order. Asking a store a question before buying is not
  supported; the Help screen covers general questions.

### Verification

The rules test suite (section 8) grew from 114 to **127** tests. The
chat tests check that:
- only the two participants can read or send;
- nobody can send as someone else or as the other side;
- malformed, empty, oversized or backdated messages are refused;
- no one can delete a message outright;
- editing works only for the sender, only within 15 minutes, and is
  always marked;
- unsending leaves a placeholder and cannot be undone;
- reactions are limited to your own entry and the six emoji;
- the read markers cannot be used to change an order's status or total.

The full flow was also exercised in the app against the local emulators:
a customer messaged a store, the Store Manager saw "New message" and
replied with a photo, the marker cleared when the customer opened the
conversation, and react, reply, copy, edit and unsend each worked.
Sending and the on-screen keyboard behaviour were then checked on an
Android phone against production.

---

## 12. Profiles — customer photo and email verification, store profile

Before this, a customer could edit only their name, and a store was
known to shoppers only by its name, item count and rating.

> **Status (23 Sep 2026):** built and tested; reaches production with the
> next release (rules, storage rules, web app, APK).

### Customer profile — suggested wording

> A customer may add, change or remove a profile photo, taken with the
> camera or chosen from the photo library. The photo is shown on their
> profile and beside the reviews they write. The profile shows whether
> the customer's email address is verified; an unverified customer can
> request a verification link by email. The customer's phone number is
> kept with their saved delivery address, which the profile links to.

**Deliberately not collected: gender, birthday, bio.** PlainCo makes no
use of them — there are no birthday offers, no gender-based
recommendations, and customers have no public page for a bio. Under the
Data Privacy Act of 2012 (RA 10173), personal data collected must be
adequate, relevant and not excessive for its purpose, so fields with no
purpose are left out. Suggested wording:

> In line with the proportionality principle of the Data Privacy Act of
> 2012, PlainCo collects only the personal information needed to deliver
> orders and support the account: name, email address, an optional
> profile photo, and a delivery address with a contact number.

### Store profile — suggested wording

> Each store has a profile: a logo and a short description of up to 300
> characters, edited by that store's Store Manager from the Store Profile
> screen. The logo and description appear on the store's page, the logo
> in the Shop's "Shop by store" row and at the top of a customer's order
> chat with the store. A store's name can be changed only by a Platform
> Admin, because it is recorded on the store's past orders and reviews.

**Platform Admin:** no profile added. Platform Admins are never shown to
customers, and their account details are managed in Manage Users.

### Functional requirements

| # | Requirement |
|---|---|
| FR-P1 | A customer can add, change or remove their profile photo (camera or library; JPEG, PNG or WebP up to 5 MB). |
| FR-P2 | A customer's photo is shown beside reviews they write after setting it. |
| FR-P3 | The profile shows "Email verified" or "Not verified · Verify now"; Verify now sends a verification email. The status changes to "Email verified" by itself within seconds of the link being opened — on switching back to the app, or while the profile is open — without signing out. |
| FR-P4 | The profile links to the saved delivery address and phone number. |
| FR-S1 | A Store Manager can set, change or remove their store's logo and description from Store Profile, with a preview of how shoppers will see it. |
| FR-S2 | The store's logo and description appear on its store page; the logo also appears in "Shop by store" and in the customer's order chat header. |
| FR-S3 | A Store Manager cannot change the store's name, or another store's profile. |

### Business rules / security (enforced by security rules)

- A customer can change only their own `photoUrl`, and no other field in
  the same write.
- Only a store's own manager can change its `logoUrl` and `description`;
  only a Platform Admin can change its `name`.
- Profile photos can be uploaded only by the account they belong to;
  store logos only by that store's manager.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `users` | `photoUrl` (string, optional) | Set only by the account itself. |
| `stores` | `logoUrl` (string, optional), `description` (string ≤ 300, optional) | Set only by the store's manager. |
| `reviews` | `userPhotoUrl` (string, optional) | The author's photo, copied when the review is written, like `userName`. |
| Storage | `avatars/{uid}/…`, `stores/{storeId}/…` | Profile photos and store logos. |

### Screens — add to the module list (section 7)

- **Store Profile** (Store Manager) — new; reached from a new tile on the
  Store Manager dashboard.
- **Profile** (customer) — gains the photo, email verification status and
  the Delivery Address & Phone link.

### Limitations

- A review keeps the photo its author had when writing it; changing the
  profile photo later does not update old reviews.
- The Store Manager does not see the customer's photo in order chat:
  customer accounts are private to the customer.

### Verification

Rules test suite 127 → **130**: a customer can set and remove only their
own photo and cannot slip another field into the same write; a Store
Manager can edit only their own store's logo and description, not its
name, and not another store's; a deactivated manager cannot; a review
may carry the author's photo, within the length limit. The flows were
also run in the app against the local emulators: a customer set a photo
and requested verification, a Store Manager set a logo and description,
and a shopper saw them on the store page and in "Shop by store".

---

## 13. Onboarding redesign — icon, splash, landing, sign up, log in, password reset, Privacy Policy, Staff Portal

The first screens a new user sees were redesigned from approved HTML
previews, as one continuous flow rather than separate pages.

> **Status (23 Sep 2026):** built and tested against the local emulators;
> reaches production with the next release (web app and APK). No
> database, security-rule or Cloud Function changes.

### What changed — suggested wording

> **App icon.** A cream "P" on a Clay tile, on both iOS and Android
> home screens.
>
> **Launch splash.** The Clay tile appears on a cream background, shrinks
> to the left as the "plainco" wordmark slides out beside it, and the
> Clay dot drops onto the "i". For a signed-out user the logo then
> glides up to become the Landing screen's header; for a signed-in user
> the splash fades straight into Home.
>
> **Landing.** Under the logo: "Ukay-Ukay · Ready-to-Wear", the headline
> "Pre-loved finds. Brand-new styles. One app.", two category cards
> (Ukay-Ukay and Ready-to-Wear), **Get Started**, **Log In**, and a link
> to the Staff Portal. The logo stays in place when moving to Sign Up,
> Log In or Forgot Password; only the content below it changes.
>
> **Sign Up** checks each field as the user leaves it and shows the
> result under the field. **Create Account** stays disabled until every
> field is valid and the Privacy Policy is agreed to. On success the
> button shows "Account created" and the user is taken to Home.
>
> **Log In** reports problems in a notice above the form rather than a
> pop-up: incorrect email or password, a deactivated account, or a staff
> account (with a link to the Staff Portal).
>
> **Forgot Password** carries over the email typed on Log In, sends a
> reset link, and confirms with "Check your email". The confirmation is
> the same whether or not an account exists for that email.
>
> **Privacy Policy** opens as a sheet from Sign Up and from Profile, with
> jump-to-section chips and a reading-progress bar. From Sign Up it has
> an **I Agree** button that ticks the consent box.
>
> **Staff Portal** is the same sign-in form on a dark background, marked
> "Staff Portal", for Store Managers and Platform Admins. It reports
> problems above the form: incorrect email or password, a deactivated
> staff account, or a customer account (with a link back to the customer
> log in). On success it names the role ("Signed in as Store Manager" or
> "Signed in as Platform Admin") and opens the store dashboard or Manage
> Users. When a staff account is typed into the customer Log In, or a
> customer account into the Staff Portal, the link to the other screen
> carries the email over.

### Functional requirements

| # | Requirement |
|---|---|
| FR-O1 | On launch, the app plays the logo animation, then shows Landing to a signed-out user or Home to a signed-in one. |
| FR-O2 | Sign Up requires a full name (at least 2 characters), a valid email address, a password of **at least 8 characters**, a matching confirmation, and agreement to the Privacy Policy. Each field shows its own error or confirmation. |
| FR-O3 | If the email is already registered, Sign Up says so on the email field ("An account with this email already exists. Try logging in."). |
| FR-O4 | Log In shows, above the form: "Incorrect email or password" (and clears the password), "This account has been deactivated", or, for a Store Manager or Platform Admin account, that staff sign in through the Staff Portal, with a link to it. In each case the user is left signed out. |
| FR-O5 | Forgot Password sends a reset link and shows the same confirmation whether or not the email is registered. The link can be resent after 60 seconds. |
| FR-O6 | The Privacy Policy can be read before agreeing. **I Agree** ticks the consent box; closing it does not. The policy can be re-read from Profile at any time. |
| FR-O7 | Log In and Sign Up link to each other, and the back arrow on either returns to Landing. |
| FR-O8 | The Staff Portal admits only Store Manager and Platform Admin accounts that are active. It shows, above the form: "Incorrect email or password" (and clears the password), "This staff account has been deactivated", or, for a customer account, that customers sign in on the main log-in screen, with a link to it. In each case the user is left signed out. A Store Manager lands on the store dashboard and a Platform Admin on Manage Users. |

**Changed requirement — minimum password length is now 8 characters**
(was 6). This applies to new accounts only; existing accounts still log
in with their current passwords.

### Use-case updates

- **Register — alternate flow "Email already in use":** the error now
  appears on the email field and the form stays filled in, instead of a
  pop-up.
- **Log In — alternate flows "Invalid credentials", "Deactivated account"
  and "Staff account":** the message now appears in a notice above the
  form. The staff case offers a link to the Staff Portal.
- **New use case — Reset Password** (fills the gap listed in section 31):
  the user taps "Forgot password?" on Log In, enters their email and taps
  Send Reset Link. *Postcondition:* a reset email is sent if an account
  exists; the confirmation screen is identical either way, so the screen
  cannot be used to discover which emails are registered.
- **Staff Login — alternate flows "Invalid credentials", "Not a staff
  account" and "Deactivated account":** the message now appears in a
  notice above the form instead of a pop-up. The customer-account case
  offers a link to the customer log in. "Forgot password?" uses the same
  Reset Password use case as customers.

### The Privacy Policy text

The in-app policy follows the approved preview, with four corrections
made after checking each statement against the app:

1. **Payments:** the preview had a placeholder. The policy states that
   payments in this version are simulated: the user can choose GCash,
   Maya, Card or Cash on Delivery, no money is charged, and no card or
   e-wallet details are collected or stored. *(Superseded: the policy
   now names PayMongo — see section 18.)*
2. **Contact:** the preview had a "[support email]" placeholder. The
   policy points to the Contact Support form in the Help Center, which
   is the channel the app actually provides.
3. **Added:** the optional profile photo, photos sent in order chat, the
   order-confirmation email, and Cloud Storage (where photos are kept).
4. **Review names:** the policy states that reviews show the author's
   first name and last initial (e.g. "Juan D.") and profile photo, not
   the full name, matching section 9.

Full text, for an appendix:

> **Privacy Policy** — Last updated: September 2026
>
> PlainCo connects you with local Ukay-Ukay and Ready-to-Wear stores.
> This policy explains what personal information we collect, why we need
> it, and the rights you have under the Data Privacy Act of 2012
> (Republic Act No. 10173).
>
> **1. Information we collect**
> - *Account details:* your name, email address, and password (passwords
>   are handled by Firebase Authentication and are never visible to
>   PlainCo or store staff).
> - *Profile photo (optional):* a picture you choose to add. It appears
>   on your profile and next to your reviews.
> - *Delivery details:* recipient name, phone number, street address,
>   city, province, and ZIP code.
> - *Location (optional):* only when you tap "Use Current Location," to
>   fill in your address. We do not track your location in the
>   background.
> - *Shopping activity:* your cart, favorites, orders, reviews, and the
>   messages and photos you send to a store about an order.
>
> **2. How we use your information**
> - To create and secure your account.
> - To process your orders and deliver them to you.
> - To email you a confirmation when you place an order.
> - To show your order status and let you message the store about an
>   order.
> - To display your reviews on products you have purchased.
>
> We do not sell your personal information or use it for advertising.
>
> **3. Who can see your information**
> When you place an order, the store you ordered from sees your name,
> delivery address, phone number, order details, and your messages about
> that order, so they can fulfil it. Stores cannot see your orders from
> other stores. PlainCo platform administrators can access account
> records to manage users and resolve issues. Your reviews are shown to
> other PlainCo shoppers with your first name and last initial (for
> example, "Juan D.") and your profile photo. Your full name is not
> shown.
>
> **4. Payments**
> You can pay with GCash, Maya, Card, or Cash on Delivery. GCash, Maya,
> and Card are processed by PayMongo, a Philippine payment gateway: you
> enter your card or e-wallet details on PayMongo's own secure page, and
> PlainCo never receives or stores them. PlainCo keeps only the payment
> method, the amount, and PayMongo's payment reference, as part of your
> order record. PayMongo currently runs in test mode, so no real money is
> charged.
>
> **5. How your data is stored and protected**
> Your data is stored on Google Firebase (Authentication, Cloud
> Firestore, and Cloud Storage for photos). Data is encrypted in transit,
> and access is limited by security rules so that each user and store
> can only reach the records they are allowed to see. Firebase servers
> may be located outside the Philippines.
>
> **6. How long we keep it**
> We keep your information while your account is active. If you
> deactivate your account, you can no longer sign in, but your past
> order records are kept for transaction history.
>
> **7. Your rights**
> Under the Data Privacy Act, you have the right to: be informed about
> how your data is processed; access the personal data we hold about
> you; correct inaccurate information; object to processing, or request
> that your data be blocked or erased, subject to legal and
> transaction-record requirements; obtain a copy of your data in a
> portable format; and file a complaint with the National Privacy
> Commission.
>
> **8. Contact us**
> For privacy questions or requests, send us a message through the
> Contact Support form in the Help Center (tap the ? at the top of your
> Profile). We will respond within a reasonable time.
>
> **9. Changes to this policy**
> If we make significant changes, we will update the date above and let
> you know in the app.

### Screens — module list (section 7)

No new screens. **Landing, Sign Up, Log In, Forgot Password and the
Staff Portal login** are redesigned; the **Privacy Policy** changes from a pop-up to a sheet.

### Limitations

- The animated splash and landing play in the web app and in Expo Go;
  the still splash image and the new home-screen icon appear only in an
  installed build (the APK).
- The resend cooldown is 60 seconds in the app; Firebase applies its own
  limit on top, and past it the screen says "Too many requests".

### Verification

Each screen was compared frame by frame with its approved preview in a
browser, then run against the local emulators with test accounts:
- Sign Up: all field errors; duplicate email; account creation reaching
  Home; the policy's I Agree ticking the box.
- Log In: wrong password; deactivated account; Store Manager account and
  its Staff Portal link; successful login reaching Home; switching to
  Sign Up and back; back arrow to Landing.
- Forgot Password: carried-over email; invalid email; an unregistered
  email receiving the same confirmation and countdown; Back to Log In.
- Staff Portal: invalid email; wrong password; deactivated Store
  Manager; customer account and its link back to Log In (email carried
  over); staff account on Log In reaching the portal with its email;
  Store Manager reaching the dashboard; Platform Admin reaching Manage
  Users; back arrow and footer link returning to Log In.

---

## 14. Home and Shop redesign, and the customer tab bar

> **Status (23 Sep 2026):** built and tested against the local emulators;
> reaches production with the next release (web app and APK). No
> database, security-rule or Cloud Function changes. Everything shown is
> read from the live catalogue, as before.

### What changed — suggested wording

> **Home** greets the customer by first name, with their profile photo
> (or initials) opening Profile. Below it: a search bar that opens Shop
> ready to type, the **Ukay-Ukay** and **Ready-to-Wear** tiles with live
> item counts, **New arrivals** (the six newest listings across all
> stores) and **Ukay finds** (up to ten ukay-ukay items). Each section's
> "See all" opens Shop on the matching category.
>
> **Shop** keeps its title, item count, search bar and category tabs
> (All, Ready-to-Wear, Ukay-Ukay) fixed at the top while the two-column
> grid scrolls. Each card shows the photo, an Ukay or RTW tag, a
> favorite heart, the name, the store and the price. An item whose stock
> is 0 is shown dimmed with a "Sold out" label and a struck-through
> price. A search with no results says so and offers to clear the search
> and filters. A store's own page works as before, with a back arrow.
>
> Above the grid, **Shop by store** lists each store with its logo, item
> count and seller rating (or "New store" for a store under 30 days old
> with no reviews yet), followed by **Location** and **Help** buttons.
> Both are hidden while a search is being typed.
>
> **Tab bar.** Home and Shop share a bottom tab bar: Home, Shop,
> Favorites, Cart (with the item count) and Profile.

### Functional requirements

| # | Requirement |
|---|---|
| FR-H1 | Home shows the number of ukay-ukay and ready-to-wear items currently listed, and each tile opens Shop filtered to that category. |
| FR-H2 | Home lists the six most recently added products and up to ten ukay-ukay products. |
| FR-H3 | Shop search matches the product name or its category, including the words "ukay", "secondhand", "thrift" and "rtw". Search and the category tab combine: a search never resets the selected tab. |
| FR-H4 | A product with a recorded stock of 0 is marked "Sold out" in Home and Shop. A product with no stock recorded is not. |
| FR-H5 | The tab bar on Home and Shop opens Home, Shop, Favorites, Cart and Profile. Choosing a screen that is already open returns to it rather than opening a second copy. |

### Differences from the previous version

- **Removed from Home:** the photo banner ("Looking for New Clothes in
  Minutes?" with Start Shopping) and the "pre-loved pieces getting a
  second life" strip. The ukay-ukay count now appears on the Ukay-Ukay
  tile, and the search bar and tiles take the banner's place as the way
  into Shop.
- **Featured Picks** is renamed **New arrivals** (same six newest items),
  and **Ukay finds** is added.
- **Favorites is now in the tab bar.** Before, Home's navigation had only
  Home, Shop, Cart and Profile.
- **Shop no longer has a back arrow or cart icon** when opened as a tab;
  the tab bar replaces both. A store's page keeps them.
- **Search words:** category search previously matched only the stored
  names ("ukay-ukay", "ready-to-wear").

### Screens — module list (section 7)

No new screens. **Home** and **Shop** are redesigned; the tab bar is a
shared component used by both.

### Limitations

- A store's page has a back arrow instead of the tab bar. Favorites, Cart
  and Profile, restyled afterwards (section 15), carry the tab bar too, and show a back
  arrow only when opened from somewhere other than the tab bar.
- Home's rails are not paged: New arrivals shows the six newest items
  and Ukay finds the ten newest ukay-ukay items; "See all" opens the full
  list in Shop.

### Verification

Compared with the approved preview in a browser, then run against the
local emulators with a customer account, two stores and eight products
(one with stock 0, two without photos): Home counts and rails; the
search bar opening Shop focused; searching "denim"; a search with no
results and clearing it; the category tabs; a category search inside a
filtered tab; a store's page with its profile and sold-out item; the tab
bar returning to Home; and each category tile opening Shop filtered.

---

## 15. Favorites, Cart and Profile redesign

> **Status (23 Sep 2026):** built and tested against the local emulators;
> reaches production with the next release (web app and APK). No
> database, security-rule or Cloud Function changes. The rules for stock,
> availability, checkout and deactivation are unchanged; only the screens
> around them are new.

### What changed — suggested wording

> **Favorites** shows saved items in the same cards as Shop, with each
> item's current price and stock. If a saved item's product has been
> removed from the shop, it stays in the list, faded and marked "No
> longer available", so the customer can see what happened and remove
> it. Removing a favorite can be undone for a few seconds.
>
> **Cart** lists each item with its photo, colour, size and a quantity
> control, followed by a summary (subtotal, free shipping, total, and a
> note that Cash on Delivery is available). The **Checkout** button shows
> the total and stays in view above the tab bar. An item that is no longer
> sold is marked "No longer available" and left out of checkout. A
> one-of-a-kind ukay-ukay item says so when its single piece is already in
> the cart. Removing an item can be undone for a few seconds.
>
> **Profile** opens with an identity card: the customer's photo (or
> initials), name, email and whether the email is verified. Tapping the
> photo changes it; the pencil opens a sheet to change the display name.
> Below it are the saved delivery address and phone, then **Shopping**
> (My Orders, Favorites), **Support & legal** (Help & Support, Privacy
> Policy) and **Account** (Staff Portal, Log Out, Deactivate Account). The
> app version is shown at the bottom.
>
> All three screens carry the customer tab bar (section 14).

### Functional requirements

| # | Requirement |
|---|---|
| FR-P1 | Favorites shows each saved item's current price and stock where the product still exists, and marks it "No longer available" where it does not. Availability is decided only after the product list has loaded. |
| FR-P2 | Removing a favorite or a cart item shows an Undo option for about four seconds; undoing restores it. |
| FR-P3 | The cart limits each item's quantity to the stock remaining after the same product's other cart lines, and states the limit when it is reached ("Only 3 in stock"; for a one-of-a-kind ukay-ukay item, "Only 1 available (one-of-a-kind)"). |
| FR-P4 | The cart total and the Checkout button exclude items that are no longer available, and say so. Checkout is disabled only when no available items remain. |
| FR-P5 | Profile shows the saved delivery address and phone, or a prompt to add them, and opens the Delivery Address screen to edit them. |
| FR-P6 | The display name is edited in a sheet; it must not be empty and may be at most 60 characters. The email is shown read-only. |
| FR-P7 | Log Out and Deactivate each ask for confirmation. Log Out names the account being logged out of. The Deactivate confirmation states that the user will be signed out and cannot sign in again, that past orders are kept for transaction records, that only a Platform Admin can reactivate the account, and that data questions go through Contact Support in the Help Center. Deactivate stays disabled until the user ticks that they understand they can't log in again. Both end on a confirmation screen before returning to the landing screen. |

### Differences from the previous version

- **Favorites:** the "My Orders" and "Settings" shortcuts at the top are
  removed; Profile, now in the tab bar, leads to both. Removed products
  were previously shown as ordinary cards with their old price.
- **Cart:** Checkout moves from the bottom of the summary to a button
  that stays above the tab bar and shows the total. The stock note is now
  Moss (information) rather than red (error).
- **Profile:** the name is edited in a sheet instead of inline; the
  delivery address is shown on the screen instead of only as a menu row;
  Log Out and Deactivate confirmations are reworded as above.
- **Where the app differs from the approved preview, and why:**
  - Shipping reads "Free", matching Checkout, not "Calculated at
    checkout".
  - Checkout stays available when some items are unavailable (they are
    left out), rather than blocked until they are removed — the existing
    behaviour.
  - The Deactivate confirmation does not say it "withdraws consent to data
    processing", because the Privacy Policy (section 13) does not say so.
  - Profile keeps the Staff Portal row, the "?" Help button (which the
    Privacy Policy points to) and email verification, none of which the
    preview shows.

### Screens — module list (section 7)

No new screens. **Favorites, Cart and Profile** are redesigned. Shared
pieces (the page title, empty states, the Undo message, the offline
notice) are one component used by all three.

### Limitations

- A saved favorite is a copy of the product taken when it was saved. If
  the product is removed, only that copy remains, so its photo may be
  missing.
- The Undo window is about four seconds; after that the removal stands.

### Verification

Compared with the approved preview in a browser, then run against the
local emulators with a customer account holding a saved address, four
favorites (one for a deleted product) and three cart lines (one for a
deleted product, one ukay-ukay item with one in stock): the removed
favorite marked unavailable; removing and undoing a favorite; the cart
total and Checkout amount; raising a quantity; removing a cart line and
the unavailable note clearing; the address card; renaming through the
sheet; the Deactivate confirmation; and logging out to Landing.

---

## 16. Delivery Address, Help & Support and store page redesign

> **Status (24 Sep 2026):** built and tested against the local emulators;
> reaches production with the next release (web app and APK). No
> database, security-rule or Cloud Function changes. Support requests are
> stored in the same fields as before.

### What changed — suggested wording

> **Delivery Address** opens with a "Use my current location" card that
> shows whether it is searching, has found the address, or could not
> (for example, when location permission or Location Services is off).
> Fields filled from the location are tinted until the customer edits
> them. The form is grouped under **Recipient** (full name, mobile
> number) and **Address** (street, city, ZIP code, province). The mobile
> number is entered after a fixed "+63" and must be a Philippine mobile
> number; the ZIP code must be four digits. Saving shows a confirmation
> and returns to the previous screen. The saved address is the one
> checkout copies onto each order.
>
> **Help & Support** has a search that highlights matching words in the
> questions and answers and opens the best match, and four topic tiles
> (Orders, Shipping, Returns, Account) that narrow the questions. It
> shows the support hours with a live "Open now" or "Closed now" label,
> the four contact channels (Email, Call, WhatsApp, Messenger), and a
> "Share PlainCo" action. "Still stuck? Send us a request" opens a form
> in a sheet: the customer picks a topic, says whether the request is
> about an order, and writes a message. A request about an order goes to
> the store that sold it; any other goes to the PlainCo team.
>
> **A store's page** (opened from "Shop by store" or a product's "Sold
> by") has a banner in the store's category colour, an ID card with the
> logo, what the store sells, the month it joined, and three figures
> (items, rating, and how many buyers said items were as described), the
> store's description, its rating and review summary, and its items.
> The search, and the category tabs for a store selling both kinds, stay
> pinned under the header as the page scrolls.

### Functional requirements

| # | Requirement |
|---|---|
| FR-A1 | The Delivery Address screen can fill the address from the device's location, and states when it cannot (permission denied, Location Services off, no address found). |
| FR-A2 | The mobile number must be ten digits starting with 9 after "+63", and is saved as "+63 9XX XXX XXXX". A number saved in an older format (e.g. "09171234567") is converted when the screen opens. |
| FR-A3 | The ZIP code must be four digits. Full name, street, city and province are required. |
| FR-A4 | Help's search matches question and answer text, highlights the matches and opens the best one; topic tiles narrow the list to one category. |
| FR-A5 | A support request needs a topic and a message of 10–500 characters. The topic is stored at the start of the message ("Wrong item received: …"). |
| FR-A6 | A support request about an order is routed to the store that sold that order; any other request to the PlainCo team. The confirmation names who will reply. |
| FR-A7 | Help shows whether support is open now, from the published hours (Mon–Fri 9 AM–8 PM, Sat 9 AM–6 PM, Sun closed). |
| FR-A8 | A store's page shows its item count, its rating (or "New store" for a store under 30 days old with no reviews), and the share of reviews saying items matched the description. |

### Differences from the previous version

- **Delivery Address:** the phone field now requires a PH mobile number
  and the ZIP code four digits; neither was checked before.
- **Help:** two FAQ answers were out of date and are corrected — profile
  editing is now possible, and a password is changed through "Forgot
  password?" on Log In. Categories are shortened to four tiles. The
  request form moved into a sheet and gained a topic.
- **Store page:** it is now its own screen rather than a filtered view of
  Shop.
- **Where the app differs from the approved preview, and why:**
  - The request topic is written into the message, because the security
    rules accept only the existing support-request fields.
  - The "Request sent" screen shows no reference number; nothing in the
    app could look one up.
  - Under Save, the address screen says "Your address is only used for
    delivery", not "Only you and the store can see this": a Platform
    Admin can also read user records.
  - The contact channels and support hours are the app's existing ones
    (no SMS).
  - Store ratings use the app's existing gold stars and print whole
    averages as "3", not "3.0".

### Screens — module list (section 7)

**Store page** is a new screen (previously part of Shop). **Delivery
Address** and **Help & Support** are redesigned.

### New use case — 2.5 View Store Page

> **2.5 Transaction Name: View Store Page**
>
> • **Use Case Description**
> A customer opens a store's page from the Shop screen to view the
> store's profile and its product listings. The page displays the
> store's name, logo, category, date joined, description, item count,
> and a review summary computed from reviews of that store's products,
> followed by a searchable grid of the store's products.
>
> **Preconditions:** The customer is logged in and the store has an
> active profile in Cloud Firestore.
>
> **Postconditions:** The store's profile and product grid are
> displayed; searching filters only that store's products.
>
> **Extensions:** 1a. No Reviews: If none of the store's products have
> been reviewed, the summary is replaced by a message explaining that
> buyers can review an item once their order is delivered.

Checked against the app. Details the panel may want to include:

- The page can also be opened from "Sold by" on a product's page, not
  only from Shop.
- The category is not stored on the store. It is worked out from the
  store's products: Ukay-Ukay, Ready-to-Wear, or both. A store selling
  both also gets category tabs above its products.
- The review summary is the average rating and the share of buyers who
  said items matched the description. It is computed from the store's
  100 most recent reviews.
- The login precondition is required: the security rules let only
  signed-in users read stores, products and reviews.

### Limitations

- Filling the address from location needs permission and a network
  connection; the result should be checked before saving.
- The "Open now" label uses the device's clock, not Philippine time.

### Verification

Compared with the approved preview in a browser, then run against the
local emulators with a customer account: an invalid mobile number and an
empty ZIP code rejected; "09181234567" formatted as "+63 918 123 4567"
and saved, shown back on Profile; a search for "refund" opening the
matching answer; the Shipping tile filtering the questions; a request
sent with the "Wrong item received" topic; and a store page opened from
Shop, scrolled, and searched.

---

## 17. Product details, size guide, add to cart, checkout and order confirmation redesign

> **Status (24 Sep 2026):** built and tested against the local emulators
> (see Verification for what could not be tested locally); reaches
> production with the next release (web app and APK). No database,
> security-rule or Cloud Function changes. Prices, stock and the order
> itself are still checked and written by the server (section 4).

### What changed — suggested wording

> **Product details** opens on a large photo, with the category, name,
> price, rating, and a "Sold by" card for the store below it, then the
> colour, size and quantity choices, the description and the reviews.
> When the store has recorded measurements, a **Size guide** link opens
> a sheet with them for every size; tapping a row chooses that size.
> After a size is chosen, its measurements are shown under the size
> buttons. The quantity line states the stock ("Only 3 left", "One of a
> kind" for a single ukay-ukay piece, "Sold out").
>
> **Add to Cart** confirms in place: the button turns green, the photo
> moves into the cart icon, and a short "Added to cart" panel shows the
> colour, size and quantity with a "View cart" button. **Buy Now** shows
> the total for the chosen quantity and goes straight to checkout.
>
> **Checkout** shows where the customer is ("Cart/Item → Review & pay →
> Done") and the order in cards: **Deliver to**, **Items**, **Payment
> method** and **Order summary**. Each payment method has a short
> description, and a note says that online payments are completed on
> PayMongo's secure page or, for Cash on Delivery, to prepare the amount. If an item
> sells out or runs short before the order is placed, a notice at the
> top says so, confirms nothing was charged, and links back to change
> the order.
>
> **Order placed** confirms the order with its order number (one per
> store for a multi-store cart), status, payment method and total, with
> "View My Orders" and "Continue shopping".

### Functional requirements

| # | Requirement |
|---|---|
| FR-B1 | The customer must choose a size before adding to the cart or buying; a product offered in only one size has it chosen already. Trying without one says "Please choose a size first." |
| FR-B2 | The size guide appears only when the store has recorded measurements, shows every size the product offers with the measured fields and unit, and lets the customer choose a size from it. |
| FR-B3 | Quantity cannot exceed the product's stock; the stock is stated beside it, and a sold-out product cannot be added or bought. |
| FR-B4 | Adding to the cart confirms without a dialog and offers a way to the cart for about four seconds. |
| FR-B5 | Placing an order without a payment method is refused with an on-screen message beside the button, and the payment options are highlighted. Without a delivery address it is refused with a prompt to add one. |
| FR-B6 | When the server refuses an order because an item sold out or has too little stock, checkout shows which item and how many remain, states that nothing was charged, and links back to the cart or product. |
| FR-B7 | "Place order" is disabled while the device is offline, and checkout says so. |

### Differences from the previous version

- **No size is chosen automatically** (previously the first size was, so
  an order could be placed in a size nobody picked).
- Add to Cart previously opened a dialog; the size guide was a centred
  window without size selection; Buy Now showed the unit price rather
  than the total for the quantity.
- Checkout's missing-payment and sold-out messages were dialogs.
- The order confirmation no longer repeats the item list, delivery
  address and "What happens next"; they are in My Orders.
- **Where the app differs from the approved preview, and why:**
  - No empty stars are shown for a product with no reviews, only "No
    reviews yet", because empty stars read as a zero rating.
  - The "Sold by" card keeps the store's rating.
  - Stock is one number per product, not per size, as stored.
  - The shoe diagram appears only in the footwear size guide; other kinds
    of item show the table only.
  - The confirmation offers "View My Orders", not "View order": the order
    screen needs the full stored order, which is not available at that
    moment.

### Screens — module list (section 7)

No new screens. **Product Details**, **Checkout** and **Order
Confirmation** are redesigned; the **Size Guide** is now a sheet on the
product screen.

### Checkout use case — alternative flow (Buy Now)

Suggested addition to the Checkout / Add to Cart use case:

> Alternatively, the customer taps "Buy Now," which proceeds directly to
> Checkout with only the selected item, size, color and quantity,
> without adding it to the shopping cart.

Checked against the app. The cart is left as it was, and placing the
order doesn't remove anything from it. As with Add to Cart, a size must
be chosen first (FR-B1), and Buy Now is disabled for a sold-out item.

### Limitations

- A size guide is only as accurate as the store's own measurements, and
  says so.
- Stock can still change between Add to Cart and checkout; the server's
  check at checkout is the one that counts (FR-B6).

### Verification

Compared with the approved preview in a browser, then run against the
local emulators with a customer account, a saved address and a footwear
product with measurements for two sizes: no size preselected; Add to
Cart without a size refused with the message; choosing size M from the
size guide and its measurements appearing; the "Added to cart" panel
and the cart count rising to 1; the panel closing after four seconds;
the header turning solid on scroll; Buy Now opening checkout with the
address and item; Place order without a payment method refused; and
choosing Cash on Delivery clearing the message.

The order confirmation, the sold-out notice and the offline state were
not run locally: they follow a real order, and the functions emulator
sends real email. They should be checked with one test order on the
release build.

---

## 18. Online payment through PayMongo — NEW

GCash, Maya and Card are no longer only options in the interface. They
are processed by **PayMongo**, a Philippine payment gateway, in **test
mode** (real PayMongo servers, test keys, no real money). Cash on
Delivery is unchanged. This replaces every statement in the SRS that
payment options are "included in the UI design and not yet integrated".

### What changed in each SRS area

**Scope / Constraints.** Replace the "payment is UI only" constraint:

> Online payments (GCash, Maya and Card) are processed through the
> PayMongo payment gateway. The customer completes the payment on
> PayMongo's hosted checkout page; PlainCo never receives, transmits or
> stores card numbers, CVVs or e-wallet credentials. In this version
> PayMongo operates in test mode, so no real money is charged. Cash on
> Delivery is paid to the rider on arrival.

**External interfaces** (add if the SRS has this section):

> PlainCo's server communicates with the PayMongo API over HTTPS to open
> a checkout session, check a session's payment status, and close an
> unpaid session. PayMongo notifies PlainCo of completed payments through
> a webhook, whose requests are verified with a shared secret before they
> are accepted.

**Functional requirements — checkout.** Add:

- FR: When the customer places an order with GCash, Maya or Card, the
  system reserves the items and opens PayMongo's payment page for the
  chosen method.
- FR: The order is created only after PayMongo confirms the payment. The
  customer then sees "Payment successful" and the order is marked
  **Paid** with PayMongo's payment reference (`pay_…`).
- FR: If the customer leaves the payment page without paying, the
  reservation is released at once, no order is created, nothing is
  charged, and the cart is left as it was.
- FR: Items reserved for an unfinished payment are released
  automatically after **30 minutes**.
- FR: Cash on Delivery orders are created immediately, marked "Pay on
  delivery", and never open the payment page.

**New use case — Pay Online**

| | |
|---|---|
| **Actor** | Customer |
| **Precondition** | Signed in, a delivery address saved, items in the cart (or Buy Now), GCash, Maya or Card selected |
| **Main flow** | 1. Customer taps **Place order**. 2. System checks stock and prices, reserves the items for 30 minutes, and opens PayMongo's page for the chosen method. 3. Customer pays on PayMongo's page. 4. PayMongo confirms the payment to PlainCo. 5. System creates one order per store, marked Paid, and clears the cart. 6. Customer sees **Payment successful** with the order number(s). |
| **Alternative flow A — customer backs out** | At step 3 the customer closes the page or taps **Cancel payment**. The system first checks with PayMongo that no payment was made, then releases the items. Checkout shows "Payment not completed — no money was taken and your order wasn't placed." |
| **Alternative flow B — paid, then closed the page** | The customer pays but closes the page before it returns to the app. The system finds the payment when it checks with PayMongo and places the order anyway. |
| **Alternative flow C — no answer in time** | The reservation expires after 30 minutes. The items go back on sale and Checkout shows "Payment timed out". |
| **Exception — gateway unavailable** | PayMongo cannot be reached when the order is placed. The reservation is released and the customer is told to try again or choose Cash on Delivery. |
| **Postcondition** | Either one Paid order per store exists, or nothing was created and nothing was charged. |

**Security / business rules.** Add:

> An order is created only after PlainCo's server has confirmed the
> payment with PayMongo, either through PayMongo's signed webhook or by
> querying PayMongo directly; the app's own report that a payment
> succeeded is never trusted. The amount PayMongo charged must equal the
> order total computed by the server from the product catalogue.
> Webhook requests without a valid PayMongo signature are rejected.
> Customers can read only their own pending checkout and cannot change
> it. The switch between the test sandbox and PayMongo can be changed
> only from the Firebase console, never by a user of the app.

**Data dictionary.** New collection `checkouts` (one document per online
payment in progress):

| Field | Type | Meaning |
|---|---|---|
| `customerId` | string | Who is paying |
| `status` | string | `pending`, `paid`, `released`, or (flagged for a person) `needs-review` / `paid-after-release` |
| `total` | number | Amount to be charged, computed by the server |
| `paymentMethod` | string | `gcash`, `maya` or `card` |
| `sessionId` | string | PayMongo checkout session id |
| `expiresAt` | timestamp | When the 30-minute reservation ends |
| `paymentId` | string | PayMongo payment id, once paid |

New or changed fields on each **order**:

| Field | Type | Meaning |
|---|---|---|
| `paymentStatus` | string | `paid` (online) or `unpaid` (Cash on Delivery) |
| `paymentRef` | string / null | PayMongo payment id such as `pay_…`; null for Cash on Delivery |
| `paymentProvider` | string / null | `paymongo`, `sandbox`, or null for Cash on Delivery |
| `paymentSandbox` | boolean | `true` when no real money moved (PayMongo test mode or the sandbox) |
| `paidAt` | timestamp | When PayMongo confirmed the payment |

**Module / screen list.** Add **Online Payment** (customer side): shows
the amount and method, opens PayMongo's page, and confirms the result.
The earlier **Sandbox Payment** screen remains for offline demos only;
the live app no longer shows it.

**Order screens.** Order Details and the Store Manager's order view show
the PayMongo reference and, while in test mode, "PayMongo test payment —
no real money moved".

**Privacy Policy (section 13).** Section 4 of the in-app policy now
reads:

> You can pay with GCash, Maya, Card, or Cash on Delivery. GCash, Maya,
> and Card are processed by PayMongo, a Philippine payment gateway: you
> enter your card or e-wallet details on PayMongo's own secure page, and
> PlainCo never receives or stores them. PlainCo keeps only the payment
> method, the amount, and PayMongo's payment reference, as part of your
> order record. PayMongo currently runs in test mode, so no real money is
> charged.

**Help / FAQ.** "What payment methods do you accept?" and "Is my payment
information secure?" now describe PayMongo and test mode instead of the
sandbox.

**Limitations / future work.**

> Payments run in PayMongo's test mode; accepting real money requires
> PayMongo business verification and live keys, with no change to the
> app's design. Refunds are made from the PayMongo dashboard, not from
> within PlainCo.

### Verification

Automated tests (with PayMongo replaced by a stand-in) cover:
- an online order reserving stock without creating an order;
- a signed webhook creating the paid orders exactly once, even when
  PayMongo sends it twice;
- a forged webhook being refused;
- backing out releasing the reservation, but placing the order if the
  customer had actually paid;
- expiry after 30 minutes;
- PayMongo being unreachable;
- a payment that does not match the total creating no order.

Checkout tests: 39. Security-rule tests: 133. On the live app, the
PayMongo page was opened and a cancelled payment returned to Checkout
with nothing charged.

---

## 19. Staff account provisioning — made visible in the app

Section 3 still stands: staff accounts are **granted by a Platform
Admin, never self-registered**. What was missing was saying so where
people look. The Staff Portal only had one line of small print, so
someone new to PlainCo went looking for a staff sign-up that does not
exist.

The Staff Portal now has a **"How do I get a staff account?"** link under
its subtitle. It opens a panel with:

1. **Create a customer account** — sign up on the main sign-up screen,
   with the email you want to use for work.
2. **Ask a Platform Admin for a role** — they find your email in Manage
   Users and make you a Store Manager (with your store) or a Platform
   Admin.
3. **Sign in here** — the same email and password open the Staff Portal.

It also explains why there is no staff sign-up (staff can manage stores,
orders and other people's accounts), notes that the staff member keeps
their own password, and has a **Create a customer account** button that
opens the sign-up screen.

Suggested addition to the Staff Portal screen description (section 2 or
13):

> The Staff Portal has no registration option, by design. A "How do I get
> a staff account?" link explains the process: register as a customer,
> then a Platform Admin assigns the Store Manager or Platform Admin role
> from Manage Users. A button on the explanation opens customer
> registration.

If a panel asks why there is no staff or seller registration: an open
Platform Admin sign-up would let anyone take control of every account
and store, and an open Store Manager sign-up would give unapproved
sellers access to customers' names and addresses. Approval by a Platform
Admin is the control.

---

## 20. Product brand and condition — NEW

Before this, the only way a store could describe how worn an ukay-ukay
piece was, or what brand it was, was free text in the description, worded
differently by every store and impossible to search.

> **Status (1 Oct 2026):** built and tested against the emulator. The
> security rules must be deployed (`npm run rules:deploy`) before the app
> can save the new fields in production.

### What changed — suggested wording

> A Store Manager may record a product's **brand** (optional, up to 40
> characters) when adding or editing it. An ukay-ukay product must also
> state its **condition**, chosen from a fixed scale: *New with tags*,
> *Like new*, *Gently used* or *Well loved*. Each grade has a one-line
> definition that the manager sees when choosing and the shopper sees on
> the product page. The manager may add a note on any **flaws** (up to
> 300 characters); a *Well loved* item cannot be saved without one,
> because that grade is defined as having visible wear or a flaw.
> Ready-to-wear products have no condition, since they are brand-new.
>
> On the product page, the brand appears above the product name, and an
> ukay-ukay product shows its condition beside the category and in a
> Condition section with the definition and the seller's flaws note.
> Searching the Shop, a store page or Manage Products also matches brand.

Why a fixed scale rather than free text: the product page already asks
reviewers whether the item matched its description (section 9). A
shared scale gives "matched" a concrete meaning, and "Gently used" means
the same thing whichever store sells the item.

### Functional requirements

| # | Requirement |
|---|---|
| FR-B1 | A Store Manager can set, change or clear a product's brand when adding or editing it. |
| FR-B2 | Searching the Shop, a store page or Manage Products matches the brand as well as the name. |
| FR-B3 | An ukay-ukay product cannot be added without a condition from the fixed scale. |
| FR-B4 | A *Well loved* product cannot be saved without a flaws note. |
| FR-B5 | The product page shows the brand above the name and, for ukay-ukay, the condition, its definition and any flaws note. |
| FR-B6 | Changing a product to ready-to-wear removes its condition and flaws note when it is saved. |

### Use case updates

**Add Product** (Store Manager): add to the main flow, after the product
name and type are entered:

> 1. The Store Manager optionally enters the brand.
> 2. If the type is Ukay-Ukay, the system displays the condition scale
>    with each grade's definition, and the Store Manager selects one.
> 3. The Store Manager optionally describes any flaws.
>
> *Alternate flow — no condition selected (ukay-ukay):* the system
> highlights the Condition field with "Pick the condition it's in." and
> does not save the product.
>
> *Alternate flow — Well loved without a flaws note:* the system
> highlights the Flaws field with "Say what the wear or flaw is, so
> shoppers know before buying." and does not save the product.

**Edit Product** (Store Manager): add:

> The Store Manager may change the brand, condition and flaws note.
> Changed fields are marked and can be undone individually, like the
> other fields.
>
> *Alternate flow — ukay-ukay product created before condition existed:*
> the product opens with no condition selected and the note "Needed to
> save"; the Store Manager must select a condition before any change can
> be saved.

**View Product Details** (Customer): add:

> The system displays the brand, if recorded, above the product name. For
> an ukay-ukay product with a recorded condition, it also displays the
> condition beside the category, and a Condition section with the grade's
> definition and the seller's flaws note.

### Screens — module list (section 7)

- **Add Product / Edit Product** (Store Manager): new Brand field; for
  ukay-ukay, new Condition and Flaws fields.
- **Product Details** (Customer): brand, condition label and Condition
  section.
- **Shop, Store page, Manage Products**: search also matches brand.

### Business rules / security (enforced by security rules)

- `condition` must be one of the four scale values; `brand` and `flaws`
  must be strings within their length limits, on create and on edit.
- Requiring a condition on new ukay-ukay products is enforced by the
  app (Add Product will not save without one), not yet by the security
  rules: an APK built before this change is still installed for the UAT
  survey and does not send the field, and a rule requiring it would stop
  that build adding products. Once every installed build sends it, the
  rule is tightened to require it (marked in firestore.rules).
- Ukay-ukay products created before this change have no condition; they
  can still be edited, and the Edit Product screen asks for a condition
  before they can be saved again.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `products` | `brand` (string ≤ 40, optional) | Left off when blank. |
| `products` | `condition` (string, one of `new-with-tags`, `like-new`, `gently-used`, `well-loved`) | Ukay-ukay only; required by the app on new ukay-ukay products. |
| `products` | `flaws` (string ≤ 300, optional) | Ukay-ukay only; required in the app for `well-loved`. |

### Limitations

- The Shop has no filter by brand or condition yet; brand is matched by
  search only.
- The product cards in the Shop grid do not show brand or condition;
  they appear on the product page.

### Verification

Rules test suite 137 → **141**: brand, condition and flaws are accepted;
an ukay-ukay product from a build without condition is still accepted
(until the rule is tightened, above); an unknown
condition, a non-string brand and over-length brand or flaws are refused
on create and on edit; an older ukay-ukay product without a condition
can still be edited.

---

## 21. Product Section (who it's for) and the Shop's Section filter — NEW

Before this, a shopper looking for women's or men's clothing had to
scroll the whole catalogue: products recorded nothing about who they
were for.

> **Status (1 Oct 2026):** built and tested against the emulator. The
> security rules must be deployed (`npm run rules:deploy`) before the app
> can save products in production — every new product now carries this
> field, so an old rule set would refuse them. The deploy does not affect
> the APK used for the UAT survey: it can still add products, without a
> Section.

### What changed — suggested wording

> Every product records who it is for, chosen by the Store Manager from
> four options: *Women*, *Men*, *Unisex* or *Kids*. It is required when
> adding a product of either type. The product page shows it beside the
> category (for example "Women's").
>
> The Shop has a Section filter under the Ready-to-Wear / Ukay-Ukay tabs:
> *All*, *Women*, *Men* and *Kids*. A *Unisex* product appears under both
> Women and Men. The Section filter, the category tabs and the search box
> combine: a shopper can view, for example, women's ukay-ukay items
> matching "denim".

Why it is a filter and not separate tabs or sections: PlainCo presents
one catalogue (see PRODUCT.md, "One catalog, both worlds"). Splitting it
into separate women's and men's areas would fragment it; a filter narrows
the same catalogue instead.

On data privacy: this describes the **product**, not the customer.
Section 12's decision not to collect customers' gender is unchanged.

### Functional requirements

| # | Requirement |
|---|---|
| FR-D1 | The Store Manager must choose a Section (Women, Men, Unisex or Kids) when adding a product, and can change it when editing. |
| FR-D2 | The product page shows the product's Section beside its category. |
| FR-D3 | The Shop offers a Section filter (All, Women, Men, Kids). Unisex products appear under Women and under Men. |
| FR-D4 | The Section filter combines with the category tabs and the search box; "Clear search & filters" resets all three. |
| FR-D5 | A product listed before Section existed appears under All only, and must be given a Section the next time it is saved in Edit Product. |

### Use case updates

**Add Product** (Store Manager): add, after the brand:

> The Store Manager selects who the product is for: Women, Men, Unisex or
> Kids.
>
> *Alternate flow — no Section selected:* the system highlights the
> Section field with "Pick who it's for." and does not save the product.

**Edit Product** (Store Manager): add:

> *Alternate flow — product created before Section existed:* the product
> opens with no Section selected and the note "Needed to save"; the Store
> Manager must select one before any change can be saved.

**Browse Products** (Customer): add:

> The customer may select a Section (All, Women, Men or Kids) to narrow
> the products shown. The selection combines with the category tab and
> the search text.

### Business rules / security (enforced by security rules)

- `section` must be one of `women`, `men`, `unisex` or `kids`, on create
  and on edit.
- Requiring a Section on every new product is enforced by the app, not
  yet by the security rules, for the same reason as condition (section
  20): the UAT survey APK predates the field. The rule is tightened once
  every installed build sends it.
- Products created before this change have none; they can still be
  edited.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `products` | `section` (string, one of `women`, `men`, `unisex`, `kids`) | Required by the app on new products. |

### Screens — module list (section 7)

- **Add Product / Edit Product** (Store Manager): new Section field.
- **Shop** (Customer): new Section filter under the category tabs.
- **Product Details** (Customer): Section shown beside the category.

### Limitations

- The Section filter is on the Shop only, not on a store's own page or
  Home.
- Existing products show only under All until a Store Manager edits them
  and picks a Section. (`scripts/seed-catalog.mjs` fills it in for the
  products it seeded.)

### Verification

Rules test suite 141 → **143**: each of the four values is accepted, and
so is a product from a build without a Section (until the rule is
tightened); an unknown value is
refused on create and on edit; a product listed before Section existed
can still be edited and given one.

---

## 22. Store location ("Ships from") — NEW

Before this, a shopper could not tell where a store was, so could not
judge how far an order would travel before buying.

> **Status (1 Oct 2026):** built and tested against the emulator. The
> security rules must be deployed (`npm run rules:deploy`) before a Store
> Manager can save a location in production. The deploy does not affect
> the APK used for the UAT survey: its Store Profile keeps saving the logo
> and description as before.

### What changed — suggested wording (extends the Store profile in section 12)

> A Store Manager may record where their store ships from, as a city or
> area of up to 60 characters (for example "Cubao, Quezon City"), from
> the Store Profile screen. Shoppers see it on the store's page, on the
> store's card in "Shop by store", and as "Ships from …" under "Sold by"
> on each of the store's products. The location is optional; a store
> without one shows none.

**Deliberately city or area only.** Some sellers sell from home, so a
street address would publish a private individual's address to every
shopper. The screen says "City or area only, never your street address",
and nothing more precise is asked for. This follows the Data Privacy Act
proportionality principle already applied to customer data (section 12).

### Functional requirements

| # | Requirement |
|---|---|
| FR-L1 | A Store Manager can set, change or remove their store's location (city or area, up to 60 characters) from Store Profile, with a live preview. |
| FR-L2 | The store page and the store's card in "Shop by store" show the location, when set. |
| FR-L3 | The product page shows "Ships from \<location\>" under "Sold by", when set. |
| FR-L4 | A Store Manager cannot set another store's location; a Platform Admin cannot set any store's location. |

### Use case updates

**Edit Store Profile** (Store Manager): add:

> The Store Manager may enter the city or area the store ships from. The
> live preview shows it as it is typed. Saving with the field empty
> removes the location.

**View Store** and **View Product Details** (Customer): add:

> If the store has recorded a location, the system displays it on the
> store's page and its "Shop by store" card, and as "Ships from
> \<location\>" under "Sold by" on each of the store's products.

### Business rules / security (enforced by security rules)

- Only a store's own active manager can change `location`, in the same
  rule branch as `logoUrl` and `description`.
- `location` must be text containing at least one non-space character,
  at most 60 characters, or absent.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `stores` | `location` (string ≤ 60, optional) | City or area; set only by the store's manager. |

### Screens — module list (section 7)

- **Store Profile** (Store Manager): new "Ships from" card; the live
  preview shows the location.
- **Store page**, **Shop** ("Shop by store") and **Product Details**
  (Customer): show the location.

### Limitations

- The location is free text and is not checked against a list of real
  places.
- There is no "near me" filter and shipping fees do not depend on
  distance; both would need precise addresses and map data, which this
  deliberately does not collect.

### Verification

Rules test suite 143 → **145**: a manager can set, change and remove
their own store's location, alone or with the rest of the profile, and
an older build's logo-and-description save still succeeds; a blank,
non-text or over-length location is refused, as is a change by another
store's manager, a customer, a deactivated manager or a Platform Admin.

---

## 23. Product photos, zoom and flaw disclosure — NEW

Before this, a product had one photo, and an ukay piece only had to
describe a flaw if it was graded "Well loved". A "Gently used" piece with
a stain could be listed without mentioning it.

> **Status (1 Oct 2026):** built; rules tested against the emulator. The
> security rules must be deployed (`npm run rules:deploy`) before a Store
> Manager can save a product with the new photos in production. The deploy
> does not affect the APK used for the UAT survey: the new fields are
> optional in the rules, and required by the app instead.

### What changed — suggested wording (extends Add/Edit Product and View Product Details)

> A product has up to four photos, one per slot: Front, Back, Label & size
> tag, and Fabric close-up. An ukay-ukay listing requires the first three;
> a ready-to-wear listing requires only the Front, since it is new and the
> same across its stock.
>
> Every ukay-ukay listing must answer "Did you find any flaws?" with no
> default answer. "No flaws found" states that the seller checked for
> stains, holes, fading and damage. "Yes, it has flaws" requires the kind
> of flaw (Stain, Hole or tear, Fading, Pilling, Stretched, Zipper or
> button, Other), a note saying where it is, and at least one photo of it
> (up to three). A "Well loved" listing cannot answer "No flaws found".
>
> On the product page the photos form a gallery the shopper can swipe and
> open full screen, where each photo can be zoomed by pinching or
> double-tapping. Flaw photos are part of the gallery and are also shown
> beside the flaw description.

### Functional requirements

| # | Requirement |
|---|---|
| FR-P1 | A Store Manager can add, replace and remove a photo in each of the four slots, by camera, gallery or image link. |
| FR-P2 | The system refuses to add an ukay-ukay listing without Front, Back and Label & size tag photos, or a ready-to-wear listing without a Front photo. |
| FR-P3 | The system refuses to save an ukay-ukay listing until the flaw question is answered; a "Yes" needs at least one flaw kind, a note, and one to three flaw photos. |
| FR-P4 | The product page shows every photo as a swipeable gallery with each photo's label, and opens a full-screen viewer with pinch and double-tap zoom. |
| FR-P5 | The product page's Condition section states "No flaws found" or lists the flaws found, with their photos. |

### Use case updates

**Add Product** (Store Manager): add:

> The Store Manager fills the required photo slots for the item type. For
> an ukay-ukay item, they answer whether it has flaws; if it does, they
> pick the kinds, describe where, and add a photo of each.
>
> *Alternative flow:* a required photo or the flaw answer is missing — the
> system names what is still needed and does not save.

**Edit Product** (Store Manager): add:

> The same rules apply, except that a listing created before photo slots
> existed may be saved without its Back or Label photo; the screen asks
> for them. A required photo the listing already has can be replaced but
> not removed.

**View Product Details** (Customer): add:

> The customer may swipe through the product's photos and tap one to view
> it full screen and zoom in. For an ukay-ukay item, the Condition section
> shows whether the seller found flaws and, if so, what and where, with
> photos.

### Business rules / security (enforced by security rules)

- `flawCheck` is `none` or `found`, or absent.
- `flawTags` is a list of at most 7 keys from the fixed flaw list.
- `photos` is a list of at most 8 entries.
- None of the three is required by the rules yet, so the survey APK keeps
  working; the app requires them.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `products` | `photos` (list ≤ 8 of `{ kind, url }`, optional) | Every photo besides the Front. `kind` is `back`, `label`, `fabric` or `flaw`. |
| `products` | `flawCheck` (`none` \| `found`, optional) | Ukay-ukay only. |
| `products` | `flawTags` (list of keys, optional) | Ukay-ukay only, with `found`. |

The Front photo stays in `imageUrl`, so the catalog, cart, orders and
older builds are unchanged.

### Screens — module list (section 7)

- **Add Product** and **Edit Product** (Store Manager): the Photo card
  becomes a Photos card with one tile per slot; the Condition area gains
  the flaw question, flaw kinds, note and flaw photos.
- **Product Details** (Customer): photo gallery, full-screen zoom viewer,
  and the flaw disclosure in the Condition section.

### Limitations

- The app cannot tell whether a photo shows what its slot says (a "Back"
  photo that is really the front). The labels guide the seller; buyer
  reviews ("Didn't match the description") are the check.
- Rules can bound the size of `photos` but not the shape of each entry;
  the app reads it defensively.
- Replaced photos stay in Cloud Storage, as before (see storage.rules).

### Verification

Rules test suite 145 → **148**: a product with photos, a flaw answer and
flaw kinds is accepted on create and on edit, and a build that sends none
of them still is; an unknown flaw answer or kind, a non-list, and more
than eight photos are refused, on create and on edit.

---

## 24. "Just in" and last-piece notes — NEW

Before this, Home's first rail was captioned "Just added by our stores"
even when its newest item was months old, and a shopper browsing the
catalog could not tell a fresh listing or a last piece without opening
each product.

> **Status (1 Oct 2026):** built; display only. No security rules or
> stored fields change, so nothing needs deploying and the APK used for
> the UAT survey is unaffected.

### What changed — suggested wording (extends Browse Products and the Home screen)

> A product listed in the last three days shows a "Just in" note on its
> photo wherever products are listed: Home, Shop, a store's page and
> Favorites. A product with exactly one left says so beside its price —
> "One of a kind" for ukay-ukay, "Only 1 left" for ready-to-wear — in the
> same words the product page uses. Neither is shown on a sold-out
> product.
>
> Home's first rail is titled "Just in", with the number of products
> listed in the last three days, while there are any; otherwise it is
> titled "New arrivals" and shows the newest products.

**Deliberately plain.** The notes are stated, not promoted: no countdown,
no flash-sale colours, no stacked badges, consistent with the design
principles in PRODUCT.md. A timed "drop" with countdowns, reservations
and push notifications was considered and left out (see Limitations).

### Functional requirements

| # | Requirement |
|---|---|
| FR-N1 | The system shows a "Just in" note on a product listed within the last three days, in every product list, unless it is sold out. |
| FR-N2 | The system shows "One of a kind" (ukay-ukay) or "Only 1 left" (ready-to-wear) beside the price of a product whose stock is exactly 1. |
| FR-N3 | Home's first rail is titled "Just in" and states how many products were listed in the last three days while there are any, and is titled "New arrivals" otherwise. |

### Use case updates

**Browse Products** (Customer, Guest): add:

> Each product in the list shows "Just in" if it was listed in the last
> three days, and "One of a kind" or "Only 1 left" if it is the last one.

### Business rules

- "Listed" is the product's `createdAt`, stamped by the server when the
  Store Manager adds it. Editing a product does not make it "Just in"
  again.
- A product whose stock is not recorded shows no last-piece note.

### Data model changes

None. Both notes are worked out from the existing `createdAt` and
`stock` fields.

### Screens — module list (section 7)

- **Home** (Customer, Guest): the first rail is "Just in" or "New
  arrivals" as above.
- **Home**, **Shop**, **Store page** and **Favorites**: product cards
  show the two notes.

### Limitations

- The three-day window is fixed in the app; it is not set per store.
- There is no scheduled "drop": a Store Manager cannot hold products back
  until a set time, shoppers cannot reserve an item, and there are no
  push notifications for new listings. Holding stock for a reservation
  would need a server process to release expired holds, and remote push
  notifications do not work in Expo Go on Android.
- A shopper with the app open sees a product leave "Just in" the next
  time the list refreshes, not at the exact moment it turns three days
  old.

### Verification

Lint unchanged at 0 errors. No rules change, so the rules test suite is
unaffected. Checked on a device against production (1 Oct 2026): an ukay
test listing with a stock of 1, added through the rules as a Store
Manager (`scripts/add-test-product.mjs`), appeared first in Home's "Just
in" rail with the "Just in" note and "One of a kind" beside its price,
and its product page showed all five photos (section 23) with zoom and
the flaw disclosure. The listing was removed afterwards.

---

## 25. Price drop on saved items — NEW

Shoppers often save an ukay piece and come back to it later rather than
buying on the spot. Before this, Favorites showed a saved item's current
price but not whether it had changed since it was saved.

> **Status (1 Oct 2026):** built; display only. No security rules or
> stored fields change, so nothing needs deploying and the APK used for
> the UAT survey is unaffected.

### What changed — suggested wording (extends Favorites, section 15)

> When a saved item's current price is lower than its price when it was
> saved, its card in Favorites says so under the price — for example,
> "Down from ₱450" beneath ₱350. Nothing is shown when the price has
> risen or not changed, or when the item is sold out or no longer
> available.

**Deliberately plain.** One line in Moss under the price, not a
struck-through sale tag or a percentage badge, consistent with the design
principles in PRODUCT.md. Price-drop push notifications were considered
and left out (see Limitations).

### Functional requirements

| # | Requirement |
|---|---|
| FR-W1 | Favorites shows "Down from ₱X" under a saved item's price when its current price is lower than the price X it was saved at, unless the item is sold out or no longer available. |

### Use case updates

**Favorites** (Customer) — whichever use case covers viewing saved
items: add:

> Each saved item whose price has dropped since it was saved shows the
> price it came down from.

### Business rules

- The comparison is against the price when the customer saved the item.
  Removing the item from Favorites and saving it again starts from the
  price at that time.
- Only drops are noted; a price rise is not.
- Only Favorites shows the note. Home, Shop and store pages are
  unchanged.

### Data model changes

None. A favorite already stores a copy of the product, including its
price, when it is saved (section 15); the note compares that price with
the live product's.

### Screens — module list (section 7)

- **Favorites** (Customer): product cards show the price-drop note.

### Limitations

- There is no notification: the customer sees a drop the next time they
  open Favorites. Notifying them would need a server process that runs
  when a price changes, stored device tokens, and remote push
  notifications, which do not work in Expo Go on Android.
- A drop that is later reversed leaves no trace; the note reflects only
  the current price against the saved one.

### Verification

Lint unchanged at 0 errors. No rules change, so the rules test suite is
unaffected. Checked on a device against production (1 Oct 2026): a test
listing (`scripts/add-test-product.mjs`) was saved to Favorites by a
customer account, its price lowered through Edit Product by the Store
Manager, and Favorites then showed "Down from" the saved price under the
new one. The listing was removed afterwards.

---

## 26. Change password while signed in — NEW

Before this, the only way to change a password was Reset Password
(section 13), which emails a link. That fails for any account whose
email address can't receive mail, and asks a user who knows their
password to leave the app to change it.

> **Status (1 Oct 2026):** built. Firebase Authentication only: no
> security rules, stored fields or Cloud Functions change, so nothing
> needs deploying and the APK used for the UAT survey is unaffected.

### What changed — suggested wording

> A signed-in user can change their password from their account:
> customers from Profile (Account → Change Password), Store Managers from
> the Account section at the foot of their dashboard, and Platform Admins
> from "Your account" at the foot of Manage Users. They enter their
> current password, then the new password twice. When it is accepted, the
> app confirms "Password changed" and the user keeps working; the new
> password applies the next time they log in.

### Functional requirements

| # | Requirement |
|---|---|
| FR-A1 | The system lets a signed-in customer, Store Manager or Platform Admin change their password. |
| FR-A2 | The system requires the current password before changing it, and states "That isn't your current password." when it is wrong. |
| FR-A3 | The new password must be at least 8 characters (the same minimum as Sign Up), must differ from the current one, and must be entered twice identically; each problem is named under its field. |
| FR-A4 | The change cannot be submitted while offline, and too many failed attempts are refused with a message to wait and try again. |

### Use case updates

**New use case — Change Password** (Customer, Store Manager, Platform
Admin):

> *Precondition:* the user is logged in. *Main flow:* the user opens
> Change Password, enters their current password and the new password
> twice, and taps Change password; the system confirms "Password
> changed". *Alternate flows:* wrong current password; new password too
> short, the same as the current one, or not matching its confirmation;
> too many attempts; no connection. Each says what to fix and leaves the
> password unchanged. *Postcondition:* the new password is required at
> the next log in; the old one no longer works.

A user who has forgotten their current password is directed to Reset
Password, which stays as it is.

### Business rules

- The current password is checked again even though the user is logged
  in, so someone holding an unlocked phone cannot take over the account.
- The minimum length is shared with Sign Up, so the two cannot drift
  apart.

### Data model changes

None. Passwords are held by Firebase Authentication, not in the database.

### Screens — module list (section 7)

- **Profile** (Customer): Change Password row in Account.
- **Store Manager dashboard**: Account section below Manage.
- **Manage Users** (Platform Admin): "Your account" row at the foot of the
  list.

All three open the same Change Password sheet.

### Limitations

- Per Firebase's documentation, a password change ends the account's
  other sessions: another device signed in to the account is signed out
  when its sign-in next renews, within about an hour, not instantly. This
  was not tested.
- Changing the password is not recorded in the account activity log.

### Verification

Lint unchanged at 0 errors. No rules change, so the rules test suite is
unaffected. Against the local Auth emulator: a wrong current password
was refused without signing the user out; the right one, followed by the
change, succeeded; afterwards the old password was refused at log in and
the new one accepted. Checked on a device against production (1 Oct
2026) with a throwaway customer account: each validation message, a
successful change, and logging in again with the new password. Staff
passwords were not changed while the UAT survey uses those accounts.

---

## 27. "New this week" on a store's page — NEW

A store's page (section 16) listed everything it sells in one grid,
newest first. A regular shopper returning to an ukay store, where every
piece is one of a kind, had no quick way to see what had arrived since
their last visit.

> **Status (1 Oct 2026):** built; display only. No security rules or
> stored fields change, so nothing needs deploying and the APK used for
> the UAT survey is unaffected.

### What changed — suggested wording (extends the store page, section 16)

> A store's page shows a "New this week" row above its search: the
> store's products listed in the last seven days that are not sold out,
> newest first, with how many there are — for example, "3 pieces listed
> in the last 7 days". The row scrolls sideways and shows up to twelve.
> It is not shown when the store has listed nothing in that time, or when
> everything the store sells is new, since "All items" below already
> starts with those.

**Deliberately plain.** A heading and a count, not a banner or a
countdown, consistent with the design principles in PRODUCT.md. Garment
tabs (Dresses, Tops, Bottoms) and a "Sale" tab were considered at the
same time; see Limitations.

### Functional requirements

| # | Requirement |
|---|---|
| FR-T1 | A store's page shows the store's products listed within the last seven days, excluding sold-out ones, in a "New this week" row with their count. |
| FR-T2 | The row is not shown when the store has no such products, or when every product the store sells is one of them. |
| FR-T3 | The store's search and Ukay-Ukay / Ready-to-Wear tabs narrow "All items" only, not the "New this week" row. |

### Use case updates

**View Store Page** (Customer, use case 2.5): add:

> Below the store's rating, the customer sees what the store has listed
> this week, and can open any of those products or save it to Favorites
> from there.

### Business rules

- "Listed" is the product's `createdAt`, as for "Just in" (section 24).
  Editing a product does not make it new again.
- The window is seven days, not the three of "Just in": one store adds
  stock less often than the whole catalog does, so three days would
  leave most stores' rows empty. A product listed in the last three days
  also carries its own "Just in" note in the row.

### Data model changes

None. The row is worked out from the existing `createdAt` and `stock`
fields.

### Screens — module list (section 7)

- **Store page** (Customer): "New this week" row between the rating and
  the search.

### Limitations

- The seven-day window is fixed in the app; it is not set per store.
- Garment tabs (Dresses, Tops, Bottoms) were not part of this change:
  products had no required garment type to build them on. They were
  added next, with a new Item category field (section 28).
- There is no "Sale" section. Products have no original or sale price,
  and a sale section is the flash-sale pattern PRODUCT.md rules out;
  Favorites already notes a price drop on a saved item (section 25).
- There is no "Follow" for stores, and no notification when a store
  lists something new.

### Verification

Lint unchanged at 0 errors. No rules change, so the rules test suite is
unaffected. Checked in the web build against the local emulators, with
products backdated in the emulator: a store with two new pieces, one new
but sold-out piece and two older ones showed the row with "3 pieces" —
the sold-out and older pieces left out — and all six in "All items"; a
store whose only product was new showed no row; and the store search
still stayed pinned under the header when scrolled. Not yet checked on a
device.

---

## 28. Item category and a store's category tabs — NEW

A store's page listed everything it sells in one grid, so a shopper
after a dress had to scroll past every shirt and pair of jeans. Products
recorded who they were for (section 21) but not what kind of item they
were. The nearest field, the measurement type, was optional and saved
only with measurements, so most products had none.

**A note on terms.** Elsewhere in these notes "category" means the
product type, Ukay-Ukay or Ready-to-Wear (as in "category tabs"). This
section adds a separate field, the **item category**: what kind of item
it is. The app labels it "Category" because the type is labelled "Type"
in Add and Edit Product.

> **Status (1 Oct 2026):** built and tested against the emulator; the
> security rules are deployed. The deploy does not affect the APK used
> for the UAT survey: it can still add and edit products, without an
> item category.

### What changed — suggested wording

> Every product records its item category, chosen by the Store Manager
> from seven: *Tops*, *Outerwear*, *Bottoms*, *Dresses*, *Footwear*,
> *Bags* or *Accessories*. A line under the choices says what each covers
> (for example, Bottoms: "Pants, jeans, shorts, skirts"). It is required
> when adding a product of either type. The product page shows it with
> the Section, for example "Women's Tops".
>
> A store's page has a chip for each item category the store sells, under
> its search: for example *All · Tops · Bottoms · Dresses*. A store
> selling only one has none. The chips combine with the Ukay-Ukay /
> Ready-to-Wear tabs and the search. Searching the Shop or a store for an
> item category's name ("dress", "tops") finds the products in it.
>
> The item category also decides which measurements Add and Edit Product
> ask for (Bottoms: waist, hip, inseam, rise, length), replacing the
> separate "what kind of item is this?" choice in the Measurements
> section, so the Store Manager answers the question once.

### Functional requirements

| # | Requirement |
|---|---|
| FR-K1 | The Store Manager must choose an item category when adding a product, and can change it when editing. |
| FR-K2 | The product page shows the item category with the Section ("Women's Tops"). |
| FR-K3 | A store's page offers a chip for each item category among its products, plus All, when there are at least two; they combine with the type tabs and the search. |
| FR-K4 | The Shop's and a store's search match a product's item category by name. |
| FR-K5 | The item category sets which measurements are asked for. Changing it to one measured differently, after measurements were entered, asks first, and says they will be cleared. |
| FR-K6 | A product listed before the item category existed appears under All only, keeps its measurements, and must be given an item category the next time it is saved in Edit Product. |

### Use case updates

**Add Product** (Store Manager): add, after the Section:

> The Store Manager selects the item category. The Measurements section
> then shows the measurements for that kind of item.
>
> *Alternate flow — no item category selected:* the system highlights
> the field with "Pick what kind of item it is." and does not save the
> product.
>
> *Alternate flow — item category changed after measurements were
> entered:* if the new one is measured differently, the system asks
> "Change category?" and clears the measurements only if the Store
> Manager confirms.

**Edit Product** (Store Manager): add:

> *Alternate flow — product created before the item category existed:*
> the product opens with none selected and the note "Needed to save"; the
> Store Manager must select one before any change can be saved. Undoing
> the item category also restores any measurements the change cleared.

**View Store Page** (Customer, use case 2.5): add:

> The customer may select an item category chip to narrow the store's
> items. The selection combines with the type tab and the search text.

### Business rules / security (enforced by security rules)

- `category` must be one of `tops`, `outerwear`, `bottoms`, `dresses`,
  `footwear`, `bags` or `accessories`, on create and on edit.
- Requiring it on every new product is enforced by the app, not yet by
  the security rules, for the same reason as Section (section 21): the
  UAT survey APK predates the field. The rule is tightened once every
  installed build sends it.
- Outerwear is measured like Tops, and Dresses like the existing
  "Dresses & One-Piece" measurements; the other item categories match
  the measurement type of the same name. Moving between two measured the
  same way keeps what was entered.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `products` | `category` (string, one of the seven above) | Required by the app on new products. |

`measurementType` is unchanged and still saved with the measurements; it
now follows the item category instead of being chosen separately.

### Screens — module list (section 7)

- **Add Product / Edit Product** (Store Manager): new Category field;
  the Measurements section no longer has its own type choice.
- **Store page** (Customer): item category chips under the search.
- **Product Details** (Customer): item category shown with the Section.

### Limitations

- The item category chips are on a store's page only, not on the Shop,
  which already has the type tabs and the Section filter.
- Products listed before this change, including any added from the
  survey APK, show only under All until a Store Manager edits them and
  picks an item category. (`scripts/seed-catalog.mjs` fills it in for
  the products it seeded.)
- Search matches the item category's name, not synonyms: "jeans" finds
  products named jeans, not every product filed under Bottoms.

### Verification

Rules test suite 148 → **150**: each of the seven values is accepted,
and so is a product from a build with neither Section nor item category
(the survey APK's shape); an unknown value is refused on create and on
edit; a product without one can still be edited and given one. Against
the emulator, as a Store Manager: the survey APK's shape was accepted,
"Dresses" (capitalised) refused and "dresses" accepted. Lint unchanged at
0 errors.

Checked in the web build against the local emulators. A store with tops,
outerwear, bottoms and dresses showed *All · Tops · Outerwear · Bottoms ·
Dresses*; Bottoms showed its two products; a product without an item
category appeared under All only; "jeans" found only the product named
jeans; the product page read "Women's Bottoms". Add Product refused to
save without an item category, and picking Bottoms showed the Bottoms
measurements. Edit Product, on a product with Tops measurements and no
item category: Outerwear kept the measurements without asking; Bottoms
asked first and then showed the Bottoms measurements; Undo restored the
Tops measurements; saving with Bottoms stored `category` and
`measurementType` as `bottoms`. A full Add Product save, as the Store
Manager (front photo given as an image link rather than uploaded):
Women, Dresses, ready-to-wear, size M with a bust of 18; it was stored
with `category` `dresses` and `measurementType` `onepiece`, and the
shopper then saw it under the store's Dresses chip (and not the Tops
product) with "Women's Dresses" on its product page.

---

## 29. Photos on a review — NEW

A review could say an item was "Not like the photos" but could not show
it. The only picture on a review was the author's profile photo. A buyer
can now add photos of the item as it arrived.

> **Status (1 Oct 2026):** built and tested against the emulator; the
> Firestore and Storage rules are deployed, and a review with a photo was
> posted from a phone against production. The change does not affect the
> APK used for the UAT survey: its reviews, which have no photos, are
> still accepted.

### What changed — suggested wording

> When writing or editing a review, the customer may add up to three
> photos of the item, taken with the camera or chosen from their library.
> Each photo is uploaded when it is picked and can be removed before
> posting. Photos are optional and appear in the preview of the review.
>
> On the product page, a review's photos appear under its text; tapping
> one opens it full screen, where the customer can swipe between them and
> zoom. The Store Manager sees the same photos on each review in Reviews,
> and hiding a review hides its photos with it.

### Functional requirements

| # | Requirement |
|---|---|
| FR-V1 | A customer writing or editing a review may add up to three photos, from the camera or the photo library. |
| FR-V2 | Photos are optional, and the customer can remove any of them before posting or updating. |
| FR-V3 | A review's photos appear on the product page under its text and open full screen when tapped. |
| FR-V4 | The Store Manager sees each review's photos in Reviews. Hiding a review hides its photos. |

### Use case updates

**Write a Review** (Customer, section 9a): add, after the written note:

> The customer may add up to three photos of the item. The system
> uploads each one and shows it in the review's preview.
>
> *Alternate flow — upload refused:* the system shows "Photo not added"
> with the reason (too large, unsupported format, no connection) and
> keeps the rest of the review as it was.

### Business rules / security (enforced by security rules)

- `photoUrls` is optional; if present it is a list of at most three
  strings, each no longer than 2000 characters, on create and on edit.
  Only the review's author may change it.
- A photo can be uploaded to `reviews/{customer}/{order}/` only by that
  customer, only once that order is delivered, and only as a JPEG, PNG or
  WebP under 5 MB.
- Photos cannot be replaced or deleted from storage, the same as order
  chat photos.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `reviews` | `photoUrls` (list of strings, optional, at most 3) | The buyer's photos of the item. Omitted when there are none. |

### Screens — module list (section 7)

- **Write a Review** (Customer): an "Add photos" row under the written
  note, and the photos in the preview and the posted review.
- **Product Details** (Customer): photos under each review's text, opening
  full screen.
- **Reviews** (Store Manager): photos on each review card.

### Limitations

- A photo removed before posting, or replaced by an edit, stays in
  storage. Clearing those would be a server-side job, as for product
  photos.
- The Store Manager cannot hide one photo on its own; hiding applies to
  the whole review.

### Verification

Rules test suite 150 → **152**: three photos are accepted on create; a
review without photos can be given one and then have it cleared; four
photos, a single string instead of a list, a non-string entry and a URL
over 2000 characters are refused; a Store Manager and another customer
cannot change a review's photos. The Storage rules load in the emulator
without errors. Lint unchanged at 0 errors.

---

## 30. Order status emails — NEW

The app tracked an order's status (Placed → Processing → Shipped →
Delivered), but the customer saw a change only by opening My Orders. The
only email was the confirmation sent when the order was placed. The
customer is now emailed when the order ships, is delivered, or is
cancelled.

> **Status (1 Oct 2026):** built and tested against the emulator, and the
> function is deployed to production. An order marked Delivered from a
> phone against production sent the customer the email. It runs
> entirely in Cloud Functions, so no rules change was needed. The APK
> used for the UAT survey is unaffected, and its customers get the
> emails too.

### What changed — suggested wording

> When the Store Manager changes an order's status to Shipped, Delivered
> or Cancelled, the system emails the customer. Each email gives the
> order number, the store, the items and the total, and what happens
> next: delivery times and, for Cash on Delivery, a reminder to pay the
> rider (Shipped); how to review the items and report damage (Delivered);
> and, for an order already paid online, that refunds are arranged with
> the store (Cancelled).
>
> Each update is sent at most once per order. Moving an order to
> Processing sends no email. Status update emails appear in the Store
> Manager's Email Delivery log as "Order update", and one that failed can
> be sent again from there, unless the order has since moved to another
> status.

### Functional requirements

| # | Requirement |
|---|---|
| FR-E1 | The system emails the customer when their order's status changes to Shipped, Delivered or Cancelled. |
| FR-E2 | Each of those emails is sent at most once per order, including when the Store Manager undoes a status change and makes it again. |
| FR-E3 | A cancellation email for an order paid online tells the customer that refunds are not automatic and are arranged with the store. |
| FR-E4 | Status update emails are recorded in the Email Delivery log. The Store Manager may resend one that failed, only while the order is still at that status. |

### Use case updates

**Update Order Status** (Store Manager): add as a postcondition:

> If the new status is Shipped, Delivered or Cancelled, the system
> emails the customer. A failed email does not undo the status change.

### Business rules / security

- The email is sent by a Cloud Function, not the app, so a customer or a
  Store Manager cannot choose who receives it or what it says.
- A change to an order that does not touch its status (order chat, a
  payment confirmation) sends nothing.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `mailLog` | `kind: 'orderStatus'` and `orderStatus` | Which order update an entry was for. Written by the server only. |

### Screens — module list (section 7)

- **Email Delivery** (Store Manager): status update emails listed as
  "Order update".
- **Help** (Customer): "How do I track my order?" mentions the emails.
- **Privacy Policy**: "How we use your information" includes the status
  emails.

### Limitations

- If the Store Manager marks an order Shipped and taps Undo, the email
  has already gone. Marking it Shipped again does not send a second one.
- There are no push notifications. Expo Go on Android does not support
  them, and the demo runs on Expo Go.
- There is no live delivery tracking (no courier link or rider map).

### Verification

Email test suite 20 → **28**: shipping sends one email and records it
for the order's store; Processing sends nothing; a write that leaves the
status alone (chat, payment) sends nothing; Undo and re-ship sends once;
the wording changes for COD and paid-online orders; an order with no
usable email sends nothing; a failed update can be resent; an update
for an order that has since moved on is refused without using up an
attempt. Lint unchanged at 0 errors.

---

## 31. Still outstanding — SRS-side only, no code changes needed

From [SRS_AUDIT.md](SRS_AUDIT.md). Category A (things the SRS promised
that the app didn't do) is now empty. These remain, and are all
documentation gaps:

**Category B — the app does it, the SRS doesn't mention it**
- Password reset by email (a full flow exists; the SRS documents only
  registration and login/logout). Section 13 now gives a use case for it.
- A Store Manager can set an order status of "Cancelled", which restores
  the stock checkout decremented, and is permitted only from Pending or
  Processing. See section 4a — the SRS documents neither the restoration
  nor the restriction.
- The Help screen offers four contact channels, topic filters, a support
  request form routed to the right store, an app-share action, and
  published support hours, beyond the "searchable FAQ" the SRS describes
  (section 16).

**Category C — both mention it, but describe it differently**
- Signup postcondition: the SRS says the user is redirected to the login
  page; the app signs them in and goes to Home, because account creation
  authenticates them automatically.
- "Out of Stock notification": the app marks the product "Sold out" and
  disables Add to Cart and Buy Now rather than displaying a message.
- "Invalid Quantity" error: quantity is a stepper with a disabled
  decrement, so zero or negative input is structurally impossible and the
  error branch the SRS describes cannot occur.
- Order status vocabulary differs between the staff view (five statuses)
  and the customer view (pending and processing collapsed into one).

Note also that the SRS's own audit report keeps the *original* findings
alongside the resolutions, so the historical text describes the system as
it was, not as it is.
