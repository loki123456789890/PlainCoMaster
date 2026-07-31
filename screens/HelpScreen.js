import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  Platform,
  Linking,
  Share,
  KeyboardAvoidingView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  interpolateColor,
  Easing,
  FadeIn,
  FadeInDown,
  LinearTransition,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { db, auth } from '../firebaseConfig';
import { showAppAlert } from '../utils/appAlert';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

// FAQ Data
const faqCategories = [
  {
    id: 'orders',
    name: 'Orders',
    icon: 'cart-outline',
    color: Colors.light.tint,
    questions: [
      {
        id: 'o1',
        question: 'How do I track my order?',
        answer: 'You can track your order by going to "My Orders" in your profile. Click on the specific order to see its current status (Processing, Shipped, or Delivered).',
      },
      {
        id: 'o2',
        question: 'Can I cancel or modify my order?',
        answer: 'Orders can\'t be cancelled or modified directly in the app yet. If you need to cancel or change an order, please contact our support team as soon as possible after placing it and we\'ll do our best to help before it ships.',
      },
      {
        id: 'o3',
        question: 'What payment methods do you accept?',
        answer: 'At checkout you can select GCash, Maya, Card, or Cash on Delivery (COD). Online payment processing for GCash, Maya, and Card is still being integrated, so for now COD is the most reliable option — you pay in person when your order arrives.',
      },
      {
        id: 'o4',
        question: 'Do you have voucher or promo codes?',
        answer: 'We don\'t have a voucher or promo code system in the app yet. Keep an eye on our announcements for upcoming deals!',
      },
    ],
  },
  {
    id: 'shipping',
    name: 'Shipping & Delivery',
    icon: 'car-outline',
    color: Colors.light.secondary,
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
        answer: 'Currently, we only ship within the Philippines. We\'re working on expanding our shipping coverage internationally soon!',
      },
      {
        id: 's4',
        question: 'What if my package is damaged?',
        answer: 'If you receive a damaged item, please contact us within 24 hours of delivery with photos of the damage. We\'ll arrange for a replacement or refund.',
      },
    ],
  },
  {
    id: 'returns',
    name: 'Returns & Refunds',
    icon: 'refresh-outline',
    color: Colors.light.highlight,
    questions: [
      {
        id: 'r1',
        question: 'What is your return policy?',
        answer: 'We accept returns within 7 days of delivery for unused items in original packaging. Items must be in original condition with tags attached.',
      },
      {
        id: 'r2',
        question: 'How do I request a return?',
        answer: 'There\'s no automatic return request feature in the app yet. Please contact our support team within 7 days of delivery and we\'ll walk you through the process manually.',
      },
      {
        id: 'r3',
        question: 'When will I get my refund?',
        answer: 'Refunds are processed within 5-10 business days after we receive and inspect the returned item. The refund will be credited to your original payment method.',
      },
      {
        id: 'r4',
        question: 'Can I exchange an item?',
        answer: 'Exchanges aren\'t handled automatically in the app yet. Contact our support team and we\'ll help arrange a size or color exchange manually.',
      },
    ],
  },
  {
    id: 'account',
    name: 'Account & Security',
    icon: 'person-outline',
    color: Colors.light.success,
    questions: [
      {
        id: 'a1',
        question: 'How do I change my password?',
        answer: 'There\'s no in-app "change password" option yet. To reset your password, log out and tap "Forgot Password?" on the sign-in screen — we\'ll email you a secure link to set a new one.',
      },
      {
        id: 'a2',
        question: 'How do I deactivate my account?',
        answer: 'You can deactivate your account from your Profile screen. Your account will be disabled and you will be signed out, and you will not be able to sign in again. Your personal information is retained only as required for order and transaction records — deactivation does not erase past orders. If you need further action on your data, send us a message through the Contact Support form below.',
      },
      {
        id: 'a3',
        question: 'Is my payment information secure?',
        answer: 'We never ask for or store card numbers, CVV, or e-wallet credentials in the app. Online payment processing is still being integrated, so Cash on Delivery is currently the safest and most reliable way to pay.',
      },
      {
        id: 'a4',
        question: 'How do I update my profile?',
        answer: 'Profile editing isn\'t available in the app yet — your name and email are set when you sign up. If you need to update this information, please contact our support team.',
      },
    ],
  },
];

// Contact Methods
const contactMethods = [
  {
    id: 'email',
    name: 'Email Support',
    value: 'support@plainco.com',
    icon: 'mail-outline',
    color: Colors.light.tint,
    action: 'email',
  },
  {
    id: 'phone',
    name: 'Hotline',
    value: '+63 2 8123 4567',
    icon: 'call-outline',
    color: Colors.light.secondary,
    action: 'phone',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    value: '+63 912 345 6789',
    icon: 'logo-whatsapp',
    color: '#25D366',
    action: 'whatsapp',
  },
  {
    id: 'messenger',
    name: 'Facebook Messenger',
    value: '@plainco.ph',
    icon: 'logo-facebook',
    color: '#0084FF',
    action: 'messenger',
  },
];

// Common Issues
const commonIssues = [
  {
    id: 'issue1',
    title: 'Order Not Received',
    description: 'Your order is delayed or missing',
    icon: 'time-outline',
  },
  {
    id: 'issue2',
    title: 'Wrong Item Received',
    description: 'Received incorrect product',
    icon: 'alert-circle-outline',
  },
  {
    id: 'issue3',
    title: 'Payment Failed',
    description: 'Issues with payment processing',
    icon: 'cash-outline',
  },
  {
    id: 'issue4',
    title: 'Account Issues',
    description: 'Login or registration problems',
    icon: 'person-outline',
  },
];

// One FAQ row: question + chevron that rotates on expand, answer reveals
// with a fade, and the surrounding list reflows smoothly via `layout` —
// same LinearTransition treatment Ordersscreen.js uses for its filtered list.
function FAQItem({ question, isExpanded, onToggle }) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(isExpanded ? 1 : 0);
  React.useEffect(() => {
    rotation.value = withTiming(isExpanded ? 1 : 0, { duration: 200, easing: EASE_OUT_QUART });
  }, [isExpanded]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 180}deg` }],
  }));

  return (
    <Animated.View layout={reduceMotion ? undefined : LinearTransition.duration(200).easing(EASE_OUT_QUART)}>
      <AnimatedPressable
        style={styles.faqItem}
        onPress={onToggle}
        rippleColor={Colors.light.border}
        accessibilityRole="button"
        accessibilityLabel={question.question}
        accessibilityHint={isExpanded ? 'Collapses the answer' : 'Expands the answer'}
        accessibilityState={{ expanded: isExpanded }}
      >
        <View style={styles.faqHeader}>
          <Text style={styles.faqQuestion}>{question.question}</Text>
          <Animated.View style={chevronStyle}>
            <Ionicons name="chevron-down" size={20} color={Colors.light.icon} />
          </Animated.View>
        </View>
        {isExpanded && (
          <Animated.View
            style={styles.faqAnswer}
            entering={reduceMotion ? undefined : FadeIn.duration(180).easing(EASE_OUT_QUART)}
          >
            <Text style={styles.faqAnswerText}>{question.answer}</Text>
          </Animated.View>
        )}
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function HelpScreen({ navigation }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [supportMessage, setSupportMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  // Refs for scroll-to-section behavior (replaces the web-only document.getElementById approach)
  const scrollViewRef = useRef(null);
  const contactFormY = useRef(0);
  const messageInputRef = useRef(null);

  // Briefly glows the message field after a Common Issue tap pre-fills it,
  // so the user's eye lands on exactly where their draft appeared instead
  // of having to hunt for it after the auto-scroll.
  const messageHighlight = useSharedValue(0);
  const messageHighlightStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      messageHighlight.value,
      [0, 1],
      [Colors.light.background, Colors.light.tint + '14']
    ),
    borderColor: interpolateColor(
      messageHighlight.value,
      [0, 1],
      [Colors.light.border, Colors.light.tint]
    ),
  }));

  // Filter FAQs based on search
  const filteredFAQs = () => {
    if (!searchQuery.trim()) return faqCategories;

    const query = searchQuery.toLowerCase();
    return faqCategories
      .map(category => ({
        ...category,
        questions: category.questions.filter(q =>
          q.question.toLowerCase().includes(query) ||
          q.answer.toLowerCase().includes(query)
        ),
      }))
      .filter(category => category.questions.length > 0);
  };

  const handleToggleFAQ = (question) => {
    Haptics.selectionAsync();
    setSelectedQuestion((current) => (current?.id === question.id ? null : question));
  };

  const handleContact = async (method) => {
    try {
      switch (method.action) {
        case 'email':
          await Linking.openURL(`mailto:${method.value}`);
          break;
        case 'phone':
          await Linking.openURL(`tel:${method.value.replace(/\s/g, '')}`);
          break;
        case 'whatsapp':
          await Linking.openURL(`https://wa.me/${method.value.replace(/\s/g, '')}`);
          break;
        case 'messenger':
          await Linking.openURL(`https://m.me/${method.value}`);
          break;
      }
    } catch (error) {
      // Most commonly: the relevant app (Mail, WhatsApp, Messenger) isn't
      // installed. Without this, the tap does nothing and looks broken —
      // exactly the wrong impression for the screen meant to build trust.
      showAppAlert(
        'Unable to Open',
        `We couldn't open ${method.name}. You can reach us directly at ${method.value}.`
      );
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: 'Check out PlainCo! Great place to shop for ukay-ukay and ready-to-wear items. Download the app now!',
        url: 'https://plainco.com/download',
        title: 'Share PlainCo',
      });
    } catch (error) {
      showAppAlert('Error', 'Unable to share at this moment.');
    }
  };

  const handleSubmitSupport = async () => {
    if (!supportMessage.trim()) {
      showAppAlert('Error', 'Please enter your message');
      return;
    }

    if (!auth.currentUser) {
      showAppAlert(
        'Log In Required',
        'Please log in so our support team can follow up with you about this request.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log In', onPress: () => navigation.navigate('Login') },
        ]
      );
      return;
    }

    if (!isConnected) {
      showAppAlert('No Internet Connection', 'Please check your connection and try again.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmitting(true);
    try {
      // Writes the request to Firestore so it's durable and admin-reviewable.
      // There's no email/push pipeline yet (would need Cloud Functions + a
      // mail provider) — this is the real, persisted equivalent of "sent".
      await addDoc(collection(db, 'supportRequests'), {
        message: supportMessage.trim(),
        userId: auth.currentUser?.uid || null,
        userEmail: auth.currentUser?.email || null,
        status: 'open',
        createdAt: serverTimestamp(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        'Message Sent!',
        'Thank you for reaching out. Our support team will respond within 24 hours.',
        [{ text: 'OK', onPress: () => setSupportMessage('') }]
      );
    } catch (error) {
      console.error('Error submitting support request:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert(
        'Error',
        'Could not send your message. Please try again, or use one of the contact methods above.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCommonIssue = (issue) => {
    Haptics.selectionAsync();
    setSupportMessage(`Hello, I need help with: ${issue.title}. ${issue.description}`);
    // React Native has no DOM, so we scroll using the ScrollView ref
    // and the y-position captured by the contact form's onLayout below.
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: contactFormY.current, animated: true });
      setTimeout(() => {
        messageInputRef.current?.focus();
        if (!reduceMotion) {
          messageHighlight.value = withSequence(
            withTiming(1, { duration: 150, easing: EASE_OUT_QUART }),
            withTiming(0, { duration: 500, easing: EASE_OUT_QUART })
          );
        }
      }, 350);
    }, 100);
  };

  const phoneMethod = contactMethods.find((m) => m.id === 'phone');
  const emailMethod = contactMethods.find((m) => m.id === 'email');
  const whatsappMethod = contactMethods.find((m) => m.id === 'whatsapp');
  const visibleFAQs = filteredFAQs();

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help Center</Text>
        <TouchableOpacity
          onPress={handleShare}
          style={styles.headerAction}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Share the PlainCo app"
        >
          <Ionicons name="share-outline" size={24} color={Colors.light.text} />
        </TouchableOpacity>
      </View>

      {!isConnected && (
        <Animated.View
          style={styles.offlineBanner}
          entering={reduceMotion ? undefined : FadeIn.duration(220)}
        >
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — sending a message is unavailable, but call, email, and text still work.
          </Text>
        </Animated.View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={20} color={Colors.light.icon} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search for help..."
              placeholderTextColor={Colors.light.icon}
              value={searchQuery}
              onChangeText={setSearchQuery}
              accessibilityLabel="Search for help"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={20} color={Colors.light.icon} />
              </TouchableOpacity>
            )}
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <AnimatedPressable
              style={styles.quickActionItem}
              onPress={() => handleContact(phoneMethod)}
              accessibilityRole="button"
              accessibilityLabel="Call us"
              accessibilityHint={`Calls ${phoneMethod.value}`}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: Colors.light.tint + '20' }]}>
                <Ionicons name="call-outline" size={24} color={Colors.light.tint} />
              </View>
              <Text style={styles.quickActionText}>Call Us</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={styles.quickActionItem}
              onPress={() => handleContact(emailMethod)}
              accessibilityRole="button"
              accessibilityLabel="Email support"
              accessibilityHint={`Opens an email to ${emailMethod.value}`}
            >
              <View style={[styles.quickActionIcon, { backgroundColor: Colors.light.secondary + '20' }]}>
                <Ionicons name="mail-outline" size={24} color={Colors.light.secondary} />
              </View>
              <Text style={styles.quickActionText}>Email</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={styles.quickActionItem}
              onPress={() => handleContact(whatsappMethod)}
              accessibilityRole="button"
              accessibilityLabel="Message us on WhatsApp"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: '#25D36620' }]}>
                <Ionicons name="logo-whatsapp" size={24} color="#25D366" />
              </View>
              <Text style={styles.quickActionText}>WhatsApp</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={styles.quickActionItem}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel="Share the PlainCo app"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: Colors.light.highlight + '20' }]}>
                <Ionicons name="share-social-outline" size={24} color={Colors.light.highlight} />
              </View>
              <Text style={styles.quickActionText}>Share App</Text>
            </AnimatedPressable>
          </View>

          {/* Common Issues */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Common Issues</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.issuesScroll}
            >
              {commonIssues.map((issue) => (
                <AnimatedPressable
                  key={issue.id}
                  onPress={() => handleCommonIssue(issue)}
                  rippleColor={Colors.light.border}
                  accessibilityRole="button"
                  accessibilityLabel={`${issue.title}. ${issue.description}.`}
                  accessibilityHint="Pre-fills a support message about this issue"
                >
                  <Card variant="flat" style={styles.issueCard}>
                    <View style={styles.issueIcon}>
                      <Ionicons name={issue.icon} size={24} color={Colors.light.tint} />
                    </View>
                    <Text style={styles.issueTitle}>{issue.title}</Text>
                    <Text style={styles.issueDescription}>{issue.description}</Text>
                  </Card>
                </AnimatedPressable>
              ))}
            </ScrollView>
          </View>

          {/* FAQ Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
            {visibleFAQs.map((category, categoryIndex) => (
              <Animated.View
                key={category.id}
                style={styles.faqCategory}
                entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(categoryIndex, 8) * 40).duration(220).easing(EASE_OUT_QUART)}
                layout={reduceMotion ? undefined : LinearTransition.duration(220).easing(EASE_OUT_QUART)}
              >
                <View style={styles.categoryHeader}>
                  <View style={[styles.categoryIcon, { backgroundColor: category.color + '20' }]}>
                    <Ionicons name={category.icon} size={20} color={category.color} />
                  </View>
                  <Text style={styles.categoryName}>{category.name}</Text>
                </View>
                <Card variant="flat" style={styles.faqListCard}>
                  {category.questions.map((question) => (
                    <FAQItem
                      key={question.id}
                      question={question}
                      isExpanded={selectedQuestion?.id === question.id}
                      onToggle={() => handleToggleFAQ(question)}
                    />
                  ))}
                </Card>
              </Animated.View>
            ))}
            {visibleFAQs.length === 0 && (
              <Animated.View
                style={styles.noResults}
                entering={reduceMotion ? undefined : FadeIn.duration(220)}
              >
                <EmptyState
                  icon="search-outline"
                  title="No results found"
                  subtitle="Try different keywords or contact our support team below."
                />
              </Animated.View>
            )}
          </View>

          {/* Contact Support Form */}
          <View
            style={styles.section}
            onLayout={(event) => {
              contactFormY.current = event.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.sectionTitle}>Contact Support</Text>
            <Card variant="flat">
              <Text style={styles.contactSubtitle}>
                Can&apos;t find what you&apos;re looking for? Send us a message and we&apos;ll help you out!
              </Text>

              <View style={styles.contactMethods}>
                {contactMethods.map((method) => (
                  <AnimatedPressable
                    key={method.id}
                    style={styles.contactMethod}
                    onPress={() => handleContact(method)}
                    rippleColor={Colors.light.border}
                    accessibilityRole="button"
                    accessibilityLabel={`${method.name}, ${method.value}`}
                  >
                    <View style={[styles.contactMethodIcon, { backgroundColor: method.color + '20' }]}>
                      <Ionicons name={method.icon} size={24} color={method.color} />
                    </View>
                    <View style={styles.contactMethodInfo}>
                      <Text style={styles.contactMethodName}>{method.name}</Text>
                      <Text style={styles.contactMethodValue}>{method.value}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={Colors.light.icon} />
                  </AnimatedPressable>
                ))}
              </View>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.supportForm}>
                <Text style={styles.formLabel}>Send us a message</Text>
                <AnimatedTextInput
                  ref={messageInputRef}
                  style={[styles.messageInput, messageHighlightStyle]}
                  placeholder="Describe your issue in detail..."
                  placeholderTextColor={Colors.light.icon}
                  value={supportMessage}
                  onChangeText={setSupportMessage}
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                  accessibilityLabel="Describe your issue"
                />
                <View style={styles.submitButtonWrap}>
                  <Button
                    variant="primary"
                    label={!isConnected ? 'No Internet Connection' : 'Send Message'}
                    onPress={handleSubmitSupport}
                    loading={isSubmitting}
                    disabled={isSubmitting || !isConnected}
                  />
                </View>
              </View>
            </Card>
          </View>

          {/* Operating Hours */}
          <View style={styles.section}>
            <View
              accessible
              accessibilityLabel="Support hours: Monday to Friday, 9 AM to 8 PM. Saturday, 9 AM to 6 PM. Sunday, closed. Average response time: 2 to 4 hours."
            >
              <Card variant="flat" style={styles.hoursCard}>
                <Ionicons name="time-outline" size={24} color={Colors.light.tint} />
                <View style={styles.hoursInfo}>
                  <Text style={styles.hoursTitle}>Support Hours</Text>
                  <Text style={styles.hoursText}>Monday - Friday: 9:00 AM - 8:00 PM</Text>
                  <Text style={styles.hoursText}>Saturday: 9:00 AM - 6:00 PM</Text>
                  <Text style={styles.hoursText}>Sunday: Closed</Text>
                  <Text style={styles.hoursNote}>Average response time: 2-4 hours</Text>
                </View>
              </Card>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>© {new Date().getFullYear()} PlainCo. All rights reserved.</Text>
            <Text style={styles.footerVersion}>Version 1.0.0</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
  },
  headerAction: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.danger + '40',
  },
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
  keyboardView: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    margin: 20,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: Colors.light.text,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  quickActionItem: {
    alignItems: 'center',
  },
  quickActionIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionText: {
    fontSize: 12,
    color: Colors.light.icon,
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 16,
  },
  issuesScroll: {
    flexDirection: 'row',
  },
  issueCard: {
    width: 160,
    marginRight: 12,
  },
  issueIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.tint + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  issueTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 4,
  },
  issueDescription: {
    fontSize: 12,
    color: Colors.light.icon,
  },
  faqCategory: {
    marginBottom: 20,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.light.text,
  },
  faqListCard: {
    padding: 0,
    overflow: 'hidden',
  },
  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    padding: 16,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQuestion: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
    marginRight: 12,
  },
  faqAnswer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  faqAnswerText: {
    fontSize: 13,
    color: Colors.light.icon,
    lineHeight: 20,
  },
  noResults: {
    paddingVertical: 8,
  },
  contactSubtitle: {
    fontSize: 14,
    color: Colors.light.icon,
    marginBottom: 16,
    lineHeight: 20,
  },
  contactMethods: {
    marginBottom: 16,
  },
  contactMethod: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  contactMethodIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  contactMethodInfo: {
    flex: 1,
  },
  contactMethodName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 2,
  },
  contactMethodValue: {
    fontSize: 12,
    color: Colors.light.icon,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.light.border,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 12,
    color: Colors.light.icon,
  },
  supportForm: {
    marginTop: 8,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.light.text,
    marginBottom: 8,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  submitButtonWrap: {
    marginTop: 12,
  },
  hoursCard: {
    flexDirection: 'row',
    gap: 12,
  },
  hoursInfo: {
    flex: 1,
  },
  hoursTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 8,
  },
  hoursText: {
    fontSize: 12,
    color: Colors.light.icon,
    marginBottom: 4,
  },
  hoursNote: {
    fontSize: 11,
    color: Colors.light.success,
    marginTop: 8,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingBottom: 40,
  },
  footerText: {
    fontSize: 12,
    color: Colors.light.icon,
    marginBottom: 4,
  },
  footerVersion: {
    fontSize: 11,
    color: Colors.light.border,
  },
});
