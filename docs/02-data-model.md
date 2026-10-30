# Data Model

Status: DRAFT. This is the entity-relationship design behind `backend/prisma/schema.prisma`. Stage markers show when each entity is first used; all are modeled now so later stages are additive migrations.

## Conventions

- Every table has an immutable `id` (UUID), `createdAt`, `updatedAt`.
- Money fields are `Decimal(18,4)` in the record's native currency, plus a resolved PKR amount where the record crosses currencies.
- Quantities are `Decimal` (not float), non-negative, enforced by CHECK constraints where the DB supports it and by service-layer validation.
- Soft-archive (`archivedAt`, `isActive`) instead of delete, for any master record that can be referenced by a transaction.
- All stock-affecting operations write to `StockMovement`; no table stores an editable "current balance" — balances are materialized views/queries over the ledger, optionally cached and reconciled.

## 1. Identity & access (Stage 1)

- **User**: id, name, email (unique), passwordHash, mfaSecret?, isActive, lastLoginAt.
- **Role**: id, code (owner/manager/receiving/picker/seller/finance/viewer), label, isSystem.
- **UserRole**: userId, roleId (many-to-many — a user may hold multiple roles).
- **Permission**: id, code (e.g. `cost.view`, `price.override`, `refund.approve`, `backdate.create`, `period.reopen`, `user.manage`, `export.data`). See `03-permission-matrix.md`.
- **RolePermission**: roleId, permissionId.
- **ApprovalThreshold**: scope (e.g. discount %, refund amount), roleId, maxValue, requiresSecondApproval(bool).
- **AuditEvent**: actorUserId, action, entityType, entityId, beforeJson, afterJson, reason?, requestId, approvedByUserId?, createdAt. Append-only; no update/delete permission for any role.

## 2. Master/reference data (Stage 1)

- **Category** (self-referencing parent for subcategories): id, name, parentId?, archivedAt?.
- **Product (SKU)**: id, skuCode (unique), name, categoryId, description, unitOfMeasure, brand?, sizeGroup?, material?, defaultSellPrice?, minPrice?, isActive, archivedAt?.
- **ProductPhoto**: productId, mediaAssetId, isRepresentative(bool=true), caption?.
- **Grade**: id, code (A/B/C/UNGRADED + owner-added), label, definition, exampleMediaAssetIds[], archivedAt?.
- **Location/Bin**: id, code, label, archivedAt?. (Single warehouse now; model supports more later.)
- **Currency**: id, code (PKR/GBP/USD/...), symbol, decimalPlaces, isActive.
- **ExchangeRateSnapshot**: fromCurrency, toCurrency(=PKR by convention), rate (PKR per 1 unit foreign), source, capturedAt, isManualOverride(bool), overrideReason?, overrideByUserId?.
- **SalesChannel**: id, code (fleek/local_market/friend/online/instagram/...), label, defaultCommissionPct?, archivedAt?.
- **PaymentMethodAccount**: id, label, currencyId, kind(cash/bank/mobile_wallet), archivedAt?.
- **ExpenseCategory**: id, label, archivedAt?.
- **ReasonCode**: id, kind(cancellation/return/adjustment), label, archivedAt?.

## 3. Suppliers & purchasing (Stage 1)

- **Supplier**: id, name, contactPerson, phone, email, address, categories[], defaultCurrencyId, paymentTerms, bankDetails (restricted field, see permissions), taxDetails?, qualityAgreement?, returnPolicy?, isActive, approvalStatus.
- **PurchaseOrder**: id, poNumber (unique), supplierId, status(draft/approved/cancelled/closed), currencyId, expectedReceiptDate, terms, notes.
- **PurchaseOrderLine**: poId, productId, orderedQty, unitPrice, discount?, additionalCosts?, (received/accepted/rejected/returned/cancelled/outstanding quantities are derived, not stored redundantly except as a materialized reconciliation cache recomputed from GRN lines).
- **SupplierAdvance**: supplierId, poId?, currencyId, amount, paidAt, paymentMethodAccountId, status(open/applied/partially_applied), reference.
- **SupplierInvoice**: supplierId, poId?, currencyId, amount, invoiceDate, matchedAdvanceAmount, status.
- **SupplierPayment**: supplierId, invoiceId?, advanceId?, amount, currencyId, paidAt, paymentMethodAccountId, reference.
- **GRN** (Goods Received Note): id, grnNumber (unique), supplierId, poIds[] (a GRN may close out more than one PO line set), receiptDate, deliveryReference, receivingUserId, notes.
- **GRNLine**: grnId, poLineId?, productId, receivedQty, rejectedQty, inspectionNotes.
- **Lot**: id, lotCode (human-readable, unique), grnLineId? (nullable for opening-stock lots), supplierId?, productId, originalCurrencyId, sourceUnitPrice, exchangeRateSnapshotId, notes, createdAt.
- **LandedCostAllocation**: lotId, costType(freight/handling/other), amount, currencyId, allocationMethod(by_piece/custom), appliedAt, approvedByUserId.
- **CostLayer**: id, lotId, gradeId, bin Id, quantityOriginal, quantityRemaining, unitCost (Decimal, landed), createdAt. — This is the unit that stock valuation and COGS draw from. Grading transfers *split* a cost layer's quantity across new grade-specific cost layers at the *same* unit cost (conservation of quantity and total value); they never change `unitCost` by themselves.

## 4. Stock & movements (Stage 1)

- **StockMovement**: id, type(receive_to_inspection/grading_transfer/bin_transfer/reserve/release/pick/dispatch/return_receipt/return_to_bulk/write_off/count_adjustment/supplier_return_dispatch), productId, gradeId, binId, costLayerId, quantity (signed or paired in/out — modeled as a single signed `quantity` plus `direction` for clarity in reports), sourceRef(type+id), destinationRef(type+id)?, actorUserId, occurredAt, relatedDocumentType, relatedDocumentId.
- **StockState** (derived/materialized, reconciled nightly and on-demand against StockMovement): productId, gradeId, binId, costLayerId, onHandQty, reservedQty, availableQty(=onHand-reserved, never stored independently of the other two), state(inspection/saleable/picking/packed/dispatched/return_inspection/repair/damaged/supplier_return_dispatched).
- **IndividualItem**: id, productId, sourceCostLayerId, gradeId, mediaAssetIds[], status(listed/sold/returned_to_bulk), createdFromMovementId, returnedToMovementId?.
- **StockCount**: id, countDate, binId?, lines[{productId, gradeId, costLayerId, countedQty, systemQty, varianceQty}], status(draft/submitted/approved), approvedByUserId?.

All movement writes happen inside a DB transaction with row-level locking on the affected `(productId, gradeId, binId, costLayerId)` tuple to satisfy "no negative stock" and "no double reservation" (acceptance test #7). Postgres `SELECT ... FOR UPDATE` on the StockState row, or an equivalent optimistic-version check with retry.

## 5. Media (Stage 1)

- **MediaAsset**: id, kind(product/lot/order/individual_item/attachment), storageKey (private bucket), mimeType, sizeBytes, uploadedByUserId, uploadStatus(pending/complete/failed), referencedBy (polymorphic), retentionPolicy.

## 6. Sales (Stage 2, modeled now)

- **Customer**: id, name, contact, address, notes, isActive.
- **SalesOrder**: id, orderNumber, channelId, externalOrderId?, customerId, currencyId, status, paymentStatus, fulfilmentStatus, returnStatus, refundStatus, salespersonUserId, notes.
- **SalesOrderLine**: orderId, productId, gradeRequirementType(none/allowed_set/exact_composition), allowedGradeIds[]/exactGradeQuantities(json), quantity, unitPrice?, bundleTotalPrice?, allocationMethod, discount?, taxesFees?.
- **BundleAllocation**: orderLineId, derivedUnitRevenue, method, approvedOverride(bool).
- **Reservation**: orderLineId, costLayerId, gradeId, binId, quantity, status(provisional/confirmed/released), expiresAt?.
- **PickAllocation**: orderLineId, costLayerId, gradeId, binId, pickedQty, pickerUserId.
- **Shipment**: orderId, courier, trackingRef, dispatchedAt?, deliveredAt?, status, evidenceMediaAssetIds[].
- **ReturnRequest / ReturnLine**: references original SalesOrderLine + dispatch allocation, originGradeId, inspectedGradeId, disposition(resaleable/repair/damaged), originUncertain(bool), assumptionNotes?.
- **Refund**: returnId?, orderId, amount, currencyId, status, paidAt?, paymentMethodAccountId.
- **Cancellation**: orderLineId, qty, reason, feeChargedAmount?, feeBeneficiary, refundDueAmount, approvedByUserId.

## 7. Finance (Stage 2, modeled now)

- **Account**: id, label, currencyId, kind(cash/bank/platform_escrow), balanceIsDerived(always true — computed from ledger entries).
- **LedgerEntry** (double-entry): id, accountId, debit/credit amount, currencyId, relatedDocumentType/id, postedAt, reversalOfId?.
- **Expense**: date, payeeType(supplier/other), payeeId?, categoryId, currencyId, amount, paymentStatus, accountId, receiptMediaAssetId?, relatedOrderId?/relatedLotId?, approvedByUserId.
- **Transfer**: fromAccountId, toAccountId, amount, currencyId — explicitly excluded from revenue/expense reports.
- **OwnerTransaction**: accountId, amount, type(contribution/withdrawal) — excluded from trading P&L.
- **PeriodLock**: periodStart, periodEnd, lockedByUserId, lockedAt, reopenedByUserId?, reopenedAt?, reopenReason?.

## 8. Imports, screenshots, approvals (Stage 1 import tooling now; screenshot flow Stage 3)

- **ImportJob**: id, kind(products/suppliers/opening_stock/...), fileRef, status, allOrNothing(bool=true for transactional docs), resultSummaryJson, errorsJson.
- **ScreenshotExtractionJob** (Stage 3): id, sourceMediaAssetIds[], channelId?, extractedJson, reviewStatus(pending/confirmed/rejected), confirmedDraftOrderId?, duplicateOfJobId?.
- **Approval**: entityType, entityId, requestedByUserId, approvedByUserId?, decision, reason?, isSelfApproval(bool).

## 9. Key invariants enforced at the service layer (not just DB constraints)

1. Grading transfer: `sum(outputQuantities) == inputQuantity` and `sum(outputQuantities * sameUnitCost) == inputQuantity * sameUnitCost` — i.e. unit cost is copied, never recomputed, by grading alone.
2. Landed cost allocation rounding remainder is assigned deterministically (e.g. to the last line by received date) so allocated total == input total exactly.
3. No `StockMovement` may bring any `(productId, gradeId, binId, costLayerId)` balance below zero.
4. `Reservation` + `pick` quantities for an order line can never exceed the order line's ordered quantity; restricted-grade lines reject disallowed `gradeId`s unless an approved amendment exists.
5. `AuditEvent` rows are never updated or deleted by any role, including Owner.
6. Historical `ExchangeRateSnapshot` used by a posted document is never mutated by a later rate refresh.
