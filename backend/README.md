# Backend (Stage 1)

Fastify + TypeScript + Prisma/PostgreSQL. Implements the data model in
`../docs/02-data-model.md` and the permission matrix in
`../docs/03-permission-matrix.md`, Stage 1 slice only (see `prisma/schema.prisma`
header comment).

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

Covers (see `tests/`):
- Acceptance test #1 — grading conserves quantity and cost (`tests/grading.test.ts`).
- Acceptance test #2 — a separately purchased cheaper Grade C lot keeps its own cost layer (`tests/grading.test.ts`).
- Acceptance test #16 — a role without `cost.view` is denied by the backend regardless of what the client sends, verified both as a unit test of the middleware (`tests/rbac.test.ts`) and as a real HTTP request through the Fastify app via `inject()` — 401 with no token, 403 for a picker, 200 for finance (`tests/rbac-http.test.ts`).
- No-negative-stock: a write-off larger than remaining quantity is rejected.

All of the above were run against a real local PostgreSQL 17 instance (not mocked) as of this writing; `npm run build` and `npm test` both pass.

## Known limitations (Stage 1 scaffold, be honest about what's not here yet)

- No DB-level CHECK constraints yet (quantity/cost non-negativity is enforced in the service layer only, inside SERIALIZABLE transactions — see `docs/02-data-model.md` section 9). Adding redundant CHECK constraints via a follow-up migration is recommended hardening, not yet done.
- Purchase orders, GRN line → multi-receipt reconciliation, opening-data import, and the backup job are specified in the data model/plan but not yet implemented as routes — only the receiving → grading → cost-layer core is wired end-to-end in this pass.
- Stage 2/3 tables (sales, finance, returns, screenshots) are designed in `docs/02-data-model.md` but not yet in `schema.prisma`.
