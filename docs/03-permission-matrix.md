# Permission Matrix

Status: DRAFT. Enforced server-side in `backend/src/middleware/rbac.ts` against the permission codes below — the UI only hides actions a role can't take; the API is the real gate (acceptance test #16).

A user may hold multiple roles; effective permission = union across roles. Owner implicitly has all permissions and cannot be locked out by permission edits.

## Permission codes

| Code | Meaning |
|---|---|
| `stock.receive` | Create GRNs, receive into inspection |
| `stock.grade` | Perform grading transfers |
| `stock.transfer` | Bin transfers |
| `stock.count` | Submit stock counts |
| `stock.count.approve` | Approve count variances |
| `stock.writeoff` | Post damage/write-off adjustments |
| `cost.view` | View purchase cost, landed cost, cost layers |
| `profit.view` | View gross profit, margin, profitability reports |
| `price.override` | Set a price/discount below the configured floor |
| `order.create` | Create/confirm sales orders |
| `order.pick` | Perform picking, record actual grade composition |
| `order.grade_amend` | Amend a restricted-grade requirement with audit trail |
| `order.dispatch` | Mark shipments dispatched/delivered |
| `return.process` | Receive and inspect returns |
| `refund.create` | Create a refund request |
| `refund.approve` | Approve a refund (subject to `ApprovalThreshold`) |
| `finance.payment` | Record supplier/customer payments, advances |
| `finance.expense` | Enter expenses |
| `finance.reconcile` | Bank/platform statement reconciliation |
| `finance.report.view` | View financial dashboards |
| `supplier.payment_details.view` | View supplier bank/payment details |
| `backdate.create` | Create a transaction dated in a prior period |
| `period.reopen` | Reopen a locked period |
| `export.data` | Bulk export of records |
| `user.manage` | Create/deactivate users, assign roles |
| `settings.manage` | Edit master/reference data (categories, grades, channels, etc.) |
| `audit.view` | Read audit log |

## Role → permission defaults

| Permission | Owner | Manager | Receiving | Picker/Packer | Seller | Finance | Viewer/Auditor |
|---|---|---|---|---|---|---|---|
| stock.receive | ✓ | ✓ | ✓ | | | | |
| stock.grade | ✓ | ✓ | ✓ | | | | |
| stock.transfer | ✓ | ✓ | ✓ | | | | |
| stock.count | ✓ | ✓ | ✓ | ✓ | | | |
| stock.count.approve | ✓ | ✓ | | | | | |
| stock.writeoff | ✓ | ✓ | | | | | |
| cost.view | ✓ | ✓ | | | | ✓ | view-only if granted |
| profit.view | ✓ | ✓ | | | | ✓ | view-only if granted |
| price.override | ✓ | ✓ | | | within configured limit | | |
| order.create | ✓ | ✓ | | | ✓ | | |
| order.pick | ✓ | ✓ | | ✓ | | | |
| order.grade_amend | ✓ | ✓ | | | | | |
| order.dispatch | ✓ | ✓ | | ✓ | | | |
| return.process | ✓ | ✓ | ✓ | | | | |
| refund.create | ✓ | ✓ | | | ✓ | ✓ | |
| refund.approve | ✓ | ✓ (within threshold) | | | | | |
| finance.payment | ✓ | ✓ | | | | ✓ | |
| finance.expense | ✓ | ✓ | | | | ✓ | |
| finance.reconcile | ✓ | | | | | ✓ | |
| finance.report.view | ✓ | ✓ | | | | ✓ | view-only if granted |
| supplier.payment_details.view | ✓ | | | | | ✓ | |
| backdate.create | ✓ | ✓ (logged) | | | | ✓ (logged) | |
| period.reopen | ✓ | | | | | | |
| export.data | ✓ | ✓ | | | | ✓ | view-only if granted |
| user.manage | ✓ | | | | | | |
| settings.manage | ✓ | ✓ | | | | | |
| audit.view | ✓ | ✓ | | | | | ✓ |

Notes:
- Owner self-approving a refund/threshold must still write an `Approval` row with `isSelfApproval = true` — never silently skipped (spec section 13).
- "Viewer/auditor" permissions are read-only and must be explicitly granted per report; default is no access until configured.
- A Picker must be denied `cost.view` and `profit.view` even if they can see the product and order they're picking — this is acceptance test #16 and should have a dedicated integration test.
