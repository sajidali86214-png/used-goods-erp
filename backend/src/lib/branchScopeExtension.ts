import { Prisma } from "@prisma/client";
import { currentBranchId } from "./branchContext.js";

/**
 * Every per-branch model from the multi-branch data-isolation plan. GLOBAL
 * models (Role, Permission, RolePermission, Currency, ExpenseCategory,
 * ReasonCode, AppSetting, IdempotencyKey, Investor, InvestorTransaction,
 * UserRole) are deliberately NOT listed here — scoping them would be
 * meaningless (they're shared across branches by design) or, for UserRole,
 * redundant with scoping User itself.
 */
export const BRANCH_SCOPED_MODELS = new Set([
  "User",
  "ApprovalThreshold",
  "AuditEvent",
  "Approval",
  "Category",
  "Brand",
  "Product",
  "ProductPhoto",
  "Grade",
  "Bin",
  "SalesChannel",
  "PaymentMethodAccount",
  "Supplier",
  "PurchaseOrder",
  "PurchaseOrderLine",
  "SupplierAdvance",
  "SupplierInvoice",
  "SupplierInvoiceLine",
  "SupplierPayment",
  "SupplierCredit",
  "GRN",
  "GRNLine",
  "Lot",
  "LandedCostAllocation",
  "CostLayer",
  "StockMovement",
  "StockState",
  "IndividualItem",
  "StockCount",
  "StockCountLine",
  "MediaAsset",
  "ImportJob",
  "ExchangeRateSnapshot",
  "Customer",
  "SalesOrder",
  "SalesOrderLine",
  "BundleAllocation",
  "Reservation",
  "PickAllocation",
  "Shipment",
  "ShipmentLine",
  "ReturnRequest",
  "ReturnLine",
  "Refund",
  "PaymentReceipt",
  "PaymentAllocation",
  "CurrencyConversion",
  "Cancellation",
  "Account",
  "LedgerEntry",
  "Expense",
  "Transfer",
  "OwnerTransaction",
  "PeriodLock",
]);

/** Prisma client property name (e.g. "gRN") -> canonical schema model name (e.g. "GRN"). */
export const MODEL_NAME_BY_CLIENT_PROPERTY = new Map(
  [...BRANCH_SCOPED_MODELS].map((m) => [m[0]!.toLowerCase() + m.slice(1), m]),
);

const WHERE_FILTER_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

function mergeBranchFilter(where: unknown, branchId: string): Record<string, unknown> {
  const w = { ...(where as Record<string, unknown> | undefined) };
  if (w.branchId !== undefined && w.branchId !== branchId) {
    // Fail loudly, never silently "correct" a caller that explicitly named a
    // different branch — that's a bug to catch in tests, not paper over.
    throw new Error(`branch scope conflict: query specified branchId=${String(w.branchId)}, current branch is ${branchId}`);
  }
  w.branchId = branchId;
  return w;
}

/**
 * Rewrites one operation's args to filter/inject branchId — shared by both
 * enforcement paths: the Prisma Client Extension below (for the ordinary
 * `prisma` client) and the hand-rolled Proxy in transaction.ts (for the
 * interactive-transaction `tx` client, which has no `$extends` of its own —
 * confirmed empirically, not assumed; see transaction.ts's comment).
 */
export function applyBranchScopedArgs(model: string, operation: string, args: unknown, branchId: string): unknown {
  if (!BRANCH_SCOPED_MODELS.has(model)) return args;
  const a = { ...(args as Record<string, unknown> | undefined) };

  if (WHERE_FILTER_OPS.has(operation)) {
    a.where = mergeBranchFilter(a.where, branchId);
  }
  if (operation === "upsert") {
    a.where = mergeBranchFilter(a.where, branchId);
    a.create = { ...(a.create as Record<string, unknown>), branchId };
  }
  if (operation === "create") {
    a.data = { ...(a.data as Record<string, unknown>), branchId };
  }
  if (operation === "createMany") {
    const data = a.data as Record<string, unknown>[] | Record<string, unknown>;
    a.data = Array.isArray(data) ? data.map((row) => ({ ...row, branchId })) : data;
  }
  return a;
}

export function branchScopeExtension() {
  return Prisma.defineExtension({
    name: "branch-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !BRANCH_SCOPED_MODELS.has(model)) return query(args);
          return query(applyBranchScopedArgs(model, operation, args, currentBranchId()) as typeof args);
        },
      },
    },
  });
}
