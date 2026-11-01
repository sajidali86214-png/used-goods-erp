import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";

interface CreateOrderLineInput {
  productId: string;
  quantity: Decimal | number;
  gradeRequirementType?: "none" | "allowed_set" | "exact_composition";
  allowedGradeIds?: string[];
  exactGradeQuantities?: Record<string, number>;
  unitPrice?: Decimal | number;
  priceOverrideReason?: string;
}

interface CreateOrderInput {
  orderNumber: string;
  channelId: string;
  customerId: string;
  currencyId: string;
  salespersonUserId?: string;
  lines: CreateOrderLineInput[];
  actorUserId: string;
  actorHasPriceOverride: boolean;
}

/**
 * Creates a draft sales order with its lines. Grade requirement types per
 * spec section 7.2. Any line priced below the product's configured
 * `minPrice` is a price override: it requires both the `price.override`
 * permission (checked here, not just hidden in the UI) and a reason, which
 * is recorded as an audit event — matching the permission matrix's
 * "discounts below limits" distinction between Manager/Owner and Seller.
 */
export async function createDraftOrder(input: CreateOrderInput) {
  const overridesNeeded: { lineIndex: number; productId: string; unitPrice: Decimal; minPrice: Decimal; reason?: string }[] = [];

  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i]!;
    if (line.unitPrice === undefined) continue;
    const product = await prisma.product.findUniqueOrThrow({ where: { id: line.productId } });
    if (product.minPrice === null) continue;
    const unitPrice = new Decimal(line.unitPrice);
    if (unitPrice.lessThan(product.minPrice)) {
      overridesNeeded.push({ lineIndex: i, productId: line.productId, unitPrice, minPrice: product.minPrice, reason: line.priceOverrideReason });
    }
  }

  if (overridesNeeded.length > 0 && !input.actorHasPriceOverride) {
    throw new Error("One or more lines are priced below the product's minimum price — requires price.override permission");
  }
  const missingReason = overridesNeeded.find((o) => !o.reason);
  if (missingReason) {
    throw new Error(`Line ${missingReason.lineIndex + 1} is priced below minimum and needs a priceOverrideReason`);
  }

  const order = await prisma.salesOrder.create({
    data: {
      orderNumber: input.orderNumber,
      channelId: input.channelId,
      customerId: input.customerId,
      currencyId: input.currencyId,
      salespersonUserId: input.salespersonUserId,
      status: "draft",
      lines: {
        create: input.lines.map((line) => ({
          productId: line.productId,
          quantity: new Decimal(line.quantity),
          gradeRequirementType: line.gradeRequirementType ?? "none",
          allowedGradeIds: line.allowedGradeIds ?? [],
          exactGradeQuantities: line.exactGradeQuantities ?? undefined,
          unitPrice: line.unitPrice !== undefined ? new Decimal(line.unitPrice) : undefined,
        })),
      },
    },
    include: { lines: true },
  });

  for (const override of overridesNeeded) {
    const createdLine = order.lines[override.lineIndex]!;
    await prisma.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "price_override",
        entityType: "SalesOrderLine",
        entityId: createdLine.id,
        beforeJson: { minPrice: override.minPrice.toString() },
        afterJson: { unitPrice: override.unitPrice.toString() },
        reason: override.reason,
      },
    });
  }

  return order;
}

export async function confirmOrder(orderId: string) {
  return prisma.salesOrder.update({ where: { id: orderId }, data: { status: "confirmed" } });
}

/**
 * Amends a restricted-grade order line to allow an additional grade, with a
 * required audit trail (spec section 7.2: "block disallowed grades unless
 * the requirement is formally amended with an audit trail").
 */
export async function amendGradeRequirement(params: {
  orderLineId: string;
  addAllowedGradeId: string;
  actorUserId: string;
  reason: string;
}) {
  const line = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: params.orderLineId } });

  if (line.gradeRequirementType !== "allowed_set") {
    throw new Error("amendGradeRequirement only applies to allowed_set grade requirements");
  }

  const updated = await prisma.salesOrderLine.update({
    where: { id: params.orderLineId },
    data: { allowedGradeIds: { push: params.addAllowedGradeId } },
  });

  await prisma.auditEvent.create({
    data: {
      actorUserId: params.actorUserId,
      action: "amend_grade_requirement",
      entityType: "SalesOrderLine",
      entityId: params.orderLineId,
      beforeJson: { allowedGradeIds: line.allowedGradeIds },
      afterJson: { allowedGradeIds: updated.allowedGradeIds },
      reason: params.reason,
    },
  });

  return updated;
}
