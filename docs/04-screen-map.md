# Screen Map

Status: DRAFT. Mobile covers all daily operations; Admin Web adds bulk import, reporting, and administration (spec section 1).

## Mobile (React Native / Expo) — Android + iPhone

Bottom nav: **Dashboard · Stock · Purchases · Orders · Finance · Reports · Settings** — items hidden per permission.

- **Dashboard**: on-hand/available/reserved/inspection/damaged summary tiles, pending receipts, unfulfilled orders, overdue deliveries, pending returns/refunds, low-stock alerts.
- **Stock**
  - Product search / SKU list → Product detail (grades on hand, lots, aging)
  - Lot detail (cost layers, grade breakdown, photos)
  - Grading transfer screen (input qty per grade, live conservation check)
  - Bin transfer screen
  - Individual-item: "Separate for individual sale" action + listing photo capture; "Return to bulk" action
  - Stock count entry (scoped to assigned bin)
- **Purchases/Receiving**
  - Supplier list → Supplier detail (balances, advances, POs) — bank details hidden unless permitted
  - PO list/detail, create/approve PO, record supplier advance
  - GRN entry: scan/search product, enter received/accepted/rejected qty against PO line, attach photos, route to inspection or direct grading
- **Orders/Picking**
  - Order list (filter by status/channel), Order detail
  - Create order (manual entry; "Upload screenshot" entry point — Stage 3)
  - Grade requirement selector per line (no ratio / allowed grades / exact composition)
  - Picking screen: suggested allocation, actual grade/lot entry, conservation check against ordered qty
  - Dispatch screen: courier, tracking ref, photos
  - Returns: receive return, inspect, regrade, disposition
  - Refund request (goes to approval queue if over threshold)
- **Finance** (Finance/Owner/Manager roles)
  - Payment entry (supplier/customer), expense entry with receipt photo
  - Fleek GBP receipt + later GBP→PKR conversion entry
  - Reconciliation queue (match statement lines to orders/payments)
- **Reports** (permission-gated)
  - Operational: stock aging, pending receipts/returns
  - Financial: sales, GP, expenses, receivables — hidden entirely from roles without `finance.report.view`
- **Settings**
  - My profile, change password, MFA setup
  - (Owner/Manager only) categories, grades, bins, channels, payment methods, reason codes, users/roles

All forms: autosave draft indicator (Saved/Saving/Pending retry/Failed), explicit "Confirm"/"Post" action separate from autosave, conflict dialog on concurrent edit.

## Admin Web (React)

Everything in mobile, plus:

- **Bulk import/export** per entity (products, suppliers, customers, opening stock, grades, PO lines) via CSV/XLSX template → validate → preview with row errors → confirm.
- **Full reporting suite**: lot report, supplier performance, customer balances, channel sales, expense analysis, cash movement, backup status — with filters (date range, SKU/category, grade, lot, supplier, channel, seller) and CSV/PDF export.
- **User & role administration**: invite users, assign roles, configure `ApprovalThreshold`s, session revocation, deactivate.
- **Audit log viewer** (read-only, searchable).
- **Period lock / reopen** (Owner only).
- **Backup status**: last successful backup time, Drive quota, restore-test history, alerts.
- **Opening-data import wizard** (section 17 go-live flow).

## Explicit non-goals for v1 mobile UI

Offline transaction posting, direct Fleek API integration, and a public storefront are out of scope per spec section 20 — the mobile app assumes normal connectivity and shows a retry state on failure rather than queuing offline writes.
