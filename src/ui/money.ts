/** Minor units (cents) as a price: 1000 NPR -> "USD 10.00". */
export const money = (currency: unknown, minor: unknown): string => {
  const n = Number(minor ?? 0);
  return `${n < 0 ? '-' : ''}${String(currency ?? '')} ${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, '0')}`;
};

/** A typed price ("10", "10.50") to minor units, or undefined when it is not a valid amount. */
export const toMinor = (text: string): number | undefined => {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text.trim())) return undefined;
  return Math.round(Number(text.trim()) * 100);
};
