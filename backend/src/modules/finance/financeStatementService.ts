import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";

/**
 * Resolves a posted ledger entry's relatedDocumentType/Id into something a
 * human can read on a statement — who it was with, what it was for, which
 * expense/customer/supplier category it falls under. Falls back to a plain
 * "<Type> <id>" label for a document type that isn't posted by name here
 * (e.g. an older/未-wired posting path) rather than failing the whole
 * statement over one unresolved row.
 */
async function describeDocument(type: string, id: string): Promise<{ party: string | null; description: string; category: string | null }> {
  try {
    switch (type) {
      case "Expense": {
        const expense = await prisma.expense.findUnique({ where: { id } });
        if (!expense) break;
        const category = await prisma.expenseCategory.findUnique({ where: { id: expense.categoryId } });
        let party: string | null = null;
        if (expense.payeeType === "supplier" && expense.payeeId) {
          const supplier = await prisma.supplier.findUnique({ where: { id: expense.payeeId } });
          party = supplier?.name ?? null;
        }
        return { party, description: `Expense${category ? `: ${category.label}` : ""}`, category: category?.label ?? null };
      }
      case "PaymentReceipt": {
        const receipt = await prisma.paymentReceipt.findUnique({ where: { id }, include: { allocations: { include: { order: true } } } });
        if (!receipt) break;
        const customer = receipt.customerId ? await prisma.customer.findUnique({ where: { id: receipt.customerId } }) : null;
        const orderNumbers = receipt.allocations.map((a) => a.order.orderNumber).join(", ");
        return {
          party: customer?.name ?? null,
          description: `Customer receipt${orderNumbers ? ` — ${orderNumbers}` : ""}`,
          category: "Customer receipt",
        };
      }
      case "SupplierAdvance": {
        const advance = await prisma.supplierAdvance.findUnique({ where: { id }, include: { supplier: true } });
        if (!advance) break;
        return { party: advance.supplier.name, description: "Supplier advance", category: "Supplier advance" };
      }
      case "SupplierPayment": {
        const payment = await prisma.supplierPayment.findUnique({ where: { id }, include: { supplier: true } });
        if (!payment) break;
        return { party: payment.supplier.name, description: "Supplier payment", category: "Supplier payment" };
      }
      case "Refund": {
        const refund = await prisma.refund.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
        if (!refund) break;
        return { party: refund.order.customer.name, description: `Refund — ${refund.order.orderNumber}`, category: "Refund" };
      }
      case "Transfer": {
        const transfer = await prisma.transfer.findUnique({ where: { id }, include: { fromAccount: true, toAccount: true } });
        if (!transfer) break;
        return {
          party: null,
          description: `Transfer: ${transfer.fromAccount.label} -> ${transfer.toAccount.label}`,
          category: "Internal transfer",
        };
      }
      case "OwnerTransaction": {
        const tx = await prisma.ownerTransaction.findUnique({ where: { id } });
        if (!tx) break;
        return { party: "Owner", description: tx.type === "contribution" ? "Owner contribution" : "Owner withdrawal", category: "Owner equity" };
      }
      case "ShipmentLine": {
        const line = await prisma.shipmentLine.findUnique({
          where: { id },
          include: { orderLine: { include: { order: { include: { customer: true } }, product: true } } },
        });
        if (!line) break;
        return {
          party: line.orderLine.order.customer.name,
          description: `Sale — ${line.orderLine.order.orderNumber} (${line.orderLine.product.skuCode})`,
          category: "Sale",
        };
      }
    }
  } catch {
    // fall through to the generic label below
  }
  return { party: null, description: `${type} ${id.slice(0, 8)}`, category: null };
}

export async function getAccountStatement(params: { accountId: string; from?: Date; to?: Date }) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: params.accountId } });
  const debitNormal = account.nature === "asset" || account.nature === "expense";

  const allEntries = await prisma.ledgerEntry.findMany({
    where: { accountId: params.accountId },
    orderBy: { postedAt: "asc" },
  });

  const before = allEntries.filter((e) => params.from && e.postedAt < params.from);
  const inRange = allEntries.filter((e) => (!params.from || e.postedAt >= params.from) && (!params.to || e.postedAt <= params.to));

  function balanceDelta(entries: typeof allEntries): Decimal {
    const debits = sumDecimal(entries.filter((e) => e.direction === "debit").map((e) => e.amount));
    const credits = sumDecimal(entries.filter((e) => e.direction === "credit").map((e) => e.amount));
    return debitNormal ? debits.minus(credits) : credits.minus(debits);
  }

  const openingBalance = balanceDelta(before);
  let running = openingBalance;

  const lines = [];
  for (const entry of inRange) {
    const signedAmount = debitNormal
      ? entry.direction === "debit"
        ? entry.amount
        : entry.amount.negated()
      : entry.direction === "credit"
        ? entry.amount
        : entry.amount.negated();
    running = running.plus(signedAmount);
    const { party, description, category } = await describeDocument(entry.relatedDocumentType ?? "", entry.relatedDocumentId ?? "");
    lines.push({
      id: entry.id,
      postedAt: entry.postedAt,
      party,
      description,
      category,
      currencyId: entry.currencyId,
      amount: signedAmount,
      sourceDocumentType: entry.relatedDocumentType,
      sourceDocumentId: entry.relatedDocumentId,
      runningBalance: running,
    });
  }

  const moneyIn = sumDecimal(lines.filter((l) => l.amount.greaterThan(0)).map((l) => l.amount));
  const moneyOut = sumDecimal(lines.filter((l) => l.amount.lessThan(0)).map((l) => l.amount.negated()));

  return {
    account: { id: account.id, label: account.label, kind: account.kind, currencyId: account.currencyId },
    periodFrom: params.from ?? null,
    periodTo: params.to ?? null,
    openingBalance,
    closingBalance: running,
    moneyIn,
    moneyOut,
    lines,
  };
}
