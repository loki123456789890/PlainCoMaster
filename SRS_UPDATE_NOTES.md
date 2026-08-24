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
| `customer` (or field absent) | Customer | Browse, order, favourite, submit support requests, review items they have received | Reach any staff screen |
| `seller` | **Store Manager** | Products, orders, support requests, review moderation | Read or modify user accounts |
| `platformAdmin` | **Platform Admin** | User accounts: grant roles, activate/deactivate | Products, orders, support, reviews |

Suggested wording:

> PlainCo defines three user roles. Customers browse, purchase, and may
> review items they have received. Store Managers operate the shop —
> products, orders, support requests, and review moderation. Platform
> Admins manage user accounts and roles. The two staff roles are
> deliberately non-overlapping: a Store Manager has no access to user
> accounts, and a Platform Admin has no access to store data. This
> separation is enforced by Cloud Firestore security rules, not merely by
> hiding screens in the interface.

Anywhere the SRS says "admin", decide which of the two it means and say
that instead. The word "admin" alone is now ambiguous.

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
- **`orders` create** — exact key allowlist, `customerId` bound to the
  authenticated caller, numeric non-negative totals, server-set
  `createdAt`, and `status` forced to `pending`. A customer cannot create
  an order that arrives in any other state. See section 9 for why that
  last clause matters more than it looks.
- **`orders` update** — confined to the `status` field, restricted to the
  five known statuses, and the transition to `cancelled` is allowed only
  from `pending` or `processing`. See section 4a.
- **`reviews` create** — exact key allowlist, `userId` bound to the
  caller, `rating` an integer 1–5, `matchedDescription` a boolean, text
  capped at 1000 characters, `hidden` forced to `false`, server-set
  `createdAt`, and the document id required to match the `orderId` and
  `productId` inside it. Updates are split into two disjoint branches: the
  author may revise rating, answer, and text and nothing else; a Store
  Manager may set `hidden` and nothing else. No role may delete. See
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
| `activityLogs` | Store Manager | Product create / edit / delete, order status changes | Store Manager |
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

**Reviews screen** (Store Manager) — the moderation queue, opening on the
reviews that reported an item did not match its description. See
section 9.

---

## 8. Verification — worth a short section if the SRS has one

The security rules have an automated test suite: **79 tests** run against
the Firestore emulator via `npm run test:rules`. Coverage includes
privilege escalation attempts, role separation in both directions, field
validation, checkout stock rules, order cancellation, audit log
integrity, order creation, and the verified-purchase chain behind reviews.
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

---

## 9. Product reviews — NEW, from panel feedback

A panellist asked for "reviews for seller and customer". That suggestion
assumes a **multi-vendor marketplace**, which PlainCo is not: there is one
store, the `seller` role is that store's own manager, and products carry
no `sellerId`. A seller rating would therefore be a single number with
nothing to compare it against, and a customer rating would feed no
decision the store ever makes — while publishing reputation data about
consumers.

What the suggestion was reaching for is the trust problem the SRS and
`PRODUCT.md` both already name: shoppers must believe the condition of
secondhand clothing bought sight-unseen. That is a claim about an **item**.
So the implementation is **product reviews restricted to verified
purchases**.

Suggested wording:

> Customers may review a product they have purchased, once the order
> containing it has been marked Delivered. A review records a 1–5 star
> rating, an answer to "did the item match its description?", and optional
> free text. Reviews are visible to all signed-in users on the product
> page. PlainCo does not rate sellers or customers: the system is a single
> store, so neither rating would carry information.

**The verified-purchase chain.** "Verified" is enforced in
`firestore.rules`, not asserted by the interface, and it is a chain of
three rules:

1. Order creation pins `status` to `'pending'` — a client cannot create an
   order that arrives already Delivered.
2. Only a Store Manager may move an order to `'delivered'`.
3. A review is accepted only against the author's **own** order, in status
   `'delivered'`, containing the product being reviewed.

Link 1 was added in this change specifically to support link 3. Without
it, a client could mint its own proof of purchase and review any product
it named.

**One review per order line** is structural rather than conventional: the
review's document id is derived as `orderId_productId` and the rule
requires it to match the fields inside, so a duplicate is a write to a
document that already exists. Buying the same item again on a later order
earns a second review, which is correct.

**The ukay-ukay problem, and why "did it match the description?" exists.**
Secondhand pieces are frequently one of a kind — stock 1, sold once — so a
per-product average is a permanent sample of one, and most product pages
would read "No reviews yet" forever. "Did it match the description?" is
the same question about every listing in the store, so it aggregates
store-wide and says something useful about an unreviewed item. A product
with no reviews of its own shows that store-wide figure instead of an
empty state.

**Moderation is hiding, never deletion.** A Store Manager may set a
`hidden` flag and nothing else — the rules grant no delete on reviews to
any role, and no write to a review's rating or text. This mirrors the
existing decision that accounts are deactivated rather than deleted (SRS
§2.4), and for the same reason: a store that can erase reviews can erase
the unflattering ones, and no reader could tell a clean record from a
cleaned one. Every hide and restore is written to the Store Activity log.

**Privacy.** A review displays the author's first name and last initial
("Hans V."), abbreviated at write time so the full name is never stored in
a document other shoppers can read.

**Honest limitations**, all the same boundary the activity log already
draws (no Cloud Functions in this project):

- Rating aggregates are computed on the client from the reviews
  themselves, not stored as counters on the product. A server-side trigger
  is the production answer; a client-maintained counter would be
  tamperable.
- Firestore rules cannot inspect a query's filters, so a hidden review is
  still fetchable by a client querying the collection directly. The app
  filters them from every list it renders, and the rules guarantee that
  hiding is the only moderation available and that it is logged.
- Orders placed before this change carry no `productIds` field and their
  lines cannot be reviewed. Failing in that direction is deliberate: the
  alternative would make the check optional for any write that omitted the
  field.

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
> 6. The system stores the review and confirms.
>
> **Postcondition:** The review is visible on the product page to all
> signed-in users, attributed to the author's first name and last initial.
> The order line now offers "Edit your review" instead.
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

### 9b. Data model — one new collection, one changed field

**New collection: `reviews/{orderId}_{productId}`.** The document id is
derived rather than random; see the note on one review per order line
above.

| Field | Type | Notes |
|---|---|---|
| `orderId` | string | The delivered order the review was earned on. Immutable after creation. |
| `productId` | string | The item reviewed. Immutable after creation. |
| `productName` | string ≤ 120 | Snapshot at write time — a product can be renamed after the sale. |
| `userId` | string | The author. Bound to the authenticated caller; immutable. |
| `userName` | string ≤ 60 | First name and last initial. Snapshot, because `/users` is unreadable to other shoppers. |
| `rating` | integer 1–5 | Whole stars only. |
| `matchedDescription` | boolean | "Did the item match its description?" |
| `text` | string ≤ 1000 | Optional free text. |
| `hidden` | boolean | Moderation flag. Always `false` at creation; only a Store Manager may change it. |
| `createdAt` | timestamp | Server-set; cannot be backdated. |
| `updatedAt` | timestamp | Present only on a revised review. Server-set. |

**Changed collection: `orders`** — one field added.

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

## 10. Still outstanding — SRS-side only, no code changes needed

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
