---
target: screens/Homescreen.js
total_score: 22
p0_count: 1
p1_count: 4
timestamp: 2026-07-19T02-33-07Z
slug: screens-homescreen-js
---
Method: dual-agent (A: a192837fa0bce24b8 · B: aab49f9686c9a79ea)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | Skeleton + crossfade are well done, but a failed Firestore fetch renders identically to a genuinely empty catalog — no error branch exists |
| 2 | Match Between System and Real World | 4/4 | ₱ formatting, PH-native "Ukay-Ukay" terminology, time-aware greeting, recognizable icons — solid |
| 3 | User Control and Freedom | 3/4 | Favoriting is a clean reversible toggle; no search entry point on Home, no pull-to-refresh/retry anywhere on the ScrollView |
| 4 | Consistency and Standards | 1/4 | Hero CTA reimplements `Button` with different numbers (`Radius.lg`=16 + `padding:14/36` vs. the shared component's `Radius.md`=12 + `Spacing.md/lg`=16/24); `ecoStrip` hand-rolls the exact tinted-pill formula `Badge` already encodes; ~23 total drift/violation findings from the technical pass |
| 5 | Error Prevention | 3/4 | Low-risk browse screen; nothing meaningfully guards against, because there's little to break |
| 6 | Recognition Rather Than Recall | 4/4 | Every nav icon is paired with a text label; no hidden/memorized paths |
| 7 | Flexibility and Efficiency of Use | 1/4 | Zero accelerators (recents, price sort/filter) for the "price-and-deal-driven, short casual session" persona PRODUCT.md names as primary |
| 8 | Aesthetic and Minimalist Design | 2/4 | Two full-bleed color tiles + 4 CTAs into the same destination read closer to marketplace-tile density than PlainCo's documented "restrained" identity |
| 9 | Help Recognize/Diagnose/Recover from Errors | 0/4 | No error state exists at all on this screen — confirmed by both assessments independently |
| 10 | Help and Documentation | 2/4 | Appropriately light-touch for a product-register screen, but zero trust/condition reassurance despite that being the product's core named anxiety |

**Total: 22/40 — Acceptable** (significant improvements needed before this reads as fully shipped, but the foundation — token usage, motion discipline, locale correctness — is genuinely solid)

## Anti-Patterns Verdict

**LLM assessment (Assessment A):** Borderline. The code underneath shows real craft (per-element reduced-motion handling, a skeleton shaped exactly like the live row, a controlled three-keyframe favorite pulse) — that is not what generic AI output looks like. But the *composition* is the single most template-shaped e-commerce layout available: stock hero photo + overlay CTA → two solid-color category tiles → horizontal carousel → four-tab nav. Verdict: not slop in execution, but slop in silhouette — a well-built version of a generic template rather than something designed from PlainCo's own "Neighborhood Thrift Counter" north star. The hero is an unbranded Unsplash photo of folded denim with no connection to an actual PlainCo product; "Looking for New Clothes in Minutes?" leans toward the promotional tone PRODUCT.md explicitly says to avoid.

**Deterministic scan:** The skill's standard `detect.mjs`/browser-injection tooling is web-only (HTML/CSS + DOM) and does not apply to a native React Native screen — there is no browser or dev server to inject into. Assessment B substituted a manual, deterministic native-evidence pass instead: grepping every interactive element for accessibility props, computing WCAG contrast ratios with real hex values from `constants/theme.ts` via a Node script, measuring approximate touch-target boxes against the 44pt(iOS)/48dp(Android) minimums, and checking hardcoded-color and dead-import hygiene. Findings: **7 accessibility gaps, 3 touch-target failures (2 confirmed, 1 marginal), 6 confirmed contrast failures, 2 unused imports, 3 component-reuse violations, 2 confirmed platform-conformance violations** (~23 total). Full detail in Priority Issues and Minor Observations below. No user-visible overlay is available for this target — native screens have no DOM to inject into, so there is nothing to view in a browser tab.

## Overall Impression

The craft is real — this is not a screen an inexperienced team shipped. Every animation respects reduced motion independently, the loading skeleton is pixel-matched to the real content, and the color system is used correctly almost everywhere it appears. But the screen is still fighting itself in two ways: it doesn't fully trust its own design system (the two highest-traffic interactive elements — the hero button and the category tiles — are hand-rolled instead of routed through `Button`/`Card`, with measurably different numbers as a result), and it doesn't yet address the one thing PRODUCT.md says this product has to earn — trust in buying secondhand goods sight-unseen. The single biggest opportunity: this screen currently sells "browse our catalog" four different ways before it sells "you can trust what you're buying here" even once.

## What's Working

- **Reduced Motion is honored independently in five separate places** (`AnimatedPressable`, `FavoriteButton`, `FadingImage`, `SkeletonBlock`, `HeroImage`), not faked once and skipped elsewhere. This is the kind of accessibility discipline that's trivial to fake and hard to actually maintain consistently — here it's real.
- **The loading skeleton is shaped exactly like the live content it replaces**, so there's zero layout shift on data arrival — the "skeleton, not spinner" pattern PRODUCT.md's own register guidance calls for, executed correctly rather than just referenced.
- **Locale and token correctness in the small things**: ₱ formatting, a genuinely time-aware greeting, and gold used *only* for price — exactly matching DESIGN.md's "gold reserved for money" rule with no drift, verified by direct contrast computation (4.79:1, matches the token's own code comment).

## Priority Issues

**[P0] No distinction between an empty catalog and a failed fetch**
- **Why it matters**: `useProducts()` exposes an `error` field (confirmed in `context/ProductContext.js`) that Homescreen.js never reads. A user on flaky mobile data — the primary connectivity mode PRODUCT.md names for this audience — sees "Nothing here just yet — we're still unpacking" whether the shop is genuinely empty or Firestore just failed. There's no retry action anywhere: no `RefreshControl` on the outer `ScrollView`, no pull-to-refresh, no manual reload path. A real outage looks identical to "we have no inventory," which is a materially worse thing for a shopper to believe about a marketplace.
- **Fix**: Read `error` from `useProducts()`. On error, render a distinct `EmptyState` (e.g. `icon="cloud-offline-outline"`, title "Couldn't load picks", subtitle "Check your connection") with a `Button` that calls `refreshProducts()` (or triggers a re-fetch) — visually and textually distinct from the true-empty state.
- **Suggested command**: `/impeccable harden`

**[P1] Two of the highest-traffic elements bypass the shared component system, with measurable drift**
- **Why it matters**: DESIGN.md's stated reason the shared component vocabulary exists at all: "the same Button/Input/Card/Badge vocabulary everywhere is what makes buying secondhand feel safe — inconsistency reads as risk." The hero CTA reimplements `Button` by hand with different numbers than the actual component (`Radius.lg`=16px + `paddingVertical:14`/`paddingHorizontal:36` vs. `Button`'s `Radius.md`=12px + `Spacing.md`=16/`Spacing.lg`=24) — not a stylistic choice, a literal numeric mismatch from the system's own source of truth. Separately, `ecoStrip` hand-builds the exact "tinted pill" formula `Badge` already encodes (`backgroundColor: color+'20'`, `color: color`) as a raw `View`+`Text` instead of importing it.
- **Fix**: Route the hero CTA through `<Button variant="primary" label="Start Shopping" onPress={...} />`. For `ecoStrip`, either accept the duplication as intentional (it's not a badge semantically) or extract the shared "tinted pill" pattern so both call sites use one implementation. (Category/product cards' non-adoption of `<Card>` was considered and is a softer case — see Minor Observations.)
- **Suggested command**: `/impeccable polish`

**[P1] Four separate elements all resolve to the same destination, undifferentiated in weight**
- **Why it matters**: The hero "Start Shopping" CTA, the Ukay-Ukay tile, the Ready-to-Wear tile, and "See all" all navigate to `Shop` (optionally filtered), rendered at comparably strong visual weight, all above or barely below the fold. This is the direct cause of three separate cognitive-load-checklist failures (single focus, visual hierarchy, one-thing-at-a-time). It's also why "See all" — one of these four redundant paths — is the single worst touch-target failure on the screen: no padding, no `hitSlop`, an effective tap box of roughly 54×17pt against a 44×44pt/48×48dp minimum, over 60% short on height.
- **Fix**: Cut the hero CTA (let the two category tiles carry that job) or demote it to a text link under the headline. If "See all" survives the redundancy cut, give it real padding/`hitSlop` regardless.
- **Suggested command**: `/impeccable layout`

**[P1] No secondhand/new signal on the one screen where first impressions form**
- **Why it matters**: PRODUCT.md's own positioning: "one catalog... distinguished by type tags." DESIGN.md documents a `Badge` component specifically for product type. Featured Picks cards currently render only image, favorite heart, name, and price — nothing tells a shopper whether an item is Ukay-Ukay or Ready-to-Wear without tapping in, on exactly the axis the product's own positioning says should never require a second step.
- **Fix**: Add `<Badge label={...} color={...} />` to each Featured Picks card using the same secondary/tint color mapping already established on the Shop and Admin Products screens.
- **Suggested command**: `/impeccable clarify`

**[P1] The favorited heart is nearly invisible during a common loading state**
- **Why it matters**: Computed, not estimated — the favorited (red, `Colors.light.danger`) heart icon sits on its `rgba(0,0,0,0.4)` backing over the image placeholder's `Colors.light.border` fill (the state that's visible before a product photo finishes decoding, or if it fails to load). That composite contrast is **1.37:1** against a 3:1 non-text-icon minimum — the icon is barely perceptible in exactly the state PRODUCT.md's own "mostly on mobile data" persona will hit often. This is a real, deterministic defect (the placeholder color is a fixed token, not photo-dependent) that survived three prior passes because none of them recomputed contrast for the loading-state backing specifically.
- **Fix**: Give the favorite button's backing a fixed, sufficiently opaque scrim regardless of load state (e.g. bump to `rgba(0,0,0,0.55)`, matching the hero's own scrim value), or use a consistently white/outline heart treatment that doesn't depend on the photo having loaded.
- **Suggested command**: `/impeccable harden`

## Persona Red Flags

**Casey (distracted mobile user)**: Casey's goal on Home is "show me something I might buy, fast." The hero is 340pt tall plus a ~40pt overlay box — Casey's entire first screenful is a stock photo and one button, zero prices, zero real products, before ever reaching anything evaluable. This directly fights the "price-and-deal-driven, short casual session" persona PRODUCT.md names as primary. Casey is also the persona most likely to actually tap "See all" one-handed and miss it — the measured 17pt-tall hit box is the kind of target a thumb-scrolling user mis-taps repeatedly.

**Jordan (confused first-timer)**: Jordan taps a Featured Pick specifically to check secondhand-vs-new and gets nothing on the card itself — no badge, has to open the product to find out, on the one dimension PRODUCT.md says needs to feel safest and fastest. When Jordan then taps the heart to save something, they're bounced into a bare native `Alert.alert()` for "Login Required" — at exactly the moment they're being asked to trust the app enough to sign up, the interface switches to an unstyled OS dialog that looks like it belongs to a different, less-finished app.

**Riley (stress-tester, flaky connection)**: On a failed fetch, Riley sees the identical "we're still unpacking — new finds land here first" copy whether the catalog is genuinely empty or Firestore just failed (P0 above), with no retry button and no pull-to-refresh anywhere on the `ScrollView`. Riley's only recourse is a full app reload — the worst possible outcome for exactly the user who tests for it deliberately.

## Minor Observations

- Nested accessible elements: the favorite-heart `Pressable` sits inside the product-card `AnimatedPressable`'s `Pressable`. Both default to `accessible={true}` in RN — a documented VoiceOver/TalkBack anti-pattern (outer element can swallow the inner one's distinct label on iOS; Android's accessibility scanner flags nested touchable nodes). Needs on-device verification to confirm severity, but the structural pattern is objectively present.
- The active "Home" tab has no `accessibilityState={{selected:true}}`/`accessibilityRole="tab"` anywhere in the bottom-nav block — a screen-reader user gets zero signal for which tab is current, only a color cue sighted users get.
- Hero CTA, category tiles, "See all", and all four bottom-nav items are missing `accessibilityRole="button"` (the favorite button is the one fully-conformant interactive element in the file — it has label, role, and state).
- Cart badge count has no spoken label (e.g. "Cart, 3 items") — a screen reader just concatenates whatever text nodes it finds.
- Every screen in this app hand-rolls its own bottom nav row rather than using a real `Tab.Navigator` — confirmed via `App.js`: the app uses only `createNativeStackNavigator`, no `createBottomTabNavigator` exists anywhere. This is a direct, named violation of ios.md's system-navigation rule and android.md's Material-navigation expectation — systemic across the app, not unique to Home.
- `navText`/`navTextActive` render at 10px, under ios.md's stated 11pt floor (the one documented 10px exception, `cartBadgeText`, is app policy per DESIGN.md; these two are not).
- `Spacing` and `Shadow` are imported from `constants/theme` but never used anywhere in the file.
- File header comment reads `// screens/HomeScreen.js`; actual filename is `Homescreen.js` — stale from a prior rename.
- Hero overlay uses `borderRadius: 20`, not one of DESIGN.md's tokens (8/12/16/24/999) — nearest documented values are `Radius.lg`(16) or `Radius.xl`(24).
- The favorited heart reuses `Colors.light.danger` (Rust) — the token DESIGN.md reserves for destructive/error states specifically so destructive actions never read as primary. Red hearts are conventional enough that this is low-risk, but it's borrowing a semantically-reserved token for an unrelated, positive meaning.

## Questions to Consider

- If four different elements on this screen all lead to the same Shop screen, what does Home look like with only one of them left — would it actually feel less finished, or just clearer?
- PRODUCT.md says trust in the transaction matters as much as trust in the product — what's the smallest thing Home could say before a first-time visitor even browses (one line about condition-checking or COD, for instance) that would do more for conversion than a second category tile does?
- The hero photo is generic stock imagery — if "Neighborhood Thrift Counter" is the actual north star, what would the hero look like built from the app's own product photography instead of Unsplash?
