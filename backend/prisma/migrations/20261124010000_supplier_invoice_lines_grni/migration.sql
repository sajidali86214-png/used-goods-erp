-- Phase 1 of the finance redesign: three-way match (PO vs GRN vs invoice)
-- needs line-level invoice detail, plus an approval lifecycle distinct from
-- the existing advance-match `status` field.

ALTER TABLE "SupplierInvoice" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "SupplierInvoice" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'pending_approval';
ALTER TABLE "SupplierInvoice" ADD COLUMN "approvedByUserId" TEXT;
ALTER TABLE "SupplierInvoice" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "SupplierInvoice" ADD COLUMN "hasVariance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SupplierInvoice" ADD COLUMN "isDisputed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "invoiceId" TEXT NOT NULL,
    "grnLineId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "varianceNotes" TEXT,
    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierInvoiceLine_branchId_idx" ON "SupplierInvoiceLine"("branchId");

ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_grnLineId_fkey" FOREIGN KEY ("grnLineId") REFERENCES "GRNLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
