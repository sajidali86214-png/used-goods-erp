import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { randomUUID } from "node:crypto";
import { receiveSaleable, seedSalesReferenceData } from "./salesHelpers.js";
import { createDraftOrder, amendGradeRequirement } from "../src/modules/sales/salesOrderService.js";
import { suggestAllocation, reserveStock } from "../src/modules/sales/reservationService.js";
import { pickFromReservation } from "../src/modules/sales/pickingService.js";
import { computeLineProfitability } from "../src/modules/sales/profitabilityService.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("acceptance test #4: mixed-grade order with no promised ratio", () => {
  it("reserves eligible quantities FIFO, picks an actual mix, and conserves the ordered total", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } =
      await seedSalesReferenceData();

    await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeByCode.get("A")!.id,
      unitPrice: 500,
      quantity: 50,
      actorUserId: user.id,
    });
    await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeByCode.get("B")!.id,
      unitPrice: 500,
      quantity: 50,
      actorUserId: user.id,
    });

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 60, gradeRequirementType: "none", unitPrice: 900 }],
    });
    const line = order.lines[0]!;

    const { candidates, fulfilledQty } = await suggestAllocation({ productId: product.id, quantity: 60 });
    expect(fulfilledQty.toNumber()).toBe(60);
    // FIFO: all 50 of the first (A) layer, then 10 spilling into the second (B) layer.
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.quantity.toNumber()).toBe(50);
    expect(candidates[1]!.quantity.toNumber()).toBe(10);

    for (const candidate of candidates) {
      await reserveStock({
        orderLineId: line.id,
        costLayerId: candidate.costLayerId,
        gradeId: candidate.gradeId,
        binId: candidate.binId,
        quantity: candidate.quantity,
      });
    }

    // Picking confirms the actual mix â€” here it matches what was reserved exactly.
    const picks = [];
    for (const candidate of candidates) {
      picks.push(
        await pickFromReservation({
          orderLineId: line.id,
          costLayerId: candidate.costLayerId,
          gradeId: candidate.gradeId,
          binId: candidate.binId,
          quantity: candidate.quantity,
          pickerUserId: user.id,
        }),
      );
    }

    const totalPicked = picks.reduce((sum, p) => sum + p.pickedQty.toNumber(), 0);
    expect(totalPicked).toBe(60);

    const refreshedLine = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(refreshedLine.quantity.toNumber()).toBe(60); // ordered quantity itself never changes
  });
});

describe("acceptance test #5: A-only restricted order rejects Grade B unless amended", () => {
  it("rejects picking a disallowed grade, then allows it after an audited amendment", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } =
      await seedSalesReferenceData();

    const gradeA = gradeByCode.get("A")!;
    const gradeB = gradeByCode.get("B")!;

    await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeB.id,
      unitPrice: 400,
      quantity: 20,
      actorUserId: user.id,
    });

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [
        {
          productId: product.id,
          quantity: 10,
          gradeRequirementType: "allowed_set",
          allowedGradeIds: [gradeA.id],
          unitPrice: 900,
        },
      ],
    });
    const line = order.lines[0]!;

    const { candidates } = await suggestAllocation({ productId: product.id, quantity: 10 });
    const gradeBCandidate = candidates[0]!;

    await reserveStock({
      orderLineId: line.id,
      costLayerId: gradeBCandidate.costLayerId,
      gradeId: gradeBCandidate.gradeId,
      binId: gradeBCandidate.binId,
      quantity: gradeBCandidate.quantity,
    });

    await expect(
      pickFromReservation({
        orderLineId: line.id,
        costLayerId: gradeBCandidate.costLayerId,
        gradeId: gradeBCandidate.gradeId,
        binId: gradeBCandidate.binId,
        quantity: gradeBCandidate.quantity,
        pickerUserId: user.id,
      }),
    ).rejects.toThrow(/not in the allowed set/);

    await amendGradeRequirement({
      orderLineId: line.id,
      addAllowedGradeId: gradeB.id,
      actorUserId: user.id,
      reason: "Customer agreed to accept Grade B for this line",
    });

    const pick = await pickFromReservation({
      orderLineId: line.id,
      costLayerId: gradeBCandidate.costLayerId,
      gradeId: gradeBCandidate.gradeId,
      binId: gradeBCandidate.binId,
      quantity: gradeBCandidate.quantity,
      pickerUserId: user.id,
    });
    expect(pick.pickedQty.toNumber()).toBe(10);

    const auditEvents = await prisma.auditEvent.findMany({
      where: { entityType: "SalesOrderLine", entityId: line.id, action: "amend_grade_requirement" },
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.reason).toMatch(/Grade B/);
  });
});

describe("acceptance test #6: gross profit from two lots matches the worked example", () => {
  it("revenue 45000, cost 28000, gross profit 17000", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } =
      await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 500,
      quantity: 20,
      actorUserId: user.id,
    });
    await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 600,
      quantity: 30,
      actorUserId: user.id,
    });

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [{ productId: product.id, quantity: 50, gradeRequirementType: "none", unitPrice: 900 }],
    });
    const line = order.lines[0]!;

    const { candidates } = await suggestAllocation({ productId: product.id, quantity: 50 });
    expect(candidates.map((c) => c.quantity.toNumber())).toEqual([20, 30]);

    for (const candidate of candidates) {
      await reserveStock({
        orderLineId: line.id,
        costLayerId: candidate.costLayerId,
        gradeId: candidate.gradeId,
        binId: candidate.binId,
        quantity: candidate.quantity,
      });
      await pickFromReservation({
        orderLineId: line.id,
        costLayerId: candidate.costLayerId,
        gradeId: candidate.gradeId,
        binId: candidate.binId,
        quantity: candidate.quantity,
        pickerUserId: user.id,
      });
    }

    const profitability = await computeLineProfitability(line.id);
    expect(profitability.revenue.toNumber()).toBe(45000);
    expect(profitability.cogs.toNumber()).toBe(28000);
    expect(profitability.grossProfit.toNumber()).toBe(17000);
  });
});

describe("acceptance test #7: two concurrent reservations for the last ten pieces", () => {
  it("only lets quantities that are actually available be reserved", async () => {
    const { bin, product, currency, gradeByCode, user, channel, customer } =
      await seedSalesReferenceData();
    const gradeA = gradeByCode.get("A")!;

    const costLayer = await receiveSaleable({
      productId: product.id,
      binId: bin.id,
      currencyId: currency.id,
      gradeId: gradeA.id,
      unitPrice: 500,
      quantity: 10,
      actorUserId: user.id,
    });

    const order = await createDraftOrder({
      channelId: channel.id,
      customerId: customer.id,
      currencyId: currency.id,
      actorUserId: user.id,
      actorHasPriceOverride: false,
      lines: [
        { productId: product.id, quantity: 10, gradeRequirementType: "none" },
        { productId: product.id, quantity: 10, gradeRequirementType: "none" },
      ],
    });
    const [lineA, lineB] = order.lines;

    const results = await Promise.allSettled([
      reserveStock({
        orderLineId: lineA!.id,
        costLayerId: costLayer.id,
        gradeId: gradeA.id,
        binId: bin.id,
        quantity: 10,
      }),
      reserveStock({
        orderLineId: lineB!.id,
        costLayerId: costLayer.id,
        gradeId: gradeA.id,
        binId: bin.id,
        quantity: 10,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const state = await prisma.stockState.findUniqueOrThrow({
      where: {
        productId_gradeId_binId_costLayerId_state: {
          productId: product.id,
          gradeId: gradeA.id,
          binId: bin.id,
          costLayerId: costLayer.id,
          state: "saleable",
        },
      },
    });
    expect(state.reservedQty.toNumber()).toBe(10);
    expect(state.onHandQty.toNumber()).toBe(10);
  });
});
