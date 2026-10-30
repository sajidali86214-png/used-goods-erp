# Used Goods ERP

Inventory, purchasing, sales, and finance system for a bulk used-clothing and
bags business. Built against the specification in the project's original brief
(summarized in `docs/`).

## Status

**Stage 1 in progress.** See:

- [`docs/01-implementation-plan.md`](docs/01-implementation-plan.md) — stages, tech choices, "what done means"
- [`docs/02-data-model.md`](docs/02-data-model.md) — entities and invariants
- [`docs/03-permission-matrix.md`](docs/03-permission-matrix.md) — role → permission grid
- [`docs/04-screen-map.md`](docs/04-screen-map.md) — mobile + admin web screens
- [`docs/05-decisions-needed.md`](docs/05-decisions-needed.md) — owner decisions required before production

## Layout

```
backend/     Fastify + Prisma + PostgreSQL API — real business logic lives here
admin-web/   React admin app — currently a skeleton, not yet wired to the API
mobile/      Expo React Native app (Android + iPhone) — currently a skeleton
docs/        Planning documents (read these first)
```

## What actually works right now

Only `backend/` has real, tested logic: receiving into inspection, grading
transfers with quantity/cost conservation, write-offs with no-negative-stock
enforcement, and server-side RBAC. Everything else (sales, finance, returns,
currency, screenshots, admin-web, mobile) is designed in `docs/` but not yet
implemented — see each sub-project's README for specifics. Do not treat
anything not listed in `backend/README.md`'s test section as verified.
