import { Decimal } from "@prisma/client/runtime/library";

/** All money/quantity math goes through Decimal — never native float. */
export { Decimal };

export function sumDecimal(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0));
}

export function assertEqual(a: Decimal, b: Decimal, message: string): void {
  if (!a.equals(b)) {
    throw new Error(`${message}: ${a.toString()} !== ${b.toString()}`);
  }
}

export function assertNonNegative(value: Decimal, message: string): void {
  if (value.isNegative()) {
    throw new Error(`${message}: ${value.toString()} is negative`);
  }
}

/**
 * Splits `total` across `weights` proportionally, rounding each share down
 * to `precision` decimal places and assigning the entire rounding
 * remainder to the last weight. This is the deterministic-remainder pattern
 * spec section 6.4 uses for landed-cost allocation, reused here for bundle
 * revenue and shared discount/shipping allocation (section 7.1, section 12)
 * so the shares always sum exactly to `total`, never approximately.
 */
export function allocateProportional(weights: Decimal[], total: Decimal, precision = 4): Decimal[] {
  const totalWeight = sumDecimal(weights);
  if (totalWeight.lessThanOrEqualTo(0)) {
    throw new Error("allocateProportional: total weight must be positive");
  }

  const shares = weights.map((w) => total.times(w).dividedBy(totalWeight).toDecimalPlaces(precision, Decimal.ROUND_DOWN));
  const allocated = sumDecimal(shares);
  const remainder = total.minus(allocated);

  const lastIndex = shares.length - 1;
  shares[lastIndex] = shares[lastIndex]!.plus(remainder);

  return shares;
}
