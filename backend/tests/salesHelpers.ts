import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { Decimal } from "../src/lib/money.js";
import { receiveToInspection, gradeTransfer } from "../src/modules/stock/stockService.js";
import { seedReferenceData } from "./helpers.js";

/** Receives a lot and immediately grades the full quantity into one saleable grade. Returns the resulting cost layer. */
export async function receiveSaleable(params: {
  productId: string;
  binId: string;
  currencyId: string;
  gradeId: string;
  unitPrice: number;
  quantity: number;
  actorUserId: string;
}) {
  const { costLayer } = await receiveToInspection({
    productId: params.productId,
    originalCurrencyId: params.currencyId,
    sourceUnitPrice: params.unitPrice,
    exchangeRate: 1,
    quantity: params.quantity,
    binId: params.binId,
    lotCode: `LOT-${randomUUID()}`,
    actorUserId: params.actorUserId,
  });

  const { created } = await gradeTransfer({
    sourceCostLayerId: costLayer.id,
    splits: [{ gradeId: params.gradeId, binId: params.binId, quantity: params.quantity }],
    actorUserId: params.actorUserId,
    destinationState: "saleable",
  });

  return created[0]!;
}

export async function seedSalesReferenceData() {
  const base = await seedReferenceData();

  const channel = await prisma.salesChannel.upsert({
    where: { code: "local_market" },
    update: {},
    create: { code: "local_market", label: "Local market" },
  });

  const customer = await prisma.customer.create({
    data: { name: `Customer-${randomUUID()}` },
  });

  return { ...base, channel, customer };
}

export { Decimal };
