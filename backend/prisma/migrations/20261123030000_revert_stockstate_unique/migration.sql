-- StockState's uniqueness doesn't need a branchId prefix: every component
-- (costLayerId especially) is already scoped to one branch via its own FK
-- chain, so two branches can never collide on this key. Revert to the
-- original 5-field unique and keep branchId as a plain indexed column.
DROP INDEX "StockState_branchId_productId_gradeId_binId_costLayerId_s_key";
CREATE UNIQUE INDEX "StockState_productId_gradeId_binId_costLayerId_state_key" ON "StockState"("productId", "gradeId", "binId", "costLayerId", "state");
