import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../middleware/rbac.js";
import {
  getStockSummary,
  getInventoryValuation,
  getPendingReceipts,
  getUnfulfilledOrders,
  getPendingReturns,
  getPendingRefunds,
  getFinancialSummary,
} from "./reportService.js";

export async function reportRoutes(app: FastifyInstance) {
  // Operational dashboard — broadly available to operational roles.
  app.get("/reports/stock-summary", { preHandler: requirePermission("stock.count") }, async () => getStockSummary());
  app.get(
    "/reports/pending-receipts",
    { preHandler: requirePermission("stock.receive") },
    async () => getPendingReceipts(),
  );
  app.get("/reports/unfulfilled-orders", { preHandler: requirePermission("order.pick") }, async () =>
    getUnfulfilledOrders(),
  );
  app.get("/reports/pending-returns", { preHandler: requirePermission("return.process") }, async () =>
    getPendingReturns(),
  );
  app.get("/reports/pending-refunds", { preHandler: requirePermission("refund.create") }, async () =>
    getPendingRefunds(),
  );

  // Financial dashboard — cost/profit-gated, never visible to a picker.
  app.get(
    "/reports/inventory-valuation",
    { preHandler: requirePermission("cost.view") },
    async () => getInventoryValuation(),
  );
  app.get(
    "/reports/financial-summary",
    { preHandler: requirePermission("profit.view") },
    async (request) => {
      const { from, to } = request.query as { from?: string; to?: string };
      return getFinancialSummary({
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      });
    },
  );
}
