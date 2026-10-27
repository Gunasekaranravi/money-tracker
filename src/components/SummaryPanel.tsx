import { StyleSheet, Text, View } from 'react-native';
import { dashboard, type Summary } from '../lib/schema';
import { C, rupees } from '../theme';

const signed = (n: number) => (n < 0 ? '−' : '') + rupees(Math.abs(n));

export function SummaryPanel({ s }: { s: Summary }) {
  // Spent = paid out minus refunds; Net = received (income + refunds) minus paid out.
  const { spent, net } = dashboard(s);
  const reviewed = s.need + s.want;
  const needPct = reviewed ? (s.need / reviewed) * 100 : 0;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Stat label="Inflow" value={rupees(s.inflow)} color={C.income} />
        <Stat
          label="Spent"
          value={signed(spent)}
          color={C.expense}
          sub={s.refunds > 0 ? `after ${rupees(s.refunds)} refunds` : undefined}
        />
        <Stat label="Net" value={signed(net)} color={C.text} />
      </View>
      <View style={styles.bar}>
        {reviewed > 0 ? (
          <>
            <View style={{ flex: needPct, backgroundColor: C.need }} />
            <View style={{ flex: 100 - needPct, backgroundColor: C.want }} />
          </>
        ) : (
          <View style={{ flex: 1, backgroundColor: C.border }} />
        )}
      </View>
      <View style={styles.legend}>
        <Text style={[styles.legendText, { color: C.need }]}>Need {rupees(s.need)}</Text>
        <Text style={[styles.legendText, { color: C.want }]}>Want {rupees(s.want)}</Text>
        {s.unreviewedOut > 0 && (
          <Text style={[styles.legendText, { color: C.muted }]}>Unsorted {rupees(s.unreviewedOut)}</Text>
        )}
      </View>
    </View>
  );
}

function Stat({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub && (
        <Text style={[styles.statSub, { color: C.refund }]} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: C.card, borderRadius: 20, padding: 16, marginHorizontal: 16, borderWidth: 1, borderColor: C.border },
  row: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1 },
  statLabel: { color: C.muted, fontSize: 12, fontWeight: '600' },
  statValue: { fontSize: 19, fontWeight: '800', marginTop: 2 },
  statSub: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 14 },
  legend: { flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap' },
  legendText: { fontSize: 12, fontWeight: '600' },
});
