import { prisma } from "../../lib/prisma.js";
import { Decimal } from "../../lib/money.js";
import { getFinancialSummary, getInventoryValuation, getExpensesByCategory } from "../reports/reportService.js";

export async function listInvestors() {
  return prisma.investor.findMany({ include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } });
}

export async function createInvestor(params: { name: string; profitSharePercent: number; userId?: string }) {
  return prisma.investor.create({
    data: {
      name: params.name,
      profitSharePercent: new Decimal(params.profitSharePercent),
      userId: params.userId,
    },
  });
}

export async function updateInvestor(
  id: string,
  params: { name?: string; profitSharePercent?: number; userId?: string | null; isActive?: boolean },
) {
  return prisma.investor.update({
    where: { id },
    data: {
      name: params.name,
      profitSharePercent: params.profitSharePercent !== undefined ? new Decimal(params.profitSharePercent) : undefined,
      userId: params.userId === undefined ? undefined : params.userId,
      isActive: params.isActive,
    },
  });
}

/**
 * Restricted investor portal: current inventory value, profitability for the
 * period, the investor's agreed share and calculated amount, and expenses
 * broken down by category. Every number here reads only posted records
 * (same rule as getFinancialSummary) — never draft/unposted documents.
 */
export async function getInvestorDashboard(params: { investorId: string; from?: Date; to?: Date }) {
  const investor = await prisma.investor.findUniqueOrThrow({ where: { id: params.investorId } });

  const [financialSummary, inventoryValuation, expensesByCategory] = await Promise.all([
    getFinancialSummary({ from: params.from, to: params.to }),
    getInventoryValuation(),
    getExpensesByCategory({ from: params.from, to: params.to }),
  ]);

  const profitSharePercent = investor.profitSharePercent;
  const profitShareAmount = financialSummary.operatingResult.times(profitSharePercent).div(100);

  return {
    investor: { id: investor.id, name: investor.name, profitSharePercent },
    periodFrom: params.from ?? null,
    periodTo: params.to ?? null,
    profitability: financialSummary,
    profitShareAmount,
    currentInventoryValue: inventoryValuation.totalValue,
    expensesByCategory: expensesByCategory.lines,
    totalExpenses: expensesByCategory.total,
  };
}
