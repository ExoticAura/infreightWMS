-- Infreight WMS schema (Postgres). Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('ADMIN','OPS')),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  code      TEXT PRIMARY KEY,        -- e.g. KBS, APEX
  name      TEXT NOT NULL,
  ship_ref  TEXT                     -- default outbound trip ref e.g. T255
);

CREATE TABLE IF NOT EXISTS skus (
  sku        TEXT PRIMARY KEY,
  descr      TEXT NOT NULL,
  account    TEXT REFERENCES accounts(code),
  pcs_ctn    NUMERIC,
  cbm_ctn    NUMERIC,
  kgs_ctn    NUMERIC
);

CREATE TABLE IF NOT EXISTS opening_balances (
  sku  TEXT PRIMARY KEY REFERENCES skus(sku),
  pcs  NUMERIC NOT NULL DEFAULT 0
);

-- Inbound: a shipment carries a customer CIPL (expected) + ULD GRN (actual + bins)
CREATE TABLE IF NOT EXISTS inbound_shipments (
  id           TEXT PRIMARY KEY,     -- GRN id e.g. GR-007874
  account      TEXT REFERENCES accounts(code),
  cipl_no      TEXT,
  cipl_date    DATE,
  po           TEXT,
  shipper      TEXT,
  vessel       TEXT,
  eta          TEXT,
  permit       TEXT,
  received_date DATE,
  status       TEXT NOT NULL DEFAULT 'Pending review',  -- Pending review | Booked
  booked_by    TEXT,
  booked_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CIPL expected lines (one per SKU)
CREATE TABLE IF NOT EXISTS cipl_lines (
  id           SERIAL PRIMARY KEY,
  shipment_id  TEXT REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  expected_pcs NUMERIC NOT NULL DEFAULT 0,
  ctn          NUMERIC
);

-- GRN actual lines (one per bin location)
CREATE TABLE IF NOT EXISTS grn_lines (
  id           SERIAL PRIMARY KEY,
  shipment_id  TEXT REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  loc          TEXT,
  actual_pcs   NUMERIC NOT NULL DEFAULT 0,
  vol          NUMERIC
);

-- Outbound: a goods issue / pick
CREATE TABLE IF NOT EXISTS issues (
  id           TEXT PRIMARY KEY,     -- GI-119055
  account      TEXT REFERENCES accounts(code),
  ship_ref     TEXT,                 -- T251
  issue_date   DATE,
  status       TEXT NOT NULL DEFAULT 'Deducted',
  deducted_by  TEXT,
  deducted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issue_lines (
  id        SERIAL PRIMARY KEY,
  issue_id  TEXT REFERENCES issues(id) ON DELETE CASCADE,
  sku       TEXT NOT NULL,
  descr     TEXT,
  qty       NUMERIC NOT NULL,
  uom       TEXT DEFAULT 'PCS',
  permit    TEXT,
  uld       TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id      SERIAL PRIMARY KEY,
  ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_name TEXT,
  action  TEXT,
  detail  TEXT
);

CREATE INDEX IF NOT EXISTS idx_cipl_ship ON cipl_lines(shipment_id);
CREATE INDEX IF NOT EXISTS idx_grn_ship ON grn_lines(shipment_id);
CREATE INDEX IF NOT EXISTS idx_issue_lines ON issue_lines(issue_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
