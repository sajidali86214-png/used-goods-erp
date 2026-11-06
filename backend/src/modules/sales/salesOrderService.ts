import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";
import { generateSequentialNumber } from "../../lib/sequentialNumber.js";

export async function generateOrderNumber(): Promise<string> {
  return generateSequentialNumber({
    prefix: "SO",
    countExisting: () => prisma.salesOrder.count(),
    exists: async (candidate) => !!(await prisma.salesOrder.findUnique({ where: { orderNumber: candidate } })),
  });
}

interface CreateOrderLineInput {
  productId: string;
  quantity: Decimal | number;
  gradeRequirementType?: "none" | "allowed_set" | "exact_composition";
  allowedGradeIds?: string[];
  exactGradeQuantities?: Record<string, number>;
  unitPrice?: Decimal | number;
  priceOverrideReason?: string;
  discountType?: "percentage" | "fixed";
  discountValue?: Decimal | number;
}

interface CreateOrderInput {
  channelId: string;
  externalOrderId?: string;
  customerId: string;
  currencyId: string;
  salespersonUserId?: string;
  shippingPerUnit?: Decimal | number;
  commissionType?: "percentage" | "fixed";
  commissionValue?: Decimal | number;
  lines: CreateOrderLineInput[];
  actorUserId: string;
  actorHasPriceOverride: boolean;
}

interface OrderWithLinesForCostSummary {
  shippingPerUnit: Decimal | null;
  commissionType: string | null;
  commissionValue: Decimal | null;
  lines: {
    quantity: Decimal;
    unitPrice: Decimal | null;
    discount: Decimal | null;
    discountType: string | null;
    discountValue: Decimal | null;
  }[];
}

/** A line's discount amount: discountType/discountValue (% or fixed) takes precedence over the legacy flat `discount` field. */
function lineDiscountAmount(line: OrderWithLinesForCostSummary["lines"][number]): Decimal {
  const gross = (line.unitPrice ?? new Decimal(0)).times(line.quantity);
  if (line.discountType === "percentage" && line.discountValue) {
    return gross.times(line.discountValue).dividedBy(100);
  }
  if (line.discountType === "fixed" && line.discountValue) {
    return line.discountValue;
  }
  return line.discount ?? new Decimal(0);
}

/**
 * Derived, display-only totals for a sales order: shipping scales with the
 * total piece count across lines (shippingPerUnit * total quantity), and
 * commission is either a % of the line subtotal or a flat amount. This is
 * separate from the ledger/COGS/profitability engine — it does not post
 * anywhere, it only surfaces what the order is expected to cost/net.
 */
export function computeOrderCostSummary(order: OrderWithLinesForCostSummary) {
  const totalQuantity = order.lines.reduce((sum, l) => sum.plus(l.quantity), new Decimal(0));
  const discountTotal = order.lines.reduce((sum, l) => sum.plus(lineDiscountAmount(l)), new Decimal(0));
  const subtotal = order.lines.reduce(
    (sum, l) => sum.plus((l.unitPrice ?? new Decimal(0)).times(l.quantity)).minus(lineDiscountAmount(l)),
    new Decimal(0),
  );
  const shippingTotal = order.shippingPerUnit ? order.shippingPerUnit.times(totalQuantity) : new Decimal(0);
  // Commission base is the order amount net of shipping — (total amount - shipping) * commission%.
  const commissionBase = subtotal.minus(shippingTotal);
  let commissionAmount = new Decimal(0);
  if (order.commissionType === "percentage" && order.commissionValue) {
    commissionAmount = commissionBase.times(order.commissionValue).dividedBy(100);
  } else if (order.commissionType === "fixed" && order.commissionValue) {
    commissionAmount = order.commissionValue;
  }
  const netTotal = subtotal.minus(shippingTotal).minus(commissionAmount);
  return { totalQuantity, discountTotal, subtotal, shippingTotal, commissionBase, commissionAmount, netTotal };
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

  const orderNumber = await generateOrderNumber();
  const order = await prisma.salesOrder.create({
    data: {
      orderNumber,
      channelId: input.channelId,
      externalOrderId: input.externalOrderId,
      customerId: input.customerId,
      currencyId: input.currencyId,
      salespersonUserId: input.salespersonUserId,
      shippingPerUnit: input.shippingPerUnit !== undefined ? new Decimal(input.shippingPerUnit) : undefined,
      commissionType: input.commissionType,
      commissionValue: input.commissionValue !== undefined ? new Decimal(input.commissionValue) : undefined,
      status: "draft",
      lines: {
        create: input.lines.map((line) => ({
          productId: line.productId,
          quantity: new Decimal(line.quantity),
          gradeRequirementType: line.gradeRequirementType ?? "none",
          allowedGradeIds: line.allowedGradeIds ?? [],
          exactGradeQuantities: line.exactGradeQuantities ?? undefined,
          unitPrice: line.unitPrice !== undefined ? new Decimal(line.unitPrice) : undefined,
          discountType: line.discountType,
          discountValue: line.discountValue !== undefined ? new Decimal(line.discountValue) : undefined,
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
 * Free-form manual status update — no transition rules enforced (e.g. you
 * can mark an order delivered without payment having been recorded yet).
 * Lets staff keep the order's QC/payment/fulfilment labels in sync with
 * reality, including the quick popup amounts (payment received, return
 * pieces/refund, cancellation amount), without going through the detailed
 * reserve/pick/dispatch/finance flow.
 */
export async function updateOrderStatus(
  orderId: string,
  params: {
    qcStatus?: string;
    paymentStatus?: string;
    fulfilmentStatus?: string;
    paymentReceivedAmount?: Decimal | number;
    returnedQuantity?: Decimal | number;
    refundAmount?: Decimal | number;
    cancellationAmount?: Decimal | number;
  },
) {
  return prisma.salesOrder.update({
    where: { id: orderId },
    data: {
      qcStatus: params.qcStatus,
      paymentStatus: params.paymentStatus,
      fulfilmentStatus: params.fulfilmentStatus,
      paymentReceivedAmount: params.paymentReceivedAmount !== undefined ? new Decimal(params.paymentReceivedAmount) : undefined,
      returnedQuantity: params.returnedQuantity !== undefined ? new Decimal(params.returnedQuantity) : undefined,
      refundAmount: params.refundAmount !== undefined ? new Decimal(params.refundAmount) : undefined,
      cancellationAmount: params.cancellationAmount !== undefined ? new Decimal(params.cancellationAmount) : undefined,
    },
  });
}

/**
 * How much of the order's net amount due (after discount/shipping/commission)
 * has actually been received, for the payment popup and summary panel.
 * "Received" prefers the manual paymentReceivedAmount entered via the quick
 * popup; falls back to real PaymentAllocation totals if that's unset, so
 * adopting the full finance flow later doesn't silently double-count.
 */
export async function getOrderPaymentSummary(orderId: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
  const { netTotal } = computeOrderCostSummary(order);
  let amountReceived = order.paymentReceivedAmount;
  if (amountReceived === null) {
    const allocations = await prisma.paymentAllocation.findMany({ where: { orderId } });
    amountReceived = allocations.reduce((sum, a) => sum.plus(a.amount), new Decimal(0));
  }
  return { amountDue: netTotal, amountReceived, outstanding: netTotal.minus(amountReceived) };
}

/**
 * An order can be amended freely up until money has actually been received
 * against it — once paymentStatus leaves "unpaid", the figures customers
 * were charged against need to stay fixed, so edits are blocked from here on.
 */
async function assertOrderIsEditable(orderId: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (order.paymentStatus !== "unpaid") {
    throw new Error(`Order ${order.orderNumber} can no longer be edited — payment has already been received against it`);
  }
  return order;
}

export async function updateOrder(
  orderId: string,
  params: {
    customerId?: string;
    channelId?: string;
    externalOrderId?: string;
    salespersonUserId?: string;
    notes?: string;
    shippingPerUnit?: Decimal | number;
    commissionType?: "percentage" | "fixed" | null;
    commissionValue?: Decimal | number;
  },
) {
  await assertOrderIsEditable(orderId);
  return prisma.salesOrder.update({
    where: { id: orderId },
    data: {
      customerId: params.customerId,
      channelId: params.channelId,
      externalOrderId: params.externalOrderId,
      salespersonUserId: params.salespersonUserId,
      notes: params.notes,
      shippingPerUnit: params.shippingPerUnit !== undefined ? new Decimal(params.shippingPerUnit) : undefined,
      commissionType: params.commissionType,
      commissionValue: params.commissionValue !== undefined ? new Decimal(params.commissionValue) : undefined,
    },
    include: { lines: true },
  });
}

export async function updateOrderLine(
  lineId: string,
  params: {
    quantity?: Decimal | number;
    unitPrice?: Decimal | number;
    discount?: Decimal | number;
    discountType?: "percentage" | "fixed" | null;
    discountValue?: Decimal | number;
    taxesFees?: Decimal | number;
  },
) {
  const line = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: lineId } });
  await assertOrderIsEditable(line.orderId);
  return prisma.salesOrderLine.update({
    where: { id: lineId },
    data: {
      quantity: params.quantity !== undefined ? new Decimal(params.quantity) : undefined,
      unitPrice: params.unitPrice !== undefined ? new Decimal(params.unitPrice) : undefined,
      discount: params.discount !== undefined ? new Decimal(params.discount) : undefined,
      discountType: params.discountType,
      discountValue: params.discountValue !== undefined ? new Decimal(params.discountValue) : undefined,
      taxesFees: params.taxesFees !== undefined ? new Decimal(params.taxesFees) : undefined,
    },
  });
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
