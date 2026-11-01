import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";

interface CreateOrderLineInput {
  productId: string;
  quantity: Decimal | number;
  gradeRequirementType?: "none" | "allowed_set" | "exact_composition";
  allowedGradeIds?: string[];
  exactGradeQuantities?: Record<string, number>;
  unitPrice?: Decimal | number;
}

interface CreateOrderInput {
  orderNumber: string;
  channelId: string;
  customerId: string;
  currencyId: string;
  salespersonUserId?: string;
  lines: CreateOrderLineInput[];
}

/** Creates a draft sales order with its lines. Grade requirement types per spec section 7.2. */
export async function createDraftOrder(input: CreateOrderInput) {
  return prisma.salesOrder.create({
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
