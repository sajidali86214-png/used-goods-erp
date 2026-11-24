-- Nullable: PKR orders need no rate, and pre-existing non-PKR orders are
-- left unconverted (excluded from PKR aggregates) until staff set one via
-- PATCH /sales/orders/:id/exchange-rate.
ALTER TABLE "SalesOrder" ADD COLUMN "exchangeRateSnapshotId" TEXT;
