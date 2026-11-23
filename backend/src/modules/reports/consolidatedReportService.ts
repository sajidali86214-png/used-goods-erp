import { rawPrisma } from "../../lib/prisma.js";
import { runInBranchContext } from "../../lib/branchContext.js";
import { sumDecimal } from "../../lib/money.js";
import { getInventoryValuation, getFinancialSummary, getSupplierBalances } from "./reportService.js";

/**
 * Owner-only, read-only, all-branches-combined views — see
 * "reports.consolidated.view" in permissions.ts and the route guard in
 * reportRoutes.ts. Each function runs the ordinary (unchanged, single-branch)
 * report function once per active branch inside that branch's own narrow
 * context, then combines results in plain code. Deliberately NOT a bypass of
 * the branch-scoping extension — rawPrisma/runInBranchContext are only ever
 * imported here, never threaded into operational code.
 */

export async function getConsolidatedInventoryValuation() {
  const branches = await rawPrisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const perBranch = await Promise.all(
    branches.map((b) =>
      runInBranchContext(b.id, async () => {
        const { totalValue } = await getInventoryValuation();
        return { branchId: b.id, branchName: b.name, totalValue };
      }),
    ),
  );
  return { byBranch: perBranch, combinedTotalValue: sumDecimal(perBranch.map((p) => p.totalValue)) };
}

export async function getConsolidatedFinancialSummary(params: { from?: Date; to?: Date }) {
  const branches = await rawPrisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const perBranch = await Promise.all(
    branches.map((b) =>
      runInBranchContext(b.id, async () => ({
        branchId: b.id,
        branchName: b.name,
        ...(await getFinancialSummary(params)),
      })),
    ),
  );
  return {
    byBranch: perBranch,
    combined: {
      grossSales: sumDecimal(perBranch.map((p) => p.grossSales)),
      netSales: sumDecimal(perBranch.map((p) => p.netSales)),
      cogs: sumDecimal(perBranch.map((p) => p.cogs)),
      grossProfit: sumDecimal(perBranch.map((p) => p.grossProfit)),
      operatingExpenses: sumDecimal(perBranch.map((p) => p.operatingExpenses)),
      operatingResult: sumDecimal(perBranch.map((p) => p.operatingResult)),
      receivables: sumDecimal(perBranch.map((p) => p.receivables)),
      supplierAdvancesOutstanding: sumDecimal(perBranch.map((p) => p.supplierAdvancesOutstanding)),
      unsoldInventoryValue: sumDecimal(perBranch.map((p) => p.unsoldInventoryValue)),
    },
  };
}

export async function getConsolidatedSupplierBalances() {
  const branches = await rawPrisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const perBranch = await Promise.all(
    branches.map((b) =>
      runInBranchContext(b.id, async () => ({
        branchId: b.id,
        branchName: b.name,
        suppliers: await getSupplierBalances(),
      })),
    ),
  );
  return { byBranch: perBranch };
}
