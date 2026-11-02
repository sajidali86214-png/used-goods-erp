# Admin Web

React + TypeScript + Vite, talking to the real backend API (no mock data).
Implements the screens in `../docs/04-screen-map.md` that make sense for a
desktop admin UI: bulk operations, reporting, and administration, plus the
day-to-day flows needed to actually exercise the backend.

## Setup

```powershell
cd admin-web
npm install
copy .env.example .env
# edit .env if the backend isn't on http://localhost:3000
npm run dev   # http://localhost:5173 — requires the backend running separately
```

Log in with the seeded owner account (`npm run seed` in `../backend`), or
any user created via Settings → Users once logged in as an owner/manager.

## What's actually here

- **Auth**: login, `/auth/me` for identity/permissions, sidebar nav hidden per-permission (not just a visual nicety — every route it calls is also enforced server-side).
- **Products / Suppliers / Customers**: list + create.
- **Purchasing**: PO create/approve, GRN receiving that completes the full loop into real inventory (creates the GRN *and* calls `/stock/receive` to create the actual lot/cost layer).
- **Sales**: order create, order detail page driving the real reserve → pick → dispatch flow (a "Fulfil" button does FIFO suggest+reserve+pick in one click for `gradeRequirementType: "none"` lines).
- **Returns & Refunds**: start a return, receive a line against a known or origin-uncertain dispatch, inspect it (single-outcome only — see below), basic refund recording exists in the backend but has no dedicated form here yet.
- **Finance**: record an expense (posts to the ledger in the same action), record a customer receipt (auto-locks a 1:1 rate for same-currency receipts), view account balances.
- **Reports**: financial summary and inventory valuation.
- **Bulk Import**: CSV upload (client-side parsed) for products/suppliers/customers/opening-stock, with preview and row-level error display.
- **Users**: invite users with role checkboxes, deactivate.
- **Audit Log**: read-only viewer.
- **Settings**: categories/grades/bins/channels/accounts CRUD, period lock **and reopen**.

## Verified how, given the environment

No browser-automation tool in this environment could reach a `localhost`
server (the built-in browser pane and Claude-in-Chrome were both
unavailable/out of reach here), so "test it in a browser" instead meant:
a clean `tsc` + production build, and replaying every page's *exact* API
call sequence against the live backend from a script, which is what
actually caught the one real bug found this way — `api/client.ts` was
sending `Content-Type: application/json` on bodyless POSTs (approve,
dispatch-with-no-body, etc.), which Fastify correctly rejects as an empty
JSON body. Fixed once in the client; it covers every page.

**If you have a real browser available, click through it before trusting
this list further** — the above is "the code paths work when driven the
way the UI drives them," not "a human has looked at the rendered pages."

## Known gaps — be honest about what's not here

- No pagination anywhere (`/products`, `/sales/orders`, etc. are called with a fixed `take` on the backend and the lists just render whatever comes back).
- Exact-composition and allowed-grade-restricted order lines have no dedicated picking UI (the backend fully supports them — see `backend/README.md` — but the "Fulfil" button only handles `gradeRequirementType: "none"`; restricted lines need the API directly for now).
- Return inspection only supports a single outcome per call in this UI (the backend supports splitting one return across multiple grades, e.g. the spec's "3 stay A, 2 become B" example — this UI doesn't expose that split).
- No dedicated refund-creation form (the backend route exists; not wired up here).
- No dashboards beyond the single Dashboard page's operational/financial tiles — no charts, no stock aging, no supplier/customer-balance reports.
- Styling is plain and functional, not polished.
