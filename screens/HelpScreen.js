import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  Modal,
  Linking,
  Share,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { db, auth } from '../firebaseConfig';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

// FAQ Data
const faqCategories = [
  {
    id: 'orders',
    name: 'Orders',
    icon: 'cart-outline',
    color: '#007AFF',
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
    color: '#34C759',
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
    color: '#FF9500',
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
    color: '#AF52DE',
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
    color: '#007AFF',
    action: 'email',
  },
  {
    id: 'phone',
    name: 'Hotline',
    value: '+63 2 8123 4567',
    icon: 'call-outline',
    color: '#34C759',
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

export default function HelpScreen({ navigation }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Refs for scroll-to-section behavior (replaces the web-only document.getElementById approach)
  const scrollViewRef = useRef(null);
  const contactFormY = useRef(0);

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

  const handleContact = async (method) => {
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
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: 'Check out PlainCo! Great place to shop for ukay-ukay and ready-to-wear items. Download the app now!',
        url: 'https://plainco.com/download',
        title: 'Share PlainCo',
      });
    } catch (error) {
      Alert.alert('Error', 'Unable to share at this moment.');
    }
  };

  const handleSubmitSupport = async () => {
    if (!supportMessage.trim()) {
      Alert.alert('Error', 'Please enter your message');
      return;
    }

    if (!auth.currentUser) {
      Alert.alert(
        'Log In Required',
        'Please log in so our support team can follow up with you about this request.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log In', onPress: () => navigation.navigate('Login') },
        ]
      );
      return;
    }

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
      Alert.alert(
        'Message Sent!',
        'Thank you for reaching out. Our support team will respond within 24 hours.',
        [{ text: 'OK', onPress: () => setSupportMessage('') }]
      );
    } catch (error) {
      console.error('Error submitting support request:', error);
      Alert.alert(
        'Error',
        'Could not send your message. Please try again, or use one of the contact methods above.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCommonIssue = (issue) => {
    setSupportMessage(`Hello, I need help with: ${issue.title}. ${issue.description}`);
    // React Native has no DOM, so we scroll using the ScrollView ref
    // and the y-position captured by the contact form's onLayout below.
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: contactFormY.current, animated: true });
    }, 100);
  };

  const renderFAQItem = (question, categoryColor) => {
    const isExpanded = selectedQuestion?.id === question.id;

    return (
      <TouchableOpacity
        key={question.id}
        style={styles.faqItem}
        onPress={() => {
          if (isExpanded) {
            setSelectedQuestion(null);
          } else {
            setSelectedQuestion(question);
          }
        }}
      >
        <View style={styles.faqHeader}>
          <Text style={styles.faqQuestion}>{question.question}</Text>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#666"
          />
        </View>
        {isExpanded && (
          <View style={styles.faqAnswer}>
            <Text style={styles.faqAnswerText}>{question.answer}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help Center</Text>
        <TouchableOpacity onPress={handleShare}>
          <Ionicons name="share-outline" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollViewRef} showsVerticalScrollIndicator={false}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for help..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickActionItem} onPress={() => Linking.openURL('tel:0281234567')}>
            <View style={styles.quickActionIcon}>
              <Ionicons name="call-outline" size={24} color="#007AFF" />
            </View>
            <Text style={styles.quickActionText}>Call Us</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionItem} onPress={() => Linking.openURL('mailto:support@plainco.com')}>
            <View style={styles.quickActionIcon}>
              <Ionicons name="mail-outline" size={24} color="#34C759" />
            </View>
            <Text style={styles.quickActionText}>Email</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionItem} onPress={() => Linking.openURL('https://wa.me/639123456789')}>
            <View style={styles.quickActionIcon}>
              <Ionicons name="logo-whatsapp" size={24} color="#25D366" />
            </View>
            <Text style={styles.quickActionText}>WhatsApp</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionItem} onPress={handleShare}>
            <View style={styles.quickActionIcon}>
              <Ionicons name="share-social-outline" size={24} color="#FF9500" />
            </View>
            <Text style={styles.quickActionText}>Share App</Text>
          </TouchableOpacity>
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
              <TouchableOpacity
                key={issue.id}
                style={styles.issueCard}
                onPress={() => handleCommonIssue(issue)}
              >
                <View style={styles.issueIcon}>
                  <Ionicons name={issue.icon} size={24} color="#007AFF" />
                </View>
                <Text style={styles.issueTitle}>{issue.title}</Text>
                <Text style={styles.issueDescription}>{issue.description}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* FAQ Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {filteredFAQs().map((category) => (
            <View key={category.id} style={styles.faqCategory}>
              <View style={styles.categoryHeader}>
                <View style={[styles.categoryIcon, { backgroundColor: category.color + '20' }]}>
                  <Ionicons name={category.icon} size={20} color={category.color} />
                </View>
                <Text style={styles.categoryName}>{category.name}</Text>
              </View>
              <View style={styles.faqList}>
                {category.questions.map((question) => renderFAQItem(question, category.color))}
              </View>
            </View>
          ))}
          {filteredFAQs().length === 0 && (
            <View style={styles.noResults}>
              <Ionicons name="search-outline" size={48} color="#ccc" />
              <Text style={styles.noResultsText}>No results found</Text>
              <Text style={styles.noResultsSubtext}>
                Try different keywords or contact our support team
              </Text>
            </View>
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
          <View style={styles.contactCard}>
            <Text style={styles.contactSubtitle}>
              Can&apos;t find what you&apos;re looking for? Send us a message and we&apos;ll help you out!
            </Text>

            <View style={styles.contactMethods}>
              {contactMethods.map((method) => (
                <TouchableOpacity
                  key={method.id}
                  style={styles.contactMethod}
                  onPress={() => handleContact(method)}
                >
                  <View style={[styles.contactMethodIcon, { backgroundColor: method.color + '20' }]}>
                    <Ionicons name={method.icon} size={24} color={method.color} />
                  </View>
                  <View style={styles.contactMethodInfo}>
                    <Text style={styles.contactMethodName}>{method.name}</Text>
                    <Text style={styles.contactMethodValue}>{method.value}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#999" />
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.supportForm}>
              <Text style={styles.formLabel}>Send us a message</Text>
              <TextInput
                style={styles.messageInput}
                placeholder="Describe your issue in detail..."
                placeholderTextColor="#999"
                value={supportMessage}
                onChangeText={setSupportMessage}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmitSupport}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="send-outline" size={20} color="#fff" />
                    <Text style={styles.submitButtonText}>Send Message</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Operating Hours */}
        <View style={styles.section}>
          <View style={styles.hoursCard}>
            <Ionicons name="time-outline" size={24} color="#007AFF" />
            <View style={styles.hoursInfo}>
              <Text style={styles.hoursTitle}>Support Hours</Text>
              <Text style={styles.hoursText}>Monday - Friday: 9:00 AM - 8:00 PM</Text>
              <Text style={styles.hoursText}>Saturday: 9:00 AM - 6:00 PM</Text>
              <Text style={styles.hoursText}>Sunday: Closed</Text>
              <Text style={styles.hoursNote}>Average response time: 2-4 hours</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>© 2026 PlainCo. All rights reserved.</Text>
          <Text style={styles.footerVersion}>Version 1.0.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9FB',
    margin: 20,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: '#000',
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
    backgroundColor: '#F9F9FB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionText: {
    fontSize: 12,
    color: '#666',
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
  },
  issuesScroll: {
    flexDirection: 'row',
  },
  issueCard: {
    width: 160,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  issueIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  issueTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  issueDescription: {
    fontSize: 12,
    color: '#666',
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
    color: '#000',
  },
  faqList: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    overflow: 'hidden',
  },
  faqItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
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
    color: '#000',
    marginRight: 12,
  },
  faqAnswer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  faqAnswerText: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
  },
  noResults: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noResultsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginTop: 12,
  },
  noResultsSubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
  contactCard: {
    backgroundColor: '#F9F9FB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  contactSubtitle: {
    fontSize: 14,
    color: '#666',
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
    borderBottomColor: '#E5E5EA',
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
    color: '#000',
    marginBottom: 2,
  },
  contactMethodValue: {
    fontSize: 12,
    color: '#666',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5EA',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 12,
    color: '#999',
  },
  supportForm: {
    marginTop: 8,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginBottom: 8,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#fff',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hoursCard: {
    flexDirection: 'row',
    backgroundColor: '#F9F9FB',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    gap: 12,
  },
  hoursInfo: {
    flex: 1,
  },
  hoursTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  hoursText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  hoursNote: {
    fontSize: 11,
    color: '#34C759',
    marginTop: 8,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingBottom: 40,
  },
  footerText: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  footerVersion: {
    fontSize: 11,
    color: '#ccc',
  },
});