# Backend (Stage 1 + Stage 2 core)

Fastify + TypeScript + Prisma/PostgreSQL. Implements the data model in
`../docs/02-data-model.md` and the permission matrix in
`../docs/03-permission-matrix.md` (see `prisma/schema.prisma` header comment
for exactly which tables exist).

## Setup

```powershell
cd backend
npm install
copy .env.example .env
# edit .env: set DATABASE_URL to a real Postgres database, and JWT_SECRET
npm run prisma:migrate   # creates the database schema
npm run seed             # creates roles/permissions/currencies/grades + an owner user
npm run dev              # starts the API on http://localhost:3000
```

## Tests

Tests run against a real Postgres database via `DATABASE_URL` (no mocking of
the database — the grading-conservation and no-negative-stock rules are only
meaningful against a real transactional DB). Point `.env` at a disposable
test database before running:

```powershell
npm test
```

Test files map to spec acceptance tests (`docs/01-implementation-plan.md` has the full checklist):
- `tests/grading.test.ts` — #1 (grading conserves quantity/cost), #2 (separately purchased cheaper Grade C keeps its own cost layer), plus no-negative-stock on write-off.
- `tests/purchasing.test.ts` — #3 (partial receipt of a prepaid PO: remaining expected stock and unapplied advance shown correctly, payment never re-recorded at GRN).
- `tests/sales.test.ts` — #4 (mixed-grade order, no promised ratio), #5 (A-only restricted order rejects Grade B unless amended), #6 (gross-profit worked example: revenue 45000 / cost 28000 / GP 17000), #7 (two concurrent reservations for the last 10 pieces — exactly one wins).
- `tests/individual-item.test.ts` — #8 (separate one piece for individual sale, then return it to bulk; total stock/cost unchanged throughout).
- `tests/dispatch-cancel.test.ts` — #9 (partial dispatch, then cancel the remaining unshipped quantity).
- `tests/returns.test.ts` — #10 (regraded return keeps original cost basis, partial refund), #11 (origin-uncertain return requires an explicit documented assumption, blocks excess returns).
- `tests/currency.test.ts` — #12 (partial GBP receipt + later conversion at a different real rate; Fleek commission defaults to zero), #13 (refreshing exchange rates never changes an already-posted snapshot or the lot/cost it priced).
- `tests/idempotency.test.ts` — #15 (retrying a request with the same Idempotency-Key creates only one order, not two).
- `tests/rbac.test.ts` + `tests/rbac-http.test.ts` + `tests/sales-http.test.ts` + `tests/finance-http.test.ts` — #16 (backend denies by permission regardless of the client), at both the middleware-unit and real-HTTP level.
- `tests/import.test.ts` — #17 (invalid/duplicate rows never produce a silent partial document; re-importing an existing SKU is rejected, not overwritten).
- `tests/stock-count.test.ts` — #18 (a counted variance is never posted until approved; approval posts one adjustment and never edits prior movement history).
- `tests/bundle.test.ts` — #19 (bundle total price and shared discount/shipping allocate across lines with an exact deterministic-remainder reconciliation).
- `tests/backup.test.ts` — #20, database half; **skips itself** unless `TEST_POSTGRES_SUPERUSER_URL` and `BACKUP_ENCRYPTION_KEY_HEX` are set in `.env`.
- `tests/drive-backup.test.ts` — the Google Drive nightly-copy half of #20, against the real Drive API (not mocked); **skips itself** unless the `GOOGLE_OAUTH_*` / `GOOGLE_DRIVE_*` vars are set (see `.env.example` and `scripts/driveOAuthSetup.ts`).
- `tests/ledger.test.ts` — finance ledger postings (expenses, supplier advances, customer receipts, paid refunds, sale revenue/COGS at dispatch, transfers, owner transactions) are all balanced and update account balances correctly; cross-checked against the same 45000/28000/17000 worked example used elsewhere.
- `tests/reports.test.ts` — operational/financial dashboard aggregations reconcile with the ledger and with known fixtures.
- `tests/price-override.test.ts` — a line priced below a product's `minPrice` is gated by the `price.override` permission and audited.

51 tests passing against a real local PostgreSQL 17 instance (not mocked) as of this writing; `npm run build` and `npm test` both pass.

## Known limitations — be honest about what's not here yet

Not implemented at all:
- Screenshot-assisted order drafts (Stage 3, spec section 10 / acceptance test #14) — deliberately not started: it needs a real OCR/extraction service, which spec section 21 says must not be assumed free or already connected. Needs an owner decision + budget first (see `docs/05-decisions-needed.md`).
- Media/attachment backup — the database backup+Drive-upload pipeline is real and tested end to end (see below); media (product/lot/order photos) has no backup yet because no object storage is provisioned.
- Period lock enforcement — `PeriodLock` table exists; nothing yet blocks a posting into a locked period.
- Opening-data import (section 17's go-live flow) — the generic bulk-import validation engine (`src/modules/imports`) exists and is tested for products; it isn't yet wired up for suppliers/customers/opening-stock.
- Admin-web and mobile are still unimplemented skeletons (see their own READMEs) — this backend has no UI consuming it yet beyond the test suite and manual HTTP calls.

Partial/hardening gaps:
- No DB-level CHECK constraints yet (quantity/cost non-negativity is enforced in the service layer only, inside SERIALIZABLE transactions — see `docs/02-data-model.md` section 9).
- Audit log exists and is used for grade-requirement amendments and price overrides, but isn't yet wired into every sensitive mutation (e.g. refund approval, backdating, user management).
- The Idempotency-Key middleware applies to all POST/PUT/PATCH routes, but only one HTTP-level test exercises it (`/sales/orders`) — the same middleware is unverified-but-presumed-correct on other routes since the logic isn't route-specific.
- Finance ledger posting (`src/modules/finance/ledgerService.ts`) is a DEFAULT policy, not a final accounting decision — see the module's own docstring. It recognizes revenue/COGS at dispatch and only supports PKR-denominated postings (a foreign-currency posting throws rather than guessing an FX treatment). Spec section 11 explicitly wants accountant sign-off on posting triggers, revenue recognition timing, and FX/exchange-difference treatment before this runs in production.

## Backup (spec section 16)

Both the database and Google Drive halves are real, tested, working code, not mocks:
- `src/modules/backup/backupService.ts` — `pg_dump` → SHA-256 checksum → AES-256-GCM encrypt → manifest; `restoreAndVerify` decrypts, re-checks the checksum, and restores into a throwaway database to verify row counts, reporting measured duration.
- `src/modules/backup/driveUploadService.ts` — uploads the encrypted backup + manifest to a Drive folder, authenticated as the **owner's own Google account via OAuth** (a bare service account has zero storage quota on a personal/non-Workspace Drive — this was discovered by actually hitting that error, not assumed). One-time setup: create an OAuth client (Desktop app type) in Google Cloud Console, put its ID/secret in `.env`, then run `npx tsx scripts/driveOAuthSetup.ts` and approve access once in a browser.

Not yet built: an actual scheduled/cron job that runs this nightly, and alerting on a missed/failed run (spec section 16's monitoring requirements). The pieces exist and work when called; nothing calls them on a schedule yet.
