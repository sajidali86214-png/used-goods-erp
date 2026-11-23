-- Step 1: add Branch, add branchId (nullable) to every per-branch table, backfill to
-- one "Main Branch", then replace single-column unique constraints/indexes with
-- branchId-prefixed composites. branchId is NOT yet NOT NULL / FK-constrained —
-- see the immediately-following migration for that.

CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

INSERT INTO "Branch" ("id", "name", "code", "isActive", "createdAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Main Branch', 'MAIN', true, CURRENT_TIMESTAMP);

ALTER TABLE "User" ADD COLUMN "branchId" TEXT;
ALTER TABLE "ApprovalThreshold" ADD COLUMN "branchId" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Approval" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Category" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Brand" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Product" ADD COLUMN "branchId" TEXT;
ALTER TABLE "ProductPhoto" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Grade" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Bin" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SalesChannel" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PaymentMethodAccount" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SupplierAdvance" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SupplierInvoice" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SupplierCredit" ADD COLUMN "branchId" TEXT;
ALTER TABLE "GRN" ADD COLUMN "branchId" TEXT;
ALTER TABLE "GRNLine" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Lot" ADD COLUMN "branchId" TEXT;
ALTER TABLE "LandedCostAllocation" ADD COLUMN "branchId" TEXT;
ALTER TABLE "CostLayer" ADD COLUMN "branchId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN "branchId" TEXT;
ALTER TABLE "StockState" ADD COLUMN "branchId" TEXT;
ALTER TABLE "IndividualItem" ADD COLUMN "branchId" TEXT;
ALTER TABLE "StockCount" ADD COLUMN "branchId" TEXT;
ALTER TABLE "StockCountLine" ADD COLUMN "branchId" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "branchId" TEXT;
ALTER TABLE "ImportJob" ADD COLUMN "branchId" TEXT;
ALTER TABLE "ExchangeRateSnapshot" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "branchId" TEXT;
ALTER TABLE "SalesOrderLine" ADD COLUMN "branchId" TEXT;
ALTER TABLE "BundleAllocation" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PickAllocation" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Shipment" ADD COLUMN "branchId" TEXT;
ALTER TABLE "ShipmentLine" ADD COLUMN "branchId" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN "branchId" TEXT;
ALTER TABLE "ReturnLine" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Refund" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PaymentReceipt" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PaymentAllocation" ADD COLUMN "branchId" TEXT;
ALTER TABLE "CurrencyConversion" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Cancellation" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Account" ADD COLUMN "branchId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Transfer" ADD COLUMN "branchId" TEXT;
ALTER TABLE "OwnerTransaction" ADD COLUMN "branchId" TEXT;
ALTER TABLE "PeriodLock" ADD COLUMN "branchId" TEXT;

UPDATE "User" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "ApprovalThreshold" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "AuditEvent" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Approval" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Category" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Brand" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Product" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "ProductPhoto" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Grade" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Bin" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "SalesChannel" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "PaymentMethodAccount" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Supplier" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "PurchaseOrder" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "PurchaseOrderLine" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "SupplierAdvance" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "SupplierInvoice" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "SupplierPayment" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "SupplierCredit" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "GRN" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "GRNLine" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Lot" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "LandedCostAllocation" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "CostLayer" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "StockMovement" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "StockState" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "IndividualItem" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "StockCount" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "StockCountLine" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "MediaAsset" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "ImportJob" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "ExchangeRateSnapshot" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Customer" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "SalesOrder" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "SalesOrderLine" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "BundleAllocation" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Reservation" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "PickAllocation" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Shipment" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "ShipmentLine" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "ReturnRequest" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "ReturnLine" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Refund" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "PaymentReceipt" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "PaymentAllocation" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "CurrencyConversion" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Cancellation" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Account" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "LedgerEntry" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Expense" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "Transfer" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "OwnerTransaction" SET "branchId" = '00000000-0000-0000-0000-000000000001';
UPDATE "PeriodLock" SET "branchId" = '00000000-0000-0000-0000-000000000001';

-- Replace single-column unique constraints with branchId-prefixed composites.
DROP INDEX "Product_skuCode_key";
CREATE UNIQUE INDEX "Product_branchId_skuCode_key" ON "Product"("branchId", "skuCode");

DROP INDEX "Category_name_key";
CREATE UNIQUE INDEX "Category_branchId_name_key" ON "Category"("branchId", "name");

DROP INDEX "Brand_name_key";
CREATE UNIQUE INDEX "Brand_branchId_name_key" ON "Brand"("branchId", "name");

DROP INDEX "Bin_code_key";
CREATE UNIQUE INDEX "Bin_branchId_code_key" ON "Bin"("branchId", "code");

DROP INDEX "Grade_code_key";
CREATE UNIQUE INDEX "Grade_branchId_code_key" ON "Grade"("branchId", "code");

DROP INDEX "SalesChannel_code_key";
CREATE UNIQUE INDEX "SalesChannel_branchId_code_key" ON "SalesChannel"("branchId", "code");

DROP INDEX "PurchaseOrder_poNumber_key";
CREATE UNIQUE INDEX "PurchaseOrder_branchId_poNumber_key" ON "PurchaseOrder"("branchId", "poNumber");

DROP INDEX "GRN_grnNumber_key";
CREATE UNIQUE INDEX "GRN_branchId_grnNumber_key" ON "GRN"("branchId", "grnNumber");

DROP INDEX "Lot_lotCode_key";
CREATE UNIQUE INDEX "Lot_branchId_lotCode_key" ON "Lot"("branchId", "lotCode");

DROP INDEX "SalesOrder_orderNumber_key";
CREATE UNIQUE INDEX "SalesOrder_branchId_orderNumber_key" ON "SalesOrder"("branchId", "orderNumber");

DROP INDEX "Account_code_key";
CREATE UNIQUE INDEX "Account_branchId_code_key" ON "Account"("branchId", "code");

DROP INDEX "StockState_productId_gradeId_binId_costLayerId_state_key";
CREATE UNIQUE INDEX "StockState_branchId_productId_gradeId_binId_costLayerId_s_key" ON "StockState"("branchId", "productId", "gradeId", "binId", "costLayerId", "state");

-- Replace plain indexes with branchId-prefixed versions.
DROP INDEX "AuditEvent_entityType_entityId_idx";
CREATE INDEX "AuditEvent_branchId_entityType_entityId_idx" ON "AuditEvent"("branchId", "entityType", "entityId");

DROP INDEX "CostLayer_lotId_gradeId_binId_idx";
CREATE INDEX "CostLayer_branchId_lotId_gradeId_binId_idx" ON "CostLayer"("branchId", "lotId", "gradeId", "binId");

DROP INDEX "LedgerEntry_accountId_postedAt_idx";
CREATE INDEX "LedgerEntry_branchId_accountId_postedAt_idx" ON "LedgerEntry"("branchId", "accountId", "postedAt");

DROP INDEX "Reservation_costLayerId_status_idx";
CREATE INDEX "Reservation_branchId_costLayerId_status_idx" ON "Reservation"("branchId", "costLayerId", "status");

DROP INDEX "SalesOrder_channelId_externalOrderId_idx";
CREATE INDEX "SalesOrder_branchId_channelId_externalOrderId_idx" ON "SalesOrder"("branchId", "channelId", "externalOrderId");

DROP INDEX "SalesOrderLine_bundleGroupId_idx";
CREATE INDEX "SalesOrderLine_branchId_bundleGroupId_idx" ON "SalesOrderLine"("branchId", "bundleGroupId");

DROP INDEX "StockMovement_productId_gradeId_binId_costLayerId_idx";
CREATE INDEX "StockMovement_branchId_productId_gradeId_binId_costLayerId_idx" ON "StockMovement"("branchId", "productId", "gradeId", "binId", "costLayerId");

-- Plain branchId index on every other per-branch table.
CREATE INDEX "User_branchId_idx" ON "User"("branchId");
CREATE INDEX "ApprovalThreshold_branchId_idx" ON "ApprovalThreshold"("branchId");
CREATE INDEX "Approval_branchId_idx" ON "Approval"("branchId");
CREATE INDEX "Category_branchId_idx" ON "Category"("branchId");
CREATE INDEX "Brand_branchId_idx" ON "Brand"("branchId");
CREATE INDEX "Product_branchId_idx" ON "Product"("branchId");
CREATE INDEX "ProductPhoto_branchId_idx" ON "ProductPhoto"("branchId");
CREATE INDEX "Grade_branchId_idx" ON "Grade"("branchId");
CREATE INDEX "Bin_branchId_idx" ON "Bin"("branchId");
CREATE INDEX "SalesChannel_branchId_idx" ON "SalesChannel"("branchId");
CREATE INDEX "PaymentMethodAccount_branchId_idx" ON "PaymentMethodAccount"("branchId");
CREATE INDEX "Supplier_branchId_idx" ON "Supplier"("branchId");
CREATE INDEX "PurchaseOrder_branchId_idx" ON "PurchaseOrder"("branchId");
CREATE INDEX "PurchaseOrderLine_branchId_idx" ON "PurchaseOrderLine"("branchId");
CREATE INDEX "SupplierAdvance_branchId_idx" ON "SupplierAdvance"("branchId");
CREATE INDEX "SupplierInvoice_branchId_idx" ON "SupplierInvoice"("branchId");
CREATE INDEX "SupplierPayment_branchId_idx" ON "SupplierPayment"("branchId");
CREATE INDEX "SupplierCredit_branchId_idx" ON "SupplierCredit"("branchId");
CREATE INDEX "GRN_branchId_idx" ON "GRN"("branchId");
CREATE INDEX "GRNLine_branchId_idx" ON "GRNLine"("branchId");
CREATE INDEX "Lot_branchId_idx" ON "Lot"("branchId");
CREATE INDEX "LandedCostAllocation_branchId_idx" ON "LandedCostAllocation"("branchId");
CREATE INDEX "StockState_branchId_idx" ON "StockState"("branchId");
CREATE INDEX "IndividualItem_branchId_idx" ON "IndividualItem"("branchId");
CREATE INDEX "StockCount_branchId_idx" ON "StockCount"("branchId");
CREATE INDEX "StockCountLine_branchId_idx" ON "StockCountLine"("branchId");
CREATE INDEX "MediaAsset_branchId_idx" ON "MediaAsset"("branchId");
CREATE INDEX "ImportJob_branchId_idx" ON "ImportJob"("branchId");
CREATE INDEX "ExchangeRateSnapshot_branchId_idx" ON "ExchangeRateSnapshot"("branchId");
CREATE INDEX "Customer_branchId_idx" ON "Customer"("branchId");
CREATE INDEX "BundleAllocation_branchId_idx" ON "BundleAllocation"("branchId");
CREATE INDEX "PickAllocation_branchId_idx" ON "PickAllocation"("branchId");
CREATE INDEX "Shipment_branchId_idx" ON "Shipment"("branchId");
CREATE INDEX "ShipmentLine_branchId_idx" ON "ShipmentLine"("branchId");
CREATE INDEX "ReturnRequest_branchId_idx" ON "ReturnRequest"("branchId");
CREATE INDEX "ReturnLine_branchId_idx" ON "ReturnLine"("branchId");
CREATE INDEX "Refund_branchId_idx" ON "Refund"("branchId");
CREATE INDEX "PaymentReceipt_branchId_idx" ON "PaymentReceipt"("branchId");
CREATE INDEX "PaymentAllocation_branchId_idx" ON "PaymentAllocation"("branchId");
CREATE INDEX "CurrencyConversion_branchId_idx" ON "CurrencyConversion"("branchId");
CREATE INDEX "Cancellation_branchId_idx" ON "Cancellation"("branchId");
CREATE INDEX "Account_branchId_idx" ON "Account"("branchId");
CREATE INDEX "Expense_branchId_idx" ON "Expense"("branchId");
CREATE INDEX "Transfer_branchId_idx" ON "Transfer"("branchId");
CREATE INDEX "OwnerTransaction_branchId_idx" ON "OwnerTransaction"("branchId");
CREATE INDEX "PeriodLock_branchId_idx" ON "PeriodLock"("branchId");
