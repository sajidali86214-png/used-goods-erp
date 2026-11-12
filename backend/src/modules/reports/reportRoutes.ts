import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../middleware/rbac.js";
import {
  getStockSummary,
  getInventoryValuation,
  getInventoryValueByCategory,
  getPendingReceipts,
  getUnfulfilledOrders,
  getPendingReturns,
  getPendingRefunds,
  getFinancialSummary,
  getStockAging,
  getSupplierBalances,
  getCustomerBalances,
  getStockLevelsByProduct,
  getProductStockDetail,
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
  app.get("/reports/stock-aging", { preHandler: requirePermission("stock.count") }, async () => getStockAging());
  app.get(
    "/reports/stock-by-product",
    { preHandler: requirePermission("stock.count") },
    async () => getStockLevelsByProduct(),
  );
  app.get(
    "/reports/stock-by-product/:id",
    { preHandler: requirePermission("stock.count") },
    async (request) => {
      const { id } = request.params as { id: string };
      return getProductStockDetail(id);
    },
  );

  // Financial dashboard — cost/profit-gated, never visible to a picker.
  app.get(
    "/reports/inventory-valuation",
    { preHandler: requirePermission("cost.view") },
    async () => getInventoryValuation(),
  );
  app.get(
    "/reports/inventory-by-category",
    { preHandler: requirePermission("cost.view") },
    async () => getInventoryValueByCategory(),
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
  app.get(
    "/reports/supplier-balances",
    { preHandler: requirePermission("supplier.payment_details.view") },
    async () => getSupplierBalances(),
  );
  app.get(
    "/reports/customer-balances",
    { preHandler: requirePermission("profit.view") },
    async () => getCustomerBalances(),
  );
}
