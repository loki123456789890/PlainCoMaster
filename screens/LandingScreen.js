import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withDelay,
  useReducedMotion,
} from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { Colors } from '../constants/theme';
import Button from '../components/ui/Button';
import { StaticLockup, headerCenterY } from '../components/BrandLockup';
import { splashHandoff } from '../utils/splashHandoff';
import { auth } from '../firebaseConfig';
import { useAdmin } from '../context/AdminContext';
import { getHomeRouteForRole } from '../constants/roles';
import { EASE_OUT_QUINT } from '../constants/motion';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// When each piece arrives, in ms from the start of the launch splash —
// the approved landing preview's timeline. The copy starts as the splash's
// lockup finishes gliding into the header. Opened later (after a logout),
// there is no splash, and the same order plays 1650 ms sooner.
const T = {
  eyebrow: 1750,
  line1: 1820,
  line2: 1900,
  line3: 1980,
  sub: 2150,
  ukay: 2280,
  rtw: 2380,
  primary: 2620,
  secondary: 2700,
  staff: 2820,
};
const LANDING_ONLY_SHIFT = 1650;

// Shared by the headline style and its rise, which starts one line down.
const HEADLINE_LINE_HEIGHT = 38;

// Converts a timeline entry into a delay from now, on whichever clock
// applies. Read once, when the content first renders.
function makeDelayFor() {
  const elapsed = splashHandoff.isActive() ? splashHandoff.elapsed() : null;
  if (splashHandoff.isActive()) {
    return (t) => Math.max(0, t - (elapsed ?? 0));
  }
  return (t) => Math.max(0, t - LANDING_ONLY_SHIFT);
}

// Fades up into place: the preview's 14 pt rise over 600 ms.
function FadeUp({ delay, reduceMotion, style, children }) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(delay, withTiming(1, { duration: 600, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 14 }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

// A headline line rising out of its own clip, like type set on a line.
function RiseLine({ delay, reduceMotion, children, textStyle }) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(delay, withTiming(1, { duration: 700, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * HEADLINE_LINE_HEIGHT * 1.05 }],
  }));
  return (
    <View style={styles.lineClip}>
      <Animated.Text style={[styles.headline, textStyle, animated]}>{children}</Animated.Text>
    </View>
  );
}

// The card icons draw themselves: a stroke revealed along its length.
function DrawnIcon({ delay, reduceMotion, kind }) {
  const offset = useSharedValue(reduceMotion ? 0 : 120);
  useEffect(() => {
    if (reduceMotion) return;
    offset.value = withDelay(delay, withTiming(0, { duration: 900, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const drawProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const stroke = {
    fill: 'none',
    stroke: Colors.light.background,
    strokeWidth: 2.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeDasharray: [120, 120],
  };
  return (
    <Svg width={44} height={44} viewBox="0 0 40 40">
      {kind === 'ukay' ? (
        <>
          {/* A price tag: one-of-a-kind, priced by the piece. */}
          <AnimatedPath d="M20 5 L30 14 V33 Q30 35 28 35 H12 Q10 35 10 33 V14 Z" {...stroke} animatedProps={drawProps} />
          <AnimatedCircle cx={20} cy={14} r={2.6} {...stroke} animatedProps={drawProps} />
        </>
      ) : (
        <>
          {/* A hanger: off the rack, new. */}
          <AnimatedPath
            d="M20 15 V13 C20 11 23.5 10.5 23.5 8 C23.5 6 22 5 20 5 C18 5 16.6 6.2 16.5 7.6"
            {...stroke}
            animatedProps={drawProps}
          />
          <AnimatedPath d="M20 15 L5 28 H35 Z" {...stroke} animatedProps={drawProps} />
        </>
      )}
    </Svg>
  );
}

// One of the two category cards: Moss for ukay-ukay, Clay for
// ready-to-wear — the same pairing the type badges use across the app.
function CategoryCard({ kind, title, caption, delay, reduceMotion }) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(delay, withTiming(1, { duration: 750, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 36 },
      { scale: 0.96 + progress.value * 0.04 },
    ],
  }));
  return (
    <Animated.View
      style={[styles.card, kind === 'ukay' ? styles.cardUkay : styles.cardRtw, animated]}
      accessible
      accessibilityLabel={`${title}. ${caption}.`}
    >
      <View style={styles.cardRing} />
      <DrawnIcon kind={kind} delay={delay + 300} reduceMotion={reduceMotion} />
      <View>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardCaption}>{caption}</Text>
      </View>
    </Animated.View>
  );
}

// The gap between "we don't know yet" and "nobody is signed in".
//
// Landing is the app's initial route, so it mounts before Firebase has
// restored a persisted session from AsyncStorage. Rendering the marketing
// screen during that gap is what the old behaviour did: someone who has
// been signed in for weeks reopened the app and was shown "Get Started".
//
// So it holds, on plain Canvas — the colour the launch splash sits on, so
// whether the session resolves to Home or to Landing, nothing flashes.
function ResolvingSession() {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
    </View>
  );
}

function LandingContent({ navigation, returning }) {
  const reduceMotion = useReducedMotion();
  // Back from Sign Up or Log In: no entrance replay. The copy just fades back in
  // under the lockup, the reverse of how it left.
  const skipEntrance = reduceMotion || returning;
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState(null);
  const [delayFor] = useState(makeDelayFor);

  // Leaving for Sign Up or Log In, the copy fades up and away while the
  // lockup stays put; both draw the same lockup on the same pixels and open with
  // no transition, so the header never moves — the approved preview.
  const contentGone = useSharedValue(returning && !reduceMotion ? 1 : 0);
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 1 - contentGone.value,
    transform: [{ translateY: contentGone.value * -12 }],
  }));

  // The header lockup. While the splash is up, its own copy is gliding
  // into this spot, so this one waits and appears in the same frame the
  // splash's disappears. Opened later, it simply fades in.
  const [lockupVisible, setLockupVisible] = useState(!splashHandoff.isActive());
  const lockupOpacity = useSharedValue(skipEntrance || splashHandoff.isActive() ? 1 : 0);
  useEffect(() => {
    splashHandoff.setLandingReady(true);
    const unsubscribe = splashHandoff.onFinish(() => setLockupVisible(true));
    if (!skipEntrance) lockupOpacity.value = withTiming(1, { duration: 250 });
    if (returning && !reduceMotion) {
      contentGone.value = withTiming(0, { duration: 320, easing: EASE_OUT_QUINT });
    }
    return () => {
      unsubscribe();
      splashHandoff.setLandingReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const lockupStyle = useAnimatedStyle(() => ({ opacity: lockupOpacity.value }));

  const leaving = useRef(false);
  const leaveFor = (route) => {
    if (leaving.current) return;
    leaving.current = true;
    if (reduceMotion) {
      navigation.replace(route, { via: 'landing' });
      return;
    }
    contentGone.value = withDelay(100, withTiming(1, { duration: 220, easing: EASE_OUT_QUINT }));
    setTimeout(() => navigation.replace(route, { via: 'landing' }), 320);
  };
  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    leaveFor('Signup');
  };
  const handleLogIn = () => {
    Haptics.selectionAsync();
    leaveFor('Login');
  };
  const handleStaff = () => {
    Haptics.selectionAsync();
    navigation.navigate('AdminLogin');
  };

  const contentTop = headerCenterY(insets.top) + 58;

  return (
    <View style={styles.root} onLayout={(e) => !size && setSize(e.nativeEvent.layout)}>
      <StatusBar barStyle="dark-content" />

      {size && lockupVisible ? (
        <Animated.View style={[StyleSheet.absoluteFill, lockupStyle]} pointerEvents="none">
          <StaticLockup width={size.width} height={size.height} topInset={insets.top} />
        </Animated.View>
      ) : null}

      <Animated.View
        style={[styles.content, { paddingTop: contentTop, paddingBottom: Math.max(insets.bottom, 16) + 18 }, contentStyle]}
      >
        <FadeUp delay={delayFor(T.eyebrow)} reduceMotion={skipEntrance}>
          <Text style={styles.eyebrow}>Ukay-Ukay · Ready-to-Wear</Text>
        </FadeUp>

        <View
          style={styles.headlineBlock}
          accessible
          accessibilityRole="header"
          accessibilityLabel="Pre-loved finds. Brand-new styles. One app."
        >
          <RiseLine delay={delayFor(T.line1)} reduceMotion={skipEntrance}>Pre-loved finds.</RiseLine>
          <RiseLine delay={delayFor(T.line2)} reduceMotion={skipEntrance}>Brand-new styles.</RiseLine>
          <RiseLine delay={delayFor(T.line3)} reduceMotion={skipEntrance} textStyle={styles.headlineAccent}>
            One app.
          </RiseLine>
        </View>

        <FadeUp delay={delayFor(T.sub)} reduceMotion={skipEntrance}>
          <Text style={styles.sub}>
            Shop local clothing stores, from hand-picked ukay to fresh ready-to-wear.
          </Text>
        </FadeUp>

        <View style={styles.cards}>
          <CategoryCard
            kind="ukay"
            title="Ukay-Ukay"
            caption="One-of-a-kind finds"
            delay={delayFor(T.ukay)}
            reduceMotion={skipEntrance}
          />
          <CategoryCard
            kind="rtw"
            title="Ready-to-Wear"
            caption="New styles, every size"
            delay={delayFor(T.rtw)}
            reduceMotion={skipEntrance}
          />
        </View>

        <View style={styles.ctas}>
          <FadeUp delay={delayFor(T.primary)} reduceMotion={skipEntrance}>
            <Button variant="primary" label="Get Started" fontSize={16} onPress={handleGetStarted} />
          </FadeUp>
          <FadeUp delay={delayFor(T.secondary)} reduceMotion={skipEntrance}>
            <Button variant="secondary" label="Log In" fontSize={16} onPress={handleLogIn} />
          </FadeUp>
          <FadeUp delay={delayFor(T.staff)} reduceMotion={skipEntrance}>
            <Pressable
              onPress={handleStaff}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="link"
              accessibilityLabel="Store staff? Sign in to the Staff Portal"
              style={styles.staffRow}
            >
              <Text style={styles.staffText}>
                Store staff? <Text style={styles.staffLink}>Sign in to the Staff Portal</Text>
              </Text>
            </Pressable>
          </FadeUp>
        </View>
      </Animated.View>
    </View>
  );
}

export default function LandingScreen({ navigation, route }) {
  const { authChecked, signedIn, accountActive, adminLoading, role } = useAdmin();

  // True only while the answer is genuinely unknown. Once auth has been
  // checked and there is no user, this is false immediately — a signed-out
  // visitor waits on nothing beyond Firebase's own restore.
  const resolving = !authChecked || (signedIn && adminLoading);

  // Skip Landing for a session that is signed in AND confirmed usable.
  //
  // accountActive must be exactly true. null means unknown — the document
  // read failed, or the account has no document yet — and false means
  // deactivated, which AdminContext is already signing out and bouncing
  // back here. Routing on anything but a confirmed true would either fight
  // that revocation or carry a broken session into the app.
  //
  // auth.currentUser is checked ALONGSIDE the context's signedIn, not
  // instead of it, and it is not redundant. Every logout in the app awaits
  // signOut() and then resets here, so this screen is mounted by the very
  // action that invalidates the session — and `signedIn` is React state
  // set from an observer, which is one render behind the synchronous
  // truth. If a reset ever won that race, a signed-out user would be
  // bounced straight back into the app by their own logout. currentUser is
  // null the instant signOut resolves, so reading both makes the skip
  // strictly harder and closes the gap without depending on flush order.
  const shouldSkipLanding =
    !resolving && signedIn && auth.currentUser !== null && accountActive === true;

  useEffect(() => {
    if (!shouldSkipLanding) return;
    // reset, not navigate: Landing must not sit behind the destination
    // where a back gesture could return a signed-in user to "Get Started".
    navigation.reset({ index: 0, routes: [{ name: getHomeRouteForRole(role) }] });
  }, [shouldSkipLanding, role, navigation]);

  // Keep holding through the frame in which the reset is dispatched, or
  // the marketing screen paints once on the way out — the exact flash this
  // whole path exists to prevent.
  if (resolving || shouldSkipLanding) return <ResolvingSession />;

  return <LandingContent navigation={navigation} returning={route?.params?.returning === true} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.light.background },
  content: { flex: 1, paddingHorizontal: 24 },

  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: Colors.light.tint,
  },
  headlineBlock: { marginTop: 10, marginBottom: 12 },
  lineClip: { overflow: 'hidden' },
  // DESIGN.md's Display step: once per screen, 700, 28–32.
  headline: {
    fontSize: 32,
    lineHeight: HEADLINE_LINE_HEIGHT,
    fontWeight: '700',
    letterSpacing: -0.6,
    color: Colors.light.text,
  },
  headlineAccent: { color: Colors.light.tint },
  sub: { fontSize: 14, lineHeight: 21, color: Colors.light.icon, marginBottom: 22, maxWidth: 320 },

  // Shrinks before anything else on a short phone, so the buttons are
  // never pushed off screen.
  cards: { flexDirection: 'row', gap: 12, height: 248, minHeight: 150, flexShrink: 1 },
  card: {
    flex: 1,
    borderRadius: 22,
    padding: 16,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  cardUkay: { backgroundColor: Colors.light.secondary },
  cardRtw: { backgroundColor: Colors.light.tint },
  cardRing: {
    position: 'absolute',
    right: -38,
    top: -38,
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.18)',
  },
  cardTitle: { fontSize: 16, lineHeight: 20, fontWeight: '600', color: Colors.light.background },
  cardCaption: { fontSize: 12, color: Colors.light.background, opacity: 0.82, marginTop: 2 },

  ctas: { marginTop: 'auto', paddingTop: 16, gap: 10 },
  staffRow: { alignItems: 'center', marginTop: 4, minHeight: 32, justifyContent: 'center' },
  staffText: { fontSize: 12.5, color: Colors.light.icon },
  staffLink: { color: Colors.light.text, fontWeight: '500', textDecorationLine: 'underline' },
});
