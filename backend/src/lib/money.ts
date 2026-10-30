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
