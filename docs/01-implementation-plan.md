# Implementation Plan

Status: DRAFT — for owner review before Stage 1 code is treated as final.

## 0. Guiding constraints (from spec v1.0)

- Draft vs posted records are always separate; nothing (screenshot, autosave, retried request) can post a transaction on its own.
- All backend business rules and permissions are enforced server-side, never only in UI.
- Stock is a movement ledger, not an editable balance. Money is decimal, never float.
- No feature is "done" with mock data, placeholder buttons, or untested integrations.

## 1. Technology choices

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js 22 LTS + TypeScript, Fastify | Typed, fast to iterate, same language as mobile/admin, huge ecosystem for a 3-person team to later hire into. |
| Database | PostgreSQL (managed, e.g. Render/Neon/Supabase Postgres) | Transactional relational DB with point-in-time recovery, decimal types, row-level locking for concurrency-safe reservations. |
| ORM/migrations | Prisma | Explicit migrations, type-safe queries, good fit for a ledger-style schema. |
| Object storage | S3-compatible private bucket (e.g. Cloudflare R2 or AWS S3), signed URLs | Private media, cheap, works for photos/videos/attachments. |
| Admin web | React + TypeScript + Vite | Fast bulk-entry forms, reporting, admin tasks. |
| Mobile | React Native + Expo (TypeScript), shared with admin via a common API client package | One codebase for Android + iPhone; Expo simplifies build/distribution for a small team. |
| Auth | Backend-issued JWT access + refresh tokens, argon2 password hashing, per-role scopes checked server-side | Named accounts, no shared logins, MFA for privileged roles. |
| Backups | Managed DB PITR + nightly encrypted export job to a business-owned Google Drive folder (service account, restricted) | Matches spec section 16 targets. |
| Money/currency | `Decimal` (Prisma `Decimal` / `decimal.js`), stored as fixed-point; never native float | Prevents rounding bugs in landed cost, allocations. |

These are implementation decisions per section 1 of the spec and can be revisited; they do not change the data model or business rules below.

## 2. Monorepo layout

```
used-goods-erp/
  docs/                 planning docs (this folder)
  backend/              Fastify + Prisma API (source of truth for all business rules)
  admin-web/            React admin/web app
  mobile/               Expo React Native app
```

A shared `@erp/api-types` or OpenAPI-generated client should eventually be factored out of backend/admin-web/mobile; deferred until Stage 2 to avoid premature abstraction.

## 3. Stages (per spec section 20)

### Stage 1 — Inventory & purchasing foundation — DONE
- Data model, migrations, seed data. ✅
- Auth, roles/permissions matrix enforced server-side. ✅
- Master data: categories, products/SKUs, grades, bins, suppliers, currencies. ✅ (schema; admin UI not built)
- Purchasing: POs, supplier advances, GRNs (partial/multiple receipts validated against outstanding ordered qty), invoice-to-advance matching, lots, cost layers, landed-cost allocation. ✅ Acceptance test #3.
- Stock movement ledger (receiving, grading transfer, write-off) with no-negative-stock and concurrency-safe updates (SERIALIZABLE + retry). ✅ Acceptance tests #1, #2.
- Individual-item transfer (separate for sale / return to bulk). ✅ Acceptance test #8.
- Stock counts with approval-gated variance posting. ✅ Acceptance test #18.
- Bulk import validation (all-or-nothing by default, no silent partial documents, no duplicate SKUs). ✅ Acceptance test #17 — built for products; not yet wired up for suppliers/customers/opening-stock (section 17's go-live flow).
- Idempotency-Key middleware so a retried request never double-posts. ✅ Acceptance test #15.
- Encrypted DB backup + isolated restore test (pg_dump → AES-256-GCM → checksum → restore into a throwaway DB, verified). ✅ Acceptance test #20, database half. Google Drive upload and media backup need a real owner-provisioned service account — **not built**, see `docs/05-decisions-needed.md`.
- Audit log exists and is used for grade-requirement amendments; **not yet wired into every sensitive mutation**.

### Stage 2 — Sales, fulfilment, finance, currency — core flow DONE, dashboards/ledger-posting not started
- Sales orders with mixed/restricted/exact-composition grade requirements. ✅ Acceptance tests #4, #5.
- FIFO reservation suggestion + SERIALIZABLE reserve/release, safe under concurrency. ✅ Acceptance test #7.
- Picking (actual composition, grade-restriction enforcement, audited amendment). ✅ Acceptance test #5.
- Profitability from actual picked cost layers. ✅ Acceptance test #6.
- Partial dispatch + cancellation of the unshipped remainder. ✅ Acceptance test #9.
- Returns with inspection-time regrading (cost basis conserved) + partial refunds. ✅ Acceptance test #10.
- Origin-uncertain return handling with a required documented assumption. ✅ Acceptance test #11.
- Currency: locked exchange-rate snapshots (append-only, never rewritten), customer receipts (partial, many-to-many order allocation), separate GBP→PKR conversion event. ✅ Acceptance tests #12, #13.
- Bundle total price and shared discount/shipping allocation, exact deterministic-remainder reconciliation. ✅ Acceptance test #19.
- All of the above are reachable through real, RBAC-gated HTTP routes (`/sales/*`, `/finance/*`, `/purchasing/*`, `/stock/*`, `/imports/*`), not just service functions.
- Finance ledger: `Account`/`LedgerEntry`/`Expense`/`Transfer`/`OwnerTransaction`/`PeriodLock` tables exist; **no posting logic, reconciliation, or period-lock enforcement yet** — deliberately not built: spec section 11 wants accountant sign-off on posting triggers (when revenue recognizes, etc.) before this is built.
- Dashboards and reports — **not started**.

39 backend tests passing against a real PostgreSQL database as of this update (see `backend/README.md` for the exact list and known limitations). 17 of the spec's 20 acceptance tests are covered; the only one not attempted is #14 (screenshot-assisted drafts), deliberately deferred to Stage 3 since it needs a real, owner-approved OCR/extraction service (spec section 21 explicitly warns against assuming one is free or already connected).

### Stage 3 — Screenshot-assisted drafts, scanning/labels, polish
- Screenshot-to-draft extraction (explicitly untrusted input, human confirmation required before posting).
- Optional QR/barcode printing and phone-camera scanning.
- Reporting refinements, usability passes.

This sequencing is per spec section 20: it does not permit omitting any requirement — Stage 2/3 items are deferred, not dropped.

## 4. What "done" means for Stage 1

A Stage 1 item is complete only when:
1. It has a Prisma migration applied to a real Postgres database (not just a schema file).
2. It has at least one automated test exercising the business rule (e.g. grading conservation, no-double-reservation-equivalent locking pattern).
3. It is reachable through a real HTTP endpoint with server-side permission checks — not a UI mock.

## 5. Known gaps to resolve with the owner before production (section 21)

Tracked in `docs/05-decisions-needed.md`. Nothing here blocks starting Stage 1 code, but these must be settled before go-live:
hosting/service budget, mobile distribution (Apple Developer + Google Play accounts owned by the business), exact grade definitions, mixed-grade picking policy, accounting/tax treatment, return/refund approval limits, invoice numbering, notification channel, media retention limits, measured backup/recovery numbers.

## 6. Immediate next actions in this session

1. Write data model (`02-data-model.md`) and permission matrix (`03-permission-matrix.md`) and screen map (`04-screen-map.md`).
2. Scaffold `backend/` with Prisma schema covering all Stage 1 + forward-compatible Stage 2/3 entities (section 18), so later stages are additive migrations, not reshuffles.
3. Implement receiving → grading → lot/cost-layer flow with a passing automated test for acceptance tests #1 and #2.
4. Implement RBAC middleware and an audit log, with a test proving a Picker role is denied cost/profit data (acceptance test #16).
5. Scaffold `admin-web/` and `mobile/` as minimal, honestly-labeled skeletons (not claimed feature-complete).
