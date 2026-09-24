import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import Animated, { useReducedMotion, FadeIn } from 'react-native-reanimated';
import { signOut } from 'firebase/auth';
import { db, auth } from '../../firebaseConfig';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  writeBatch,
  deleteField,
  serverTimestamp,
} from 'firebase/firestore';
import { useAdmin } from '../../context/AdminContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../../constants/theme';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import SkeletonBlock from '../../components/ui/Skeleton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import DialogButtonRow from '../../components/ui/DialogButtonRow';
import Sheet from '../../components/shop/Sheet';
import Reveal from '../../components/shop/Reveal';
import { OfflineNotice } from '../../components/shop/TabScreen';
import { ROLES, getRoleLabel, getPortalLabel, ROLE_CUSTOMER, ROLE_PLATFORM_ADMIN, ROLE_SELLER } from '../../constants/roles';
import { logAccountActivity, ACTIONS } from '../../utils/activityLog';

// The three roles Firestore recognizes (see firestore.rules) and their
// user-facing names both come from constants/roles.js, so the picker, the
// badges, and every other screen that names a role can't drift apart.
// "admin" is not one of them — no document holds it and no rule grants it
// anything. Note the stored value 'seller' displays as "Store Manager":
// that's the job title the SRS and the customer-facing copy both use.
const ROLE_OPTIONS = ROLES;

// Stands in for a storeId in the Edit User form when the admin is opening
// a new store rather than picking an existing one. Not a valid Firestore
// id (ids can't contain '/'), so it can never collide with a real store.
const NEW_STORE = 'new/store';
const STORE_NAME_MAX = 60;

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const CARD_LINE = '#EEE7DD';
const ON_INK_MUTED = '#BDB3A9';

// Role badges, from the redesign preview but on this app's palette: Rust
// for Platform Admin (as before), Moss for Store Manager (the dashboard's
// role color; the preview's gold is reserved for money), and a warm
// neutral for Customer. `bar` is the same role drawn on the ink overview.
const ROLE_TONES = {
  [ROLE_PLATFORM_ADMIN]: { bg: '#FBEDEB', ink: '#B42318', bar: '#E0806F', icon: 'shield-checkmark' },
  [ROLE_SELLER]: { bg: '#EEF0EA', ink: '#37412F', bar: '#A9B89A', icon: 'storefront' },
  [ROLE_CUSTOMER]: { bg: '#F1EBE2', ink: '#5A534B', bar: '#E9DCCB', icon: null },
};
const roleTone = (role) => ROLE_TONES[role] || ROLE_TONES[ROLE_CUSTOMER];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: ROLE_CUSTOMER, label: 'Customers' },
  { key: ROLE_SELLER, label: 'Managers' },
  { key: ROLE_PLATFORM_ADMIN, label: 'Admins' },
];

// Initials tell rows apart better than one letter: "LA" and "LE" instead
// of two "L"s. Two words give first letters; one word gives its first two.
const initialsOf = (name) => {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

// A stable color per account, so the same person keeps the same avatar.
const AVATAR_TONES = [CLAY, MOSS, '#A94F2F', '#6B655C', '#37412F'];
const avatarTone = (id) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
};

function UserAvatar({ user, size = 44 }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: avatarTone(user.id) },
        !user.isActive && styles.avatarInactive,
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.34 }]}>{initialsOf(user.name)}</Text>
    </View>
  );
}

function RoleBadge({ role, short }) {
  const tone = roleTone(role);
  const label = short && role === ROLE_PLATFORM_ADMIN ? 'Admin' : getRoleLabel(role);
  return (
    <View style={[styles.roleBadge, { backgroundColor: tone.bg }]}>
      {tone.icon ? <Ionicons name={tone.icon} size={11} color={tone.ink} /> : null}
      <Text style={[styles.roleBadgeText, { color: tone.ink }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

// One row of the ⋯ sheet's grouped actions card. `divided` draws the rule
// above it; the destructive action sits in its own card without a chevron,
// since it opens a confirmation rather than another screen.
function SheetAction({ icon, title, detail, danger, disabled, divided, noChevron, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        divided && styles.actionDivided,
        pressed && { backgroundColor: '#F7F2EC' },
        disabled && { opacity: 0.5 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <View style={[styles.actionIcon, danger && { backgroundColor: '#FBEDEB' }]}>
        <Ionicons name={icon} size={18} color={danger ? Colors.light.danger : INK} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionTitle, danger && { color: Colors.light.danger }]}>{title}</Text>
        <Text style={styles.actionDetail}>{detail}</Text>
      </View>
      {noChevron ? null : <Ionicons name="chevron-forward" size={16} color={MUTED} />}
    </Pressable>
  );
}

// One line of the Deactivate sheet's "what happens" list. The tone says
// whether it's a loss (danger), a reassurance (moss), or plain fact.
const CONSEQUENCE_TONES = {
  danger: { bg: '#FBEDEB', ink: Colors.light.danger },
  ok: { bg: '#EEF0EA', ink: MOSS },
  plain: { bg: '#F1EBE2', ink: MUTED },
};

function Consequence({ icon, tone, lead, children, first }) {
  const t = CONSEQUENCE_TONES[tone];
  return (
    <View style={[styles.con, !first && styles.conDivided]}>
      <View style={[styles.conIcon, { backgroundColor: t.bg }]}>
        <Ionicons name={icon} size={14} color={t.ink} />
      </View>
      <Text style={styles.conText}>
        <Text style={styles.conLead}>{lead}</Text> {children}
      </Text>
    </View>
  );
}

// Customer has no badge icon (it's the default), but its card in the
// Change role sheet needs one to line up with the other two.
const roleCardIcon = (role) => {
  const icon = roleTone(role).icon;
  return icon ? `${icon}-outline` : 'bag-handle-outline';
};

// Shaped like a real user row so the loading state previews the content
// that's about to arrive, instead of a spinner floating mid-screen.
function UserCardSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock style={styles.avatarSkeleton} />
      <View style={{ flex: 1, gap: 7 }}>
        <SkeletonBlock style={{ width: '45%', height: 14, borderRadius: Radius.sm }} />
        <SkeletonBlock style={{ width: '70%', height: 11, borderRadius: Radius.sm }} />
        <SkeletonBlock style={{ width: 90, height: 16, borderRadius: 6 }} />
      </View>
    </View>
  );
}

export default function AdminUsersScreen({ navigation }) {
  const { logoutAsAdmin } = useAdmin();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usersError, setUsersError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({
    role: 'customer',
    storeId: null,
    newStoreName: '',
  });
  // Every store, for the Store Manager assignment picker. A Platform Admin
  // opens stores and assigns managers to them; see firestore.rules
  // /stores and storeAssignmentIsValid().
  const [stores, setStores] = useState([]);
  // Open general questions — support requests that name no store, which
  // this role answers (handlesSupport() in firestore.rules). null while
  // unknown, so a failed read shows a dash rather than a false zero.
  const [openGeneralSupport, setOpenGeneralSupport] = useState(null);
  // Tracks which single user's activate/deactivate write is in flight, so
  // one row updating doesn't disable every other row's action button too.
  const [togglingUserId, setTogglingUserId] = useState(null);
  // Bumped by handleRetry() to force the listener below to tear down and
  // re-subscribe — same shape as AdminOrdersScreen's retryToken, so a
  // permissions blip or bad connection at mount doesn't leave the list
  // silently stuck on an unrecoverable listener.
  const [retryToken, setRetryToken] = useState(0);
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  // AdminUsersScreen is the root of the stack for a platformAdmin who just
  // logged in (AdminLoginScreen reaches it via replace(), not navigate() —
  // see AdminLoginScreen.js), so there's no screen underneath to pop back
  // to. When that's the case, the header control can't go back at all; it
  // has to actually exit the admin portal instead, the same way
  // StoreManagerDashboardScreen's logout button does.
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Explains where staff accounts come from. There is deliberately no
  // "create account" form behind this: a client app can't create another
  // person's Firebase Auth account (createUserWithEmailAndPassword signs
  // the CALLER in as the new user, which would drop this admin's own
  // session), and firestore.rules now forbids "role" from being set at
  // document-creation time at all — so signing up can never mint a
  // privileged account. Staff access is granted here, by promoting an
  // existing customer, and this dialog is what makes that visible instead
  // of folklore.
  const [addStaffVisible, setAddStaffVisible] = useState(false);
  // Focused when the dialog's action is taken, so "find the person" leads
  // straight into the search rather than leaving the admin to hunt for it.
  const searchInputRef = useRef(null);
  const scrollRef = useRef(null);
  const searchY = useRef(0);
  const [roleFilter, setRoleFilter] = useState('all');
  const [searchFocused, setSearchFocused] = useState(false);
  // The row whose ⋯ sheet is open. `lastActionUser` keeps the sheet's
  // content in place while it slides away.
  const [actionUser, setActionUser] = useState(null);
  const lastActionUser = useRef(null);
  if (actionUser) lastActionUser.current = actionUser;
  // The account the Deactivate sheet is asking about, kept the same way.
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const lastDeactivateTarget = useRef(null);
  if (deactivateTarget) lastDeactivateTarget.current = deactivateTarget;

  useEffect(() => {
    setLoading(true);
    setUsersError(false);

    const unsubscribe = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        // Base profile fields come straight from each users/{uid} doc.
        // role and isActive don't exist on most existing docs (only
        // manually-set seller/platformAdmin accounts have "role"), so
        // missing values are defaulted here rather than left undefined.
        //
        // Deliberately no per-user order stats here: platformAdmin has no
        // read access to users/{uid}/orders under firestore.rules — that
        // subcollection is a seller/owner concern (purchase history), not
        // an account-management one. Account management does not include
        // reading purchase histories.
        const baseUsers = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: data.name || 'Unnamed User',
            email: data.email || '—',
            role: data.role || 'customer',
            storeId: typeof data.storeId === 'string' ? data.storeId : null,
            isActive: data.isActive !== false,
            createdAt: data.createdAt || null,
          };
        });

        setUsers(baseUsers);
        setUsersError(false);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching users:', error);
        setUsersError(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [retryToken]);

  // Separate from the users listener so a stores failure can't blank the
  // user list. On error the picker just shows no existing stores, and a
  // new one can still be opened from the same form.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'stores'),
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          name: docSnap.data().name || 'Unnamed store',
        }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setStores(list);
      },
      (error) => console.error('Error fetching stores:', error)
    );
    return () => unsubscribe();
  }, [retryToken]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'supportRequests'),
        where('storeId', '==', null),
        where('status', '==', 'open')
      ),
      (snapshot) => setOpenGeneralSupport(snapshot.size),
      (error) => {
        console.error('Error counting general support requests:', error);
        setOpenGeneralSupport(null);
      }
    );
    return () => unsubscribe();
  }, [retryToken]);

  const storeName = (storeId) => stores.find((st) => st.id === storeId)?.name || null;

  const handleRetry = () => setRetryToken((t) => t + 1);

  // This is the Platform Admin's home screen — AdminLoginScreen resets the
  // stack to it — so there is no Back, only Log out, like the Store
  // Manager dashboard. confirmLogout below is copied from that screen.
  const handleOpenLogout = () => {
    Haptics.selectionAsync();
    setLogoutVisible(true);
  };

  const handleOpenAddStaff = () => {
    Haptics.selectionAsync();
    setAddStaffVisible(true);
  };

  // Closing straight into a focused search field is the whole point of the
  // dialog's action — the next step really is "find that person in this
  // list", so the control does it instead of describing it.
  // The focus waits for the sheet's closing slide: a field can't take focus
  // from under a modal that is still on screen.
  const handleAddStaffFindUser = () => {
    setAddStaffVisible(false);
    setRoleFilter('all');
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(searchY.current - 12, 0), animated: true });
      searchInputRef.current?.focus();
    }, 350);
  };

  const confirmLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut(auth);
      logoutAsAdmin();
      // Reset the nav stack so "back" can't return to admin screens
      // after the session is gone.
      navigation.reset({
        index: 0,
        routes: [{ name: 'AdminLogin', params: { loggedOut: true } }],
      });
    } catch (error) {
      console.error('Error signing out:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoggingOut(false);
      setLogoutVisible(false);
      showAppAlert('Error', 'Could not log out. Please try again.');
    }
  };

  // The signed-in platformAdmin's own document — firestore.rules blocks
  // the platformAdmin write branch from ever targeting request.auth.uid,
  // so role and isActive controls on this row must be disabled in the UI
  // rather than let someone tap them and get a write denied on submit.
  const isSelf = (userId) => userId === auth.currentUser?.uid;

  // Your own row comes first: it's the one row that behaves differently,
  // and "which one is me?" shouldn't take a scroll.
  const q = searchQuery.toLowerCase();
  const filteredUsers = users
    .filter((user) => roleFilter === 'all' || user.role === roleFilter)
    .filter((user) => user.name.toLowerCase().includes(q) || user.email.toLowerCase().includes(q))
    .sort((a, b) => Number(isSelf(b.id)) - Number(isSelf(a.id)));

  const me = users.find((u) => isSelf(u.id)) || null;
  const firstName = me?.name && me.name !== 'Unnamed User' ? me.name.trim().split(/\s+/)[0] : '';

  const roleCounts = { [ROLE_CUSTOMER]: 0, [ROLE_SELLER]: 0, [ROLE_PLATFORM_ADMIN]: 0 };
  users.forEach((u) => {
    if (roleCounts[u.role] !== undefined) roleCounts[u.role] += 1;
  });
  const countFor = (key) => (key === 'all' ? users.length : roleCounts[key]);

  const openActions = (user) => {
    Haptics.selectionAsync();
    setActionUser(user);
  };

  // Each action closes the sheet first, then opens what comes next, so two
  // modals are never stacked.
  const runAction = (fn) => {
    const user = actionUser;
    setActionUser(null);
    setTimeout(() => fn(user), 320);
  };

  const handleEditUser = (user) => {
    if (isSelf(user.id)) return; // Edit action is disabled on the self row; defensive no-op.
    Haptics.selectionAsync();
    setSelectedUser(user);
    setEditFormData({
      role: user.role,
      storeId: user.storeId,
      newStoreName: '',
    });
    setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
    if (isSelf(selectedUser.id)) {
      // Defensive — role chips and Save are disabled whenever the modal is
      // open on the signed-in platformAdmin's own document (see
      // editingSelf below), so this shouldn't be reachable. firestore.rules
      // would deny the write either way: the platformAdmin branch never
      // matches when the target document is the requester's own.
      return;
    }

    setUpdating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Field-scoped update — only "role" and "storeId" are sent,
      // matching the hasOnly(['role', 'isActive', 'storeId']) allowlist in
      // firestore.rules for the platformAdmin branch. Name is edited by the
      // account owner from their own Profile screen, not here.
      //
      // A Store Manager must name a store in the same write, and anyone
      // else must carry none (storeAssignmentIsValid). Opening a new store
      // rides in the same batch, so a store is never created without the
      // manager it was opened for, nor a manager assigned to a store that
      // failed to be created.
      const previousRole = selectedUser.role;
      const becomingSeller = editFormData.role === ROLE_SELLER;
      const batch = writeBatch(db);
      let assignedStoreId = null;
      let assignedStoreName = null;
      if (becomingSeller && editFormData.storeId === NEW_STORE) {
        const storeRef = doc(collection(db, 'stores'));
        assignedStoreName = editFormData.newStoreName.trim();
        batch.set(storeRef, { name: assignedStoreName, createdAt: serverTimestamp() });
        assignedStoreId = storeRef.id;
      } else if (becomingSeller) {
        assignedStoreId = editFormData.storeId;
        assignedStoreName = storeName(assignedStoreId);
      }
      batch.update(doc(db, 'users', selectedUser.id), {
        role: editFormData.role,
        storeId: assignedStoreId ?? deleteField(),
      });
      await batch.commit();
      // Granting or revoking staff access is the single most consequential
      // action this screen performs, so it's the one the log most needs to
      // carry — including what the role was before.
      logAccountActivity({
        action: ACTIONS.USER_ROLE,
        targetId: selectedUser.id,
        targetLabel: selectedUser.name,
        // A manager moved between stores keeps their role, so that case
        // names the move rather than logging "Store Manager → Store Manager".
        summary:
          previousRole === editFormData.role && assignedStoreName
            ? `${selectedUser.name} — now runs ${assignedStoreName}`
            : `${selectedUser.name} — role ${getRoleLabel(previousRole)} → ` +
              `${getRoleLabel(editFormData.role)}` +
              (assignedStoreName ? ` at ${assignedStoreName}` : ''),
      });
      setShowEditModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        'Role changed',
        `${selectedUser.name} is now ${getRoleLabel(editFormData.role)}` +
          (assignedStoreName ? ` at ${assignedStoreName}.` : '.')
      );
    } catch (error) {
      console.error('Error updating user:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
        return;
      }

      showAppAlert('Error', 'Could not update user. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  // `onSuccess` runs before the confirmation alert, so the Deactivate
  // sheet is already closing when the alert appears.
  const setUserActive = async (user, newStatus, onSuccess) => {
    setTogglingUserId(user.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateDoc(doc(db, 'users', user.id), { isActive: newStatus });
      // Deactivation is this project's stand-in for deletion (SRS
      // §2.4 keeps accounts for auditability), so it needs to leave
      // a trace of its own — otherwise an account can go dark with
      // nothing recording who did it.
      logAccountActivity({
        action: ACTIONS.USER_STATUS,
        targetId: user.id,
        targetLabel: user.name,
        summary: `${user.name} — account ${newStatus ? 'activated' : 'deactivated'}`,
      });
      onSuccess?.();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        newStatus ? 'Account activated' : 'Account deactivated',
        newStatus ? `${user.name} can sign in again.` : `${user.name} can no longer sign in.`
      );
    } catch (error) {
      console.error('Error updating user status:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
      } else {
        showAppAlert('Error', 'Could not update user status. Please try again.');
      }
    } finally {
      setTogglingUserId(null);
    }
  };

  // Deactivating gets a sheet that spells out what happens; activating
  // only gives access back, so a plain confirm is enough.
  const handleToggleUserStatus = (user) => {
    if (isSelf(user.id)) {
      // Defensive — the status toggle is disabled on the signed-in
      // platformAdmin's own row; firestore.rules would deny this write
      // either way.
      return;
    }

    Haptics.selectionAsync();
    if (user.isActive) {
      setDeactivateTarget(user);
      return;
    }
    showAppAlert('Activate account?', `${user.name} will be able to sign in again.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Activate', onPress: () => setUserActive(user, true) },
    ]);
  };

  const confirmDeactivate = () =>
    setUserActive(deactivateTarget, false, () => setDeactivateTarget(null));

  const formatDate = (dateInput) => {
    if (!dateInput) return 'Unknown';
    // Two shapes reach this. Accounts created from now on carry a
    // Firestore Timestamp; accounts created before Signupscreen switched
    // to serverTimestamp() carry an ISO string. new Date(timestamp) is
    // Invalid Date, so handling only the string form would have turned
    // every new account's join date into "Unknown" the moment signup
    // changed — which is why the two moved together.
    const date = dateInput?.toDate ? dateInput.toDate() : new Date(dateInput);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getStats = () => {
    const totalUsers = users.length;
    const activeUsers = users.filter((u) => u.isActive).length;
    // Counts ACTIVE platform admins only. A deactivated one can't sign in
    // (AdminLoginScreen refuses them) and resolves to no role at all
    // (AdminContext.resolvePrivilegedRole), so counting them here would
    // report cover that doesn't exist — and this number is what the
    // single-admin warning below depends on.
    const platformAdminUsers = users.filter(
      (u) => u.role === 'platformAdmin' && u.isActive
    ).length;

    return { totalUsers, activeUsers, platformAdminUsers };
  };

  const stats = getStats();
  // The role can be locked out of the app entirely. firestore.rules stops
  // a platform admin from deactivating themselves through THIS screen, but
  // the ordinary owner branch still lets any account deactivate itself
  // from Profile — and only a platform admin can set isActive back to
  // true. So if the last active one deactivates, or simply loses access to
  // their email, nothing inside the app can restore account management;
  // recovery means editing the document in the Firebase console.
  //
  // Profilescreen blocks the self-deactivation half of that. This warning
  // covers the rest: it names the risk while a second admin can still be
  // appointed, which is the only cheap moment to fix it.
  const isSolePlatformAdmin = !loading && !usersError && stats.platformAdminUsers <= 1;
  // Guards the Edit User modal's role picker + Save button — see the
  // comment above the picker for why this defensive check exists even
  // though the modal's entry points are already gated.
  const editingSelf = selectedUser ? isSelf(selectedUser.id) : false;
  // A Store Manager needs a store before Save means anything — the rules
  // refuse the promotion without one, so the button waits for it instead.
  const needsStore =
    editFormData.role === ROLE_SELLER &&
    (!editFormData.storeId ||
      (editFormData.storeId === NEW_STORE && !editFormData.newStoreName.trim()));
  // What Save would change, for the Change role sheet's before → after bar.
  // Moving a manager to another store counts; re-picking the same one doesn't.
  const editChanged = Boolean(
    selectedUser &&
      (editFormData.role !== selectedUser.role ||
        (editFormData.role === ROLE_SELLER && editFormData.storeId !== selectedUser.storeId))
  );
  const roleLine = (role, storeId) => {
    if (role !== ROLE_SELLER || !storeId) return getRoleLabel(role);
    const name =
      storeId === NEW_STORE ? editFormData.newStoreName.trim() || 'New store' : storeName(storeId);
    return name ? `${getRoleLabel(role)} · ${name}` : getRoleLabel(role);
  };
  const activeManagersAt = (storeId, exceptId) =>
    users.filter(
      (u) => u.role === ROLE_SELLER && u.storeId === storeId && u.isActive && u.id !== exceptId
    );

  const shownAction = lastActionUser.current;
  const shownDeactivate = lastDeactivateTarget.current;
  const deactivating = Boolean(shownDeactivate) && togglingUserId === shownDeactivate.id;
  // Who else keeps a store running if this manager goes.
  const deactivateStore =
    shownDeactivate?.role === ROLE_SELLER && shownDeactivate.storeId
      ? {
          name: storeName(shownDeactivate.storeId) || 'Their store',
          others: activeManagersAt(shownDeactivate.storeId, shownDeactivate.id),
        }
      : null;
  const openQuestions = openGeneralSupport;
  const inboxTone =
    openQuestions === null ? 'unknown' : openQuestions > 0 ? 'waiting' : 'clear';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Where staff accounts come from, as three steps. There is no
          "create account" form behind it — see addStaffVisible above. */}
      <Sheet visible={addStaffVisible} onClose={() => setAddStaffVisible(false)}>
        <View style={styles.staffIcon}>
          <Ionicons name="shield-checkmark-outline" size={26} color="#A94F2F" />
        </View>
        <Text style={styles.sheetTitle} accessibilityRole="header">Add a staff member</Text>
        <Text style={styles.sheetText}>
          Staff roles are granted, not signed up for, so no stranger can give themselves access.
        </Text>
        <View style={styles.steps}>
          <View style={styles.stepsLine} />
          {[
            { title: 'They sign up as a customer', detail: 'Using the regular PlainCo app.' },
            { title: 'Find them here', detail: 'Search by name or email.' },
            { title: 'Change their role', detail: 'Open ⋯ → Change role.' },
          ].map((step, i, all) => {
            const last = i === all.length - 1;
            return (
              <View key={step.title} style={styles.step}>
                <View style={[styles.stepNum, last && styles.stepNumLast]}>
                  <Text style={[styles.stepNumText, last && { color: '#fff' }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDetail}>{step.detail}</Text>
                  {last ? (
                    <View style={styles.stepRoles}>
                      <RoleBadge role={ROLE_SELLER} />
                      <RoleBadge role={ROLE_PLATFORM_ADMIN} />
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
        <View style={styles.lockNote}>
          <Ionicons name="lock-closed-outline" size={17} color={CLAY} />
          <Text style={styles.lockNoteText}>Only Platform Admins can grant or remove staff roles.</Text>
        </View>
        <Button label="Find the user" fontSize={15.5} onPress={handleAddStaffFindUser} fullWidth />
        <Pressable
          onPress={() => setAddStaffVisible(false)}
          style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
          <Text style={styles.ghostText}>Close</Text>
        </Pressable>
      </Sheet>

      {/* Names the account being signed out, which matters when several
          admins share a test phone. "Stay" reads clearer than "Cancel" when
          the question is about leaving. */}
      <ConfirmDialog
        visible={logoutVisible}
        onClose={() => setLogoutVisible(false)}
        icon="log-out-outline"
        title="Log out?"
        cancelLabel="Stay"
        confirmLabel="Log out"
        confirmVariant="primary"
        onConfirm={confirmLogout}
        loading={loggingOut}
        confirmDisabled={loggingOut}
        cancelDisabled={loggingOut}
      >
        <Text style={styles.modalMessage}>You&apos;ll need to sign in again to manage users and roles.</Text>
        <View style={styles.who}>
          {me ? <UserAvatar user={me} size={38} /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.whoName} numberOfLines={1}>{me?.name || 'Platform Admin'}</Text>
            <Text style={styles.whoEmail} numberOfLines={1}>
              {me?.email || auth.currentUser?.email || ''}
            </Text>
          </View>
          <RoleBadge role={ROLE_PLATFORM_ADMIN} short />
        </View>
      </ConfirmDialog>

      {/* The ⋯ sheet: who it's about, then what can be done to them. */}
      <Sheet visible={Boolean(actionUser)} onClose={() => setActionUser(null)}>
        {shownAction ? (
          <View>
            <View style={styles.idCard}>
              <UserAvatar user={shownAction} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.idName} numberOfLines={1}>{shownAction.name}</Text>
                <Text style={styles.idEmail} numberOfLines={1}>{shownAction.email}</Text>
                <View style={styles.badges}>
                  <RoleBadge role={shownAction.role} />
                  {!shownAction.isActive ? (
                    <View style={[styles.roleBadge, { backgroundColor: '#FBEDEB' }]}>
                      <Text style={[styles.roleBadgeText, { color: '#B42318' }]}>DEACTIVATED</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
            <View style={styles.facts}>
              <View style={styles.fact}>
                <Text style={styles.factLabel}>Store</Text>
                <Text style={styles.factValue} numberOfLines={2}>
                  {shownAction.role === ROLE_SELLER
                    ? storeName(shownAction.storeId) || 'No store assigned'
                    : '—'}
                </Text>
              </View>
              <View style={styles.fact}>
                <Text style={styles.factLabel}>Member since</Text>
                <Text style={styles.factValue}>{formatDate(shownAction.createdAt)}</Text>
              </View>
            </View>

            <View style={styles.actionGroup}>
              {isSelf(shownAction.id) ? null : (
                <SheetAction
                  icon="swap-horizontal-outline"
                  title="Change role or store"
                  detail={`Currently ${roleLine(shownAction.role, shownAction.storeId)}`}
                  onPress={() => runAction(handleEditUser)}
                />
              )}
              <SheetAction
                icon="time-outline"
                title="See their history"
                detail={`Role and account changes for ${shownAction.name}`}
                divided={!isSelf(shownAction.id)}
                onPress={() =>
                  runAction((user) => navigation.navigate('AdminActivity', { query: user.name }))
                }
              />
            </View>

            {isSelf(shownAction.id) ? (
              // Your own role and status can't change here (firestore.rules
              // blocks the admin branch on your own document), so the sheet
              // says so instead of offering actions that would be refused.
              <View style={styles.selfNote}>
                <Ionicons name="lock-closed-outline" size={15} color={MUTED} />
                <Text style={styles.selfNoteText}>
                  Your own role and status can&apos;t be changed here. Ask another Platform Admin.
                </Text>
              </View>
            ) : (
              <View style={[styles.actionGroup, { marginTop: 10 }]}>
                <SheetAction
                  icon={shownAction.isActive ? 'person-remove-outline' : 'person-add-outline'}
                  title={shownAction.isActive ? 'Deactivate account' : 'Activate account'}
                  detail={
                    !isConnected
                      ? 'You’re offline'
                      : shownAction.isActive
                        ? 'Blocks sign-in. Orders and history are kept.'
                        : 'Let them sign in again'
                  }
                  danger={shownAction.isActive}
                  noChevron
                  disabled={!isConnected || togglingUserId === shownAction.id}
                  onPress={() => runAction(handleToggleUserStatus)}
                />
              </View>
            )}
          </View>
        ) : null}
      </Sheet>

      {/* Deactivate: says exactly what happens, including whether a store is
          left without anyone running it, before the one red button. */}
      <Sheet
        visible={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        locked={deactivating}
        footer={
          <DialogButtonRow
            buttons={[
              {
                label: 'Keep active',
                variant: 'secondary',
                onPress: () => setDeactivateTarget(null),
                disabled: deactivating,
              },
              {
                label: isConnected ? 'Deactivate' : 'Offline',
                variant: 'danger',
                onPress: confirmDeactivate,
                loading: deactivating,
                disabled: deactivating || !isConnected,
              },
            ]}
          />
        }
      >
        {shownDeactivate ? (
          <View>
            <View style={styles.warnRing}>
              <Ionicons name="person-remove-outline" size={26} color={Colors.light.danger} />
            </View>
            <Text style={styles.warnTitle} accessibilityRole="header">
              Deactivate {shownDeactivate.name}?
            </Text>
            <Text style={styles.warnEmail} numberOfLines={1}>{shownDeactivate.email}</Text>
            <View style={styles.cons}>
              <Consequence first icon="log-out-outline" tone="danger" lead="They can’t sign in.">
                Anything they try while still signed in is refused.
              </Consequence>
              {deactivateStore ? (
                deactivateStore.others.length > 0 ? (
                  <Consequence icon="storefront-outline" tone="ok" lead={`${deactivateStore.name} stays covered.`}>
                    {deactivateStore.others.map((u) => u.name).join(', ')}{' '}
                    {deactivateStore.others.length === 1 ? 'still runs it.' : 'still run it.'}
                  </Consequence>
                ) : (
                  <Consequence icon="alert-circle-outline" tone="danger" lead={`${deactivateStore.name} will have no active manager.`}>
                    Nobody can update its products or orders until you assign someone.
                  </Consequence>
                )
              ) : null}
              <Consequence icon="archive-outline" tone="plain" lead="Nothing is deleted.">
                Their orders, messages and history stay as they are.
              </Consequence>
              <Consequence icon="arrow-undo-outline" tone="plain" lead="You can undo it.">
                Activate them again from ⋯ anytime. Both are recorded in Account activity.
              </Consequence>
            </View>
          </View>
        ) : null}
      </Sheet>

      {/* Log out sits behind your avatar, not in the top-left corner where
          people reach for Back. The signed-in role is named here too, so
          "why can't I see Products?" has its answer at the top. */}
      <View style={styles.top}>
        <Pressable
          onPress={handleOpenLogout}
          style={({ pressed }) => [styles.meRow, pressed && { opacity: 0.7 }]}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Signed in as ${me?.name || 'Platform Admin'}. Log out`}
        >
          {me ? (
            <UserAvatar user={me} size={42} />
          ) : (
            <View style={[styles.avatar, styles.avatarBlank]}>
              <Ionicons name="person" size={20} color={CLAY} />
            </View>
          )}
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.meRole}>{getPortalLabel(ROLE_PLATFORM_ADMIN)}</Text>
            <Text style={styles.meName} numberOfLines={1} accessibilityRole="header">
              {firstName ? `Hi, ${firstName}` : 'Manage Users'}
            </Text>
          </View>
        </Pressable>
        <View style={styles.topActions}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              navigation.navigate('AdminActivity');
            }}
            style={({ pressed }) => [styles.topButton, pressed && { backgroundColor: '#F3EEE6' }]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Account activity log"
          >
            <Ionicons name="time-outline" size={20} color={INK} />
          </Pressable>
          <Pressable
            onPress={handleOpenAddStaff}
            style={({ pressed }) => [styles.topButton, styles.topButtonInk, pressed && { opacity: 0.85 }]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Add a staff member"
          >
            <Ionicons name="person-add-outline" size={19} color="#fff" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {!isConnected ? (
          <View style={styles.sidePad}>
            <OfflineNotice>No internet connection. User data may be out of date.</OfflineNotice>
          </View>
        ) : null}

        {/* One card for the whole headcount. The role mix is a bar rather
            than a row of side-scrolling stat cards, which clipped at phone
            width. */}
        <Reveal delay={40}>
          <View style={styles.overview}>
            <View style={styles.ring} pointerEvents="none" />
            <View style={styles.ovRow}>
              <View>
                {loading ? (
                  <SkeletonBlock style={styles.ovSkeleton} />
                ) : (
                  <Text style={styles.ovBig}>{usersError ? '—' : stats.totalUsers}</Text>
                )}
                <Text style={styles.ovLabel}>Total {stats.totalUsers === 1 ? 'user' : 'users'}</Text>
              </View>
              {!loading && !usersError ? (
                <View style={styles.ovPill}>
                  <View style={styles.ovPillDot} />
                  <Text style={styles.ovPillText}>{stats.activeUsers} active</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {stats.totalUsers > 0 ? (
                [ROLE_CUSTOMER, ROLE_SELLER, ROLE_PLATFORM_ADMIN]
                  .filter((role) => roleCounts[role] > 0)
                  .map((role) => (
                    <View key={role} style={{ flex: roleCounts[role], backgroundColor: roleTone(role).bar, borderRadius: 8 }} />
                  ))
              ) : (
                <View style={{ flex: 1, backgroundColor: 'rgba(250,247,242,0.12)', borderRadius: 8 }} />
              )}
            </View>
            <View
              style={styles.keys}
              accessible
              accessibilityLabel={`${roleCounts[ROLE_CUSTOMER]} customers, ${roleCounts[ROLE_SELLER]} store managers, ${roleCounts[ROLE_PLATFORM_ADMIN]} platform admins`}
            >
              {[
                [ROLE_CUSTOMER, 'Customer', 'Customers'],
                [ROLE_SELLER, 'Manager', 'Managers'],
                [ROLE_PLATFORM_ADMIN, 'Admin', 'Admins'],
              ].map(([role, one, many]) => (
                <View key={role} style={styles.key}>
                  <View style={[styles.keyDot, { backgroundColor: roleTone(role).bar }]} />
                  <Text style={styles.keyText}>
                    {roleCounts[role]} {roleCounts[role] === 1 ? one : many}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </Reveal>

        {/* The way into this role's support inbox: general questions no
            single store can answer. Calm Moss when there's nothing to do,
            Clay when someone is waiting. */}
        <Reveal delay={90}>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              navigation.navigate('AdminSupport');
            }}
            style={({ pressed }) => [
              styles.inbox,
              inboxTone === 'waiting' && styles.inboxWaiting,
              inboxTone === 'unknown' && styles.inboxUnknown,
              pressed && { transform: [{ scale: 0.99 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              inboxTone === 'unknown'
                ? 'Support inbox. Couldn’t count open questions.'
                : `${openQuestions} open ${openQuestions === 1 ? 'question' : 'questions'}. Opens the support inbox.`
            }
          >
            <Ionicons
              name={inboxTone === 'clear' ? 'chatbubble-ellipses-outline' : 'chatbubbles-outline'}
              size={20}
              color={inboxTone === 'waiting' ? '#A94F2F' : inboxTone === 'clear' ? MOSS : MUTED}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.inboxTitle, inboxTone === 'waiting' && { color: '#8A3F24' }]}>
                {inboxTone === 'unknown'
                  ? 'Support inbox'
                  : inboxTone === 'waiting'
                    ? `${openQuestions} open ${openQuestions === 1 ? 'question' : 'questions'}`
                    : 'No open questions'}
              </Text>
              <Text style={[styles.inboxText, inboxTone === 'waiting' && { color: '#A94F2F' }]}>
                {inboxTone === 'unknown'
                  ? 'Couldn’t count open questions'
                  : inboxTone === 'waiting'
                    ? 'Someone is waiting for a reply'
                    : 'You’re all caught up'}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={inboxTone === 'waiting' ? '#A94F2F' : inboxTone === 'clear' ? MOSS : MUTED}
            />
          </Pressable>
        </Reveal>

        {/* Highlight rather than danger: nothing is broken yet, and this is a
            standing condition rather than a failure — Rust here would cry
            wolf on every visit until a second admin exists. */}
        {isSolePlatformAdmin && (
          <Animated.View
            style={styles.warningBanner}
            entering={reduceMotion ? undefined : FadeIn.duration(220)}
          >
            <Ionicons name="warning-outline" size={16} color={Colors.light.highlight} />
            <Text style={styles.warningText}>
              You&apos;re the only active Platform Admin. If this account is lost or
              deactivated, nobody can manage roles — grant a second person the
              Platform Admin role to avoid that.
            </Text>
          </Animated.View>
        )}

        <View onLayout={(e) => { searchY.current = e.nativeEvent.layout.y; }}>
          <View style={[styles.search, searchFocused && styles.searchFocused]}>
            <Ionicons name="search-outline" size={18} color={MUTED} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Search name or email"
              placeholderTextColor={MUTED}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              returnKeyType="search"
              accessibilityLabel="Search users by name or email"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => setSearchQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color={MUTED} />
              </Pressable>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
            accessibilityRole="tablist"
          >
            {FILTERS.map((f) => {
              const on = roleFilter === f.key;
              const count = loading ? '–' : countFor(f.key);
              return (
                <Pressable
                  key={f.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setRoleFilter(f.key);
                  }}
                  style={[styles.filter, on && styles.filterOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${f.label}, ${count}`}
                >
                  <Text style={[styles.filterText, on && { color: '#fff' }]}>
                    {f.label}
                    <Text style={[styles.filterCount, on && { color: 'rgba(255,255,255,0.7)' }]}> {count}</Text>
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.list}>
          {loading ? (
            <>
              <UserCardSkeleton />
              <UserCardSkeleton />
              <UserCardSkeleton />
            </>
          ) : usersError ? (
            <View style={styles.emptyStateWrap}>
              <EmptyState
                icon="cloud-offline-outline"
                title="Couldn't load users"
                subtitle="Check your connection and try again."
              />
              <View style={styles.emptyStateAction}>
                <Button variant="outline" label="Retry" onPress={handleRetry} />
              </View>
            </View>
          ) : filteredUsers.length > 0 ? (
            filteredUsers.map((user, index) => {
              const selfRow = isSelf(user.id);
              return (
                <Reveal key={user.id} delay={120 + Math.min(index, 8) * 40}>
                  <Pressable
                    onPress={() => openActions(user)}
                    style={({ pressed }) => [
                      styles.row,
                      selfRow && styles.rowSelf,
                      pressed && { transform: [{ scale: 0.99 }] },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${user.name}${selfRow ? ', you' : ''}, ${getRoleLabel(user.role)}, ${user.isActive ? 'active' : 'deactivated'}`}
                    accessibilityHint="Shows their details and actions"
                  >
                    <UserAvatar user={user} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.name, !user.isActive && { color: MUTED }]} numberOfLines={1}>
                          {user.name}
                        </Text>
                        {selfRow ? <Text style={styles.youTag}>YOU</Text> : null}
                      </View>
                      <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
                      <View style={styles.badges}>
                        <RoleBadge role={user.role} />
                        {!user.isActive ? (
                          <View style={[styles.roleBadge, { backgroundColor: '#FBEDEB' }]}>
                            <Text style={[styles.roleBadgeText, { color: '#B42318' }]}>DEACTIVATED</Text>
                          </View>
                        ) : null}
                      </View>
                      {user.role === ROLE_SELLER ? (
                        <View style={styles.storeRow}>
                          <Ionicons name="storefront-outline" size={12} color={MUTED} />
                          <Text style={styles.storeText} numberOfLines={1}>
                            {storeName(user.storeId) || 'No store assigned'}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {selfRow ? (
                      // Your own role and status can't change here, so a
                      // lock says so instead of greyed-out buttons.
                      <View
                        style={styles.more}
                        accessible
                        accessibilityLabel="Your own role and status can’t be changed here"
                      >
                        <Ionicons name="lock-closed-outline" size={17} color={MUTED} />
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => openActions(user)}
                        style={({ pressed }) => [styles.more, pressed && { backgroundColor: '#EAE3D9' }]}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={`More actions for ${user.name}`}
                      >
                        {togglingUserId === user.id ? (
                          <ActivityIndicator size="small" color={CLAY} />
                        ) : (
                          <Ionicons name="ellipsis-horizontal" size={18} color={INK} />
                        )}
                      </Pressable>
                    )}
                  </Pressable>
                </Reveal>
              );
            })
          ) : (
            <View style={styles.emptyStateWrap}>
              <EmptyState
                icon="people-outline"
                title="No users found"
                subtitle={searchQuery ? 'Try a different search term' : 'No one has this role yet'}
              />
              {Boolean(searchQuery) || roleFilter !== 'all' ? (
                <View style={styles.emptyStateAction}>
                  <Button
                    variant="outline"
                    label="Show everyone"
                    onPress={() => {
                      setSearchQuery('');
                      setRoleFilter('all');
                    }}
                  />
                </View>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Change role: one card per role with what it can and can't reach,
          the store picker only for Store Manager, and a bar above the
          buttons that says exactly what Save will change. */}
      <Sheet
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
        locked={updating}
        footer={
          selectedUser ? (
            <View>
              <View style={[styles.diff, !editChanged && styles.diffSame]}>
                <Text style={[styles.diffLabel, !editChanged && { color: MUTED }]}>
                  {editChanged ? 'THIS CHANGE' : 'NO CHANGES YET'}
                </Text>
                {editChanged ? (
                  <View style={styles.diffLine}>
                    <Text style={styles.diffFrom} numberOfLines={1}>
                      {roleLine(selectedUser.role, selectedUser.storeId)}
                    </Text>
                    <Ionicons name="arrow-forward" size={13} color={ON_INK_MUTED} />
                    <Text style={styles.diffTo} numberOfLines={1}>
                      {roleLine(editFormData.role, editFormData.storeId)}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.diffSameText} numberOfLines={1}>
                    {roleLine(selectedUser.role, selectedUser.storeId)}
                  </Text>
                )}
              </View>
              <DialogButtonRow
                buttons={[
                  {
                    label: 'Cancel',
                    variant: 'secondary',
                    onPress: () => setShowEditModal(false),
                    disabled: updating,
                  },
                  {
                    label: !isConnected ? 'Offline' : 'Save change',
                    variant: 'primary',
                    onPress: handleUpdateUser,
                    loading: updating,
                    disabled: updating || !isConnected || editingSelf || needsStore || !editChanged,
                  },
                ]}
              />
            </View>
          ) : null
        }
      >
        {selectedUser ? (
          <View>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} accessibilityRole="header">Change role</Text>
              <Pressable
                onPress={() => setShowEditModal(false)}
                disabled={updating}
                style={({ pressed }) => [styles.sheetClose, pressed && { opacity: 0.6 }]}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={18} color={INK} />
              </Pressable>
            </View>

            {/* Name and email are the user's own to change (from Profile), so
                they collapse to one read-only row instead of greyed fields. */}
            <View style={styles.mini}>
              <UserAvatar user={selectedUser} size={34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.miniName} numberOfLines={1}>{selectedUser.name}</Text>
                <Text style={styles.miniEmail} numberOfLines={1}>{selectedUser.email}</Text>
              </View>
              <View
                style={styles.miniLock}
                accessible
                accessibilityLabel="Name and email are changed by the user, not here"
              >
                <Ionicons name="lock-closed-outline" size={11} color={MUTED} />
                <Text style={styles.miniLockText}>Set by user</Text>
              </View>
            </View>

            {/* editingSelf should never be true in normal use — every entry
                point is already disabled on your own row. Kept as a guard:
                firestore.rules denies this write however the sheet was
                reached, so the controls must not pretend otherwise. */}
            {editingSelf ? (
              <Text style={styles.selfModalHint}>
                You can&apos;t change your own role — have another platform administrator do it.
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>ROLE</Text>
            <View style={styles.roleCards}>
              {ROLE_OPTIONS.map((option) => {
                const active = editFormData.role === option.value;
                const current = selectedUser.role === option.value;
                const tone = roleTone(option.value);
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.roleCard, active && styles.roleCardOn, editingSelf && { opacity: 0.5 }]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      // Coming back to Store Manager restores their store, so
                      // a stray tap on another role doesn't lose it.
                      setEditFormData({
                        ...editFormData,
                        role: option.value,
                        storeId:
                          option.value === ROLE_SELLER
                            ? editFormData.storeId || selectedUser.storeId
                            : editFormData.storeId,
                      });
                    }}
                    disabled={editingSelf || updating}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: editingSelf }}
                    accessibilityLabel={`${option.label}${current ? ', current role' : ''}. ${option.capability}`}
                  >
                    <View style={[styles.roleCardIcon, { backgroundColor: tone.bg }]}>
                      <Ionicons name={roleCardIcon(option.value)} size={17} color={tone.ink} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.roleCardHead}>
                        <Text style={styles.roleCardTitle}>{option.label}</Text>
                        {current ? <Text style={styles.currentTag}>CURRENT</Text> : null}
                      </View>
                      <Text style={styles.roleCardSummary}>{option.summary}</Text>
                      <View style={styles.perms}>
                        {option.can.map((item) => (
                          <View key={item} style={styles.perm}>
                            <Ionicons name="checkmark" size={11} color={MOSS} />
                            <Text style={styles.permText}>{item}</Text>
                          </View>
                        ))}
                        {option.cannot.map((item) => (
                          <View key={item} style={styles.perm}>
                            <Text style={[styles.permText, styles.permNo]}>{item}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                    <View style={[styles.radio, active && styles.radioOn]} />
                  </Pressable>
                );
              })}
            </View>

            {/* Only a Store Manager runs a store, so the picker appears only
                for that role. "Open a new store" is the last tile rather than
                a separate screen: a store is only ever opened to put someone
                in charge of it. */}
            {editFormData.role === ROLE_SELLER && !editingSelf ? (
              <View>
                <Text style={styles.fieldLabel}>ASSIGNED STORE</Text>
                <View style={styles.storeGrid}>
                  {[...stores, { id: NEW_STORE, name: 'Open a new store' }].map((store) => {
                    const active = editFormData.storeId === store.id;
                    const isNew = store.id === NEW_STORE;
                    const managers = isNew ? 0 : activeManagersAt(store.id).length;
                    return (
                      <Pressable
                        key={store.id}
                        style={[styles.storeTile, isNew && styles.storeTileNew, active && styles.storeTileOn]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setEditFormData({ ...editFormData, storeId: store.id });
                        }}
                        disabled={updating}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
                        accessibilityLabel={isNew ? 'Open a new store' : `${store.name}, ${managers} active managers`}
                      >
                        {active ? (
                          <View style={styles.storeCheck}>
                            <Ionicons name="checkmark" size={11} color="#fff" />
                          </View>
                        ) : null}
                        <View style={[styles.storeTileIcon, active && { backgroundColor: CLAY }]}>
                          <Ionicons
                            name={isNew ? 'add' : 'storefront-outline'}
                            size={15}
                            color={active ? '#fff' : MUTED}
                          />
                        </View>
                        <Text style={styles.storeTileName} numberOfLines={2}>{store.name}</Text>
                        <Text style={styles.storeTileMeta}>
                          {isNew
                            ? 'Name it, then assign'
                            : managers === 0
                              ? 'No manager'
                              : `${managers} manager${managers === 1 ? '' : 's'}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {editFormData.storeId === NEW_STORE ? (
                  <TextInput
                    style={styles.newStoreInput}
                    value={editFormData.newStoreName}
                    onChangeText={(text) => setEditFormData({ ...editFormData, newStoreName: text })}
                    placeholder="Store name, e.g. Ukay ni Lola"
                    placeholderTextColor={MUTED}
                    maxLength={STORE_NAME_MAX}
                    autoFocus
                    accessibilityLabel="New store name"
                  />
                ) : null}
                <View style={styles.storeNote}>
                  <Ionicons name="information-circle-outline" size={14} color={MUTED} />
                  <Text style={styles.storeNoteText}>
                    A Store Manager can only change their own store&apos;s products. Stores can be
                    renamed later, not deleted.
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    paddingBottom: 40,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  sidePad: { paddingHorizontal: 16, paddingTop: 10 },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 6,
  },
  meRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  meRole: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: CLAY,
  },
  meName: { fontSize: 19, fontWeight: '600', letterSpacing: -0.3, color: INK, marginTop: 1 },
  topActions: { flexDirection: 'row', gap: 6 },
  topButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topButtonInk: { backgroundColor: INK, borderColor: INK },

  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarBlank: { width: 42, height: 42, borderRadius: 21, backgroundColor: CLAY + '15' },
  avatarInactive: { opacity: 0.45 },
  avatarText: { color: '#fff', fontWeight: '600' },
  avatarSkeleton: { width: 44, height: 44, borderRadius: 22 },

  overview: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 24,
    backgroundColor: INK,
    padding: 16,
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    right: -50,
    top: -60,
    width: 170,
    height: 170,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.08)',
  },
  ovRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  ovBig: {
    fontSize: 38,
    fontWeight: '600',
    letterSpacing: -0.8,
    color: Colors.light.background,
    lineHeight: 42,
    fontVariant: ['tabular-nums'],
  },
  ovSkeleton: { width: 60, height: 38, borderRadius: 8, marginBottom: 4, opacity: 0.25 },
  ovLabel: { fontSize: 12.5, color: ON_INK_MUTED, marginTop: 2 },
  ovPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(143,163,125,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  ovPillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#A9C59A' },
  ovPillText: { fontSize: 12, fontWeight: '600', color: '#CFE0BF' },
  bar: { flexDirection: 'row', height: 8, gap: 3, marginTop: 14, marginBottom: 10 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyDot: { width: 8, height: 8, borderRadius: 3 },
  keyText: { fontSize: 12, color: '#E6DED4' },

  inbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#EEF0EA',
  },
  inboxWaiting: { backgroundColor: '#F6E6DE' },
  inboxUnknown: { backgroundColor: '#fff', borderWidth: 1, borderColor: CARD_LINE },
  inboxTitle: { fontSize: 13.5, fontWeight: '600', color: '#37412F' },
  inboxText: { fontSize: 12, color: MOSS, marginTop: 1 },

  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.light.highlight + '18',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.highlight + '40',
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.light.text,
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: CARD_LINE,
    paddingHorizontal: 14,
  },
  searchFocused: { borderColor: CLAY },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: INK,
    paddingVertical: 0,
    outlineStyle: 'none',
  },
  filters: { gap: 6, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  filter: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CARD_LINE,
  },
  filterOn: { backgroundColor: CLAY, borderColor: CLAY },
  filterText: { fontSize: 12.5, fontWeight: '600', color: '#4A413A' },
  filterCount: { fontWeight: '500', color: MUTED },

  list: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  emptyStateWrap: { paddingHorizontal: Spacing.md },
  emptyStateAction: { marginTop: -Spacing.sm, marginBottom: Spacing.md, paddingHorizontal: Spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
  },
  rowSelf: { backgroundColor: '#FBF1EA', borderColor: '#F0D9CB' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '600', color: INK, flexShrink: 1 },
  youTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: INK,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  email: { fontSize: 12.5, color: MUTED, marginTop: 1, marginBottom: 6 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleBadgeText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  storeText: { fontSize: 12, color: MUTED, flexShrink: 1 },
  more: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F3EEE6',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  sheetTitle: { fontSize: 20, fontWeight: '600', color: INK, marginTop: 2 },
  sheetText: { fontSize: 13.5, lineHeight: 19, color: MUTED, marginTop: 4 },
  staffIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#F6E6DE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  steps: { marginVertical: 14 },
  stepsLine: {
    position: 'absolute',
    left: 15,
    top: 24,
    bottom: 24,
    width: 2,
    backgroundColor: CARD_LINE,
  },
  step: { flexDirection: 'row', gap: 14, paddingVertical: 8 },
  stepNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: CLAY,
    backgroundColor: Colors.light.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumLast: { backgroundColor: CLAY },
  stepNumText: { fontSize: 14, fontWeight: '700', color: '#A94F2F' },
  stepTitle: { fontSize: 14.5, fontWeight: '600', color: INK, marginTop: 5 },
  stepDetail: { fontSize: 12.5, lineHeight: 18, color: MUTED },
  stepRoles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  lockNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#E0D3C4',
    marginBottom: 16,
  },
  lockNoteText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: '#4A413A' },
  ghost: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ghostText: { fontSize: 15.5, fontWeight: '600', color: MUTED },

  // ⋯ sheet: who it is, two facts, then the actions grouped in one card
  // and the destructive one in a card of its own.
  idCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
  },
  idName: { fontSize: 16, fontWeight: '600', color: INK },
  idEmail: { fontSize: 12, color: MUTED, marginTop: 1 },
  facts: { flexDirection: 'row', gap: 8, marginTop: 8 },
  fact: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#F3EEE6' },
  factLabel: { fontSize: 10.5, color: MUTED },
  factValue: { fontSize: 12.5, fontWeight: '600', color: INK, marginTop: 1 },
  actionGroup: {
    marginTop: 14,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    overflow: 'hidden',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  actionDivided: { borderTopWidth: 1, borderTopColor: CARD_LINE },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F3EEE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#E0D3C4',
  },
  selfNoteText: { flex: 1, fontSize: 12, lineHeight: 17, color: MUTED },
  actionTitle: { fontSize: 14, fontWeight: '600', color: INK },
  actionDetail: { fontSize: 11.5, lineHeight: 16, color: MUTED },

  modalMessage: { fontSize: 14, lineHeight: 20, color: MUTED, textAlign: 'center', marginBottom: 14 },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginBottom: 18,
  },
  whoName: { fontSize: 14, fontWeight: '600', color: INK },
  whoEmail: { fontSize: 12, color: MUTED },

  selfModalHint: {
    fontSize: 13,
    color: Colors.light.icon,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing.md,
  },
  // Deactivate sheet
  warnRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FBEDEB',
    borderWidth: 8,
    borderColor: '#FDF5F3',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  warnTitle: { fontSize: 19, fontWeight: '600', color: INK, textAlign: 'center' },
  warnEmail: { fontSize: 12.5, color: MUTED, textAlign: 'center', marginTop: 3 },
  cons: {
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 2,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
  },
  con: { flexDirection: 'row', gap: 10, paddingVertical: 11 },
  conDivided: { borderTopWidth: 1, borderTopColor: CARD_LINE },
  conIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: MUTED },
  conLead: { fontWeight: '600', color: INK },

  // Change role sheet
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetClose: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: '#F0E9DF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#F3EEE6',
  },
  miniName: { fontSize: 13.5, fontWeight: '600', color: INK },
  miniEmail: { fontSize: 11.5, color: MUTED },
  miniLock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniLockText: { fontSize: 10.5, color: MUTED },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: MUTED,
    marginTop: 18,
    marginBottom: 8,
    marginHorizontal: 2,
  },
  roleCards: { gap: 8 },
  // Selection reads as a Clay outline on a faint Clay wash rather than a
  // solid fill: the card carries body copy, and the fill is reserved for
  // the actual primary action (Save change) below.
  roleCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 13,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: CARD_LINE,
    backgroundColor: '#fff',
  },
  roleCardOn: { borderColor: CLAY, backgroundColor: '#FCF3EE' },
  roleCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleCardTitle: { fontSize: 14, fontWeight: '600', color: INK },
  currentTag: {
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: MUTED,
    backgroundColor: '#EFE7DC',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  roleCardSummary: { fontSize: 11.5, lineHeight: 16, color: MUTED, marginTop: 2 },
  perms: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  perm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 99,
    backgroundColor: '#F3EEE6',
  },
  permText: { fontSize: 10.5, color: '#4A413A' },
  permNo: { color: '#9A9187', textDecorationLine: 'line-through' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.8,
    borderColor: '#CFC4B6',
    marginTop: 2,
  },
  radioOn: { borderWidth: 6, borderColor: CLAY },
  storeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  storeTile: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 88,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: CARD_LINE,
    backgroundColor: '#fff',
  },
  storeTileNew: { borderStyle: 'dashed', borderColor: '#D8CCBC', backgroundColor: 'transparent' },
  storeTileOn: { borderStyle: 'solid', borderColor: CLAY, backgroundColor: '#FCF3EE' },
  storeTileIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#F3EEE6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  storeTileName: { fontSize: 12.5, fontWeight: '600', lineHeight: 16, color: INK },
  storeTileMeta: { fontSize: 10.5, color: MUTED, marginTop: 2 },
  storeCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: CLAY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newStoreInput: {
    marginTop: 8,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: CLAY,
    backgroundColor: '#fff',
    fontSize: 14,
    color: INK,
  },
  storeNote: { flexDirection: 'row', gap: 6, marginTop: 10, marginHorizontal: 2 },
  storeNoteText: { flex: 1, fontSize: 11, lineHeight: 16, color: MUTED },
  diff: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: INK,
    marginBottom: 10,
  },
  diffSame: { backgroundColor: '#F0E9DF' },
  diffLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 1, color: ON_INK_MUTED },
  diffLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  diffFrom: {
    flexShrink: 1,
    fontSize: 12.5,
    color: ON_INK_MUTED,
    textDecorationLine: 'line-through',
  },
  diffTo: { flexShrink: 1, fontSize: 12.5, fontWeight: '600', color: '#fff' },
  diffSameText: { fontSize: 12.5, color: MUTED, marginTop: 4 },
});
