# Infreight WMS

In-house Warehouse Management System for Infreight Logistics' bonded warehouse (BW1292).

It replaces the manual stitching-together of three documents:

- **Inbound** — the customer's **CIPL** (Commercial Invoice + Packing List) gives the *expected* quantity; the ULD **GRN** confirms the *actual* received quantity and assigns *bin locations*. The two are reconciled line-by-line. **Stock is booked on the CIPL (expected) quantity**; any GRN difference is flagged for ULD to resolve.
- **Outbound** — a pick (Goods Issue) deducts the **PickedQty** from stock automatically and records it in the audit trail. Each issue can generate an **export Packing List** as a real `.xlsx` in the Koehler template layout, auto-filled from the picked goods.
- **Stock ledger** — perpetual balance per SKU (`Opening + In − Out = Closing`), with CBM/KGS derived from carton factors. One-click **DRACO** stock report export (`.xlsx`).

## Features

- Per-user accounts with roles (**Admin** / **Warehouse-Ops**), JWT auth, password hashing.
- Inbound CIPL + GRN reconciliation, manual entry or **Excel/CSV import**.
- Outbound pick with automatic stock deduction + notification + audit entry.
- Real `.xlsx` exports: export packing list (Koehler format) and DRACO stock report.
- Global search across GIs, shipment refs (T251…), GR/CIPL numbers, SKUs, stock, reports.
- Immutable audit trail.
- Postgres-backed; schema + sample data seeded automatically on first boot.

## Tech

Node.js + Express · Postgres (`pg`) · JWT (`jsonwebtoken`) · bcrypt (`bcryptjs`) · ExcelJS · Multer · Vanilla JS frontend (no build step).

## Deploy on Railway (recommended)

1. **Push this folder to a GitHub repo.**
2. In [Railway](https://railway.app): **New Project → Deploy from GitHub repo**, pick the repo.
3. In the same project: **New → Database → Add PostgreSQL**.
4. Open your **service → Variables** and add:
   - `DATABASE_URL` → reference the Postgres plugin's variable (Railway: `${{ Postgres.DATABASE_URL }}`).
   - `PGSSL` = `true` (if the service connects to Postgres over the public network) or leave `false` for private networking.
   - `JWT_SECRET` = a long random string.
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` = your first admin login (created automatically on first boot).
5. Railway builds with Nixpacks and runs `npm start`. On first boot the app creates the schema, the admin user, and seeds sample data.
6. Open the generated URL and sign in with the admin credentials above.

> The app reads `PORT` from the environment (Railway sets it automatically).

## Run locally

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL etc.
# Point DATABASE_URL at any Postgres instance (local or a Railway DB)
npm start                   # schema + seed run automatically on first boot
# open http://localhost:3000
```

`npm run seed` re-seeds sample data manually (it is idempotent).

## First login

Use the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set (defaults `admin@infreight.local` / `changeme`). Create additional Ops/Admin users from the **Users** page.

## Project layout

```
src/
  server.js            Express app, static hosting, DB init + bootstrap
  db.js                Postgres pool + transaction helper
  schema.sql           Tables (idempotent)
  seed.js              Sample SKUs / accounts / inbound / outbound
  auth.js              JWT + bcrypt + middleware
  api.js               REST API (inbound, outbound, stock, search, audit, users)
  services/
    ledger.js          Reconciliation + perpetual stock ledger
    exports.js         Real .xlsx generation (packing list + DRACO)
    importer.js        Excel/CSV parsing for CIPL/GRN import
public/
  index.html, styles.css, app.js   Frontend (calls /api)
```

## Roadmap

- PDF auto-parsing for the known ULD GRN and Flying Dragon CIPL layouts.
- Billing module (storage + handling + profit share), per the DRACO `PS CALCULATION` tab.
- Barcode scanning for putaway and picking.
