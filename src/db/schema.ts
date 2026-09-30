import type Database from 'better-sqlite3';

export const TABLE_NAMES = [
  'vehicles', 'accidents', 'vehicle_options', 'owner_changes',
  'usage_history', 'market_prices', 'yearly_prices',
] as const;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS vehicles (
  car_id                  TEXT PRIMARY KEY,
  actual_car_id           TEXT,
  vehicle_no              TEXT,
  manufacturer            TEXT,
  model_group             TEXT,
  model_name              TEXT,
  grade_name              TEXT,
  grade_detail            TEXT,
  powertrain_cluster      TEXT,
  is_domestic             INTEGER NOT NULL DEFAULT 0,
  year                    INTEGER NOT NULL,
  month                   INTEGER NOT NULL DEFAULT 0,
  form_year               TEXT,
  mileage                 INTEGER NOT NULL,
  price                   INTEGER NOT NULL,
  origin_price_base       INTEGER,
  origin_price_options    INTEGER,
  origin_price            INTEGER,
  options_status          TEXT,
  fuel_type               TEXT,
  color                   TEXT,
  region                  TEXT,
  transmission            TEXT,
  displacement            INTEGER,
  sell_type               TEXT,
  lease_type              TEXT,
  is_duplication          INTEGER NOT NULL DEFAULT 0,
  first_advertised_at     TEXT,
  first_registration_date TEXT,
  insurance_count         INTEGER NOT NULL DEFAULT 0,
  my_damage_count         INTEGER NOT NULL DEFAULT 0,
  my_damage_amount        INTEGER NOT NULL DEFAULT 0,
  other_damage_count      INTEGER NOT NULL DEFAULT 0,
  other_damage_amount     INTEGER NOT NULL DEFAULT 0,
  is_insurance_private    INTEGER NOT NULL DEFAULT 0,
  has_unavailable_period  INTEGER NOT NULL DEFAULT 0,
  unavailable_periods     TEXT NOT NULL DEFAULT '[]',
  owner_change_count      INTEGER NOT NULL DEFAULT 0,
  has_inspection          INTEGER NOT NULL DEFAULT 0,
  is_inspection_private   INTEGER NOT NULL DEFAULT 0,
  has_replacement         INTEGER NOT NULL DEFAULT 0,
  has_welding             INTEGER NOT NULL DEFAULT 0,
  has_corrosion           INTEGER NOT NULL DEFAULT 0,
  rank_counts             TEXT,
  has_diagnosis           INTEGER NOT NULL DEFAULT 0,
  diagnosis_tier          TEXT,
  diag_frame_replacement  INTEGER NOT NULL DEFAULT 0,
  diag_panel_replacement  INTEGER NOT NULL DEFAULT 0,
  has_rental_history      INTEGER NOT NULL DEFAULT 0,
  has_usage_change        INTEGER NOT NULL DEFAULT 0,
  dealer_user_id          TEXT,
  dealer_name             TEXT,
  dealer_firm_name        TEXT,
  dealer_joined_at        TEXT,
  dealer_total_sales      INTEGER,
  score_total             REAL,
  score_grade             TEXT,
  score_breakdown         TEXT,
  score_penalty           INTEGER,
  collected_at            TEXT NOT NULL,
  search_query            TEXT,
  last_seen_at            TEXT
);

CREATE TABLE IF NOT EXISTS accidents (
  id                INTEGER PRIMARY KEY,
  car_id            TEXT NOT NULL REFERENCES vehicles(car_id) ON DELETE CASCADE,
  accident_date     TEXT,
  insurance_benefit INTEGER,
  part_cost         INTEGER,
  labor_cost        INTEGER,
  painting_cost     INTEGER,
  is_major          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicle_options (
  id           INTEGER PRIMARY KEY,
  car_id       TEXT NOT NULL REFERENCES vehicles(car_id) ON DELETE CASCADE,
  option_code  TEXT,
  option_price INTEGER,
  option_name  TEXT,
  option_raw   TEXT
);

CREATE TABLE IF NOT EXISTS owner_changes (
  id          INTEGER PRIMARY KEY,
  car_id      TEXT NOT NULL REFERENCES vehicles(car_id) ON DELETE CASCADE,
  change_date TEXT
);

CREATE TABLE IF NOT EXISTS usage_history (
  id         INTEGER PRIMARY KEY,
  car_id     TEXT NOT NULL REFERENCES vehicles(car_id) ON DELETE CASCADE,
  usage_code TEXT,
  seq        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_prices (
  car_id       TEXT PRIMARY KEY REFERENCES vehicles(car_id) ON DELETE CASCADE,
  median       INTEGER,
  min_price    INTEGER,
  max_price    INTEGER,
  p25          INTEGER,
  p75          INTEGER,
  sample_count INTEGER,
  collected_at TEXT
);

CREATE TABLE IF NOT EXISTS yearly_prices (
  car_id       TEXT NOT NULL REFERENCES vehicles(car_id) ON DELETE CASCADE,
  age          INTEGER,
  year         INTEGER,
  avg_price    INTEGER,
  count        INTEGER,
  collected_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_accidents_car_id       ON accidents(car_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_options_car_id ON vehicle_options(car_id);
CREATE INDEX IF NOT EXISTS idx_owner_changes_car_id   ON owner_changes(car_id);
CREATE INDEX IF NOT EXISTS idx_usage_history_car_id   ON usage_history(car_id);
CREATE INDEX IF NOT EXISTS idx_yearly_prices_car_id   ON yearly_prices(car_id);
`;

const COLUMN_MIGRATIONS: readonly { table: string; column: string; ddl: string; backfill?: (db: Database.Database) => void }[] = [
  { table: 'vehicles', column: 'options_status', ddl: 'ALTER TABLE vehicles ADD COLUMN options_status TEXT' },
  { table: 'vehicle_options', column: 'option_name', ddl: 'ALTER TABLE vehicle_options ADD COLUMN option_name TEXT' },
  { table: 'vehicle_options', column: 'option_raw', ddl: 'ALTER TABLE vehicle_options ADD COLUMN option_raw TEXT' },
  { table: 'vehicles', column: 'last_seen_at', ddl: 'ALTER TABLE vehicles ADD COLUMN last_seen_at TEXT',
    backfill: (db) => { db.prepare('UPDATE vehicles SET last_seen_at = ? WHERE last_seen_at IS NULL').run(new Date().toISOString()); } },
];

export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  for (const m of COLUMN_MIGRATIONS) {
    if (!(db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[]).some(c => c.name === m.column)) {
      db.transaction(() => { db.exec(m.ddl); m.backfill?.(db); })();
    }
  }
}
