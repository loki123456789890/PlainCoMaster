import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
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
import StoreLogo from '../components/shop/StoreLogo';
import Sheet from '../components/shop/Sheet';
import { useStores } from '../context/StoreContext';
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

// Just the time: the day chip above each day's first message says which
// day it was.
function formatMessageTime(date) {
  if (!date) return 'Sending…';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDay(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// A message not yet stamped by the server counts as today.
const dayKey = (message) => (message?.createdAt || new Date()).toDateString();

// The order's status in the pinned strip: Clay while it's moving, Moss
// once delivered, Rust if cancelled. "Pending" reads "Placed" to a buyer,
// as on their order page.
const STATUS_PILL = {
  pending: { customer: 'Placed', store: 'Pending', color: Colors.light.tint },
  processing: { label: 'Processing', color: Colors.light.tint },
  shipped: { label: 'Shipped', color: Colors.light.tint },
  delivered: { label: 'Delivered', color: Colors.light.success },
  cancelled: { label: 'Cancelled', color: Colors.light.danger },
};

// What each side can start a conversation with. "photo" opens the photo
// picker; the rest put a message in the box to edit before sending.
const STARTERS = {
  store: [
    { key: 'photo', icon: 'camera-outline', label: 'Send a photo of the item' },
    {
      key: 'address',
      icon: 'home-outline',
      label: 'Confirm delivery address',
      text: (order) => {
        const a = order?.shippingAddress;
        return a?.address
          ? `Hi! Just confirming your delivery address: ${a.address}, ${a.city}. Is that right?`
          : 'Hi! Could you confirm your delivery address?';
      },
    },
    {
      key: 'ships',
      icon: 'time-outline',
      label: 'Let them know when it ships',
      text: () => 'Hi! We’re getting your order ready. I’ll message you here as soon as it ships.',
    },
  ],
  customer: [
    {
      key: 'photo',
      icon: 'camera-outline',
      label: 'Ask for a photo of the item',
      text: () => 'Hi! Could you send a photo of the exact piece before it ships?',
    },
    {
      key: 'size',
      icon: 'resize-outline',
      label: 'Ask about the fit',
      text: () => 'Hi! Could you share the measurements for this item?',
    },
    {
      key: 'ships',
      icon: 'time-outline',
      label: 'Ask when it ships',
      text: () => 'Hi! When do you think my order will ship?',
    },
  ],
};

// The other person, in the header: the store's logo, or the buyer's
// initial (user accounts are private, so there is no photo of them).
function PersonAvatar({ side, store, title, size }) {
  if (side === 'customer') return <StoreLogo uri={store?.logoUrl} size={size} radius={size * 0.32} />;
  const initial = (title || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.initial, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initialText, { fontSize: size * 0.38 }]}>{initial}</Text>
    </View>
  );
}

// The order this conversation is about, pinned under the header on both
// sides: the first item's photo and name, its options, the total and
// where the order is. Tapping it goes back to the order.
function OrderStrip({ order, side, onPress }) {
  if (!order) return null;
  const items = order.items || [];
  const first = items[0] || {};
  const name = items.length > 1 ? `${first.name || 'Item'} +${items.length - 1} more` : first.name || 'Order';
  const specs = [first.size, first.color].filter(Boolean).join(' · ');
  const pill = STATUS_PILL[order.status] || STATUS_PILL.pending;
  const pillLabel = pill.label || pill[side];
  const total = `₱${Number(order.total || 0).toFixed(2)}`;
  const image = first.image || first.imageUrl;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={styles.strip}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${specs ? `${specs}, ` : ''}${total}, ${pillLabel}. Back to the order.`}
    >
      {image ? (
        <Image source={{ uri: image }} style={styles.stripThumb} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.stripThumb, styles.stripThumbEmpty]}>
          <Ionicons name="shirt-outline" size={18} color={Colors.light.icon} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={styles.stripName} numberOfLines={1}>{name}</Text>
        <Text style={styles.stripSpecs} numberOfLines={1}>
          {specs ? `${specs} · ` : ''}
          <Text style={styles.stripPrice}>{total}</Text>
        </Text>
      </View>
      <Text style={[styles.pill, { color: pill.color, backgroundColor: pill.color + '1F' }]}>{pillLabel}</Text>
    </TouchableOpacity>
  );
}

// Before the first message: a nudge towards the one thing ukay buyers
// most want, a photo of the real piece, and three ways to begin.
function ChatStart({ side, order, onStarter }) {
  const first = order?.items?.[0];
  const image = first?.image || first?.imageUrl;
  const store = side === 'store';
  return (
    <View style={styles.start}>
      <View style={styles.polaroids} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.polaroid, styles.polaroidA]}>
          <View style={[styles.polaroidImg, styles.polaroidEmpty]}>
            <Ionicons name="image-outline" size={26} color={Colors.light.secondary} />
          </View>
        </View>
        <View style={[styles.polaroid, styles.polaroidB]}>
          {image ? (
            <Image source={{ uri: image }} style={styles.polaroidImg} contentFit="cover" />
          ) : (
            <View style={[styles.polaroidImg, styles.polaroidEmpty]}>
              <Ionicons name="shirt-outline" size={26} color={Colors.light.secondary} />
            </View>
          )}
        </View>
        <View style={styles.cam}>
          <Ionicons name="camera" size={17} color="#fff" />
        </View>
      </View>
      <Text style={styles.startTitle}>{store ? 'Show them the real piece' : 'Ask about the real piece'}</Text>
      <Text style={styles.startBody}>
        {store
          ? 'Every pre-loved item is one of a kind. A quick photo of this exact piece before it ships builds trust.'
          : 'Ask for a photo, the measurements or when it ships. The store will reply here.'}
      </Text>
      <View style={styles.starters}>
        {STARTERS[side].map((s, i) => (
          <TouchableOpacity
            key={s.key}
            onPress={() => onStarter(s)}
            activeOpacity={0.7}
            style={[styles.starter, i === 0 && styles.starterPrimary]}
            accessibilityRole="button"
            accessibilityLabel={s.label}
          >
            <Ionicons name={s.icon} size={17} color={Colors.light.tint} />
            <Text style={[styles.starterText, i === 0 && styles.starterTextPrimary]}>{s.label}</Text>
            <Ionicons name="chevron-forward" size={15} color={Colors.light.icon} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
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

function MessageBubble({ message, mine, quote, whoLabel, onLongPress, onOpenImage, onOpenReactions, avatar }) {
  if (message.deleted) {
    return (
      <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
        <View style={[styles.bubble, styles.bubbleUnsent]}>
          <Ionicons name="arrow-undo-outline" size={14} color={Colors.light.icon} />
          <Text style={styles.unsentText}>
            {mine ? 'You unsent a message' : `${whoLabel(message.sender)} unsent a message`}
          </Text>
        </View>
      </View>
    );
  }

  const reactions = reactionSummary(message.reactions);
  const photoOnly = message.imageUrl && !message.text && !quote;
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      {/* The other side's small avatar, beside the last bubble of a run;
          the others keep its space so a run lines up. */}
      {!mine ? <View style={styles.miniSlot}>{avatar}</View> : null}
      <View style={mine ? styles.bubbleColMine : styles.bubbleColTheirs}>
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
            <View
              style={[
                styles.bubble,
                mine ? styles.bubbleMine : styles.bubbleTheirs,
                message.imageUrl && styles.bubblePhoto,
                pressed && styles.bubblePressed,
              ]}
            >
              {quote ? (
                <View style={[styles.quote, mine && styles.quoteMine, message.imageUrl && styles.quoteInPhoto]}>
                  <Text style={[styles.quoteWho, mine && styles.onClay]}>
                    {whoLabel(quote.sender)}
                  </Text>
                  <Text
                    style={[styles.quoteText, mine && styles.onClaySoft, quote.muted && styles.quoteMuted]}
                    numberOfLines={2}
                  >
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
                    style={[styles.bubbleImage, photoOnly && styles.bubbleImageAlone]}
                    contentFit="cover"
                    transition={150}
                  />
                </Pressable>
              ) : null}
              {message.text ? (
                <Text
                  style={[styles.bubbleText, mine && styles.onClay, message.imageUrl && styles.bubbleCaption]}
                >
                  {message.text}
                </Text>
              ) : null}
            </View>
          )}
        </Pressable>
        {reactions.length > 0 ? (
          // Tappable, as in Messenger: shows who reacted, and yours can be
          // taken back from there.
          <TouchableOpacity
            onPress={onOpenReactions}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[styles.reactionPill, mine ? styles.reactionPillMine : styles.reactionPillTheirs]}
            accessibilityRole="button"
            accessibilityLabel={`Reactions: ${reactions.map(([emoji]) => emoji).join(' ')}. Tap to see who reacted.`}
          >
            {reactions.map(([emoji, count]) => (
              <Text key={emoji} style={styles.reactionPillText}>
                {emoji}{count > 1 ? ` ${count}` : ''}
              </Text>
            ))}
          </TouchableOpacity>
        ) : null}
        <Text style={styles.bubbleTime}>
          {formatMessageTime(message.createdAt)}{message.edited ? ' · Edited' : ''}
        </Text>
      </View>
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
    // Tapping the highlighted emoji again also removes it, but that is
    // easy to miss, so taking a reaction back gets its own line too.
    current
      ? { key: 'unreact', icon: 'close-circle-outline', label: `Remove your ${current} reaction`, onPress: () => onReact(current) }
      : null,
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

// Tapping the reactions under a message: who reacted with what, and
// yours with a way to take it back.
function ReactionDetails({ message, uid, nameFor, onClose, onRemove }) {
  if (!message) return null;
  // Yours first, then everyone else's.
  const entries = Object.entries(message.reactions || {}).sort(([a], [b]) =>
    a === uid ? -1 : b === uid ? 1 : 0
  );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close reactions">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>Reactions</Text>
          {entries.map(([reactorId, emoji]) => {
            const yours = reactorId === uid;
            return (
              <View key={reactorId} style={styles.reactorRow}>
                <Text style={styles.reactorEmoji}>{emoji}</Text>
                <Text style={styles.reactorName} numberOfLines={1}>{nameFor(reactorId)}</Text>
                {yours ? (
                  <TouchableOpacity
                    onPress={() => onRemove(emoji)}
                    style={styles.removeReaction}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove your ${emoji} reaction`}
                  >
                    <Text style={styles.removeReactionText}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
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
  const { customerId, orderId, side = 'customer', title, storeId } = route.params || {};
  // The store's logo in the header, on the customer's side. The store
  // side has no picture of the buyer: user accounts are private to them.
  const { getStore } = useStores();
  const chatStore = side === 'customer' ? getStore(storeId) : null;
  // The order document, for the pinned strip and the starters. Already
  // watched below for the read marker.
  const [order, setOrder] = useState(null);
  const [inputFocused, setInputFocused] = useState(false);
  const { isConnected } = useNetworkStatus();
  const uid = auth.currentUser?.uid;

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [viewerUrl, setViewerUrl] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reactionsFor, setReactionsFor] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  // Stamping "read" is a write; one in flight at a time is enough.
  const markingRead = useRef(false);
  const inputRef = useRef(null);

  // The other side, as the bubbles and quotes name them.
  // A reactor is known only by account id. The customer is the account
  // the order sits under; anyone else reacting is the store's side.
  const nameFor = (reactorId) => {
    if (reactorId === uid) return 'You';
    return whoLabel(reactorId === customerId ? 'customer' : 'store');
  };

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
        if (!snapshot.exists()) return;
        setOrder(snapshot.data());
        if (markingRead.current) return;
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
    setPhotoSheet(true);
  };

  // The picker opens once the sheet has slid away: iOS won't present one
  // modal while another is still dismissing.
  const pickFrom = (source) => {
    Haptics.selectionAsync();
    setPhotoSheet(false);
    setTimeout(() => sendPhoto(source), 350);
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

  const handleRemoveReaction = async (emoji) => {
    const message = reactionsFor;
    setReactionsFor(null);
    Haptics.selectionAsync();
    try {
      // Passing the current emoji as both makes setReaction take it back.
      await setReaction(customerId, orderId, message.id, uid, emoji, emoji);
    } catch (error) {
      failed('Couldn’t remove reaction', error);
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

  const handleStarter = (starter) => {
    Haptics.selectionAsync();
    if (starter.key === 'photo' && side === 'store') {
      handleAddPhoto();
      return;
    }
    setDraft(starter.text(order));
    inputRef.current?.focus();
  };

  // The other side's mini avatar, for the last bubble of each of their runs.
  const mini = (
    <View style={styles.mini}>
      <PersonAvatar side={side} store={chatStore} title={title} size={26} />
    </View>
  );

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
        <PersonAvatar side={side} store={chatStore} title={title} size={38} />
        <View style={styles.headerText} accessible accessibilityRole="header">
          <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Messages'}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {side === 'customer' ? 'Seller' : 'Buyer'} · Order {formatOrderNumber(orderId)}
          </Text>
        </View>
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>No internet connection — messages can’t be sent.</Text>
        </View>
      )}

      <OrderStrip order={order} side={side} onPress={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={styles.flex}
        // 'padding' on both platforms. Edge-to-edge Android no longer
        // shrinks the window for the keyboard, so this has to lift the
        // composer itself. 'height' did, but left a strip of empty space
        // under the composer once the keyboard closed — it can keep the
        // shrunken height as its new normal. 'padding' goes back to zero.
        behavior="padding"
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
          <ScrollView contentContainerStyle={styles.startScroll} keyboardShouldPersistTaps="handled">
            <ChatStart side={side} order={order} onStarter={handleStarter} />
          </ScrollView>
        ) : (
          // Inverted, newest first in the data: the list stays pinned to
          // the latest message as new ones arrive and the keyboard opens.
          <FlatList
            data={messages}
            inverted
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            // Newest first, so index - 1 is the next message down the
            // screen and index + 1 the one above.
            renderItem={({ item, index }) => {
              const older = messages[index + 1];
              const newer = messages[index - 1];
              const newDay = !older || dayKey(older) !== dayKey(item);
              const lastOfRun = !newer || newer.sender !== item.sender || dayKey(newer) !== dayKey(item);
              return (
                <View>
                  {newDay ? (
                    <Text style={styles.day}>{formatDay(item.createdAt || new Date())}</Text>
                  ) : null}
                  <MessageBubble
                    message={item}
                    mine={item.sender === side}
                    quote={resolveQuote(item.replyTo, byId)}
                    whoLabel={whoLabel}
                    avatar={lastOfRun ? mini : null}
                    onLongPress={() => openActions(item)}
                    onOpenImage={setViewerUrl}
                    onOpenReactions={() => setReactionsFor(item)}
                  />
                </View>
              );
            }}
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
              style={[styles.composerIcon, (busy || !isConnected) && styles.composerIconOff]}
              accessibilityRole="button"
              accessibilityLabel="Send a photo"
            >
              <Ionicons
                name="image-outline"
                size={22}
                color={busy || !isConnected ? Colors.light.icon : Colors.light.tint}
              />
            </TouchableOpacity>
          ) : null}
          <TextInput
            ref={inputRef}
            style={[styles.input, inputFocused && styles.inputFocused]}
            value={draft}
            onChangeText={setDraft}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
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
              <Ionicons
                name={editing ? 'checkmark' : 'send'}
                size={18}
                color={canSend ? '#fff' : Colors.light.icon}
              />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Camera is the primary tile: a fresh photo of the real piece is
          what a buyer is usually asking for. */}
      <Sheet visible={photoSheet} onClose={() => setPhotoSheet(false)}>
        <Text style={styles.photoTitle} accessibilityRole="header">Share a photo</Text>
        <Text style={styles.photoSub}>
          {side === 'store'
            ? 'A clear photo helps them check fit & condition.'
            : 'A photo shows the store exactly what you mean.'}
        </Text>
        <View style={styles.photoTiles}>
          <Pressable
            onPress={() => pickFrom('camera')}
            style={({ pressed }) => [styles.photoTile, styles.photoTileCamera, pressed && styles.photoTilePressed]}
            accessibilityRole="button"
            accessibilityLabel="Camera, take a new photo"
          >
            <View style={[styles.photoTileIcon, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
              <Ionicons name="camera-outline" size={22} color="#fff" />
            </View>
            <View>
              <Text style={[styles.photoTileTitle, { color: '#fff' }]}>Camera</Text>
              <Text style={[styles.photoTileText, { color: 'rgba(255,255,255,0.8)' }]}>Take a new photo</Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => pickFrom('library')}
            style={({ pressed }) => [styles.photoTile, pressed && styles.photoTilePressed]}
            accessibilityRole="button"
            accessibilityLabel="Library, choose from your photos"
          >
            <View style={styles.photoTileIcon}>
              <Ionicons name="images-outline" size={22} color="#A94F2F" />
            </View>
            <View>
              <Text style={styles.photoTileTitle}>Library</Text>
              <Text style={styles.photoTileText}>Choose from your photos</Text>
            </View>
          </Pressable>
        </View>
        <Pressable
          onPress={() => setPhotoSheet(false)}
          style={({ pressed }) => [styles.photoCancel, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={styles.photoCancelText}>Cancel</Text>
        </Pressable>
      </Sheet>

      <ReactionDetails
        message={reactionsFor}
        uid={uid}
        nameFor={nameFor}
        onClose={() => setReactionsFor(null)}
        onRemove={handleRemoveReaction}
      />

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
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  headerSubtitle: { fontSize: 12, color: Colors.light.icon, marginTop: 1 },
  initial: {
    backgroundColor: Colors.light.secondary + '24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: { fontWeight: '600', color: Colors.light.secondary },

  // Pinned order strip
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 2,
    padding: 8,
    paddingRight: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
  },
  stripThumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.light.border },
  stripThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  stripName: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
  stripSpecs: { fontSize: 12, color: Colors.light.icon, marginTop: 1 },
  stripPrice: { color: Colors.light.highlight, fontWeight: '600' },
  pill: {
    fontSize: 11.5,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },

  day: {
    alignSelf: 'center',
    fontSize: 11,
    color: Colors.light.icon,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 10,
  },

  // Before the first message
  startScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 20 },
  start: { alignItems: 'center' },
  polaroids: { width: 150, height: 118, marginBottom: 22 },
  polaroid: {
    position: 'absolute',
    width: 88,
    height: 104,
    padding: 7,
    paddingBottom: 22,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
  },
  polaroidA: { left: 6, top: 10, transform: [{ rotate: '-9deg' }] },
  polaroidB: { right: 6, top: 0, transform: [{ rotate: '7deg' }] },
  polaroidImg: { flex: 1, borderRadius: 6, overflow: 'hidden' },
  polaroidEmpty: { backgroundColor: Colors.light.secondary + '20', alignItems: 'center', justifyContent: 'center' },
  cam: {
    position: 'absolute',
    right: -2,
    bottom: -4,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light.tint,
    borderWidth: 3,
    borderColor: Colors.light.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text, textAlign: 'center' },
  startBody: {
    fontSize: 13,
    color: Colors.light.icon,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 280,
  },
  starters: { alignSelf: 'stretch', gap: 8, marginTop: 22 },
  starter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
  },
  starterPrimary: { borderColor: Colors.light.tint, backgroundColor: Colors.light.tint + '12' },
  starterText: { flex: 1, fontSize: 13, fontWeight: '500', color: Colors.light.text },
  starterTextPrimary: { color: Colors.light.tint, fontWeight: '600' },

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

  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 3, maxWidth: '86%' },
  bubbleRowMine: { alignSelf: 'flex-end', justifyContent: 'flex-end', maxWidth: '80%' },
  bubbleRowTheirs: { alignSelf: 'flex-start' },
  bubbleColMine: { alignItems: 'flex-end', flexShrink: 1 },
  bubbleColTheirs: { alignItems: 'flex-start', flexShrink: 1 },
  // Sits level with the bubble, above its time line.
  miniSlot: { width: 26, marginBottom: 20 },
  mini: { width: 26, height: 26 },
  // Yours in solid Clay and theirs a white bordered card, so who said
  // what reads at a glance, as in the approved preview.
  bubble: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleMine: { backgroundColor: Colors.light.tint, borderBottomRightRadius: 6 },
  bubbleTheirs: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderBottomLeftRadius: 6,
  },
  // A photo sits in the bubble with a thin frame around it.
  bubblePhoto: { padding: 4 },
  bubblePressed: { opacity: 0.7 },
  bubbleUnsent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.light.border,
    backgroundColor: 'transparent',
  },
  unsentText: { fontSize: 13, fontStyle: 'italic', color: Colors.light.icon },
  bubbleText: { fontSize: 14.5, lineHeight: 21, color: Colors.light.text },
  bubbleCaption: { paddingHorizontal: 9, paddingTop: 7, paddingBottom: 4 },
  onClay: { color: '#fff' },
  onClaySoft: { color: 'rgba(255,255,255,0.85)' },
  bubbleImage: { width: 200, height: 200, borderRadius: 14, backgroundColor: Colors.light.border },
  bubbleImageAlone: { borderRadius: 14 },
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
  quoteMine: { borderLeftColor: 'rgba(255,255,255,0.7)' },
  quoteInPhoto: { marginHorizontal: 8, marginTop: 6 },
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
  composerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.light.tint + '14',
    justifyContent: 'center',
    alignItems: 'center',
  },
  composerIconOff: { backgroundColor: Colors.light.border },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
    fontSize: 14.5,
    color: Colors.light.text,
  },
  inputFocused: { borderColor: Colors.light.tint },
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

  sheetTitle: { fontSize: 16, fontWeight: '600', color: Colors.light.text, marginBottom: 8, paddingHorizontal: 8 },
  reactorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 8 },
  reactorEmoji: { fontSize: 24 },
  reactorName: { flex: 1, fontSize: 16, color: Colors.light.text },
  removeReaction: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.light.border,
    justifyContent: 'center',
  },
  removeReactionText: { fontSize: 14, fontWeight: '600', color: Colors.light.danger },

  photoTitle: { fontSize: 20, fontWeight: '600', color: Colors.light.text, marginTop: 2 },
  photoSub: { fontSize: 13.5, color: Colors.light.icon, marginTop: 4, marginBottom: 18 },
  photoTiles: { flexDirection: 'row', gap: 12 },
  photoTile: {
    flex: 1,
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#fff',
  },
  photoTileCamera: { backgroundColor: Colors.light.tint, borderColor: Colors.light.tint },
  photoTilePressed: { transform: [{ scale: 0.98 }] },
  photoTileIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F6E6DE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTileTitle: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  photoTileText: { fontSize: 12, color: Colors.light.icon, marginTop: 1 },
  photoCancel: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  photoCancelText: { fontSize: 15.5, fontWeight: '600', color: Colors.light.icon },

  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20 },
});
