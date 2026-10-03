/**
 * Fills out the live catalogue before a UAT session or the defense, and
 * raises stock so a room full of people can all reach the confirmation
 * screen.
 *
 *     # look, change nothing (default):
 *     node scripts/seed-catalog.mjs
 *
 *     # actually write:
 *     node scripts/seed-catalog.mjs --apply
 *
 * Run it once per store, signed in as that store's manager: Divisoria RTW
 * Hub (store `rtw`) gets the ready-to-wear pieces, Ukay-Ukay ni Aling Nena
 * (store `plainco`) the ukay-ukay ones. Credentials come from the
 * environment and are never stored here:
 *
 *     PLAINCO_SELLER_EMAIL=...  PLAINCO_SELLER_PASSWORD=...
 *
 * WHY A STORE MANAGER AND NOT THE ADMIN SDK. firestore.rules is the thing
 * being demonstrated, so the seed goes through it rather than around it:
 * signing in as the Store Manager means every write here is a write the
 * app itself could have made, and a product this script creates is
 * indistinguishable from one typed into AdminAddProductScreen. A service
 * account would bypass the rules and could quietly write a shape the app
 * cannot.
 *
 * WHY STOCK MATTERS MORE THAN IT LOOKS. Every order a respondent places
 * decrements real stock. A catalogue with 3 of each item runs dry halfway
 * through a session, and the respondents who follow are told "Not enough
 * stock" — which they will score against "orders are recorded correctly"
 * and "stock levels are accurate", for an app behaving exactly right. The
 * exception is ONE_OF_A_KIND below: a few ukay pieces are listed as the
 * single piece they are, so "One of a kind" and selling out can be shown.
 *
 * WHAT IT FILLS IN ON EXISTING PRODUCTS. Re-running is safe: products are
 * matched by name, and a value a manager has already set is never
 * overwritten. A product missing any of these gets one:
 *
 *   - a size guide (measurements + measurementType), from the catalogue's
 *     entry, or for a product the catalogue doesn't know, from standard
 *     measurements for its category, section and sizes (sizeGuideFor)
 *   - section, category, condition, brand and the flaws note
 *   - for ukay-ukay, the flaw check (and kinds of flaw), and the back and
 *     label photos the app asks of every ukay listing, plus a photo of
 *     each flaw. Those extra photos are labelled placeholders, not real
 *     photographs: the front is the real one.
 *
 * A few listings typed in while testing are also given a proper name,
 * description and photo (REWRITES); nothing else's text is touched.
 *
 * Anything it can't decide for a product it doesn't know — which section
 * or category it is, an ukay piece's condition — is listed at the end of
 * the dry run instead of guessed.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, collection, getDocs, getDoc, addDoc, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';

const APPLY = process.argv.includes('--apply');
const MIN_STOCK = 60;

const EMAIL = process.env.PLAINCO_SELLER_EMAIL;
const PASSWORD = process.env.PLAINCO_SELLER_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    '\nSet the Store Manager credentials first, e.g. in PowerShell:\n\n' +
    '    $env:PLAINCO_SELLER_EMAIL = "manager@example.com"\n' +
    '    $env:PLAINCO_SELLER_PASSWORD = "..."\n\n' +
    'They are read from the environment so they never end up in a file.\n'
  );
  process.exit(1);
}

const firebaseConfig = {
  apiKey: 'AIzaSyCkJSzPnZOuE64ZjmtM2eTFQKSC85JlLsQ',
  authDomain: 'plainco-c3edc.firebaseapp.com',
  projectId: 'plainco-c3edc',
  storageBucket: 'plainco-c3edc.firebasestorage.app',
  messagingSenderId: '67563837487',
  appId: '1:67563837487:web:eeb4c6bfd4534f3a414eda',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Lets this script be rehearsed against the emulators before it is aimed
// at the live store. The product shape here has to satisfy
// isNewProductShape() and productFieldsAreWellTyped() in firestore.rules
// exactly — a missing key or a string where a number belongs is refused —
// and finding that out against production, at night, before a UAT, is the
// wrong time to find it out.
if (process.env.PLAINCO_SEED_EMULATOR === '1') {
  const { connectAuthEmulator } = await import('firebase/auth');
  const { connectFirestoreEmulator } = await import('firebase/firestore');
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  console.log('[emulators] localhost — not touching production\n');
}

// `type` must be exactly one of these two strings. Shopscreen reads
// `item.type === 'ukay-ukay'` and labels everything else "Ready to Wear",
// so a typo does not fail — it silently files the product in the wrong
// category, which is precisely what Section 1 of the UAT asks about.
const UKAY = 'ukay-ukay';
const RTW = 'ready-to-wear';

// Which store sells which type, since split-stores.mjs divided the
// catalogue by type. A manager of any other store is refused.
const STORE_TYPE = { rtw: RTW, plainco: UKAY };
// scripts/seed-emulator.mjs's two stores stand in for them in a rehearsal.
if (process.env.PLAINCO_SEED_EMULATOR === '1') Object.assign(STORE_TYPE, { 'sandbox-rtw': RTW, 'sandbox-store': UKAY });

// ---------------------------------------------------------------- photos

const pexels = (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=900`;

// The same labelled placeholders as add-test-product.mjs. The app asks
// every ukay listing for its back and its label, and a flaw for a photo
// of it; no stock photograph shows the same garment from the back or its
// tag, so these stand in, plainly labelled, rather than a mismatched photo
// of some other piece.
const placeholder = (bg, fg, text) =>
  `https://placehold.co/900x1125/${bg}/${fg}/png?text=${encodeURIComponent(text).replace(/%20/g, '+')}`;
const backPhoto = () => ({ kind: 'back', url: placeholder('EFE6DA', '1C1B1A', 'Back') });
const labelPhoto = () => ({ kind: 'label', url: placeholder('E8E1D5', '1C1B1A', 'Label & size tag') });
const flawPhoto = (what) => ({ kind: 'flaw', url: placeholder('F3D9CF', 'C4463E', `Flaw: ${what}`) });

// --------------------------------------------------------- size guides
//
// Standard flat measurements, as a seller would take them, keyed by the
// app's own field names (MEASUREMENT_TYPES in constants/productOptions.js)
// and stored as the strings Add Product stores. Inches, except footwear in
// centimeters. Kids' S/M/L are roughly ages 3–4, 5–6 and 7–8.

const SIZE_INDEX = { S: 0, M: 1, L: 2, XL: 3, XXL: 4 };

// The category decides how it's measured, as in CATEGORY_OPTIONS.
const MEASUREMENT_TYPE_OF = {
  tops: 'tops', outerwear: 'tops', bottoms: 'bottoms', dresses: 'onepiece',
  footwear: 'footwear', bags: 'bags', accessories: 'accessories',
};

const str = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// One size's measurements. `fit` tunes a piece away from the default for
// its category: 'long' sleeves, 'cropped', 'shorts', 'skirt', 'midi',
// 'maxi', 'mini', 'joggers', 'loafer', 'boot'.
function measureSize(category, section, size, fit = []) {
  const i = SIZE_INDEX[size] ?? 1;
  const kids = section === 'kids';
  const women = section === 'women';
  const has = (f) => fit.includes(f);
  switch (MEASUREMENT_TYPE_OF[category]) {
    case 'tops': {
      const outer = category === 'outerwear' ? 1.5 : 0;
      if (kids) {
        return {
          chest: str(14 + i + outer), length: str(18 + 1.5 * i + outer),
          shoulder: str(12 + i), sleeve: str(has('long') || outer ? 15 + 2 * i : 5.5 + 0.5 * i),
        };
      }
      const chest = (women ? 17.5 : 19.5) + 1.5 * i + outer;
      const length = (women ? 23 : 27) + i + (outer ? 1 : 0) - (has('cropped') ? 4 : 0);
      return {
        chest: str(chest), length: str(length),
        shoulder: str((women ? 15 : 17) + i),
        sleeve: str(has('long') || outer ? (women ? 23 : 24.5) + 0.5 * i : (women ? 6.5 : 8) + 0.5 * i),
      };
    }
    case 'bottoms': {
      const waist = kids ? 20 + i : (women ? 25 : 28) + 2 * i;
      const hip = waist + (kids ? 4 : women ? 11 : 10);
      if (has('skirt')) {
        return { waist: str(waist), hip: str(hip), length: str((has('midi') ? 28 : 16) + i) };
      }
      const rise = kids ? 7 + 0.5 * i : (women ? 10.5 : 10) + 0.5 * i;
      const inseam = has('shorts') ? (kids ? 4 : 7) : kids ? 15 + 2 * i : has('joggers') ? 27 : women ? 29 : 30;
      return {
        waist: str(waist), hip: str(hip), inseam: str(inseam), rise: str(rise), length: str(inseam + rise),
      };
    }
    case 'onepiece': {
      if (kids) {
        return {
          bust: str(21 + i), waist: str(21 + i), hip: str(23 + i),
          length: str(has('overalls') ? 30 + 3 * i : 20 + 2 * i), shoulder: str(10 + 0.5 * i),
        };
      }
      return {
        bust: str(32 + 2 * i), waist: str(26 + 2 * i), hip: str(35 + 2 * i),
        length: str((has('maxi') ? 52 : has('mini') ? 33 : 42) + i), shoulder: str(14 + 0.5 * i),
      };
    }
    case 'footwear': {
      const heel = has('loafer') ? 2 + 0.5 * Math.min(i, 1) : has('boot') ? 2.5 : 3;
      if (kids) return { length: str(16.5 + 1.5 * i), width: str(6.6 + 0.4 * i), heelHeight: str(has('boot') ? 1.5 : 1) };
      return { length: str(23.5 + i), width: str(8.5 + 0.4 * i), heelHeight: str(heel) };
    }
    case 'bags':
      return { width: '12', height: '10', depth: '4', strapDrop: '10' };
    case 'accessories':
      return { length: str(36 + 2 * i), width: '1.5', circumference: '' };
    default:
      return null;
  }
}

// The whole size guide for a product, or null if its category is unknown.
function sizeGuideFor({ category, section, sizes, fit, measure }) {
  const measurementType = MEASUREMENT_TYPE_OF[category];
  if (!measurementType || !Array.isArray(sizes) || sizes.length === 0) return null;
  const measurements = {};
  for (const size of sizes) {
    measurements[size] = measure ? measure(size) : measureSize(category, section, size, fit);
  }
  return { measurementType, measurements };
}

// ---------------------------------------------------------- catalogue
//
// Every photo was opened and checked before being written here; each one
// is a photograph of the garment it is named after. Colours are drawn
// from COLOR_PALETTE in constants/productOptions.js, and sizes from
// SIZE_OPTIONS, so the filters have real values to work with. Every piece
// says who it's for (section) and what kind of item it is (category), and
// every ukay piece its condition and what the seller found when checking
// it for flaws, as Add Product requires of a new listing.
//
// `fit` and `measure` shape its size guide (see measureSize); they're not
// stored. Bags and accessories measure themselves, as no two are alike.

const CATALOG = [
  // ---- ready-to-wear: Divisoria RTW Hub
  {
    name: 'Essential White Tee',
    price: 349,
    type: RTW,
    description: 'Plain cotton crew neck in white. Soft, breathable, and cut straight through the body — the shirt you reach for when nothing else is clean.',
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=900&q=80',
    colors: ['White'],
    sizes: ['S', 'M', 'L', 'XL'],
    section: 'unisex',
    category: 'tops',
  },
  {
    name: 'Plain Cotton Tee',
    price: 299,
    type: RTW,
    description: 'Everyday cotton tee available in six colours. Pre-shrunk, mid-weight, and honest about what it is — no print, no logo, no fuss.',
    imageUrl: 'https://images.unsplash.com/photo-1562157873-818bc0726f68?w=900&q=80',
    colors: ['Red', 'Black', 'White', 'Navy', 'Yellow'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    section: 'unisex',
    category: 'tops',
  },
  {
    name: 'Satin Jogger Pants',
    price: 749,
    type: RTW,
    description: 'High-waisted joggers in blush satin with elasticated cuffs and deep patch pockets. Dresses up with heels, down with sneakers.',
    imageUrl: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=900&q=80',
    colors: ['Pink', 'Beige'],
    sizes: ['S', 'M', 'L'],
    section: 'women',
    category: 'bottoms',
    fit: ['joggers'],
  },
  {
    name: 'Rust Bomber Jacket',
    price: 1290,
    type: RTW,
    description: 'Lightweight bomber in rust, with a zip sleeve pocket and ribbed cuffs. Warm enough for an aircon office, light enough for a Manila evening.',
    imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=900&q=80',
    colors: ['Brown'],
    sizes: ['M', 'L', 'XL'],
    section: 'men',
    category: 'outerwear',
  },
  {
    name: 'Floral Maxi Dress',
    price: 899,
    type: RTW,
    description: 'Flowing navy maxi with a large cream-and-blush floral print, a wrap neckline and soft puff sleeves. Light rayon that moves when you walk, with a tie at the waist.',
    imageUrl: pexels(26835798),
    colors: ['Navy'],
    sizes: ['S', 'M', 'L'],
    section: 'women',
    category: 'dresses',
    fit: ['maxi'],
  },
  {
    name: 'Ribbed Turtleneck Top',
    price: 399,
    type: RTW,
    description: 'Fitted long-sleeve turtleneck in a fine stretch rib. Smooth enough to layer under a blazer, warm enough for a cold office on its own.',
    imageUrl: pexels(5332269),
    colors: ['Green', 'Black', 'Beige'],
    sizes: ['S', 'M', 'L'],
    section: 'women',
    category: 'tops',
    fit: ['long'],
  },
  {
    name: 'Linen Button-Down Shirt',
    price: 649,
    type: RTW,
    description: 'Crisp white button-down in a linen-cotton blend, with a pointed collar and a straight hem you can wear untucked. Breathes in the heat and only gets softer with washing.',
    imageUrl: pexels(28576622),
    colors: ['White', 'Beige'],
    sizes: ['M', 'L', 'XL'],
    section: 'men',
    category: 'tops',
    fit: ['long'],
  },
  {
    name: 'Corduroy Overshirt',
    price: 999,
    type: RTW,
    description: 'Cream fine-wale corduroy overshirt with two flap chest pockets and snap cuffs. Wear it open over a tee as a light jacket, or buttoned as a shirt.',
    imageUrl: pexels(6626418),
    colors: ['Beige'],
    sizes: ['M', 'L', 'XL'],
    section: 'men',
    category: 'outerwear',
  },
  {
    name: 'Denim Carpenter Shorts',
    price: 549,
    type: RTW,
    description: 'Loose dark-wash denim shorts that sit just below the knee, with contrast stitching and a carpenter loop. Heavy cotton denim, no stretch.',
    imageUrl: pexels(18503337),
    colors: ['Navy'],
    sizes: ['M', 'L', 'XL'],
    section: 'men',
    category: 'bottoms',
    measure: (size) => {
      const i = SIZE_INDEX[size];
      return { waist: str(30 + 2 * i), hip: str(42 + 2 * i), inseam: '10', rise: str(11 + 0.5 * i), length: str(21 + 0.5 * i) };
    },
  },
  {
    name: "Kids' Printed Camp Shirt",
    price: 299,
    type: RTW,
    description: 'Short-sleeve camp-collar shirt in black with a white speckle print. Light cotton for warm days, with easy snap buttons small hands can manage.',
    imageUrl: pexels(15179150),
    colors: ['Black'],
    sizes: ['S', 'M', 'L'],
    section: 'kids',
    category: 'tops',
  },
  {
    name: "Kids' Denim Overalls",
    price: 549,
    type: RTW,
    description: 'Dark-wash denim overalls with adjustable straps and a bib pocket. Roomy through the leg for climbing and playing, and tough enough to be handed down.',
    imageUrl: pexels(4715335),
    colors: ['Navy'],
    sizes: ['S', 'M', 'L'],
    section: 'kids',
    category: 'dresses',
    fit: ['overalls'],
  },
  {
    name: "Kids' Yellow Raincoat",
    price: 499,
    type: RTW,
    description: 'Bright yellow hooded raincoat with reflective strips on the front and sleeves, so they are easy to see on a dark, rainy walk home. Wipes clean.',
    imageUrl: pexels(14753894),
    colors: ['Yellow'],
    sizes: ['S', 'M', 'L'],
    section: 'kids',
    category: 'outerwear',
  },
  {
    name: 'Canvas Tote Bag',
    price: 199,
    type: RTW,
    description: 'Plain black cotton canvas tote with long handles that sit comfortably on the shoulder. Fits a laptop, a lunch box and a jacket, and folds flat when empty.',
    imageUrl: pexels(1214212),
    colors: ['Black'],
    sizes: ['M'],
    section: 'unisex',
    category: 'bags',
    measure: () => ({ width: '15', height: '16', depth: '', strapDrop: '11' }),
  },
  {
    name: 'Printed Bucket Hat',
    price: 249,
    type: RTW,
    description: 'Cotton bucket hat with a bold geometric print in red, yellow and blue on white. A short brim that keeps the sun off without hiding your face.',
    imageUrl: pexels(9718031),
    colors: ['White'],
    sizes: ['M'],
    section: 'unisex',
    category: 'accessories',
    measure: () => ({ length: '', width: '2', circumference: '22.5' }),
  },

  // ---- ukay-ukay: Ukay-Ukay ni Aling Nena
  {
    name: 'Graphic Print Tee',
    price: 249,
    type: UKAY,
    description: 'Thrifted graphic tee in sand, with a bold block print across the chest. Lightly worn with no marks or holes — the print is still sharp.',
    imageUrl: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=900&q=80',
    colors: ['Beige'],
    sizes: ['M', 'L'],
    condition: 'gently-used',
    flawCheck: 'none',
    section: 'unisex',
    category: 'tops',
  },
  {
    name: 'Knit Fringe Poncho',
    price: 459,
    type: UKAY,
    description: 'Cream open-knit poncho with a fringed hem. Preloved and in good condition — one small pull on the back hem, not visible when worn.',
    imageUrl: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=900&q=80',
    colors: ['Beige', 'White'],
    sizes: ['M', 'L'],
    condition: 'well-loved',
    flawCheck: 'found',
    flawTags: ['other'],
    flaws: 'One small pull on the back hem, not visible when worn.',
    flawPhotos: ['pull on the back hem'],
    section: 'women',
    category: 'outerwear',
    measure: (size) => ({ chest: size === 'M' ? '25' : '27', length: size === 'M' ? '24' : '25', shoulder: '', sleeve: '' }),
  },
  {
    name: 'Leather Biker Jacket',
    price: 1850,
    type: UKAY,
    description: 'Classic black biker jacket with asymmetric zip and snap lapels. Secondhand, well broken in — the leather has softened and the hardware all works.',
    imageUrl: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=900&q=80',
    colors: ['Black'],
    sizes: ['S', 'M', 'L'],
    condition: 'gently-used',
    flawCheck: 'none',
    section: 'men',
    category: 'outerwear',
  },
  {
    name: 'Straight-Cut Jeans',
    price: 599,
    type: UKAY,
    description: 'Preloved straight-leg denim in three washes. Sturdy, no stretch, and already softened from wear — check the size guide before choosing.',
    imageUrl: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=900&q=80',
    colors: ['Blue', 'Navy', 'Black'],
    sizes: ['S', 'M', 'L', 'XL'],
    condition: 'gently-used',
    flawCheck: 'none',
    section: 'unisex',
    category: 'bottoms',
  },
  {
    name: 'Buffalo Check Flannel Shirt',
    price: 320,
    type: UKAY,
    description: 'Thick red-and-black buffalo check flannel, the kind that gets softer every year. Well worn and well loved, with two small things to know about below.',
    imageUrl: pexels(11943572),
    colors: ['Red', 'Black'],
    sizes: ['L'],
    condition: 'well-loved',
    flawCheck: 'found',
    flawTags: ['pilling', 'hardware'],
    flaws: 'Light pilling under both arms. The second button from the bottom is a replacement and is a slightly different black.',
    flawPhotos: ['pilling under the arm', 'replacement button'],
    section: 'men',
    category: 'tops',
    fit: ['long'],
  },
  {
    name: 'Cowl-Neck Knit Sweater',
    price: 350,
    type: UKAY,
    description: 'Cream chunky rib-knit sweater with a deep, slouchy cowl neck. Cozy and thick, with a little pilling and stretch that comes with being worn.',
    imageUrl: pexels(20025511),
    colors: ['Beige'],
    sizes: ['M'],
    condition: 'gently-used',
    flawCheck: 'found',
    flawTags: ['pilling', 'stretched'],
    flaws: 'Some pilling on the front, and both cuffs are a little stretched out.',
    flawPhotos: ['pilling on the front', 'stretched cuff'],
    section: 'women',
    category: 'tops',
    fit: ['long'],
  },
  {
    name: 'Floral Sundress',
    price: 380,
    type: UKAY,
    description: 'Light chiffon sundress with a small pink-and-cream floral print, flutter sleeves and a flowy midi skirt. Worn once to a wedding, then kept in the closet.',
    imageUrl: pexels(8200247),
    colors: ['Pink', 'White'],
    sizes: ['S'],
    condition: 'like-new',
    flawCheck: 'none',
    section: 'women',
    category: 'dresses',
  },
  {
    name: 'Plaid Pleated Mini Skirt',
    price: 280,
    type: UKAY,
    description: 'Blue-and-brown plaid mini with knife pleats all around and a side zip. Pleats are still sharp; the colors are bright with no fading.',
    imageUrl: pexels(15240413),
    colors: ['Blue'],
    sizes: ['S'],
    condition: 'gently-used',
    flawCheck: 'none',
    section: 'women',
    category: 'bottoms',
    fit: ['skirt'],
  },
  {
    name: 'White Leather Sneakers',
    brand: 'Nike',
    price: 1200,
    type: UKAY,
    description: 'Classic all-white leather low-tops. Preloved with plenty of life left — the soles are still thick and the insoles were replaced.',
    imageUrl: pexels(11946032),
    colors: ['White'],
    sizes: ['L'],
    condition: 'gently-used',
    flawCheck: 'found',
    flawTags: ['other'],
    flaws: 'Light creasing across both toe boxes and a faint scuff on the right heel.',
    flawPhotos: ['toe creasing and heel scuff'],
    section: 'unisex',
    category: 'footwear',
  },
  {
    name: 'Brown Leather Crossbody Bag',
    brand: 'Chloé',
    price: 2800,
    type: UKAY,
    description: 'Structured brown leather crossbody with an embossed logo band, a gold-tone buckle, and a long adjustable strap. Lining is clean and the zip runs smooth.',
    imageUrl: pexels(4339598),
    colors: ['Brown'],
    sizes: ['M'],
    condition: 'gently-used',
    flawCheck: 'found',
    flawTags: ['other'],
    flaws: 'A small scuff on one bottom corner, about the size of a fingernail.',
    flawPhotos: ['scuff on the bottom corner'],
    section: 'women',
    category: 'bags',
    measure: () => ({ width: '10', height: '7', depth: '3', strapDrop: '22' }),
  },
  {
    name: 'Brown Leather Belt',
    price: 450,
    type: UKAY,
    description: 'Full-grain brown leather belt with a solid brass buckle. Bought and never worn — the tags are still attached.',
    imageUrl: pexels(6654763),
    colors: ['Brown'],
    sizes: ['M', 'L'],
    condition: 'new-with-tags',
    flawCheck: 'none',
    section: 'men',
    category: 'accessories',
    measure: (size) => ({ length: size === 'M' ? '40' : '44', width: '1.5', circumference: '' }),
  },
  {
    name: 'Chunky Knit Scarf',
    price: 220,
    type: UKAY,
    description: 'Thick, soft dusty-pink scarf in a chunky knit, long enough to wrap twice. Worn a handful of times and kept folded.',
    imageUrl: pexels(3566870),
    colors: ['Pink'],
    sizes: ['M'],
    condition: 'like-new',
    flawCheck: 'none',
    section: 'women',
    category: 'accessories',
    measure: () => ({ length: '70', width: '10', circumference: '' }),
  },
  {
    name: "Kids' Pocket Tee",
    price: 120,
    type: UKAY,
    description: 'Soft light-blue cotton tee with a chest pocket. Comfortable and broken in, with a bit of fading from the wash.',
    imageUrl: pexels(3371377),
    colors: ['Blue'],
    sizes: ['M'],
    condition: 'gently-used',
    flawCheck: 'found',
    flawTags: ['fading', 'stain'],
    flaws: 'Faded evenly from washing, and a faint mark on the hem, only visible up close.',
    flawPhotos: ['faint mark on the hem'],
    section: 'kids',
    category: 'tops',
  },
  {
    name: 'Yellow Rain Boots',
    price: 350,
    type: UKAY,
    description: "Kids' yellow rubber rain boots with a navy trim and bow at the top. Outgrown after one rainy season, so there's barely a mark on them.",
    imageUrl: pexels(8612884),
    colors: ['Yellow'],
    sizes: ['S', 'M'],
    condition: 'like-new',
    flawCheck: 'none',
    section: 'kids',
    category: 'footwear',
    fit: ['boot'],
  },
];

// Listings typed into Add Product while testing ("Dress", "Loaf like a
// bread"), tidied for the defense: a real name, description and photo,
// and what the catalogue entries have. Keyed by the name they had. Price,
// stock, sizes and colors are left as the manager set them, and so is a
// size guide they already entered, unless `replaceGuide` says it was
// entered wrong. Once renamed they're no longer matched here, so a
// re-run leaves them alone.
const REWRITES = {
  Loafers: {
    name: 'Platform Horsebit Loafers',
    description: 'Glossy black loafers on a chunky lug sole with a silver horsebit across the front. The platform adds about 2 cm of height, and the treaded sole grips on wet pavement.',
    imageUrl: 'https://i.pinimg.com/originals/32/48/1c/32481ce510e37952a223eecb298d4d96.jpg',
    section: 'women',
    category: 'footwear',
  },
  Dress: {
    name: 'White Flowy Maxi Dress',
    description: 'Long white chiffon maxi with sheer long sleeves and a full, floaty skirt that moves in the wind. Lined to the knee, with a smocked waist that fits a range of sizes.',
    imageUrl: pexels(9783413),
    section: 'women',
    category: 'dresses',
    fit: ['maxi'],
  },
  'Sandals for men': {
    name: "Men's Double-Strap Slides",
    description: 'Black slides with two wide straps, one with adjustable buckles, on a cushioned footbed and a thick ridged sole. Easy on, easy off, and comfortable all day.',
    imageUrl: 'https://i.pinimg.com/originals/b2/e8/5c/b2e85c063d49d61984c7dfa489b979c9.jpg',
    section: 'men',
    category: 'footwear',
    measure: (size) => (size === 'S' ? { length: '25.5', width: '9.6', heelHeight: '3' } : { length: '26.5', width: '10', heelHeight: '3' }),
  },
  'Jacket Outerwear': {
    name: 'Green Coach Jacket',
    description: 'Dark green snap-front coach jacket in a light water-resistant shell, with side pockets and a soft lining. Just enough for a rainy commute without the bulk.',
    imageUrl: pexels(3705262),
    section: 'unisex',
    category: 'outerwear',
  },
  Jacket: {
    name: 'Columbia Windbreaker Jacket',
    brand: 'Columbia',
    description: 'Navy and blue zip-up windbreaker with a stand collar and zip hand pockets. Thrifted in good shape — the zip runs smooth and the shell has no tears.',
    imageUrl: pexels(3753650),
    section: 'men',
    category: 'outerwear',
    condition: 'gently-used',
    flawCheck: 'none',
  },
  Jeans: {
    name: 'Stonewash Straight Jeans',
    description: 'Mid-blue stonewash jeans with a straight leg and classic five-pocket styling. Preloved and softened from wear, with no rips or stains.',
    imageUrl: pexels(4210863),
    section: 'unisex',
    category: 'bottoms',
    condition: 'gently-used',
    flawCheck: 'none',
    // Its guide was saved as footwear (width 96, heel 66).
    replaceGuide: true,
  },
  'Plain White Tee-Shirt': {
    name: 'Thrifted Plain White Tee',
    description: 'Heavyweight plain white cotton tee with a ribbed crew neck. Washed a few times and still bright white, with no yellowing at the collar.',
    imageUrl: pexels(11671964),
    section: 'unisex',
    category: 'tops',
    condition: 'like-new',
    flawCheck: 'none',
  },
};

// A few ukay pieces are listed as what they really are, a single piece,
// so "One of a kind" and selling out can be shown. They're listed with a
// stock of 1 and never restocked by this script.
const ONE_OF_A_KIND = new Set(['Buffalo Check Flannel Shirt', 'Cowl-Neck Knit Sweater', 'Brown Leather Crossbody Bag']);

// ------------------------------------------------- what a product gets

// The extra photos an ukay listing carries: its back and label, and one
// per flaw when it has some.
function ukayPhotos(entry) {
  return [
    backPhoto(),
    labelPhoto(),
    ...(entry.flawCheck === 'found' ? (entry.flawPhotos || ['see the note']).map(flawPhoto) : []),
  ];
}

// The document a catalogue entry becomes, as Add Product would write it.
function documentFor(entry) {
  const { fit, measure, flawPhotos, ...fields } = entry;
  const guide = sizeGuideFor(entry);
  return {
    ...fields,
    ...(guide || {}),
    ...(entry.type === UKAY ? { photos: ukayPhotos(entry), flawTags: entry.flawTags || [] } : {}),
  };
}

// Fields filled in on an existing product that lacks them. Never photos'
// front (imageUrl), name, price or description: those are the manager's.
function missingFields(product, entry) {
  const fields = {};
  const source = entry ? documentFor(entry) : {};
  for (const key of ['section', 'category', 'condition', 'flaws', 'brand', 'flawCheck']) {
    if (source[key] && !product[key]) fields[key] = source[key];
  }
  if (source.flawTags?.length && !(product.flawTags?.length)) fields.flawTags = source.flawTags;

  const hasGuide = product.measurements && Object.keys(product.measurements).length > 0;
  if (!hasGuide || entry?.replaceGuide) {
    const guide = entry
      ? sizeGuideFor(entry)
      : sizeGuideFor({
          category: product.category || fields.category,
          section: product.section || fields.section,
          sizes: product.sizes,
        });
    if (guide) Object.assign(fields, guide);
  }

  if (product.type === UKAY) {
    // A known product without a flaw check yet: the catalogue says. An
    // unknown one is reported, not guessed — "no flaws" has to be said by
    // someone who checked.
    const flawCheck = product.flawCheck || fields.flawCheck;
    const kinds = new Set((Array.isArray(product.photos) ? product.photos : []).map((p) => p?.kind));
    const add = [];
    if (!kinds.has('back')) add.push(backPhoto());
    if (!kinds.has('label')) add.push(labelPhoto());
    if (flawCheck === 'found' && !kinds.has('flaw')) {
      add.push(...(entry?.flawPhotos || ['see the note']).map(flawPhoto));
    }
    if (add.length) fields.photos = [...(Array.isArray(product.photos) ? product.photos : []), ...add];
  }
  return fields;
}

// What a manager still has to decide for a product the catalogue doesn't
// know.
function stillMissing(product, fields) {
  const merged = { ...product, ...fields };
  const missing = [];
  if (!merged.section) missing.push('section');
  if (!merged.category) missing.push('category (so no size guide either)');
  if (merged.type === UKAY && !merged.condition) missing.push('condition');
  if (merged.type === UKAY && !merged.flawCheck) missing.push('flaw check');
  return missing;
}

const describe = (fields) =>
  Object.entries(fields)
    .map(([k, v]) =>
      k === 'measurements'
        ? `size guide (${Object.keys(v).join(', ')})`
        : k === 'photos'
        ? `photos (${v.map((p) => p.kind).join(', ')})`
        : Array.isArray(v)
        ? `${k} = ${v.join(', ')}`
        : `${k} = ${String(v).length > 60 ? `${String(v).slice(0, 57)}...` : v}`
    )
    .join('; ');

// ------------------------------------------------------------------ run

console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);

const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
console.log(`Signed in as ${cred.user.email}`);

// Seeds the signed-in manager's OWN store, and only that store: the rules
// refuse a product under any other storeId, and restocking another
// store's items is not this manager's call. A manager with no store is
// refused here rather than at the first write.
const me = await getDoc(doc(db, 'users', cred.user.uid));
const STORE_ID = me.exists() ? me.data().storeId : undefined;
if (typeof STORE_ID !== 'string' || !STORE_ID) {
  console.error(
    '\nThis account is not assigned to a store. Have a Platform Admin assign\n' +
    'one in Manage Users (or run scripts/migrate-to-stores.mjs), then re-run.\n'
  );
  process.exit(1);
}
const store = await getDoc(doc(db, 'stores', STORE_ID));
const STORE_SELLS = STORE_TYPE[STORE_ID];
console.log(`Store: ${store.exists() ? store.data().name : STORE_ID}`);
if (!STORE_SELLS) {
  console.error(`\nThis script only seeds the two original stores (${Object.keys(STORE_TYPE).join(', ')}).\n`);
  process.exit(1);
}
console.log(`Sells: ${STORE_SELLS}\n`);

const snap = await getDocs(collection(db, 'products'));
const everything = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const existing = everything.filter((p) => p.storeId === STORE_ID);

console.log(`This store's catalogue right now: ${existing.length} product(s)`);
for (const p of existing) {
  const label = p.type === UKAY ? 'Ukay-Ukay    ' : 'Ready-to-Wear';
  const guide = p.measurements && Object.keys(p.measurements).length ? 'guide' : 'NO GUIDE';
  console.log(
    `  ${label}  stock ${String(p.stock).padStart(4)}  ${guide.padEnd(8)}  ${p.section || '-'}/${p.category || '-'}  ${p.name}`
  );
}

const nameKey = (name) => (name || '').trim().toLowerCase();
// Matched against the whole catalogue, not just this store's: a piece
// already listed by the other store is not listed twice.
const listedAnywhere = new Set(everything.map((p) => nameKey(p.name)));
const toAdd = CATALOG.filter((p) => p.type === STORE_SELLS && !listedAnywhere.has(nameKey(p.name)));
const catalogByName = new Map(CATALOG.map((p) => [nameKey(p.name), p]));
const lowStock = existing.filter((p) => Number(p.stock) < MIN_STOCK && !ONE_OF_A_KIND.has(p.name));

const toFill = [];
const undecided = [];
for (const product of existing) {
  const rewrite = REWRITES[(product.name || '').trim()];
  const entry = rewrite
    ? { ...rewrite, type: product.type, sizes: product.sizes }
    : catalogByName.get(nameKey(product.name));
  const fields = missingFields(product, entry);
  if (rewrite) {
    for (const key of ['name', 'description', 'imageUrl', 'brand']) {
      if (rewrite[key] && rewrite[key] !== product[key]) fields[key] = rewrite[key];
    }
  }
  if (Object.keys(fields).length) toFill.push({ product, fields });
  const missing = stillMissing(product, fields);
  if (missing.length) undecided.push({ product, missing });
}

console.log(`\nWould add ${toAdd.length} product(s):`);
for (const p of toAdd) {
  const extra = p.type === UKAY ? `  ${p.condition}, flaws: ${p.flawCheck === 'found' ? p.flawTags.join('+') : 'none'}` : '';
  const stock = ONE_OF_A_KIND.has(p.name) ? 1 : MIN_STOCK;
  console.log(`  P${String(p.price).padStart(4)}  stock ${String(stock).padStart(2)}  ${p.section}/${p.category}  ${p.name}${extra}`);
}
console.log(`\nWould raise stock to ${MIN_STOCK} on ${lowStock.length} existing product(s).`);
console.log(`\nWould fill in missing fields on ${toFill.length} existing product(s):`);
for (const { product, fields } of toFill) {
  console.log(`  ${product.name}: ${describe(fields)}`);
}
if (undecided.length) {
  console.log(`\nNOT decided by this script — set these in Edit Product, or add the product to CATALOG:`);
  for (const { product, missing } of undecided) {
    console.log(`  ${product.name}: ${missing.join(', ')}`);
  }
}

if (!APPLY) {
  console.log('\nRe-run with --apply to write.\n');
  process.exit(0);
}

for (const entry of toAdd) {
  // createdAt must be the server's own timestamp: the create rule asserts
  // createdAt == request.time, so a client-side Date is rejected. It is
  // also what ProductContext orders the catalogue by — a product without
  // it is invisible in the app.
  await addDoc(collection(db, 'products'), {
    ...documentFor(entry),
    stock: ONE_OF_A_KIND.has(entry.name) ? 1 : MIN_STOCK,
    storeId: STORE_ID,
    createdAt: serverTimestamp(),
  });
  console.log(`  added   ${entry.name}`);
}

for (const { product, fields } of toFill) {
  await updateDoc(doc(db, 'products', product.id), fields);
  console.log(`  filled  ${product.name}`);
}

for (const p of lowStock) {
  await updateDoc(doc(db, 'products', p.id), { stock: MIN_STOCK });
  console.log(`  stocked ${p.name}  ${p.stock} -> ${MIN_STOCK}`);
}

const after = await getDocs(collection(db, 'products'));
const all = after.docs.map((d) => d.data()).filter((p) => p.storeId === STORE_ID);
const guided = all.filter((p) => p.measurements && Object.keys(p.measurements).length).length;
console.log(`\nDone. ${all.length} products live in this store, ${guided} with a size guide.\n`);
process.exit(0);
