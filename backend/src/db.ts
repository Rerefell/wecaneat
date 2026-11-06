import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://postgres:Tencent2025@localhost:5432/genie',
  max: 10,
})

export const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS batches (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      channel       TEXT NOT NULL DEFAULT '日本拼团',
      expected_kg   NUMERIC(12,4),
      rate_per_g    NUMERIC(12,6) NOT NULL DEFAULT 0.12,
      note          TEXT,
      source_file   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id            SERIAL PRIMARY KEY,
      batch_id      INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      member        TEXT NOT NULL,
      handle_no     TEXT,
      product       TEXT NOT NULL DEFAULT '',
      characters    TEXT,
      qty           NUMERIC(12,2) NOT NULL DEFAULT 0,
      unit_g        NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_g       NUMERIC(12,2) NOT NULL DEFAULT 0,
      intl_fee      NUMERIC(12,4) NOT NULL DEFAULT 0,
      adjust        NUMERIC(12,4) NOT NULL DEFAULT 0,
      subtotal      NUMERIC(12,4) NOT NULL DEFAULT 0,
      total         NUMERIC(12,4) NOT NULL DEFAULT 0,
      sort_no       INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_items_batch ON items(batch_id);
    CREATE INDEX IF NOT EXISTS idx_items_member ON items(batch_id, member);
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id            SERIAL PRIMARY KEY,
      batch_id      INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      paid          BOOLEAN NOT NULL DEFAULT false,
      paid_amount   NUMERIC(12,2),
      contact       TEXT,
      remark        TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (batch_id, name)
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id            SERIAL PRIMARY KEY,
      batch_id      INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      member        TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      file_name     TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      size          INTEGER NOT NULL DEFAULT 0,
      amount        NUMERIC(12,2),
      note          TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_member ON receipts(batch_id, member);
  `)

  // ---- 流水号 / 取证相关字段（增量升级，幂等） ----
  await pool.query(`
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS serial_no      TEXT;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS serial_source TEXT;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS content_hash  TEXT;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS phash         TEXT;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS level         TEXT DEFAULT 'safe';
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS score         INTEGER DEFAULT 100;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS checks        JSONB;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS meta          JSONB;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS ocr           JSONB;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS reviewed      BOOLEAN DEFAULT false;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS review_note   TEXT;
  `)

  // 流水号全库唯一（忽略空值与大小写差异）
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_receipts_serial
      ON receipts (UPPER(serial_no))
      WHERE serial_no IS NOT NULL AND serial_no <> '';
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS short_links (
      code   TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  // 后台登录尝试记录（防爆破）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_attempts (
      id         SERIAL PRIMARY KEY,
      ip         TEXT NOT NULL,
      ok         BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_admin_attempts ON admin_attempts(ip, created_at);
  `)

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_receipts_phash ON receipts(phash);`)
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_receipts_chash ON receipts(content_hash);`)
}
