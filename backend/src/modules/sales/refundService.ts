import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";

export async function createRefund(params: {
  orderId: string;
  returnRequestId?: string;
  amount: Decimal | number;
  currencyId: string;
}) {
  return prisma.refund.create({
    data: {
      orderId: params.orderId,
      returnRequestId: params.returnRequestId,
      amount: new Decimal(params.amount),
      currencyId: params.currencyId,
      status: "pending",
    },
  });
}

export async function markRefundPaid(refundId: string, paymentMethodAccountId: string) {
  return prisma.refund.update({
    where: { id: refundId },
    data: { status: "refunded", paidAt: new Date(), paymentMethodAccountId },
  });
}

/** Sum of refunded amounts so far for an order, for "partial refund" reconciliation. */
export async function totalRefundedForOrder(orderId: string): Promise<Decimal> {
  const refunds = await prisma.refund.findMany({ where: { orderId, status: "refunded" } });
  return sumDecimal(refunds.map((r) => r.amount));
}
