import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useReducedMotion, FadeIn, FadeInDown } from 'react-native-reanimated';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../../constants/theme';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import { EASE_OUT_QUART } from '../../constants/motion';

// The reader for functions/mailer.js's delivery record.
//
// WHY THIS SCREEN EXISTS: the mailer writes the outcome of every receipt
// and support notification to mailLog, and until now nothing read it. A
// failed send was recorded precisely where no human would ever look, which
// is the same as not recording it. The question this answers is the one a
// Store Manager actually asks — "did that customer get their receipt?" —
// and the one they cannot answer any other way, because a bounced email
// leaves no trace in the app.
//
// READ ONLY, and not by accident. There is no write rule on mailLog for
// any role (see firestore.rules, MAIL-1). Nothing here can retry a send,
// mark an entry handled, or delete one. Retrying would mean re-invoking
// the mailer, which is a Cloud Function this screen cannot call, and
// faking the rest would turn a record of what happened into a record of
// what someone clicked.

// Ordered worst-first, because the whole point of opening this screen is
// the failures. 'sending' sits between: an entry stuck there means the
// function claimed the send and then died before recording an outcome,
// which is rare and worth seeing, but is not itself proof of failure.
const STATUS_META = {
  failed: {
    label: 'Failed',
    icon: 'alert-circle-outline',
    tone: 'danger',
    blurb: 'The mail server refused this message.',
  },
  unconfigured: {
    label: 'Not sent',
    icon: 'key-outline',
    tone: 'warning',
    blurb: 'No mail credentials are set, so nothing was sent.',
  },
  sending: {
    label: 'Incomplete',
    icon: 'help-circle-outline',
    tone: 'warning',
    blurb: 'Started but never finished — the outcome was not recorded.',
  },
  sent: {
    label: 'Sent',
    icon: 'checkmark-circle-outline',
    tone: 'success',
    blurb: '',
  },
};

// Anything not in STATUS_META — a status invented by a later change to the
// mailer — renders as unknown rather than vanishing. A delivery log that
// silently drops rows it does not recognise is worse than one that admits
// it does not know.
const UNKNOWN_STATUS = {
  label: 'Unknown',
  icon: 'help-circle-outline',
  tone: 'warning',
  blurb: 'This status was not recognised.',
};

const PROBLEM_STATUSES = ['failed', 'unconfigured', 'sending'];

const KIND_LABELS = {
  orderConfirmation: 'Order receipt',
  supportRequest: 'Support alert',
};

function toneColor(tone) {
  if (tone === 'danger') return Colors.light.danger;
  if (tone === 'warning') return Colors.light.highlight;
  if (tone === 'success') return Colors.light.secondary;
  return Colors.light.icon;
}

// Matches AdminActivityScreen's formatWhen: elapsed up to a week, then a
// date. Someone opening this is almost always asking about something
// recent, and "2h ago" answers that faster than a timestamp.
function formatWhen(date) {
  if (!date) return 'Just now';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EntrySkeleton() {
  return (
    <Card variant="flat" style={styles.entryCard}>
      <SkeletonBlock style={styles.iconSkeleton} />
      <View style={styles.entryBody}>
        <SkeletonBlock style={{ width: '75%', height: 13, borderRadius: Radius.sm, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: '50%', height: 11, borderRadius: Radius.sm }} />
      </View>
    </Card>
  );
}

export default function AdminMailLogScreen({ navigation, route }) {
  // The dashboard card links here with problemsOnly, because it only
  // appears when there are problems and landing on a full list would make
  // the reader hunt for what the card just counted.
  const [problemsOnly, setProblemsOnly] = useState(route?.params?.problemsOnly === true);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setLoading(true);
    setLoadError(false);

    // Capped at 200, same reasoning as the activity log: a monitoring
    // view, not an archive. This collection gains a document per order and
    // per support request, so an unbounded listener would re-download the
    // store's entire mail history on every cold start.
    //
    // Ordered by recordedAt, which functions/mailer.js writes on every
    // path that creates one of these documents. That matters more than it
    // looks: Firestore's orderBy omits documents missing the field rather
    // than erroring, so a timestamp written on only some paths would make
    // exactly the entries this screen exists for invisible.
    const unsubscribe = onSnapshot(
      query(collection(db, 'mailLog'), orderBy('recordedAt', 'desc'), limit(200)),
      (snapshot) => {
        setEntries(
          snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              status: data.status || 'sending',
              kind: data.kind || '',
              to: data.to || '',
              subject: data.subject || '',
              detail: data.detail || '',
              recordedAt: data.recordedAt?.toDate?.() ?? null,
            };
          })
        );
        setLoadError(false);
        setLoading(false);
      },
      (error) => {
        console.error('Error loading mail log:', error);
        setLoadError(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [retryToken]);

  const problemCount = useMemo(
    () => entries.filter((entry) => PROBLEM_STATUSES.includes(entry.status)).length,
    [entries]
  );

  const visible = useMemo(
    () => (problemsOnly ? entries.filter((e) => PROBLEM_STATUSES.includes(e.status)) : entries),
    [entries, problemsOnly]
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </AnimatedPressable>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle} accessibilityRole="header">Email Delivery</Text>
          <Text style={styles.headerSubtitle}>Receipts and support alerts</Text>
        </View>
        <View style={styles.placeholder} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — this list may be out of date.
          </Text>
        </View>
      )}

      {/* One chip, not a tab bar. There are only two views and the
          interesting one is a subset of the other, so a toggle says it
          more plainly than two tabs implying separate places. Hidden
          entirely when there is nothing wrong — a filter that always
          resolves to zero is a control that teaches you to ignore it. */}
      {problemCount > 0 && (
        <Animated.View
          style={styles.filterRow}
          entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(40).easing(EASE_OUT_QUART)}
        >
          <AnimatedPressable
            onPress={() => setProblemsOnly((v) => !v)}
            style={[styles.chip, problemsOnly && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: problemsOnly }}
            accessibilityLabel={`Show only problems, ${problemCount} found`}
            accessibilityHint={problemsOnly ? 'Tap to show all email' : 'Tap to hide delivered email'}
          >
            <Ionicons
              name="alert-circle-outline"
              size={15}
              color={problemsOnly ? Colors.light.background : Colors.light.danger}
            />
            <Text style={[styles.chipText, problemsOnly && styles.chipTextActive]}>
              {problemCount} didn&apos;t send
            </Text>
            {problemsOnly && (
              <Ionicons name="close" size={15} color={Colors.light.background} />
            )}
          </AnimatedPressable>
        </Animated.View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContainer}>
        {loading ? (
          <>
            <EntrySkeleton />
            <EntrySkeleton />
            <EntrySkeleton />
          </>
        ) : loadError ? (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load email delivery"
              subtitle="Check your connection and try again."
            />
            <View style={styles.emptyStateAction}>
              <Button variant="outline" label="Retry" onPress={() => setRetryToken((t) => t + 1)} />
            </View>
          </View>
        ) : visible.length > 0 ? (
          visible.map((entry, index) => {
            const meta = STATUS_META[entry.status] ?? UNKNOWN_STATUS;
            const tint = toneColor(meta.tone);
            return (
              <Animated.View
                key={entry.id}
                entering={reduceMotion ? undefined : FadeIn.duration(200).delay(Math.min(index, 8) * 25)}
              >
                <Card variant="flat" style={styles.entryCard}>
                  <View style={[styles.iconWrap, { backgroundColor: `${tint}15` }]}>
                    <Ionicons name={meta.icon} size={18} color={tint} />
                  </View>
                  <View style={styles.entryBody}>
                    <View style={styles.entryTopRow}>
                      <Text style={styles.entryKind}>
                        {KIND_LABELS[entry.kind] || 'Email'}
                      </Text>
                      <Text style={[styles.entryStatus, { color: tint }]}>{meta.label}</Text>
                    </View>
                    <Text style={styles.entryTo} numberOfLines={1}>{entry.to || 'No recipient'}</Text>
                    {entry.subject ? (
                      <Text style={styles.entrySubject} numberOfLines={1}>{entry.subject}</Text>
                    ) : null}
                    {/* The provider's own words, not a rewrite of them.
                        "Username and Password not accepted" names the fix;
                        a friendly paraphrase would not. */}
                    {entry.detail ? (
                      <Text style={styles.entryDetail} numberOfLines={3}>{entry.detail}</Text>
                    ) : meta.blurb ? (
                      <Text style={styles.entryDetail}>{meta.blurb}</Text>
                    ) : null}
                    <Text style={styles.entryWhen}>{formatWhen(entry.recordedAt)}</Text>
                  </View>
                </Card>
              </Animated.View>
            );
          })
        ) : (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon={problemsOnly ? 'checkmark-circle-outline' : 'mail-outline'}
              title={problemsOnly ? 'Everything sent' : 'No email yet'}
              subtitle={
                problemsOnly
                  ? 'No receipts or alerts have failed.'
                  : 'Order receipts and support alerts will appear here once orders start coming in.'
              }
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.line,
  },
  backButton: { width: 32 },
  headerTitleGroup: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  headerSubtitle: { fontSize: 11, color: Colors.light.icon, marginTop: 2 },
  placeholder: { width: 32 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: `${Colors.light.danger}12`,
  },
  offlineBannerText: { fontSize: 12, color: Colors.light.danger, flex: 1 },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.line,
    backgroundColor: Colors.light.background,
  },
  chipActive: {
    backgroundColor: Colors.light.danger,
    borderColor: Colors.light.danger,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.light.text },
  chipTextActive: { color: Colors.light.background },
  listContainer: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  entryCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSkeleton: { width: 34, height: 34, borderRadius: Radius.sm },
  entryBody: { flex: 1 },
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  entryKind: { fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.light.icon },
  entryStatus: { fontSize: 11, fontWeight: '600' },
  entryTo: { fontSize: 14, fontWeight: '500', color: Colors.light.text },
  entrySubject: { fontSize: 12, color: Colors.light.icon, marginTop: 1 },
  entryDetail: {
    fontSize: 12,
    color: Colors.light.icon,
    marginTop: 6,
    ...Platform.select({ ios: { fontVariant: ['tabular-nums'] }, default: {} }),
  },
  entryWhen: { fontSize: 11, color: Colors.light.icon, marginTop: 6 },
  emptyStateWrap: { paddingTop: Spacing.xl },
  emptyStateAction: { alignItems: 'center', marginTop: Spacing.md },
});
