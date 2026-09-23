import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import * as Clipboard from 'expo-clipboard';
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
  REACTIONS,
  messagesRef,
  orderRef,
  chatFields,
  hasUnread,
  markRead,
  sendMessage,
  editMessage,
  unsendMessage,
  setReaction,
  canEdit,
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

function mapMessage(docSnap) {
  // 'estimate' so a message just sent shows a time straight away instead
  // of "null" until the server stamps it.
  const data = docSnap.data({ serverTimestamps: 'estimate' });
  return {
    id: docSnap.id,
    senderId: data.senderId,
    sender: data.sender,
    text: data.text || '',
    imageUrl: data.imageUrl || null,
    replyTo: data.replyTo || null,
    reactions: data.reactions || {},
    deleted: data.deleted === true,
    edited: !!data.editedAt,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
  };
}

// What a quote shows. The live original wins when it is loaded, so an
// edit shows through and an unsent message is not quoted back to life;
// the snapshot stored on the reply covers anything older than the list.
function resolveQuote(replyTo, byId) {
  if (!replyTo) return null;
  const original = byId.get(replyTo.id);
  if (original?.deleted) return { sender: replyTo.sender, text: 'Message unsent', muted: true };
  const text = original ? original.text : replyTo.text;
  const hasImage = original ? !!original.imageUrl : replyTo.hasImage;
  return { sender: replyTo.sender, text: text || (hasImage ? 'Photo' : ''), hasImage };
}

// Grouped as Messenger shows them: each emoji once, with a count when
// both sides picked the same one.
function reactionSummary(reactions) {
  const counts = new Map();
  Object.values(reactions || {}).forEach((emoji) => counts.set(emoji, (counts.get(emoji) || 0) + 1));
  return [...counts.entries()];
}

function MessageBubble({ message, mine, quote, whoLabel, onLongPress, onOpenImage }) {
  if (message.deleted) {
    return (
      <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
        <View style={[styles.bubble, styles.bubbleUnsent]}>
          <Text style={styles.unsentText}>
            {mine ? 'You unsent a message' : `${whoLabel(message.sender)} unsent a message`}
          </Text>
        </View>
      </View>
    );
  }

  const reactions = reactionSummary(message.reactions);
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={300}
        accessibilityRole="button"
        accessibilityHint="Long press for reactions, reply, copy and more"
        accessibilityLabel={
          `${mine ? 'You' : whoLabel(message.sender)}: ` +
          `${message.imageUrl ? 'photo. ' : ''}${message.text}${message.edited ? ', edited' : ''}`
        }
      >
        {({ pressed }) => (
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, pressed && styles.bubblePressed]}>
            {quote ? (
              <View style={styles.quote}>
                <Text style={styles.quoteWho}>
                  {whoLabel(quote.sender)}
                </Text>
                <Text style={[styles.quoteText, quote.muted && styles.quoteMuted]} numberOfLines={2}>
                  {quote.hasImage && !quote.muted ? '📷 ' : ''}{quote.text}
                </Text>
              </View>
            ) : null}
            {message.imageUrl ? (
              <Pressable
                onPress={() => onOpenImage(message.imageUrl)}
                onLongPress={onLongPress}
                delayLongPress={300}
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
        )}
      </Pressable>
      {reactions.length > 0 ? (
        <View style={[styles.reactionPill, mine ? styles.reactionPillMine : styles.reactionPillTheirs]}>
          {reactions.map(([emoji, count]) => (
            <Text key={emoji} style={styles.reactionPillText}>
              {emoji}{count > 1 ? ` ${count}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.bubbleTime}>
        {formatMessageTime(message.createdAt)}{message.edited ? ' · Edited' : ''}
      </Text>
    </View>
  );
}

// The long-press sheet: the six reactions across the top, then what can
// be done with this particular message. Only actions that will succeed
// are offered — the rules would refuse the rest anyway.
function MessageActions({ message, side, uid, onClose, onReact, onReply, onCopy, onEdit, onUnsend }) {
  if (!message) return null;
  const mine = message.sender === side;
  const current = message.reactions?.[uid];
  const actions = [
    { key: 'reply', icon: 'arrow-undo-outline', label: 'Reply', onPress: onReply },
    message.text ? { key: 'copy', icon: 'copy-outline', label: 'Copy text', onPress: onCopy } : null,
    canEdit(message, side) ? { key: 'edit', icon: 'create-outline', label: 'Edit', onPress: onEdit } : null,
    mine ? { key: 'unsend', icon: 'trash-outline', label: 'Unsend', onPress: onUnsend, danger: true } : null,
  ].filter(Boolean);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.reactionRow}>
            {REACTIONS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                onPress={() => onReact(emoji)}
                style={[styles.reactionButton, current === emoji && styles.reactionButtonActive]}
                accessibilityRole="button"
                accessibilityLabel={current === emoji ? `Remove ${emoji} reaction` : `React with ${emoji}`}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {actions.map((action) => (
            <TouchableOpacity
              key={action.key}
              onPress={action.onPress}
              style={styles.actionRow}
              accessibilityRole="button"
            >
              <Ionicons
                name={action.icon}
                size={20}
                color={action.danger ? Colors.light.danger : Colors.light.text}
              />
              <Text style={[styles.actionLabel, action.danger && styles.actionLabelDanger]}>
                {action.label}
              </Text>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
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
  const [selected, setSelected] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  // Stamping "read" is a write; one in flight at a time is enough.
  const markingRead = useRef(false);
  const inputRef = useRef(null);

  // The other side, as the bubbles and quotes name them.
  const whoLabel = (sender) =>
    sender === side ? 'You' : side === 'customer' ? title || 'The store' : 'The buyer';

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  useEffect(() => {
    if (!customerId || !orderId || !uid) return undefined;
    setLoading(true);
    setLoadError(false);

    const unsubscribeMessages = onSnapshot(
      query(messagesRef(customerId, orderId), orderBy('createdAt', 'desc'), limit(MESSAGE_LIMIT)),
      (snapshot) => {
        setMessages(snapshot.docs.map(mapMessage));
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

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(timer);
  }, [toast]);

  const failed = (heading, error) => {
    console.error(`${heading}:`, error);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    showAppAlert(
      heading,
      error?.code === 'permission-denied'
        ? 'That isn’t allowed for this message anymore.'
        : 'Check your connection and try again.'
    );
  };

  const cancelComposerMode = () => {
    if (editing) setDraft('');
    setEditing(null);
    setReplyingTo(null);
  };

  const send = async ({ imageUrl } = {}) => {
    const text = draft.trim();
    if (!uid) return;

    if (editing) {
      if (!text && !editing.imageUrl) return;
      if (text === editing.text) {
        cancelComposerMode();
        return;
      }
      setSending(true);
      try {
        await editMessage(customerId, orderId, editing.id, text);
        setDraft('');
        setEditing(null);
        Haptics.selectionAsync();
      } catch (error) {
        failed('Couldn’t edit message', error);
      } finally {
        setSending(false);
      }
      return;
    }

    if (!text && !imageUrl) return;
    setSending(true);
    try {
      await sendMessage({ customerId, orderId, side, senderId: uid, text, imageUrl, replyTo: replyingTo });
      setDraft('');
      setReplyingTo(null);
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

  // --- Long-press actions -------------------------------------------------
  const openActions = (message) => {
    if (message.deleted) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelected(message);
  };

  const handleReact = async (emoji) => {
    const message = selected;
    setSelected(null);
    Haptics.selectionAsync();
    try {
      await setReaction(customerId, orderId, message.id, uid, emoji, message.reactions?.[uid]);
    } catch (error) {
      failed('Couldn’t react', error);
    }
  };

  const handleReply = () => {
    setEditing(null);
    setReplyingTo(selected);
    setSelected(null);
    inputRef.current?.focus();
  };

  const handleCopy = async () => {
    const text = selected.text;
    setSelected(null);
    try {
      await Clipboard.setStringAsync(text);
      Haptics.selectionAsync();
      setToast('Copied');
    } catch (error) {
      failed('Couldn’t copy', error);
    }
  };

  const handleEdit = () => {
    setReplyingTo(null);
    setEditing(selected);
    setDraft(selected.text);
    setSelected(null);
    inputRef.current?.focus();
  };

  const handleUnsend = () => {
    const message = selected;
    setSelected(null);
    showAppAlert(
      'Unsend message?',
      'It will be removed for both of you. They’ll see that a message was unsent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsend',
          style: 'destructive',
          onPress: async () => {
            try {
              await unsendMessage(customerId, orderId, message.id);
              if (editing?.id === message.id) cancelComposerMode();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error) {
              failed('Couldn’t unsend', error);
            }
          },
        },
      ]
    );
  };

  const busy = sending || uploadProgress !== null;
  const hasWords = draft.trim().length > 0;
  const canSend = !busy && isConnected && (hasWords || (editing && editing.imageUrl));

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
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                mine={item.sender === side}
                quote={resolveQuote(item.replyTo, byId)}
                whoLabel={whoLabel}
                onLongPress={() => openActions(item)}
                onOpenImage={setViewerUrl}
              />
            )}
          />
        )}

        {toast ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}

        {uploadProgress !== null && (
          <View style={styles.contextBar}>
            <ActivityIndicator size="small" color={Colors.light.tint} />
            <Text style={styles.contextText}>
              Sending photo… {Math.round(uploadProgress * 100)}%
            </Text>
          </View>
        )}

        {replyingTo || editing ? (
          <View style={styles.contextBar}>
            <Ionicons
              name={editing ? 'create-outline' : 'arrow-undo-outline'}
              size={18}
              color={Colors.light.tint}
            />
            <View style={styles.flex}>
              <Text style={styles.contextTitle}>
                {editing ? 'Editing message' : `Replying to ${whoLabel(replyingTo.sender) === 'You' ? 'yourself' : whoLabel(replyingTo.sender)}`}
              </Text>
              <Text style={styles.contextText} numberOfLines={1}>
                {(editing || replyingTo).text || '📷 Photo'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={cancelComposerMode}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Cancel editing' : 'Cancel reply'}
            >
              <Ionicons name="close" size={20} color={Colors.light.icon} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.composer}>
          {/* A photo is a new message, so it has no place in an edit. */}
          {!editing ? (
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
          ) : null}
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={editing ? 'Edit your message' : 'Write a message'}
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
            accessibilityLabel={editing ? 'Save edit' : 'Send message'}
            accessibilityState={{ disabled: !canSend }}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name={editing ? 'checkmark' : 'send'} size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <MessageActions
        message={selected}
        side={side}
        uid={uid}
        onClose={() => setSelected(null)}
        onReact={handleReact}
        onReply={handleReply}
        onCopy={handleCopy}
        onEdit={handleEdit}
        onUnsend={handleUnsend}
      />

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
  bubblePressed: { opacity: 0.7 },
  bubbleUnsent: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.border,
    backgroundColor: 'transparent',
  },
  unsentText: { fontSize: 14, fontStyle: 'italic', color: Colors.light.icon },
  bubbleText: { fontSize: 15, lineHeight: 21, color: Colors.light.text },
  bubbleImage: { width: 200, height: 200, borderRadius: Radius.md, backgroundColor: Colors.light.border },
  bubbleImageWithText: { marginBottom: 6 },
  bubbleTime: { fontSize: 11, color: Colors.light.icon, marginTop: 3, marginHorizontal: 4 },

  // The quoted message inside a reply: a Clay rule down the left, like
  // a pulled quote, so it reads as "about that" rather than a second
  // message.
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.tint,
    paddingLeft: 8,
    paddingVertical: 2,
    marginBottom: 6,
  },
  quoteWho: { fontSize: 12, fontWeight: '600', color: Colors.light.tint },
  quoteText: { fontSize: 13, color: Colors.light.icon, lineHeight: 18 },
  quoteMuted: { fontStyle: 'italic' },

  reactionPill: {
    flexDirection: 'row',
    gap: 4,
    marginTop: -6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  reactionPillMine: { marginRight: 8 },
  reactionPillTheirs: { marginLeft: 8 },
  reactionPillText: { fontSize: 13, color: Colors.light.text },

  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 80,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.text,
  },
  toastText: { fontSize: 13, color: '#fff', fontWeight: '600' },

  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  contextTitle: { fontSize: 12, fontWeight: '600', color: Colors.light.tint },
  contextText: { fontSize: 13, color: Colors.light.icon },

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

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(28,27,26,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.light.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  reactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 12,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  reactionButton: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  reactionButtonActive: { backgroundColor: Colors.light.tint + '26' },
  reactionEmoji: { fontSize: 28 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48, paddingHorizontal: 8 },
  actionLabel: { fontSize: 16, color: Colors.light.text },
  actionLabelDanger: { color: Colors.light.danger },

  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20 },
});
