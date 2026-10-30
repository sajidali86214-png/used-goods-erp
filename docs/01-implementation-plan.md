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

### Stage 1 — Inventory & purchasing foundation (THIS SESSION starts here)
- Data model, migrations, seed data.
- Auth, roles/permissions matrix enforced server-side.
- Master data: categories, products/SKUs, grades, bins, suppliers, currencies.
- Purchasing: POs, supplier advances/payments, GRNs, grading-with-conservation, lots, cost layers, landed-cost allocation.
- Stock movement ledger (receiving, grading transfer, bin transfer) with no-negative-stock and concurrency-safe updates.
- Audit log for all mutations.
- Backup job skeleton (DB export → encrypted package → Drive), acceptance tests 1, 2, 3, 7 (partial), 16, 17, 18.
- Opening-data import tooling (section 17) — minimal CSV import for products/suppliers/opening stock.

### Stage 2 — Sales, fulfilment, finance, currency
- Sales orders, bundle allocation, mixed/restricted grade requirements, reservations with row-locking, picking, shipments, returns/refunds.
- Currency handling, exchange-rate snapshots, Fleek GBP flow.
- Finance ledger: subledgers, expenses, reconciliation, period lock.
- Dashboards and reports.

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
