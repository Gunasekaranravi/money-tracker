import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { hasSmsPermission, requestSmsPermission } from './modules/sms-reader';
import { SummaryPanel } from './src/components/SummaryPanel';
import { SwipeDeck, type SwipeDeckHandle, type SwipeDir } from './src/components/SwipeDeck';
import {
  getMeta,
  getPending,
  getRecent,
  getSummary,
  setLabel,
  type Label,
  type Summary,
  type Txn,
} from './src/lib/db';
import { EMPTY_SUMMARY } from './src/lib/schema';
import { loadDemoData, syncSms } from './src/lib/sync';
import { C, rupees, when } from './src/theme';

type Access = 'checking' | 'granted' | 'needed' | 'demo';

const EMPTY: Summary = EMPTY_SUMMARY;

function monthRange(d = new Date()) {
  const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { from, to, label: d.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) };
}

function labelFor(txn: Txn, dir: SwipeDir): Label {
  if (dir === 'up') return 'ignored';
  if (txn.type === 'income') return 'income';
  return dir === 'right' ? 'need' : 'want';
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Main />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Main() {
  const [access, setAccess] = useState<Access>('checking');
  const [pending, setPending] = useState<Txn[]>([]);
  const [recent, setRecent] = useState<Txn[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = useRef<string[]>([]); // swiped ids, for undo
  const deck = useRef<SwipeDeckHandle>(null);
  const month = monthRange();

  const reload = useCallback(async () => {
    const { from, to } = monthRange();
    const [p, r, s] = await Promise.all([getPending(), getRecent(), getSummary(from, to)]);
    setPending(p);
    setRecent(r);
    setSummary(s);
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncSms();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      await reload();
      setSyncing(false);
    }
  }, [reload]);

  // First launch: check SMS permission (or demo mode), then read new SMS.
  useEffect(() => {
    (async () => {
      if (await hasSmsPermission()) {
        setAccess('granted');
        await sync();
      } else if ((await getMeta('demo')) === '1') {
        setAccess('demo');
        await reload();
      } else {
        setAccess('needed');
      }
    })();
  }, [sync, reload]);

  // Every time the app comes back to the front, pick up new SMS.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && access === 'granted') sync();
    });
    return () => sub.remove();
  }, [access, sync]);

  const onSwipe = useCallback(
    async (txn: Txn, dir: SwipeDir) => {
      // Drop the card right away so the next one is ready; save in the background.
      setPending((p) => p.filter((t) => t.id !== txn.id));
      history.current.push(txn.id);
      await setLabel(txn.id, labelFor(txn, dir));
      await reload();
    },
    [reload],
  );

  const undo = async () => {
    const id = history.current.pop();
    if (!id) return;
    await setLabel(id, null);
    await reload();
  };

  if (access === 'checking') {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (access === 'needed') {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { padding: 28 }]}>
        <Text style={styles.bigEmoji}>💸</Text>
        <Text style={styles.title}>All your UPI apps, one place</Text>
        <Text style={styles.para}>
          GPay, PhonePe, Paytm… every payment sends a bank SMS. Money Tracker reads those SMS to show your
          money in and out. Nothing leaves your phone.
        </Text>
        {Platform.OS === 'android' ? (
          <Pressable
            style={styles.primary}
            onPress={async () => {
              if (await requestSmsPermission()) {
                setAccess('granted');
                await sync();
              } else {
                setError('SMS permission was denied. You can allow it in Settings → Apps → Money Tracker.');
              }
            }}
          >
            <Text style={styles.primaryText}>Allow SMS access</Text>
          </Pressable>
        ) : (
          // Browsers can't read SMS, so the web preview runs on sample messages only.
          <Text style={[styles.para, { marginTop: 24 }]}>Browser preview: SMS reading works only on Android.</Text>
        )}
        <Pressable
          style={styles.secondary}
          onPress={async () => {
            await loadDemoData();
            setAccess('demo');
            await reload();
          }}
        >
          <Text style={styles.secondaryText}>Try with sample messages</Text>
        </Pressable>
        {error && <Text style={styles.error}>{error}</Text>}
      </SafeAreaView>
    );
  }

  const top = pending[0];
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Money Tracker</Text>
          <Text style={styles.sub}>
            {month.label}
            {access === 'demo' ? ' · demo data' : ''}
          </Text>
        </View>
        {access === 'granted' && (
          <Pressable style={styles.iconBtn} onPress={sync} disabled={syncing}>
            {syncing ? <ActivityIndicator color={C.text} size="small" /> : <Text style={styles.iconText}>↻</Text>}
          </Pressable>
        )}
      </View>

      <SummaryPanel s={summary} />
      {error && <Text style={[styles.error, { marginHorizontal: 16 }]}>{error}</Text>}

      {top ? (
        <>
          <Text style={styles.count}>
            {pending.length} to review
          </Text>
          <SwipeDeck ref={deck} cards={pending} onSwipe={onSwipe} />
          <View style={styles.actions}>
            <RoundBtn label={top.type === 'income' ? '✓' : 'Want'} color={top.type === 'income' ? C.income : C.want} onPress={() => deck.current?.swipe('left')} />
            <RoundBtn label="Skip" small color={C.ignore} onPress={() => deck.current?.swipe('up')} />
            <RoundBtn label="↶" small color={C.accent} onPress={undo} />
            <RoundBtn label={top.type === 'income' ? '✓' : 'Need'} color={C.need} onPress={() => deck.current?.swipe('right')} />
          </View>
        </>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={styles.done}>
            <Text style={styles.bigEmoji}>🎉</Text>
            <Text style={styles.doneTitle}>All caught up</Text>
            <Text style={styles.para}>New payments show up here as cards the next time you open the app.</Text>
            {history.current.length > 0 && (
              <Pressable onPress={undo}>
                <Text style={[styles.secondaryText, { marginTop: 8 }]}>↶ Undo last swipe</Text>
              </Pressable>
            )}
          </View>
          {recent.length > 0 && <Text style={styles.section}>Recent</Text>}
          {recent.map((t) => (
            <RecentRow key={t.id} t={t} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RoundBtn({ label, color, onPress, small }: { label: string; color: string; onPress: () => void; small?: boolean }) {
  const size = small ? 52 : 68;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderColor: color, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={[styles.roundText, { color, fontSize: small ? 14 : 16 }]}>{label}</Text>
    </Pressable>
  );
}

const TAG: Record<Label, { text: string; color: string }> = {
  need: { text: 'Need', color: C.need },
  want: { text: 'Want', color: C.want },
  income: { text: 'Income', color: C.income },
  ignored: { text: 'Not counted', color: C.ignore },
};

const REFUND_TAG = { text: 'Refund', color: C.refund };

function RecentRow({ t }: { t: Txn }) {
  // A counted refund keeps label 'income'; show it as "Refund" instead.
  const tag = t.label === 'income' && t.kind === 'refund' ? REFUND_TAG : t.label ? TAG[t.label] : null;
  const isIncome = t.type === 'income';
  return (
    <View style={styles.rowItem}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowParty} numberOfLines={1}>
          {t.party}
        </Text>
        <Text style={styles.rowMeta}>
          {t.bank} · {when(t.date)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.rowAmt, { color: t.label === 'ignored' ? C.muted : isIncome ? C.income : C.expense }]}>
          {isIncome ? '+' : '−'}
          {rupees(t.amount)}
        </Text>
        {tag && <Text style={[styles.rowTag, { color: tag.color }]}>{tag.text}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  title: { color: C.text, fontSize: 24, fontWeight: '800', textAlign: 'left' },
  sub: { color: C.muted, fontSize: 13, marginTop: 2 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border },
  iconText: { color: C.text, fontSize: 20, fontWeight: '700' },
  count: { color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 14 },
  actions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, paddingVertical: 14 },
  round: { borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  roundText: { fontWeight: '800' },
  bigEmoji: { fontSize: 52, textAlign: 'center' },
  para: { color: C.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  primary: { backgroundColor: C.accent, paddingVertical: 15, paddingHorizontal: 28, borderRadius: 14, marginTop: 28, alignSelf: 'stretch', alignItems: 'center' },
  primaryText: { color: '#0B0C10', fontSize: 16, fontWeight: '800' },
  secondary: { paddingVertical: 14, marginTop: 6 },
  secondaryText: { color: C.accent, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  error: { color: C.expense, fontSize: 13, marginTop: 12, textAlign: 'center' },
  done: { alignItems: 'center', paddingVertical: 28 },
  doneTitle: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: 8 },
  section: { color: C.muted, fontSize: 13, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  rowItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  rowParty: { color: C.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: C.muted, fontSize: 12, marginTop: 2 },
  rowAmt: { fontSize: 15, fontWeight: '800' },
  rowTag: { fontSize: 11, fontWeight: '700', marginTop: 2 },
});
