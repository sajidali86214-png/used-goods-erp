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
- `tests/sales.test.ts` — #4 (mixed-grade order, no promised ratio), #5 (A-only restricted order rejects Grade B unless amended), #6 (gross-profit worked example: revenue 45000 / cost 28000 / GP 17000), #7 (two concurrent reservations for the last 10 pieces — exactly one wins).
- `tests/dispatch-cancel.test.ts` — #9 (partial dispatch, then cancel the remaining unshipped quantity).
- `tests/returns.test.ts` — #10 (regraded return keeps original cost basis, partial refund), #11 (origin-uncertain return requires an explicit documented assumption, blocks excess returns).
- `tests/currency.test.ts` — #12 (partial GBP receipt + later conversion at a different real rate; Fleek commission defaults to zero), #13 (refreshing exchange rates never changes an already-posted snapshot or the lot/cost it priced).
- `tests/rbac.test.ts` + `tests/rbac-http.test.ts` + `tests/sales-http.test.ts` — #16 (backend denies by permission regardless of the client), at both the middleware-unit and real-HTTP level.

22 tests passing against a real local PostgreSQL 17 instance (not mocked) as of this writing; `npm run build` and `npm test` both pass.

## Known limitations — be honest about what's not here yet

Not implemented at all:
- Acceptance test #3 (partial receipt of a prepaid PO reconciling payment/receipt) — PO/GRN HTTP endpoints beyond the core receive→grade flow don't exist yet; the schema does.
- Acceptance test #8 (individual-item separate-for-sale / return-to-bulk).
- Acceptance tests #14, #15, #17, #18, #19, #20 — screenshot-assisted drafts (Stage 3), idempotent-retry handling, bulk import validation, physical stock counts, bundle-total-price allocation (schema exists, no service), and backup/restore.
- Finance ledger posting logic, reconciliation, and period locks — tables exist (`Account`/`LedgerEntry`/`Expense`/`Transfer`/`OwnerTransaction`/`PeriodLock`) but nothing posts to them yet; spec section 11 explicitly wants accountant sign-off on posting triggers before this is built.
- Dashboards/reports.
- HTTP routes for dispatch, cancellation, returns, refunds, and currency/payments — these are service-level + tested, but not yet exposed as `/sales/*`-style endpoints the way order/reservation/pick/amend already are.

Partial/hardening gaps:
- No DB-level CHECK constraints yet (quantity/cost non-negativity is enforced in the service layer only, inside SERIALIZABLE transactions — see `docs/02-data-model.md` section 9).
- Audit log exists and is used for grade-requirement amendments, but isn't yet wired into every sensitive mutation.
- Opening-data import and the backup job are specified but not built.
