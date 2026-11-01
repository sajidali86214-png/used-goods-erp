import { prisma } from "../../lib/prisma.js";
import { Decimal, allocateProportional, assertEqual, sumDecimal } from "../../lib/money.js";

interface ExplicitShare {
  orderLineId: string;
  amount: Decimal | number;
}

/**
 * Allocates one bundle total price across the order lines sharing a
 * `bundleGroupId`. Default method is proportional piece count (spec
 * section 7.1); an approved explicit override can instead specify each
 * line's share directly, but the shares must still sum exactly to the
 * bundle price. Either way this is idempotent — re-running it replaces the
 * prior allocation for the same group.
 */
export async function allocateBundle(params: {
  bundleGroupId: string;
  totalBundlePrice: Decimal | number;
  explicitShares?: ExplicitShare[];
}) {
  const totalPrice = new Decimal(params.totalBundlePrice);
  const lines = await prisma.salesOrderLine.findMany({ where: { bundleGroupId: params.bundleGroupId } });
  if (lines.length === 0) {
    throw new Error(`No order lines found for bundleGroupId ${params.bundleGroupId}`);
  }

  let shareByLineId: Map<string, Decimal>;
  let method: string;
  let approvedOverride: boolean;

  if (params.explicitShares) {
    const total = sumDecimal(params.explicitShares.map((s) => new Decimal(s.amount)));
    assertEqual(total, totalPrice, "Explicit bundle shares must sum exactly to the bundle total price");
    shareByLineId = new Map(params.explicitShares.map((s) => [s.orderLineId, new Decimal(s.amount)]));
    method = "explicit";
    approvedOverride = true;
  } else {
    const shares = allocateProportional(lines.map((l) => l.quantity), totalPrice);
    shareByLineId = new Map(lines.map((l, i) => [l.id, shares[i]!]));
    method = "proportional_piece_count";
    approvedOverride = false;
  }

  const results = [];
  for (const line of lines) {
    const share = shareByLineId.get(line.id);
    if (!share) {
      throw new Error(`No share provided for order line ${line.id}`);
    }
    const derivedUnitRevenue = share.dividedBy(line.quantity);

    const allocation = await prisma.bundleAllocation.upsert({
      where: { orderLineId: line.id },
      update: { derivedUnitRevenue, method, approvedOverride },
      create: { orderLineId: line.id, derivedUnitRevenue, method, approvedOverride },
    });
    results.push({ allocation, lineShare: share });
  }

  return results;
}

/**
 * Generic shared-cost allocator for order-wide discounts or shipping split
 * across several lines proportionally by quantity (spec section 12),
 * written onto SalesOrderLine.discount / .taxesFees. Shares sum exactly to
 * `totalAmount` via the same deterministic-remainder rule as bundle revenue.
 */
export async function allocateSharedLineAmount(params: {
  orderLineIds: string[];
  totalAmount: Decimal | number;
  field: "discount" | "taxesFees";
}) {
  const totalAmount = new Decimal(params.totalAmount);
  const lines = await prisma.salesOrderLine.findMany({ where: { id: { in: params.orderLineIds } } });
  if (lines.length !== params.orderLineIds.length) {
    throw new Error("One or more orderLineIds were not found");
  }

  const shares = allocateProportional(lines.map((l) => l.quantity), totalAmount);

  const results = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const share = shares[i]!;
    const updated = await prisma.salesOrderLine.update({
      where: { id: line.id },
      data: { [params.field]: share },
    });
    results.push({ line: updated, share });
  }

  return results;
}
