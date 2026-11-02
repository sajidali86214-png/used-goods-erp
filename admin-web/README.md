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
- **Products / Suppliers**: list + create, with debounced search (`?search=` on the backend).
- **Purchasing**: PO create/approve, GRN receiving that completes the full loop into real inventory (creates the GRN *and* calls `/stock/receive` to create the actual lot/cost layer).
- **Sales**: order create — including `allowed_set` (checkboxes) and `exact_composition` (per-grade quantities) lines, not just plain mixed-grade. Order detail page drives the real reserve → pick → dispatch flow: a "Fulfil" button does FIFO suggest+reserve+pick in one click for `none` lines; `RestrictedGradePicker` picks each allowed grade separately and can amend the line to allow another grade (audited); `ExactCompositionPicker` shows required/picked/remaining per grade with one-click pick-remaining.
- **Returns & Refunds**: start a return, receive a line against a known or origin-uncertain dispatch, inspect it with support for splitting one return across multiple grades/dispositions in one call (the spec's "3 stay A, 2 become B" example), record a refund against a return and mark it paid from a chosen account.
- **Finance**: record an expense (posts to the ledger in the same action), record a customer receipt (auto-locks a 1:1 rate for same-currency receipts), view account balances.
- **Reports**: financial summary, inventory valuation, stock aging, supplier balances (advances paid/unapplied, open POs), customer balances (booked value vs. actual receipts).
- **Bulk Import**: CSV upload (client-side parsed) for products/suppliers/customers/opening-stock, with preview and row-level error display.
- **Users**: invite users with role checkboxes, deactivate.
- **Audit Log**: read-only viewer.
- **Settings**: categories/grades/bins/channels/accounts CRUD, period lock **and reopen** (with the lock's ID surfaced so reopening it is actually possible from the UI).

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

- No real pagination — `/products`, `/sales/orders`, etc. are still called with a fixed `take` (200) on the backend. Search narrows the list for Products/Suppliers, but `/sales/orders`, `/sales/returns`, and `/users` have no search/filter yet, so on a large dataset they'll just show the first 200.
- No charts — the new stock-aging/supplier/customer-balance reports are plain tables, not visualizations.
- `getCustomerBalances`' "booked value" is `unitPrice × quantity` per line — not bundle-allocation-aware, so a bundle-priced order's booked value will be off versus its actual allocated revenue.
- Styling is plain and functional, not polished.
