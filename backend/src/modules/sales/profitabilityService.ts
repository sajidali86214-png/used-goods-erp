import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";

/**
 * COGS is computed from the ACTUAL dispatched/picked lot-cost-layer
 * allocation, never from the product's latest purchase price (spec section
 * 12). Worked example (acceptance test #6): 50 pieces at 900, 20 from a
 * 500-cost layer and 30 from a 600-cost layer -> revenue 45000, cost 28000,
 * gross profit 17000.
 */
export async function computeLineProfitability(orderLineId: string) {
  const line = await prisma.salesOrderLine.findUniqueOrThrow({
    where: { id: orderLineId },
    include: { bundleAllocation: true },
  });

  const picks = await prisma.pickAllocation.findMany({
    where: { orderLineId },
    include: { costLayer: true },
  });

  const totalPickedQty = sumDecimal(picks.map((p) => p.pickedQty));
  const unitRevenue = line.bundleAllocation
    ? line.bundleAllocation.derivedUnitRevenue
    : line.unitPrice ?? new Decimal(0);

  const revenue = unitRevenue.times(totalPickedQty);
  const cogs = sumDecimal(picks.map((p) => p.pickedQty.times(p.costLayer.unitCost)));
  const grossProfit = revenue.minus(cogs);

  return { totalPickedQty, unitRevenue, revenue, cogs, grossProfit };
}
