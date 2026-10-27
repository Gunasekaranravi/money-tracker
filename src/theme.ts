export const C = {
  bg: '#0E0F13',
  card: '#1A1C23',
  cardAlt: '#22252E',
  border: '#2C2F3A',
  text: '#F4F5F7',
  muted: '#9096A3',
  income: '#34D399',
  expense: '#F87171',
  need: '#34D399',
  want: '#FBBF24',
  ignore: '#9096A3',
  accent: '#818CF8',
};

export function rupees(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function when(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
