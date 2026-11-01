-- Hardening: DB-level CHECK constraints for invariants already enforced at
-- the service layer (see docs/02-data-model.md section 9). These are a
-- second line of defense, not a replacement for the application checks —
-- a bug in a future code path would still be caught here instead of
-- silently corrupting stock quantities.

ALTER TABLE "CostLayer"
  ADD CONSTRAINT "CostLayer_quantityOriginal_nonneg" CHECK ("quantityOriginal" >= 0),
  ADD CONSTRAINT "CostLayer_quantityRemaining_nonneg" CHECK ("quantityRemaining" >= 0),
  ADD CONSTRAINT "CostLayer_unitCost_nonneg" CHECK ("unitCost" >= 0);

ALTER TABLE "StockState"
  ADD CONSTRAINT "StockState_onHandQty_nonneg" CHECK ("onHandQty" >= 0),
  ADD CONSTRAINT "StockState_reservedQty_nonneg" CHECK ("reservedQty" >= 0),
  ADD CONSTRAINT "StockState_reservedQty_le_onHand" CHECK ("reservedQty" <= "onHandQty");

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_quantity_nonneg" CHECK ("quantity" >= 0);

ALTER TABLE "PickAllocation"
  ADD CONSTRAINT "PickAllocation_pickedQty_positive" CHECK ("pickedQty" > 0);

ALTER TABLE "ShipmentLine"
  ADD CONSTRAINT "ShipmentLine_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "SalesOrderLine"
  ADD CONSTRAINT "SalesOrderLine_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_quantity_positive" CHECK ("quantity" > 0);
