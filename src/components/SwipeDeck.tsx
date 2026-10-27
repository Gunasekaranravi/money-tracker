import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Txn } from '../lib/db';
import { C, rupees, when } from '../theme';

export type SwipeDir = 'left' | 'right' | 'up';
export type SwipeDeckHandle = { swipe: (dir: SwipeDir) => void };

type Props = {
  cards: Txn[];
  onSwipe: (txn: Txn, dir: SwipeDir) => void;
  ref?: Ref<SwipeDeckHandle>;
};

export function SwipeDeck({ cards, onSwipe, ref }: Props) {
  const progress = useSharedValue(0); // 0..1, how far the top card has been dragged
  const topSwipe = useRef<((dir: SwipeDir) => void) | null>(null);

  useImperativeHandle(ref, () => ({ swipe: (dir) => topSwipe.current?.(dir) }), []);

  const visible = cards.slice(0, 3);
  return (
    <View style={styles.deck}>
      {visible
        .map((txn, i) =>
          i === 0 ? (
            <TopCard
              key={txn.id}
              txn={txn}
              progress={progress}
              swipeRef={topSwipe}
              onDone={(dir) => onSwipe(txn, dir)}
            />
          ) : (
            <BackCard key={txn.id} txn={txn} depth={i} progress={progress} />
          ),
        )
        .reverse()}
    </View>
  );
}

function TopCard({
  txn,
  progress,
  swipeRef,
  onDone,
}: {
  txn: Txn;
  progress: SharedValue<number>;
  swipeRef: React.RefObject<((dir: SwipeDir) => void) | null>;
  onDone: (dir: SwipeDir) => void;
}) {
  const { width, height } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const threshX = width * 0.28;
  const threshY = height * 0.15;

  useEffect(() => {
    progress.value = 0;
  }, [progress]);

  const fling = (dir: SwipeDir) => {
    'worklet';
    const toX = dir === 'right' ? width * 1.4 : dir === 'left' ? -width * 1.4 : tx.value;
    const toY = dir === 'up' ? -height : ty.value;
    tx.value = withTiming(toX, { duration: 220 });
    ty.value = withTiming(toY, { duration: 220 }, (finished) => {
      if (finished) scheduleOnRN(onDone, dir);
    });
  };

  useEffect(() => {
    swipeRef.current = fling;
  });

  const pan = usePanGesture({
    onUpdate: (e) => {
      'worklet';
      tx.value = e.translationX;
      ty.value = e.translationY;
      progress.value = Math.min(1, Math.max(Math.abs(e.translationX) / threshX, -e.translationY / threshY, 0));
    },
    onDeactivate: (e) => {
      'worklet';
      if (tx.value > threshX || e.velocityX > 900) fling('right');
      else if (tx.value < -threshX || e.velocityX < -900) fling('left');
      else if (ty.value < -threshY || e.velocityY < -1100) fling('up');
      else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
        progress.value = withTiming(0);
      }
    },
  });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-14, 0, 14])}deg` },
    ],
  }));
  const rightStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [0, threshX], [0, 1], 'clamp') }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: interpolate(tx.value, [-threshX, 0], [1, 0], 'clamp') }));
  const upStyle = useAnimatedStyle(() => ({ opacity: interpolate(ty.value, [-threshY, 0], [1, 0], 'clamp') }));

  const isIncome = txn.type === 'income';
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, cardStyle]}>
        <CardBody txn={txn} />
        <Animated.View style={[styles.stamp, styles.stampLeft, { borderColor: isIncome ? C.income : C.need }, rightStyle]}>
          <Text style={[styles.stampText, { color: isIncome ? C.income : C.need }]}>{isIncome ? 'GOT IT' : 'NEED'}</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampRight, { borderColor: isIncome ? C.income : C.want }, leftStyle]}>
          <Text style={[styles.stampText, { color: isIncome ? C.income : C.want }]}>{isIncome ? 'GOT IT' : 'WANT'}</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampUp, { borderColor: C.ignore }, upStyle]}>
          <Text style={[styles.stampText, { color: C.ignore }]}>DON'T COUNT</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

function BackCard({ txn, depth, progress }: { txn: Txn; depth: number; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    // Moves up one step as the top card is dragged away.
    const d = depth - (depth === 1 ? progress.value : 0);
    return {
      transform: [{ scale: 1 - d * 0.05 }, { translateY: d * 14 }],
      opacity: 1 - d * 0.25,
    };
  });
  return (
    <Animated.View style={[styles.card, style]} pointerEvents="none">
      <CardBody txn={txn} />
    </Animated.View>
  );
}

function CardBody({ txn }: { txn: Txn }) {
  const isIncome = txn.type === 'income';
  const color = isIncome ? C.income : C.expense;
  return (
    <View style={styles.body}>
      <View style={[styles.pill, { backgroundColor: color + '22' }]}>
        <Text style={[styles.pillText, { color }]}>{isIncome ? '↓ Money in' : '↑ Money out'}</Text>
      </View>
      <Text style={[styles.amount, { color }]}>
        {isIncome ? '+' : '−'}
        {rupees(txn.amount)}
      </Text>
      <Text style={styles.party} numberOfLines={1}>
        {isIncome ? 'from ' : 'to '}
        {txn.party}
      </Text>
      <Text style={styles.meta}>
        {txn.bank}
        {txn.account ? ` ••${txn.account}` : ''} · {when(txn.date)}
      </Text>
      <View style={styles.sms}>
        <Text style={styles.smsText} numberOfLines={4}>
          {txn.body}
        </Text>
      </View>
      <Text style={styles.hint}>
        {isIncome ? '← or → got it  ·  ↑ don’t count' : '← want  ·  ↑ don’t count  ·  need →'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute',
    width: '90%',
    height: '92%',
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    elevation: 6,
  },
  body: { flex: 1, padding: 24, justifyContent: 'center' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontSize: 13, fontWeight: '700' },
  amount: { fontSize: 46, fontWeight: '800', marginTop: 18, letterSpacing: -1 },
  party: { color: C.text, fontSize: 20, fontWeight: '600', marginTop: 6 },
  meta: { color: C.muted, fontSize: 14, marginTop: 6 },
  sms: { backgroundColor: C.cardAlt, borderRadius: 14, padding: 14, marginTop: 22 },
  smsText: { color: C.muted, fontSize: 12, lineHeight: 17 },
  hint: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 'auto', paddingTop: 16 },
  stamp: { position: 'absolute', borderWidth: 3, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  stampLeft: { top: 28, left: 22, transform: [{ rotate: '-14deg' }] },
  stampRight: { top: 28, right: 22, transform: [{ rotate: '14deg' }] },
  stampUp: { bottom: 70, alignSelf: 'center' },
  stampText: { fontSize: 26, fontWeight: '900', letterSpacing: 1 },
});
