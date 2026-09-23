import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { auth } from '../firebaseConfig';
import { Colors, Spacing, Radius } from '../constants/theme';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { showAppAlert } from '../utils/appAlert';
import { formatOrderNumber } from '../utils/orderNumber';
import { pickAndUploadImage, uploadErrorMessage, CHAT_PICKER_OPTIONS } from '../utils/imageUpload';
import {
  CHAT_TEXT_MAX,
  messagesRef,
  orderRef,
  chatFields,
  hasUnread,
  markRead,
  sendMessage,
  chatImageFolder,
} from '../utils/orderChat';

// The last 200 messages. A conversation about one parcel that runs longer
// than that has stopped being about the parcel.
const MESSAGE_LIMIT = 200;

function formatMessageTime(date) {
  if (!date) return 'Sending…';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

// Not the product vocabulary's wording: "permission to upload product
// photos" would be wrong here, so the one chat-specific refusal gets its
// own sentence and everything else reuses the shared messages.
function chatUploadErrorMessage(code) {
  if (code === 'storage/unauthorized') {
    return 'You can only send photos in a conversation about your own order.';
  }
  return uploadErrorMessage(code);
}

function MessageBubble({ message, mine, onOpenImage }) {
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {message.imageUrl ? (
          <Pressable
            onPress={() => onOpenImage(message.imageUrl)}
            accessibilityRole="imagebutton"
            accessibilityLabel="Photo. Tap to view full size."
          >
            <Image
              source={{ uri: message.imageUrl }}
              style={[styles.bubbleImage, message.text ? styles.bubbleImageWithText : null]}
              contentFit="cover"
              transition={150}
            />
          </Pressable>
        ) : null}
        {message.text ? <Text style={styles.bubbleText}>{message.text}</Text> : null}
      </View>
      <Text style={styles.bubbleTime}>{formatMessageTime(message.createdAt)}</Text>
    </View>
  );
}

/**
 * One order's conversation. Used by both sides:
 *   side 'customer' — from OrderDetailsScreen, talking to the store
 *   side 'store'    — from AdminOrdersScreen, talking to the buyer
 * The rules decide what each side may do; `side` only decides which
 * bubbles are "mine" and which read marker to stamp.
 */
export default function OrderChatScreen({ navigation, route }) {
  const { customerId, orderId, side = 'customer', title } = route.params || {};
  const { isConnected } = useNetworkStatus();
  const uid = auth.currentUser?.uid;

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [viewerUrl, setViewerUrl] = useState(null);
  // Stamping "read" is a write; one in flight at a time is enough.
  const markingRead = useRef(false);

  useEffect(() => {
    if (!customerId || !orderId || !uid) return undefined;
    setLoading(true);
    setLoadError(false);

    const unsubscribeMessages = onSnapshot(
      query(messagesRef(customerId, orderId), orderBy('createdAt', 'desc'), limit(MESSAGE_LIMIT)),
      (snapshot) => {
        setMessages(
          snapshot.docs.map((docSnap) => {
            // 'estimate' so a message just sent shows a time straight
            // away instead of "null" until the server stamps it.
            const data = docSnap.data({ serverTimestamps: 'estimate' });
            return {
              id: docSnap.id,
              text: data.text || '',
              imageUrl: data.imageUrl || null,
              sender: data.sender,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
            };
          })
        );
        setLoading(false);
      },
      (error) => {
        console.error('Could not load messages:', error);
        setLoadError(true);
        setLoading(false);
      }
    );

    // Watching the order, not the messages, for "is there something I
    // haven't read" — that is the same question the order lists ask, so
    // opening the chat is exactly what clears their dot.
    const unsubscribeOrder = onSnapshot(
      orderRef(customerId, orderId),
      (snapshot) => {
        if (!snapshot.exists() || markingRead.current) return;
        if (!hasUnread(chatFields(snapshot.data()), side)) return;
        markingRead.current = true;
        markRead(customerId, orderId, side)
          .catch((error) => console.error('Could not mark chat read:', error))
          .finally(() => {
            markingRead.current = false;
          });
      },
      (error) => console.error('Could not watch order for chat:', error)
    );

    return () => {
      unsubscribeMessages();
      unsubscribeOrder();
    };
  }, [customerId, orderId, side, uid, retryKey]);

  const send = async ({ imageUrl } = {}) => {
    const text = draft.trim();
    if ((!text && !imageUrl) || !uid) return;
    setSending(true);
    try {
      await sendMessage({ customerId, orderId, side, senderId: uid, text, imageUrl });
      setDraft('');
      Haptics.selectionAsync();
    } catch (error) {
      console.error('Could not send message:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert(
        'Message not sent',
        error?.code === 'permission-denied'
          ? 'You can’t send messages about this order.'
          : 'Check your connection and try again. Your message is still in the box.'
      );
    } finally {
      setSending(false);
    }
  };

  const sendPhoto = async (source) => {
    setUploadProgress(0);
    const result = await pickAndUploadImage({
      source,
      folder: chatImageFolder(customerId, orderId),
      pickerOptions: CHAT_PICKER_OPTIONS,
      onProgress: setUploadProgress,
    });
    setUploadProgress(null);
    if (result.cancelled) return;
    if (!result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Photo not sent', chatUploadErrorMessage(result.error));
      return;
    }
    // Whatever is typed goes with the photo, as its caption.
    await send({ imageUrl: result.url });
  };

  const handleAddPhoto = () => {
    Haptics.selectionAsync();
    // The web build has no camera picker worth offering.
    if (Platform.OS === 'web') {
      sendPhoto('library');
      return;
    }
    showAppAlert('Send a photo', undefined, [
      { text: 'Take Photo', onPress: () => sendPhoto('camera') },
      { text: 'Choose from Library', onPress: () => sendPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const busy = sending || uploadProgress !== null;
  const canSend = draft.trim().length > 0 && !busy && isConnected;

  const emptySubtitle =
    side === 'store'
      ? 'Send the buyer a photo of the exact piece before it ships, or ask about their delivery.'
      : 'Ask about the condition, sizing, or delivery. The store will reply here.';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
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
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Messages'}</Text>
          <Text style={styles.headerSubtitle}>Order {formatOrderNumber(orderId)}</Text>
        </View>
        <View style={styles.backButton} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>No internet connection — messages can’t be sent.</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        // 'height' on Android like every other form in the app: with
        // edge-to-edge on, the OS no longer shrinks the window for the
        // keyboard, so without it the keyboard covers the composer.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.light.tint} />
          </View>
        ) : loadError ? (
          <View style={styles.center}>
            <EmptyState
              icon="chatbubbles-outline"
              title="Couldn't load messages"
              subtitle="Check your connection and try again."
            />
            <View style={styles.retryWrap}>
              <Button variant="secondary" label="Retry" onPress={() => setRetryKey((k) => k + 1)} />
            </View>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <EmptyState icon="chatbubbles-outline" title="No messages yet" subtitle={emptySubtitle} />
          </View>
        ) : (
          // Inverted, newest first in the data: the list stays pinned to
          // the latest message as new ones arrive and the keyboard opens.
          <FlatList
            data={messages}
            inverted
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <MessageBubble message={item} mine={item.sender === side} onOpenImage={setViewerUrl} />
            )}
          />
        )}

        {uploadProgress !== null && (
          <View style={styles.uploadBar}>
            <ActivityIndicator size="small" color={Colors.light.tint} />
            <Text style={styles.uploadText}>
              Sending photo… {Math.round(uploadProgress * 100)}%
            </Text>
          </View>
        )}

        <View style={styles.composer}>
          <TouchableOpacity
            onPress={handleAddPhoto}
            disabled={busy || !isConnected}
            style={styles.composerIcon}
            accessibilityRole="button"
            accessibilityLabel="Send a photo"
          >
            <Ionicons
              name="image-outline"
              size={24}
              color={busy || !isConnected ? Colors.light.border : Colors.light.icon}
            />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={Colors.light.icon}
            multiline
            // A browser textarea starts two rows tall; one, like the phones.
            {...(Platform.OS === 'web' ? { rows: 1 } : null)}
            maxLength={CHAT_TEXT_MAX}
            editable={!busy}
            accessibilityLabel="Message"
          />
          <TouchableOpacity
            onPress={() => send()}
            disabled={!canSend}
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!viewerUrl} transparent animationType="fade" onRequestClose={() => setViewerUrl(null)}>
        <Pressable
          style={styles.viewer}
          onPress={() => setViewerUrl(null)}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          {viewerUrl ? (
            <Image source={{ uri: viewerUrl }} style={styles.viewerImage} contentFit="contain" />
          ) : null}
          <View style={styles.viewerClose}>
            <Ionicons name="close" size={28} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  headerSubtitle: { fontSize: 12, color: Colors.light.icon, marginTop: 1 },

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: Colors.light.danger + '10',
  },
  offlineBannerText: { fontSize: 12, color: Colors.light.danger },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  retryWrap: { width: 200, marginTop: Spacing.sm },
  listContent: { paddingHorizontal: 16, paddingVertical: 12 },

  bubbleRow: { marginVertical: 4, maxWidth: '80%' },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleRowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  // Flat, like every other surface: the other side's bubble is a bordered
  // card, and "mine" is a quiet Clay tint rather than a filled Clay block,
  // which the design system keeps for the one primary action on a screen.
  bubble: { borderRadius: Radius.lg, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: Colors.light.tint + '1F', borderBottomRightRadius: Radius.sm },
  bubbleTheirs: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderBottomLeftRadius: Radius.sm,
  },
  bubbleText: { fontSize: 15, lineHeight: 21, color: Colors.light.text },
  bubbleImage: { width: 200, height: 200, borderRadius: Radius.md, backgroundColor: Colors.light.border },
  bubbleImageWithText: { marginBottom: 6 },
  bubbleTime: { fontSize: 11, color: Colors.light.icon, marginTop: 3, marginHorizontal: 4 },

  uploadBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  uploadText: { fontSize: 13, color: Colors.light.icon },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  composerIcon: { width: 40, height: 44, justifyContent: 'center', alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
    fontSize: 15,
    color: Colors.light.text,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.light.tint,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { backgroundColor: Colors.light.border },

  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20 },
});
