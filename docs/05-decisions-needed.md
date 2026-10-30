# Decisions Needed From Owner (spec section 21)

These do not block Stage 1 code, but must be settled before production go-live. Recommendation given where there's a reasonable default; everything here is a proposal, not a commitment of money on your behalf.

| Decision | Recommendation | Status |
|---|---|---|
| Hosting/service budget | Managed Postgres (Neon/Render/Supabase) + S3-compatible storage (Cloudflare R2) + Render/Fly for API hosting. Rough estimate $25-80/mo at this scale; confirmed pricing presented before anything is provisioned. | Open |
| Mobile distribution | Needs an Apple Developer account ($99/yr, business-owned) and a Google Play Developer account ($25 one-time, business-owned). Expo EAS Build/Submit for CI builds. | Open — business must create these accounts; I cannot create them for you. |
| Exact grade definitions (A/B/C examples) | Owner/receiving staff to write definitions + example photos in-app once Settings UI exists. | Open |
| Mixed-grade picking policy | Default: suggest oldest-lot-first allocation, final mix decided at picking, no promised ratio unless the order line says "exact composition". Confirm this matches how staff already work. | Open |
| Accounting/tax & revenue recognition policy | Needs accountant sign-off per spec section 11 — affects when a sale posts revenue (order confirm vs dispatch vs delivery). | Open |
| Return/refund approval limits | Need a PKR threshold above which a second approver is required. | Open |
| Invoice numbering/layout | Need a numbering scheme (e.g. INV-2026-00001) and what fields appear on customer-facing invoices. | Open |
| Notification channel | Email vs SMS vs WhatsApp vs in-app only, for backup alerts and approval requests. | Open |
| Media size/retention limits | Proposed: 10MB/photo, 100MB/video, compress on upload, retain as long as the referencing record exists plus backup retention window. | Open |
| Backup/recovery targets | Proposed in spec section 16 (DB PITR ≤15min loss, media ≤24h, full recovery ≤4h) — needs a measured restore test before these are promised as committed numbers. | Open |

None of these block writing Stage 1 schema/code; they gate production go-live (spec section 17).
