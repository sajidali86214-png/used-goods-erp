import { prisma } from "../../lib/prisma.js";
import { Decimal, sumDecimal } from "../../lib/money.js";
import { getFinancialSummary, getInventoryValuation, getExpensesByCategory } from "../reports/reportService.js";
import { getAccountBalance } from "../finance/ledgerService.js";

export async function listInvestors() {
  return prisma.investor.findMany({ include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } });
}

export async function createInvestor(params: { name: string; profitSharePercent: number; profitShareBasis?: string; userId?: string }) {
  return prisma.investor.create({
    data: {
      name: params.name,
      profitSharePercent: new Decimal(params.profitSharePercent),
      profitShareBasis: params.profitShareBasis ?? "operating_result",
      userId: params.userId,
    },
  });
}

export async function updateInvestor(
  id: string,
  params: { name?: string; profitSharePercent?: number; profitShareBasis?: string; userId?: string | null; isActive?: boolean },
) {
  return prisma.investor.update({
    where: { id },
    data: {
      name: params.name,
      profitSharePercent: params.profitSharePercent !== undefined ? new Decimal(params.profitSharePercent) : undefined,
      profitShareBasis: params.profitShareBasis,
      userId: params.userId === undefined ? undefined : params.userId,
      isActive: params.isActive,
    },
  });
}

/** Records a capital movement (contribution/withdrawal) or a profit distribution actually paid out — never implied, always a deliberate entry. */
export async function recordInvestorTransaction(params: {
  investorId: string;
  type: "contribution" | "withdrawal" | "distribution";
  amount: number;
  occurredAt?: Date;
  notes?: string;
}) {
  return prisma.investorTransaction.create({
    data: {
      investorId: params.investorId,
      type: params.type,
      amount: new Decimal(params.amount),
      occurredAt: params.occurredAt ?? new Date(),
      notes: params.notes,
    },
  });
}

export async function listInvestorTransactions(investorId: string) {
  return prisma.investorTransaction.findMany({ where: { investorId }, orderBy: { occurredAt: "desc" } });
}

/** Sum of all PKR-denominated cash/bank account balances — "what's actually there", never confused with a calculated profit share. */
async function totalCashAndBankBalance(): Promise<Decimal> {
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  const accounts = await prisma.account.findMany({ where: { currencyId: pkr.id, kind: { in: ["cash", "bank"] }, isActive: true } });
  const balances = await Promise.all(accounts.map((a) => getAccountBalance(a.id)));
  return sumDecimal(balances);
}

/**
 * Restricted investor portal: current inventory value, profitability for the
 * period, the investor's agreed share and calculated amount, capital
 * movements (contributed/withdrawn/distributed) and the resulting
 * remaining payable, expenses broken down by category, and the business's
 * actual cash/bank position. Every number here reads only posted records
 * (same rule as getFinancialSummary) — never draft/unposted documents, and
 * the calculated share is never presented as cash sitting ready to pay out.
 */
export async function getInvestorDashboard(params: { investorId: string; from?: Date; to?: Date }) {
  const investor = await prisma.investor.findUniqueOrThrow({ where: { id: params.investorId } });

  const [financialSummary, inventoryValuation, expensesByCategory, transactions, cashAndBankBalance] = await Promise.all([
    getFinancialSummary({ from: params.from, to: params.to }),
    getInventoryValuation(),
    getExpensesByCategory({ from: params.from, to: params.to }),
    prisma.investorTransaction.findMany({ where: { investorId: params.investorId } }),
    totalCashAndBankBalance(),
  ]);

  const profitSharePercent = investor.profitSharePercent;
  const profitShareBasisAmount =
    investor.profitShareBasis === "gross_profit" ? financialSummary.grossProfit : financialSummary.operatingResult;
  const profitShareAmount = profitShareBasisAmount.times(profitSharePercent).div(100);

  const totalContributed = sumDecimal(transactions.filter((t) => t.type === "contribution").map((t) => t.amount));
  const totalWithdrawn = sumDecimal(transactions.filter((t) => t.type === "withdrawal").map((t) => t.amount));
  const totalDistributed = sumDecimal(transactions.filter((t) => t.type === "distribution").map((t) => t.amount));
  const remainingPayable = profitShareAmount.minus(totalDistributed);

  return {
    investor: {
      id: investor.id,
      name: investor.name,
      profitSharePercent,
      profitShareBasis: investor.profitShareBasis,
    },
    periodFrom: params.from ?? null,
    periodTo: params.to ?? null,
    profitability: financialSummary,
    profitShareAmount,
    capital: { totalContributed, totalWithdrawn, totalDistributed, remainingPayable },
    currentInventoryValue: inventoryValuation.totalValue,
    expensesByCategory: expensesByCategory.lines,
    totalExpenses: expensesByCategory.total,
    cashAndBankBalance,
  };
}
