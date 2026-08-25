import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  Easing,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { Colors } from '../constants/theme';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import { auth } from '../firebaseConfig';
import { useAdmin } from '../context/AdminContext';
import { getHomeRouteForRole } from '../constants/roles';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// The hero photo + gradient here is much darker than the light Canvas
// background Colors.light.highlight is contrast-tuned for elsewhere in the
// app — reusing that token on this screen is what caused the logo/icon
// legibility issue this pass fixes. Same hue as the brand gold, just a
// lighter, scoped shade for this dark-photo context specifically.
const heroGold = '#E6CD7F';

// Solid stand-in for the gradient's own darkest stop (rgba(120, 55, 30, 1)),
// shown behind the photo while it's still decoding. Users on slow mobile
// data would otherwise see the light Canvas background through the
// gradient's translucent top edge — dark enough to keep gold/white text
// legible immediately, and on-brand instead of a flash of the wrong color.
const photoPlaceholder = '#78371E';

// Reuses the app's own tinted-pill convention (DESIGN.md: badge background =
// role color at ~20% opacity, icon/text = the same color solid) for the
// feature icon backdrops, instead of inventing a new translucent-chip style.
const heroGoldTint = 'rgba(230, 205, 127, 0.18)';

// The photo cross-fades in on load, independent of the content above it —
// on a slow mobile connection the logo, copy, and CTAs are already visible
// and interactive well before the remote image finishes decoding. Once
// visible it also drifts into a slow, one-time 5% zoom (~9s, no repeat) —
// the same restrained "Ken Burns" treatment premium travel/hospitality apps
// use for hero photography, so the image reads as considered rather than a
// static crop. Skipped entirely under Reduce Motion.
function HeroPhoto({ reduceMotion }) {
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const zoom = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: zoom.value }],
  }));
  const handleLoad = () => {
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withTiming(1, { duration: 220, easing: EASE_OUT_QUART });
    zoom.value = withTiming(1.05, { duration: 9000, easing: Easing.out(Easing.ease) });
  };

  return (
    <Animated.Image
      source={{ uri: 'https://images.unsplash.com/photo-1532453288672-3a27e9be9efd?q=80&w=764&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D' }}
      resizeMode="cover"
      onLoad={handleLoad}
      style={[StyleSheet.absoluteFill, animatedStyle]}
    />
  );
}

// Primary CTA gets its own wrapper (rather than the generic AnimatedPressable)
// because the arrow icon nudges forward on press in addition to the button's
// scale-down — a detail specific to this one button, tying the icon's literal
// "forward" meaning to the tactile feedback of the app's single most
// important action.
function GetStartedButton({ onPress }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const arrowShift = useSharedValue(0);
  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const arrowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: arrowShift.value }],
  }));

  const handlePressIn = () => {
    if (reduceMotion) return;
    scale.value = withTiming(0.96, { duration: 100, easing: EASE_OUT_QUINT });
    arrowShift.value = withTiming(3, { duration: 100, easing: EASE_OUT_QUINT });
  };
  const handlePressOut = () => {
    if (reduceMotion) return;
    scale.value = withTiming(1, { duration: 150, easing: EASE_OUT_QUART });
    arrowShift.value = withTiming(0, { duration: 150, easing: EASE_OUT_QUART });
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
      accessibilityRole="button"
      accessibilityLabel="Get Started"
      accessibilityHint="Creates a new PlainCo account"
    >
      <Animated.View style={[styles.primaryButton, buttonAnimatedStyle]}>
        <Text style={styles.primaryButtonText}>Get Started</Text>
        <Animated.View style={arrowAnimatedStyle}>
          <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

// The gap between "we don't know yet" and "nobody is signed in".
//
// Landing is the app's initial route, so it mounts before Firebase has
// restored a persisted session from AsyncStorage. Rendering the marketing
// screen during that gap is what the old behaviour did: someone who has
// been signed in for weeks reopened the app and was shown "Get Started".
//
// So it holds. Deliberately styled as the hero photo's own placeholder
// colour and wordmark — the same two things Landing shows first anyway
// while its remote image decodes — so a signed-out visitor sees a
// continuous load rather than a splash that swaps to a different screen.
// The cost of the wait is paid by everyone; it is a few hundred
// milliseconds and it buys not lying to signed-in users about who they are.
function ResolvingSession() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.container, styles.resolvingContainer]}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>PlainCo</Text>
          <Text style={styles.logoSubtext}>Shop</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function LandingScreen({ navigation }) {
  const reduceMotion = useReducedMotion();
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
    // Mirrors what Checkoutscreen and ProfileScreen already do.
    navigation.reset({ index: 0, routes: [{ name: getHomeRouteForRole(role) }] });
  }, [shouldSkipLanding, role, navigation]);

  // Keep holding through the frame in which the reset is dispatched, or
  // the marketing screen paints once on the way out — the exact flash this
  // whole path exists to prevent.
  if (resolving || shouldSkipLanding) return <ResolvingSession />;

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.replace('Signup');
  };

  const handleSignIn = () => {
    // A lighter selection tap, not the same impact weight as Get Started —
    // keeps the two CTAs feeling hierarchically distinct: one creates an
    // account, the other just switches to an existing path.
    Haptics.selectionAsync();
    navigation.replace('Login');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <HeroPhoto reduceMotion={reduceMotion} />
        <LinearGradient
          colors={['rgba(196, 98, 62, 0.3)', 'rgba(120, 55, 30, 0.85)']}
          style={styles.gradient}
        >
          {/* Logo — the first brand mark on the first screen: a clean fade,
              no scale or bounce, so it reads as deliberate rather than showy. */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(320).easing(EASE_OUT_QUART)}
            style={styles.logoContainer}
          >
            <Text style={styles.logoText}>PlainCo</Text>
            <Text style={styles.logoSubtext}>Shop</Text>
          </Animated.View>

          {/* Main Content */}
          <View style={styles.content}>
            <Animated.Text
              entering={reduceMotion ? undefined : FadeIn.duration(300).delay(90).easing(EASE_OUT_QUART)}
              style={styles.title}
            >
              Preloved Finds{'\n'}Ready-to-Wear{'\n'}Styles
            </Animated.Text>
            <Animated.Text
              entering={reduceMotion ? undefined : FadeIn.duration(280).delay(150).easing(EASE_OUT_QUART)}
              style={styles.subtitle}
            >
              Shop quality Ukay-Ukay and Ready-to-Wear clothing with great deals and fast delivery
            </Animated.Text>

            {/* Features — three parallel value props, so a small directional
                stagger (not a whole-section reveal) is the legitimate case. */}
            <View style={styles.features}>
              {[
                { icon: 'layers-outline', label: 'Preloved + New' },
                { icon: 'shield-checkmark', label: 'No Card Info Stored' },
                { icon: 'cash', label: 'Cash on Delivery' },
              ].map((feature, index) => (
                <Animated.View
                  key={feature.icon}
                  entering={
                    reduceMotion
                      ? undefined
                      : FadeInDown.duration(240).delay(200 + index * 50).easing(EASE_OUT_QUART)
                  }
                  style={styles.featureItem}
                >
                  <View style={styles.featureIconWrap}>
                    <Ionicons name={feature.icon} size={22} color={heroGold} />
                  </View>
                  <Text style={styles.featureText}>{feature.label}</Text>
                </Animated.View>
              ))}
            </View>
          </View>

          {/* Buttons — fade in alongside the subtitle, not after the feature
              stagger finishes, so the primary CTA is tappable immediately
              rather than waiting behind secondary decoration. */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(260).delay(150).easing(EASE_OUT_QUART)}
            style={styles.buttonContainer}
          >
            <GetStartedButton onPress={handleGetStarted} />

            <AnimatedPressable
              style={styles.secondaryButton}
              onPress={handleSignIn}
              rippleColor="rgba(255,255,255,0.15)"
              accessibilityRole="button"
              accessibilityLabel="Sign In"
              accessibilityHint="Opens the sign in screen for an existing account"
            >
              <Text style={styles.secondaryButtonText}>Already have account? Sign In</Text>
            </AnimatedPressable>
          </Animated.View>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.light.text,
  },
  container: {
    flex: 1,
    backgroundColor: photoPlaceholder,
    // Clips the hero photo's slow zoom to the screen bounds — without this
    // the image would grow slightly past the edges instead of cropping in.
    overflow: 'hidden',
  },
  gradient: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  // Nothing but the wordmark on the hero's own placeholder colour, which
  // `container` already supplies. No spinner: this resolves in a few
  // hundred milliseconds, and a spinner that appears and vanishes that
  // fast reads as a glitch rather than as progress.
  resolvingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoText: {
    fontSize: 42,
    fontWeight: 'bold',
    color: heroGold,
    // Logo sits in the gradient's lightest, least-tinted region (the top,
    // where the overlay is only 30% opaque) — a soft shadow keeps it
    // readable regardless of what's directly behind it in the photo.
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  logoSubtext: {
    fontSize: 16,
    color: '#FFFFFF',
    marginTop: 5,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 15,
    lineHeight: 40,
  },
  subtitle: {
    fontSize: 14,
    color: '#E0E0E0',
    marginBottom: 30,
    lineHeight: 20,
  },
  features: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  featureItem: {
    alignItems: 'center',
    flex: 1,
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: heroGoldTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 8,
  },
  buttonContainer: {
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginRight: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
