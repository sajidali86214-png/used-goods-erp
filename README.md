# Used Goods ERP

Inventory, purchasing, sales, and finance system for a bulk used-clothing and
bags business. Built against the specification in the project's original brief
(summarized in `docs/`).

## Status

**Stage 1 and Stage 2 substantially complete; Stage 3 not started except where noted.** See:

- [`docs/01-implementation-plan.md`](docs/01-implementation-plan.md) — stages, tech choices, acceptance-test checklist
- [`docs/02-data-model.md`](docs/02-data-model.md) — entities and invariants
- [`docs/03-permission-matrix.md`](docs/03-permission-matrix.md) — role → permission grid
- [`docs/04-screen-map.md`](docs/04-screen-map.md) — mobile + admin web screens
- [`docs/05-decisions-needed.md`](docs/05-decisions-needed.md) — owner decisions required before production

18 of the spec's 20 acceptance tests pass against a real PostgreSQL
database (see `backend/README.md` for the exact list). The only one not
attempted is screenshot-assisted order drafts — deliberately deferred
since it needs a real, paid OCR/extraction service the spec itself says
not to assume is free or already connected.

## Layout

```
backend/     Fastify + Prisma + PostgreSQL API — the real business logic
admin-web/   React admin app — functional, talks to the real API (see its README for exact coverage)
mobile/      Expo React Native app (Android + iPhone) — still a skeleton, not started
docs/        Planning documents (read these first)
```

## What actually works right now

`backend/` has real, tested business logic for essentially the full
purchasing → inventory → sales → fulfilment → returns/refunds → finance
ledger → reporting cycle, plus RBAC, idempotent retries, bulk import
validation, period locks, DB-level hardening, and a working encrypted
backup/restore pipeline (including a real Google Drive upload). See
`backend/README.md` for the full list and its own honestly-stated gaps
(finance posting policy defaults, period-lock-adjacent edges, etc.).

`admin-web/` is a real functional app covering purchasing, sales
fulfilment, returns, finance, reports, bulk import, user/role admin, audit
log, and settings — not a skeleton — but has real gaps of its own (no
pagination, no UI for restricted-grade picking or split return
inspection, no dashboards beyond basic tiles). See `admin-web/README.md`.

`mobile/` has not been started this round — still the original
skeleton described in its own README.

Do not treat anything beyond what each sub-project's own README states as
verified.
