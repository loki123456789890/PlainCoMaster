// screens/HelpScreen.js — Help & Support
//
// In the approved address/help/stores preview's design: a search over the
// FAQ, topic tiles that narrow it, the questions as one accordion, a Clay
// card that opens the support request form in a sheet, and the ways to reach
// us. The content, contact details and routing are the app's own: a request
// about an order goes to the store that sold it, anything else to the
// PlainCo team (handlesSupport() in firestore.rules).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Linking, Share, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  useReducedMotion,
  FadeIn,
  LinearTransition,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { db, auth } from '../firebaseConfig';
import { collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { showAppAlert } from '../utils/appAlert';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import { formatOrderNumber } from '../utils/orderNumber';
import Button from '../components/ui/Button';
import Reveal from '../components/shop/Reveal';
import Sheet from '../components/shop/Sheet';
import { TopBar, GroupHeading, OfflineNotice } from '../components/shop/TabScreen';
import { EASE_OUT_QUINT } from '../constants/motion';

const FAQ_CATEGORIES = [
  {
    id: 'orders',
    name: 'Orders',
    icon: 'cart-outline',
    questions: [
      {
        id: 'o1',
        question: 'How do I track my order?',
        answer: 'You can track your order by going to "My Orders" in your profile. Click on the specific order to see its current status (Processing, Shipped, or Delivered).',
      },
      {
        id: 'o2',
        question: 'Can I cancel or modify my order?',
        answer: "Orders can't be cancelled or modified directly in the app yet. If you need to cancel or change an order, please contact our support team as soon as possible after placing it and we'll do our best to help before it ships.",
      },
      {
        id: 'o3',
        question: 'What payment methods do you accept?',
        answer: 'At checkout you can select GCash, Maya, Card, or Cash on Delivery (COD). GCash, Maya, and Card currently run in sandbox mode — the payment step is a simulation for testing, no real money moves, and no live gateway is connected. Cash on Delivery is the only method that settles real money today: you pay in person when your order arrives.',
      },
      {
        id: 'o4',
        question: 'Do you have voucher or promo codes?',
        answer: "We don't have a voucher or promo code system in the app yet. Keep an eye on our announcements for upcoming deals!",
      },
    ],
  },
  {
    id: 'shipping',
    name: 'Shipping',
    icon: 'car-outline',
    questions: [
      {
        id: 's1',
        question: 'How long does shipping take?',
        answer: 'Metro Manila deliveries take 1-3 business days. Provincial deliveries take 3-7 business days. Delivery times may vary during holidays or peak seasons.',
      },
      {
        id: 's2',
        question: 'How much is the shipping fee?',
        answer: 'Shipping is currently free on all orders, with no minimum spend required.',
      },
      {
        id: 's3',
        question: 'Do you ship internationally?',
        answer: "Currently, we only ship within the Philippines. We're working on expanding our shipping coverage internationally soon!",
      },
      {
        id: 's4',
        question: 'What if my package is damaged?',
        answer: "If you receive a damaged item, please contact us within 24 hours of delivery with photos of the damage. We'll arrange for a replacement or refund.",
      },
    ],
  },
  {
    id: 'returns',
    name: 'Returns',
    icon: 'refresh-outline',
    questions: [
      {
        id: 'r1',
        question: 'What is your return policy?',
        answer: 'We accept returns within 7 days of delivery for unused items in original packaging. Items must be in original condition with tags attached.',
      },
      {
        id: 'r2',
        question: 'How do I request a return?',
        answer: "There's no automatic return request feature in the app yet. Please contact our support team within 7 days of delivery and we'll walk you through the process manually.",
      },
      {
        id: 'r3',
        question: 'When will I get my refund?',
        answer: 'Refunds are processed within 5-10 business days after we receive and inspect the returned item. The refund will be credited to your original payment method.',
      },
      {
        id: 'r4',
        question: 'Can I exchange an item?',
        answer: "Exchanges aren't handled automatically in the app yet. Contact our support team and we'll help arrange a size or color exchange manually.",
      },
    ],
  },
  {
    id: 'account',
    name: 'Account',
    icon: 'person-outline',
    questions: [
      {
        id: 'a1',
        question: 'How do I change my password?',
        answer: 'There\'s no in-app "change password" option yet. Log out, then tap "Forgot password?" on the Log In screen and enter your email — we\'ll send you a secure link to set a new one.',
      },
      {
        id: 'a2',
        question: 'How do I deactivate my account?',
        answer: 'You can deactivate your account from your Profile screen. Your account will be disabled and you will be signed out, and you will not be able to sign in again. Your personal information is retained only as required for order and transaction records — deactivation does not erase past orders. If you need further action on your data, send us a request below.',
      },
      {
        id: 'a3',
        question: 'Is my payment information secure?',
        answer: 'We never ask for or store card numbers, CVV, or e-wallet credentials in the app — there is no screen anywhere that collects them. GCash, Maya, and Card run in sandbox mode: the payment step is simulated for testing and nothing is ever charged. Cash on Delivery remains the way to pay real money, in person, when your order arrives.',
      },
      {
        id: 'a4',
        question: 'How do I update my profile?',
        answer: "Go to Profile. Tap the pencil on your card to change your display name, tap your photo to change it, or tap your delivery address to update it and your mobile number. Your email can't be changed because it's tied to your login.",
      },
    ],
  },
];

const CONTACT = [
  { id: 'email', name: 'Email', value: 'support@plainco.com', icon: 'mail-outline', url: 'mailto:support@plainco.com' },
  { id: 'phone', name: 'Call', value: '+63 2 8123 4567', icon: 'call-outline', url: 'tel:+63281234567' },
  { id: 'whatsapp', name: 'WhatsApp', value: '+63 912 345 6789', icon: 'logo-whatsapp', url: 'https://wa.me/639123456789' },
  { id: 'messenger', name: 'Messenger', value: '@plainco.ph', icon: 'chatbubble-ellipses-outline', url: 'https://m.me/plainco.ph' },
];

// Written into the start of the message: the request itself has no topic
// field, and the rules accept only the fields the form already sends.
const TOPICS = ['Order not received', 'Wrong item received', 'Payment failed', 'Account issues', 'Something else'];
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 500;

// Monday–Friday 9 AM–8 PM, Saturday 9 AM–6 PM, closed Sunday.
const isOpenNow = (d = new Date()) => {
  const day = d.getDay();
  const h = d.getHours() + d.getMinutes() / 60;
  if (day === 0) return false;
  return h >= 9 && h < (day === 6 ? 18 : 20);
};

// The matched part of a question or answer, marked.
function Highlighted({ text, q, style }) {
  if (!q) return <Text style={style}>{text}</Text>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {text.slice(0, i)}
      <Text style={styles.mark}>{text.slice(i, i + q.length)}</Text>
      {text.slice(i + q.length)}
    </Text>
  );
}

function FaqItem({ item, q, open, onToggle, last }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = reduceMotion ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 300, easing: EASE_OUT_QUINT });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));
  return (
    <Animated.View
      style={[styles.q, !last && styles.qDivider]}
      layout={reduceMotion ? undefined : LinearTransition.duration(300).easing(EASE_OUT_QUINT)}
    >
      <Pressable
        onPress={onToggle}
        style={styles.qButton}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={item.question}
      >
        <Highlighted text={item.question} q={q} style={styles.qText} />
        <Animated.View style={chevron}>
          <Ionicons name="chevron-down" size={16} color={Colors.light.icon} />
        </Animated.View>
      </Pressable>
      {open ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(250)}>
          <Highlighted text={item.answer} q={q} style={styles.aText} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

// "Open now" with a softly pulsing dot, or "Closed now".
function LivePill({ open }) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (open && !reduceMotion) t.value = withRepeat(withTiming(1, { duration: 1800 }), -1, false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const halo = useAnimatedStyle(() => ({ opacity: 0.6 * (1 - t.value), transform: [{ scale: 1 + t.value * 1.2 }] }));
  return (
    <View style={[styles.live, !open && styles.liveOff]}>
      <View>
        {open ? <Animated.View style={[styles.liveDot, styles.liveHalo, halo]} /> : null}
        <View style={[styles.liveDot, !open && styles.liveDotOff]} />
      </View>
      <Text style={[styles.liveText, !open && styles.liveTextOff]}>{open ? 'Open now' : 'Closed now'}</Text>
    </View>
  );
}

export default function HelpScreen({ navigation }) {
  const { isConnected } = useNetworkStatus();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(null);
  const [openIds, setOpenIds] = useState(() => new Set());
  const [scrolled, setScrolled] = useState(false);

  // The request form, in its sheet.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [topic, setTopic] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null); // who the sent request went to
  const [recentOrders, setRecentOrders] = useState([]);
  const [aboutOrderId, setAboutOrderId] = useState(null);

  // One-shot, not a listener: the list only needs to be right when the form
  // opens, and a guest has no orders to offer.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDocs(query(collection(db, 'users', uid, 'orders'), orderBy('createdAt', 'desc'), limit(5)))
      .then((snapshot) => {
        setRecentOrders(
          snapshot.docs
            // An order from before stores existed has nowhere to be routed.
            .filter((d) => typeof d.data().storeId === 'string')
            .map((d) => ({ id: d.id, storeId: d.data().storeId, storeName: d.data().storeName || '' }))
        );
      })
      .catch((error) => console.error('Could not load recent orders for support:', error));
  }, []);

  const q = search.trim().toLowerCase();
  const questions = useMemo(
    () =>
      FAQ_CATEGORIES.filter((c) => !category || c.id === category)
        .flatMap((c) => c.questions)
        .filter((item) => !q || `${item.question} ${item.answer}`.toLowerCase().includes(q)),
    [category, q]
  );
  // While searching, the best match opens by itself.
  const firstMatch = q ? questions[0]?.id : null;
  const heading = category ? FAQ_CATEGORIES.find((c) => c.id === category).name : q ? 'Results' : 'Frequently asked';

  const toggle = (id) => {
    Haptics.selectionAsync();
    setOpenIds((prev) => {
      // A question is open when it's in the set XOR it's the auto-opened
      // best match, so flipping membership always flips what you see.
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openContact = async (method) => {
    Haptics.selectionAsync();
    try {
      await Linking.openURL(method.url);
    } catch (_error) {
      // Usually the app (Mail, WhatsApp, Messenger) isn't installed.
      showAppAlert('Unable to Open', `We couldn't open ${method.name}. You can reach us directly at ${method.value}.`);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: 'Check out PlainCo! Great place to shop for ukay-ukay and ready-to-wear items. Download the app now!',
        url: 'https://plainco.com/download',
        title: 'Share PlainCo',
      });
    } catch (_error) {
      showAppAlert('Error', 'Unable to share at this moment.');
    }
  };

  const openRequest = () => {
    Haptics.selectionAsync();
    setSentTo(null);
    setSheetOpen(true);
  };

  const canSend = topic && message.trim().length >= MESSAGE_MIN && !sending && isConnected;

  const handleSend = async () => {
    if (!canSend) return;
    if (!auth.currentUser) {
      showAppAlert('Log In Required', 'Please log in so our support team can follow up with you about this request.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log In', onPress: () => navigation.navigate('Login') },
      ]);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSending(true);
    try {
      const aboutOrder = recentOrders.find((o) => o.id === aboutOrderId);
      await addDoc(collection(db, 'supportRequests'), {
        message: `${topic}: ${message.trim()}`,
        userId: auth.currentUser.uid,
        userEmail: auth.currentUser.email || null,
        status: 'open',
        createdAt: serverTimestamp(),
        // Routing. The rules check the order is this customer's and that
        // storeId is its store, so both come from the order itself.
        ...(aboutOrder ? { orderId: aboutOrder.id, storeId: aboutOrder.storeId } : { storeId: null }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSentTo(aboutOrder ? aboutOrder.storeName || 'The store' : 'The PlainCo team');
      setTopic(null);
      setMessage('');
      setAboutOrderId(null);
    } catch (error) {
      console.error('Error submitting support request:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Error', 'Could not send your request. Please try again, or use one of the contact methods.');
    } finally {
      setSending(false);
    }
  };

  const open = isOpenNow();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Help & Support" onBack={() => navigation.goBack()} stuck={scrolled} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        onScroll={(e) => {
          const past = e.nativeEvent.contentOffset.y > 4;
          if (past !== scrolled) setScrolled(past);
        }}
        scrollEventThrottle={32}
      >
        <Reveal delay={40}>
          <Text style={styles.big} accessibilityRole="header">
            How can we help?
          </Text>
        </Reveal>

        {!isConnected ? (
          <View style={styles.offlineWrap}>
            <OfflineNotice>
              No internet connection — sending a request is unavailable, but call, email, and messaging still work.
            </OfflineNotice>
          </View>
        ) : null}

        <Reveal delay={90}>
          <View style={styles.search}>
            <Ionicons name="search" size={19} color={Colors.light.icon} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder='Search questions, e.g. "refund"'
              placeholderTextColor="#8E857B"
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search questions"
            />
            {search ? (
              <Pressable onPress={() => setSearch('')} style={styles.clear} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close" size={14} color={Colors.light.text} />
              </Pressable>
            ) : null}
          </View>
        </Reveal>

        {/* Tapping a topic narrows the questions to it; tapping it again
            shows them all. */}
        <Reveal delay={140} style={styles.topics}>
          {FAQ_CATEGORIES.map((c) => {
            const on = category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  setCategory(on ? null : c.id);
                }}
                style={({ pressed }) => [styles.topic, on && styles.topicOn, pressed && { transform: [{ scale: 0.95 }] }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${c.name} questions`}
              >
                <Ionicons name={c.icon} size={22} color={on ? '#fff' : Colors.light.tint} />
                <Text style={[styles.topicText, on && styles.topicTextOn]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </Reveal>

        <Reveal delay={200}>
          <GroupHeading>{heading}</GroupHeading>
        </Reveal>
        <Reveal delay={230} style={styles.faq}>
          {questions.map((item, i) => (
            <FaqItem
              key={item.id}
              item={item}
              q={q}
              open={openIds.has(item.id) !== (item.id === firstMatch)}
              onToggle={() => toggle(item.id)}
              last={i === questions.length - 1}
            />
          ))}
          {!questions.length ? (
            <Text style={styles.noResults}>No answers found. Try different words, or send us a request below.</Text>
          ) : null}
        </Reveal>

        <Reveal delay={280}>
          <Pressable
            onPress={openRequest}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }]}
            accessibilityRole="button"
            accessibilityLabel="Still stuck? Send us a request"
          >
            <View style={styles.ctaRing} pointerEvents="none" />
            <Ionicons name="chatbox-ellipses-outline" size={24} color="#fff" />
            <View style={styles.flex}>
              <Text style={styles.ctaTitle}>Still stuck? Send us a request</Text>
              <Text style={styles.ctaSub}>We&apos;ll reply to your email, usually within 24 hours.</Text>
            </View>
          </Pressable>
        </Reveal>

        <Reveal delay={320}>
          <GroupHeading>Contact us</GroupHeading>
        </Reveal>
        <Reveal delay={340}>
          <View
            style={styles.hours}
            accessible
            accessibilityLabel={`Support hours: Monday to Friday, 9 AM to 8 PM. Saturday, 9 AM to 6 PM. Sunday, closed. ${open ? 'Open now' : 'Closed now'}.`}
          >
            <View style={styles.flex}>
              <Text style={styles.hoursTitle}>Support hours</Text>
              <Text style={styles.hoursText}>Mon–Fri · 9:00 AM – 8:00 PM</Text>
              <Text style={styles.hoursText}>Sat · 9:00 AM – 6:00 PM · Sun closed</Text>
            </View>
            <LivePill open={open} />
          </View>
        </Reveal>
        <Reveal delay={380} style={styles.channels}>
          {CONTACT.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => openContact(m)}
              style={({ pressed }) => [styles.channel, pressed && { transform: [{ scale: 0.97 }] }]}
              accessibilityRole="button"
              accessibilityLabel={`${m.name}, ${m.value}`}
            >
              <View style={styles.channelIcon}>
                <Ionicons name={m.icon} size={18} color={Colors.light.text} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.channelName}>{m.name}</Text>
                <Text style={styles.channelValue} numberOfLines={1}>
                  {m.value}
                </Text>
              </View>
            </Pressable>
          ))}
        </Reveal>
        <Reveal delay={420}>
          <Pressable onPress={handleShare} style={styles.share} accessibilityRole="button">
            <Ionicons name="share-social-outline" size={18} color={Colors.light.text} />
            <Text style={styles.shareText}>Share PlainCo with a friend</Text>
          </Pressable>
        </Reveal>
      </ScrollView>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} locked={sending}>
        {sentTo ? (
          <SentView sentTo={sentTo} onDone={() => setSheetOpen(false)} />
        ) : (
          <>
            <Text style={styles.sheetTitle}>Send a support request</Text>
            <Text style={styles.sheetSub}>
              Tell us what happened.
              {auth.currentUser?.email ? (
                <>
                  {" We'll reply to "}
                  <Text style={styles.bold}>{auth.currentUser.email}</Text>.
                </>
              ) : null}
            </Text>

            <Text style={styles.label}>Topic</Text>
            <View style={styles.pills}>
              {TOPICS.map((t) => {
                const on = topic === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setTopic(t);
                    }}
                    style={[styles.pill, on && styles.pillOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                  >
                    <Text style={[styles.pillText, on && styles.pillTextOn]}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Only when there's an order to pick: the store that sold it can
                actually answer, and anything else goes to PlainCo itself. */}
            {recentOrders.length > 0 ? (
              <>
                <Text style={styles.label}>
                  Is this about an order? <Text style={styles.optional}>(optional)</Text>
                </Text>
                <View style={styles.pills}>
                  {[{ id: null, label: 'No, a general question' }, ...recentOrders.map((o) => ({
                    id: o.id,
                    label: `${formatOrderNumber(o.id)}${o.storeName ? ` · ${o.storeName}` : ''}`,
                  }))].map((opt) => {
                    const on = aboutOrderId === opt.id;
                    return (
                      <Pressable
                        key={opt.id || 'general'}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setAboutOrderId(opt.id);
                        }}
                        style={[styles.pill, on && styles.pillOn]}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={opt.id ? `About order ${opt.label}` : opt.label}
                      >
                        <Text style={[styles.pillText, on && styles.pillTextOn]}>{opt.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.routeHint}>
                  {aboutOrderId ? 'This goes to the store that sold the order.' : 'This goes to the PlainCo team.'}
                </Text>
              </>
            ) : null}

            <View style={styles.labelRow}>
              <Text style={styles.label}>Message</Text>
              <Text style={styles.count}>
                {message.length}/{MESSAGE_MAX}
              </Text>
            </View>
            <TextInput
              style={styles.textarea}
              value={message}
              onChangeText={setMessage}
              maxLength={MESSAGE_MAX}
              multiline
              textAlignVertical="top"
              placeholder="What went wrong? Include sizes, colors or dates if it helps."
              placeholderTextColor="#B3AAA0"
              accessibilityLabel="Message"
            />
            <View style={styles.sendWrap}>
              <Button
                variant="primary"
                label={!isConnected ? 'No Internet Connection' : 'Send request'}
                fontSize={16}
                onPress={handleSend}
                loading={sending}
                disabled={!canSend}
              />
            </View>
          </>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

function SentView({ sentTo, onDone }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View style={styles.done} entering={reduceMotion ? undefined : FadeIn.duration(400)}>
      <View style={styles.doneIcon}>
        <Ionicons name="checkmark" size={36} color={Colors.light.secondary} />
      </View>
      <Text style={styles.doneTitle}>Request sent</Text>
      <Text style={styles.doneText}>
        Thanks! {sentTo} will review it and reply to your email, usually within 24 hours.
      </Text>
      <View style={styles.doneButton}>
        <Button variant="secondary" label="Done" fontSize={16} onPress={onDone} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },
  bold: { fontWeight: '600', color: Colors.light.text },
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  big: { fontSize: 26, fontWeight: '600', letterSpacing: -0.5, color: Colors.light.text, marginTop: 4, marginBottom: 14 },
  offlineWrap: { marginHorizontal: -20 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    paddingLeft: 14,
    paddingRight: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontSize: 14.5,
    color: Colors.light.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  clear: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(28,27,26,0.07)', alignItems: 'center', justifyContent: 'center' },

  topics: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 2 },
  topic: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    paddingBottom: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
  },
  topicOn: { backgroundColor: Colors.light.tint, borderColor: Colors.light.tint },
  topicText: { fontSize: 11.5, fontWeight: '500', color: Colors.light.text },
  topicTextOn: { color: '#fff' },

  faq: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EEE7DD', borderRadius: 18, overflow: 'hidden' },
  q: {},
  qDivider: { borderBottomWidth: 1, borderBottomColor: '#F1EBE3' },
  qButton: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 15, paddingHorizontal: 16 },
  qText: { flex: 1, fontSize: 13.5, fontWeight: '500', color: Colors.light.text },
  aText: { paddingHorizontal: 16, paddingBottom: 15, fontSize: 12.5, lineHeight: 20, color: Colors.light.icon },
  mark: { backgroundColor: '#F6E7C9', color: Colors.light.text },
  noResults: { paddingVertical: 22, paddingHorizontal: 16, textAlign: 'center', fontSize: 12.5, color: Colors.light.icon },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: Colors.light.tint,
    marginTop: 14,
    overflow: 'hidden',
  },
  ctaRing: {
    position: 'absolute',
    right: -30,
    top: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  ctaTitle: { fontSize: 14.5, fontWeight: '600', color: '#fff' },
  ctaSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 1 },

  hours: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: Colors.light.text,
    marginBottom: 10,
  },
  hoursTitle: { fontSize: 14, fontWeight: '600', color: Colors.light.background, marginBottom: 2 },
  hoursText: { fontSize: 11.5, color: '#BDB3A9' },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(143,163,125,0.2)',
  },
  liveOff: { backgroundColor: 'rgba(250,247,242,0.08)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#9DC08B' },
  liveHalo: { position: 'absolute' },
  liveDotOff: { backgroundColor: '#8B8178' },
  liveText: { fontSize: 11.5, fontWeight: '600', color: '#CFE0BF' },
  liveTextOff: { color: '#BDB3A9' },

  channels: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '48%',
    flexGrow: 1,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
  },
  channelIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F3EEE6', alignItems: 'center', justifyContent: 'center' },
  channelName: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
  channelValue: { fontSize: 11, color: Colors.light.icon },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, marginTop: 6 },
  shareText: { fontSize: 13, fontWeight: '500', color: Colors.light.text },

  sheetTitle: { fontSize: 18, fontWeight: '600', color: Colors.light.text, marginBottom: 4 },
  sheetSub: { fontSize: 13, lineHeight: 19, color: Colors.light.icon, marginBottom: 14 },
  label: { fontSize: 12.5, fontWeight: '500', color: Colors.light.text, marginBottom: 6, marginLeft: 2 },
  optional: { fontWeight: '400', color: Colors.light.icon },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 },
  count: { fontSize: 12, color: Colors.light.icon },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  pill: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
  },
  pillOn: { backgroundColor: Colors.light.text, borderColor: Colors.light.text },
  pillText: { fontSize: 12.5, fontWeight: '500', color: Colors.light.text },
  pillTextOn: { color: Colors.light.background },
  routeHint: { fontSize: 12, color: Colors.light.icon, marginTop: -8, marginBottom: 14, marginLeft: 2 },
  textarea: {
    height: 110,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 15,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.light.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  sendWrap: { marginTop: 14 },

  done: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  doneIcon: { width: 72, height: 72, borderRadius: 22, backgroundColor: '#EEF0EA', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  doneTitle: { fontSize: 18, fontWeight: '600', color: Colors.light.text, marginBottom: 6 },
  doneText: { fontSize: 13, lineHeight: 20, color: Colors.light.icon, textAlign: 'center', marginBottom: 18 },
  doneButton: { alignSelf: 'stretch' },
});
