import { getDb } from './connection';
import {
  GRADES,
  type AccidentRecord, type Grade, type LocalPriceBaseline, type MarketPrice, type OwnerChange, type PriceBaselineKey, type ScoreResult,
  type SimilarSearchOptions, type SummaryStats, type UsageHistory, type VehicleData, type VehicleFilters, type VehicleOption, type YearlyPrice,
} from '../types';

type SqlValue = string | number | null;

/** 이 값 이상의 가격(만원)은 가격 미정 자리표시로 보고 가격 통계에서 제외 */
export const INVALID_PRICE_MIN = 9999;
export const DEFAULT_STALE_DAYS = 14;
/** STALE_DAYS: 0 이상의 정수. 비우면 14, 0이면 미확인 제외·purge 끔 */
export function getStaleDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.STALE_DAYS ?? '').trim();
  if (raw === '') return DEFAULT_STALE_DAYS;
  if (!/^\d+$/.test(raw)) throw new Error(`STALE_DAYS는 0 이상의 정수여야 합니다: ${raw}`);
  return Number(raw);
}
/** now - days 의 ISO 시각. last_seen_at <= 이 값이면 미확인(stale). days=0이면 null(끔) */
export function staleCutoffIso(now: Date = new Date(), days: number = getStaleDays()): string | null {
  return days === 0 ? null : new Date(now.getTime() - days * 86_400_000).toISOString();
}
/** 미확인 판정 SQL (NULL은 활성 취급) */
const STALE_SQL = 'last_seen_at <= ?';
const ACTIVE_SQL = '(last_seen_at IS NULL OR last_seen_at > ?)';
function pushActive(where: string[], params: SqlValue[], cutoff: string | null): void {
  if (cutoff !== null) { where.push(ACTIVE_SQL); params.push(cutoff); }
}
export function isStaleVehicle(v: Pick<VehicleData, 'lastSeenAt'>, cutoff: string | null): boolean {
  return cutoff !== null && v.lastSeenAt !== null && v.lastSeenAt <= cutoff;
}

const VEHICLE_FIELDS = [
  'carId', 'actualCarId', 'vehicleNo',
  'manufacturer', 'modelGroup', 'modelName', 'gradeName', 'gradeDetail', 'powertrainCluster', 'isDomestic',
  'year', 'month', 'formYear', 'mileage', 'price', 'originPriceBase', 'originPriceOptions', 'originPrice', 'optionsStatus',
  'fuelType', 'color', 'region', 'transmission', 'displacement', 'sellType', 'leaseType', 'isDuplication',
  'firstAdvertisedAt', 'firstRegistrationDate',
  'insuranceCount', 'myDamageCount', 'myDamageAmount', 'otherDamageCount', 'otherDamageAmount',
  'isInsurancePrivate', 'hasUnavailablePeriod', 'unavailablePeriods',
  'ownerChangeCount',
  'hasInspection', 'isInspectionPrivate', 'hasReplacement', 'hasWelding', 'hasCorrosion', 'rankCounts',
  'hasDiagnosis', 'diagnosisTier', 'diagFrameReplacement', 'diagPanelReplacement',
  'hasRentalHistory', 'hasUsageChange',
  'dealerUserId', 'dealerName', 'dealerFirmName', 'dealerJoinedAt', 'dealerTotalSales',
  'scoreTotal', 'scoreGrade', 'scoreBreakdown', 'scorePenalty',
  'collectedAt', 'searchQuery', 'lastSeenAt',
] as const satisfies readonly (keyof VehicleData)[];

type MissingVehicleField = Exclude<keyof VehicleData, (typeof VEHICLE_FIELDS)[number]>;
const _allFieldsCovered: [MissingVehicleField] extends [never] ? true : false = true;
void _allFieldsCovered;

const BOOL_FIELDS: ReadonlySet<keyof VehicleData> = new Set<keyof VehicleData>([
  'isDomestic', 'isDuplication', 'isInsurancePrivate', 'hasUnavailablePeriod',
  'hasInspection', 'isInspectionPrivate', 'hasReplacement', 'hasWelding', 'hasCorrosion',
  'hasDiagnosis', 'diagFrameReplacement', 'diagPanelReplacement', 'hasRentalHistory', 'hasUsageChange',
]);
const JSON_FIELDS: ReadonlySet<keyof VehicleData> = new Set<keyof VehicleData>([
  'unavailablePeriods', 'rankCounts', 'scoreBreakdown',
]);

export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const VEHICLE_COLUMNS = VEHICLE_FIELDS.map(toSnake);

const SEARCH_TEXT_EXPR =
  "(COALESCE(manufacturer,'') || ' ' || COALESCE(model_group,'') || ' ' || COALESCE(model_name,'') || ' ' || COALESCE(grade_name,'') || ' ' || COALESCE(grade_detail,''))";

function vehicleToRow(v: VehicleData): Record<string, SqlValue> {
  const row: Record<string, SqlValue> = {};
  for (const f of VEHICLE_FIELDS) {
    const raw = v[f] as unknown;
    let value: SqlValue;
    if (BOOL_FIELDS.has(f)) value = raw ? 1 : 0;
    else if (JSON_FIELDS.has(f)) value = raw == null ? (f === 'unavailablePeriods' ? '[]' : null) : JSON.stringify(raw);
    else value = (raw ?? null) as SqlValue;
    row[toSnake(f)] = value;
  }
  return row;
}

function rowToVehicle(row: Record<string, unknown>): VehicleData {
  const out: Record<string, unknown> = {};
  for (const f of VEHICLE_FIELDS) {
    const raw = row[toSnake(f)];
    if (BOOL_FIELDS.has(f)) out[f] = raw === 1;
    else if (JSON_FIELDS.has(f)) out[f] = raw == null ? (f === 'unavailablePeriods' ? [] : null) : JSON.parse(raw as string);
    else out[f] = raw ?? null;
  }
  return out as unknown as VehicleData;
}

function tokenize(model: string): string[] {
  return model.trim().split(/\s+/).filter((t) => t.length > 0);
}

function replaceChildRows(table: string, carId: string, columns: string[], rows: SqlValue[][]): void {
  const db = getDb();
  const del = db.prepare(`DELETE FROM ${table} WHERE car_id = ?`);
  const ins = db.prepare(
    `INSERT INTO ${table} (car_id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`
  );
  db.transaction(() => {
    del.run(carId);
    for (const r of rows) ins.run(carId, ...r);
  })();
}

export function upsertVehicle(data: VehicleData): void {
  const sql =
    `INSERT INTO vehicles (${VEHICLE_COLUMNS.join(', ')}) ` +
    `VALUES (${VEHICLE_COLUMNS.map((c) => '@' + c).join(', ')}) ` +
    `ON CONFLICT(car_id) DO UPDATE SET ` +
    VEHICLE_COLUMNS.filter((c) => c !== 'car_id').map((c) => `${c} = excluded.${c}`).join(', ');
  getDb().prepare(sql).run(vehicleToRow(data));
}

export function upsertAccidents(carId: string, records: AccidentRecord[]): void {
  replaceChildRows('accidents', carId,
    ['accident_date', 'insurance_benefit', 'part_cost', 'labor_cost', 'painting_cost', 'is_major'],
    records.map((r) => [r.accidentDate ?? null, r.insuranceBenefit ?? null, r.partCost ?? null,
      r.laborCost ?? null, r.paintingCost ?? null, r.isMajor ? 1 : 0]));
}

export function upsertOptions(carId: string, options: VehicleOption[]): void {
  replaceChildRows('vehicle_options', carId, ['option_code', 'option_price', 'option_name', 'option_raw'],
    options.map((o) => [o.optionCode ?? null, o.optionPrice ?? null, o.optionName ?? null, o.optionRaw ?? null]));
}

export function upsertOwnerChanges(carId: string, dates: string[]): void {
  replaceChildRows('owner_changes', carId, ['change_date'], dates.map((d) => [d]));
}

export function upsertUsageHistory(carId: string, codes: string[]): void {
  replaceChildRows('usage_history', carId, ['usage_code', 'seq'], codes.map((c, i) => [c, i]));
}

export function upsertMarketPrice(carId: string, data: MarketPrice): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO market_prices (car_id, median, min_price, max_price, p25, p75, sample_count, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(carId, Math.round(data.median), data.minPrice, data.maxPrice, data.p25, data.p75,
    data.sampleCount, data.collectedAt);
}

export function upsertYearlyPrices(carId: string, points: YearlyPrice[]): void {
  replaceChildRows('yearly_prices', carId, ['age', 'year', 'avg_price', 'count', 'collected_at'],
    points.map((p) => [p.age, p.year, p.avgPrice, p.count, p.collectedAt]));
}

const SORT_SQL: Record<NonNullable<VehicleFilters['sort']>, string> = {
  price: 'price ASC',
  score: 'score_total DESC',
  mileage: 'mileage ASC',
  year: 'year DESC, month DESC',
};

export function findVehicles(filters: VehicleFilters = {}): VehicleData[] {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filters.model) {
    for (const t of tokenize(filters.model)) { where.push(`${SEARCH_TEXT_EXPR} LIKE ?`); params.push(`%${t}%`); }
  }
  if (filters.minScore !== undefined) { where.push('score_total >= ?'); params.push(filters.minScore); }
  if (filters.excludeStaleAsOf !== undefined) pushActive(where, params, staleCutoffIso(filters.excludeStaleAsOf));
  let sql = 'SELECT * FROM vehicles';
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY ${SORT_SQL[filters.sort ?? 'score']}, car_id ASC`;
  if (filters.limit !== undefined) { sql += ' LIMIT ?'; params.push(filters.limit); }
  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToVehicle);
}

export function findSimilarVehicles(
  model: string, year: number, mileage: number, options: SimilarSearchOptions = {}
): VehicleData[] {
  const yearRange = options.yearRange ?? 2;
  const ratio = options.mileageRatio === undefined ? 0.4 : options.mileageRatio;
  const where: string[] = ['year BETWEEN ? AND ?'];
  const params: SqlValue[] = [year - yearRange, year + yearRange];
  for (const t of tokenize(model)) { where.push(`${SEARCH_TEXT_EXPR} LIKE ?`); params.push(`%${t}%`); }
  if (options.gradeName) { where.push('grade_name = ?'); params.push(options.gradeName); }
  if (ratio !== null) {
    where.push('mileage BETWEEN ? AND ?');
    params.push(Math.floor(mileage * (1 - ratio)), Math.ceil(mileage * (1 + ratio)));
  }
  const sql = `SELECT * FROM vehicles WHERE ${where.join(' AND ')} ORDER BY price ASC, car_id ASC`;
  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToVehicle);
}

export function getSummary(now: Date = new Date()): SummaryStats {
  const db = getDb();
  const staleDays = getStaleDays();
  const cutoff = staleCutoffIso(now, staleDays);
  const aw: string[] = [];
  const ap: SqlValue[] = [];
  pushActive(aw, ap, cutoff);
  const activeWhere = aw.length ? `WHERE ${aw.join(' AND ')}` : '';
  const counts = db.prepare(
    `SELECT COUNT(*) AS totalCount, MAX(collected_at) AS lastCollectedAt, MAX(last_seen_at) AS lastSeenAt,
            COALESCE(SUM(CASE WHEN ${STALE_SQL} THEN 1 ELSE 0 END), 0) AS staleCount
     FROM vehicles`
  ).get(cutoff) as { totalCount: number; lastCollectedAt: string | null; lastSeenAt: string | null; staleCount: number };
  // 가격 통계는 유효 가격(0 < 가격 < 9999만원)만 사용. 9,999 이상은 엔카의 가격 미정 자리표시값 (시세 기준과 동일)
  const validPrice = `price > 0 AND price < ${INVALID_PRICE_MIN}`;
  const priceStats = db.prepare(
    `SELECT MIN(CASE WHEN ${validPrice} THEN price END) AS priceMin, MAX(CASE WHEN ${validPrice} THEN price END) AS priceMax,
            AVG(CASE WHEN ${validPrice} THEN price END) AS priceAvg, AVG(score_total) AS scoreAvg,
            COALESCE(SUM(CASE WHEN ${validPrice} THEN 0 ELSE 1 END), 0) AS priceExcludedCount
     FROM vehicles ${activeWhere}`
  ).get(...ap) as { priceMin: number | null; priceMax: number | null; priceAvg: number | null; scoreAvg: number | null; priceExcludedCount: number };
  const modelDistribution = db.prepare(
    `SELECT TRIM(COALESCE(model_name,'') || ' ' || COALESCE(grade_name,'')) AS label, COUNT(*) AS count
     FROM vehicles ${activeWhere} GROUP BY label ORDER BY count DESC, label ASC LIMIT 10`
  ).all(...ap) as { label: string; count: number }[];
  const gradeWhere = aw.length ? `WHERE ${aw.join(' AND ')} AND score_grade IS NOT NULL` : 'WHERE score_grade IS NOT NULL';
  const gradeRows = db.prepare(
    `SELECT score_grade AS grade, COUNT(*) AS count FROM vehicles ${gradeWhere} GROUP BY score_grade`
  ).all(...ap) as { grade: string; count: number }[];
  const gradeDistribution = Object.fromEntries(GRADES.map((g) => [g, 0])) as Record<Grade, number>;
  for (const r of gradeRows) {
    if ((GRADES as readonly string[]).includes(r.grade)) gradeDistribution[r.grade as Grade] = r.count;
  }
  return {
    totalCount: counts.totalCount,
    lastCollectedAt: counts.lastCollectedAt,
    modelDistribution,
    gradeDistribution,
    priceMin: priceStats.priceMin,
    priceMax: priceStats.priceMax,
    priceAvg: priceStats.priceAvg,
    priceExcludedCount: priceStats.priceExcludedCount,
    scoreAvg: priceStats.scoreAvg,
    activeCount: counts.totalCount - counts.staleCount,
    staleCount: counts.staleCount,
    staleDays,
    lastSeenAt: counts.lastSeenAt,
  };
}

export function getLocalPriceBaseline(key: PriceBaselineKey, now: Date = new Date()): LocalPriceBaseline | null {
  if (!key.modelGroup || !(key.year > 0)) return null;
  const where: string[] = [
    'model_group = ?', 'year = ?', 'car_id <> ?',
    'price > 0', 'price < 9999',
    "COALESCE(sell_type, '') NOT IN ('렌트', '리스')",
    "COALESCE(lease_type, '') = ''",
    'is_duplication = 0',
  ];
  const params: SqlValue[] = [key.modelGroup, key.year, key.carId];
  pushActive(where, params, staleCutoffIso(now));
  if (key.modelName) { where.push('model_name = ?'); params.push(key.modelName); }
  if (key.gradeName) {
    if (key.powertrainCluster) { where.push('powertrain_cluster = ?'); params.push(key.powertrainCluster); }
    else {
      where.push('grade_name = ?'); params.push(key.gradeName);
      if (key.gradeDetail) { where.push('grade_detail = ?'); params.push(key.gradeDetail); }
    }
  }
  const row = getDb().prepare(
    `SELECT COUNT(*) AS n, AVG(price) AS avg FROM vehicles WHERE ${where.join(' AND ')}`
  ).get(...params) as { n: number; avg: number | null };
  if (!row || row.n === 0 || row.avg == null) return null;
  return { avgPrice: Math.round(row.avg), sampleCount: row.n };
}

export function getAccidentsByCarId(carId: string): AccidentRecord[] {
  const rows = getDb().prepare(
    `SELECT accident_date, insurance_benefit, part_cost, labor_cost, painting_cost, is_major
     FROM accidents WHERE car_id = ? ORDER BY id ASC`
  ).all(carId) as { accident_date: string | null; insurance_benefit: number | null; part_cost: number | null;
                    labor_cost: number | null; painting_cost: number | null; is_major: number }[];
  return rows.map((r) => ({
    accidentDate: r.accident_date ?? '', insuranceBenefit: r.insurance_benefit, partCost: r.part_cost,
    laborCost: r.labor_cost, paintingCost: r.painting_cost, isMajor: r.is_major === 1,
  }));
}

export function getYearlyPricesByCarId(carId: string): YearlyPrice[] {
  const rows = getDb().prepare(
    `SELECT age, year, avg_price, count, collected_at FROM yearly_prices WHERE car_id = ? ORDER BY age ASC`
  ).all(carId) as { age: number; year: number; avg_price: number; count: number; collected_at: string | null }[];
  return rows.map((r) => ({ age: r.age, year: r.year, avgPrice: r.avg_price, count: r.count, collectedAt: r.collected_at ?? '' }));
}

export function updateVehicleScore(carId: string, score: ScoreResult): void {
  getDb().prepare(
    `UPDATE vehicles SET score_total = ?, score_grade = ?, score_breakdown = ?, score_penalty = ? WHERE car_id = ?`
  ).run(score.total, score.grade, JSON.stringify(score.breakdown), score.penalty, carId);
}

export function findVehicleById(carId: string): VehicleData | null {
  const row = getDb().prepare('SELECT * FROM vehicles WHERE car_id = ?').get(carId) as Record<string, unknown> | undefined;
  return row ? rowToVehicle(row) : null;
}

export function hasVehicle(carId: string): boolean {
  return getDb().prepare('SELECT 1 FROM vehicles WHERE car_id = ?').get(carId) !== undefined;
}

export function getOptionsByCarId(carId: string): VehicleOption[] {
  const rows = getDb().prepare('SELECT option_code, option_price, option_name, option_raw FROM vehicle_options WHERE car_id = ? ORDER BY id ASC')
    .all(carId) as { option_code: string | null; option_price: number | null; option_name: string | null; option_raw: string | null }[];
  return rows.map((r) => ({ optionCode: r.option_code ?? '', optionPrice: r.option_price, optionName: r.option_name ?? null, optionRaw: r.option_raw ?? null }));
}

export function getOptionNamesByCarIds(carIds: readonly string[]): Map<string, (string | null)[]> {
  const out = new Map<string, (string | null)[]>();
  const db = getDb();
  for (let i = 0; i < carIds.length; i += 500) {
    const chunk = carIds.slice(i, i + 500);
    const rows = db.prepare(
      `SELECT car_id, option_name FROM vehicle_options WHERE car_id IN (${chunk.map(() => '?').join(', ')}) ORDER BY id ASC`
    ).all(...chunk) as { car_id: string; option_name: string | null }[];
    for (const r of rows) {
      const list = out.get(r.car_id);
      if (list) list.push(r.option_name);
      else out.set(r.car_id, [r.option_name]);
    }
  }
  return out;
}

export function getOwnerChangesByCarId(carId: string): OwnerChange[] {
  const rows = getDb().prepare('SELECT change_date FROM owner_changes WHERE car_id = ? ORDER BY id ASC')
    .all(carId) as { change_date: string | null }[];
  return rows.map((r) => ({ changeDate: r.change_date ?? '' }));
}

export function getUsageHistoryByCarId(carId: string): UsageHistory[] {
  const rows = getDb().prepare('SELECT usage_code, seq FROM usage_history WHERE car_id = ? ORDER BY seq ASC, id ASC')
    .all(carId) as { usage_code: string | null; seq: number }[];
  return rows.map((r) => ({ usageCode: r.usage_code ?? '', seq: r.seq }));
}

export function getMarketPriceByCarId(carId: string): MarketPrice | null {
  const r = getDb().prepare('SELECT median, min_price, max_price, p25, p75, sample_count, collected_at FROM market_prices WHERE car_id = ?')
    .get(carId) as { median: number; min_price: number; max_price: number; p25: number; p75: number; sample_count: number; collected_at: string | null } | undefined;
  return r ? { median: r.median, minPrice: r.min_price, maxPrice: r.max_price, p25: r.p25, p75: r.p75,
    sampleCount: r.sample_count, collectedAt: r.collected_at ?? '' } : null;
}

/** 해당 검색 조건(search_query)으로 저장된 매물 car_id (NULL search_query는 포함되지 않음) */
export function getCarIdsBySearchQuery(searchQuery: string): string[] {
  const rows = getDb().prepare('SELECT car_id FROM vehicles WHERE search_query = ? ORDER BY car_id ASC')
    .all(searchQuery) as { car_id: string }[];
  return rows.map((r) => r.car_id);
}

/** search_query 소유가 그대로인 매물만 단일 트랜잭션으로 삭제 (자식 테이블은 ON DELETE CASCADE). 실제 삭제된 car_id 반환 */
export function deleteVehiclesOwnedBy(searchQuery: string, carIds: readonly string[]): string[] {
  const db = getDb();
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('foreign_keys가 꺼진 연결에서는 매물을 삭제할 수 없습니다 (자식 테이블이 남음)');
  }
  const del = db.prepare('DELETE FROM vehicles WHERE car_id = ? AND search_query = ?');
  return db.transaction((): string[] => carIds.filter((id) => del.run(id, searchQuery).changes > 0))();
}

/** 목록에서 본 매물의 last_seen_at 갱신 (DB에 없는 id는 무시). 갱신 행 수 반환 */
export function markVehiclesSeen(carIds: readonly string[], seenAt: string): number {
  const db = getDb();
  let changed = 0;
  db.transaction(() => {
    for (let i = 0; i < carIds.length; i += 500) {
      const chunk = carIds.slice(i, i + 500);
      changed += db.prepare(`UPDATE vehicles SET last_seen_at = ? WHERE car_id IN (${chunk.map(() => '?').join(', ')})`).run(seenAt, ...chunk).changes;
    }
  })();
  return changed;
}

export function countVehicles(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM vehicles').get() as { c: number }).c;
}

export function countStaleVehicles(cutoff: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS c FROM vehicles WHERE ${STALE_SQL}`).get(cutoff) as { c: number }).c;
}

export function getStaleCarIds(cutoff: string): string[] {
  return (getDb().prepare(`SELECT car_id FROM vehicles WHERE ${STALE_SQL} ORDER BY last_seen_at ASC, car_id ASC`).all(cutoff) as { car_id: string }[]).map((r) => r.car_id);
}

export interface StaleBreakdownRow {
  label: string; total: number; stale: number; lastSeenMax: string | null;
}

export function getStaleBreakdown(cutoff: string): StaleBreakdownRow[] {
  return getDb().prepare(
    `SELECT COALESCE(model_group, '(모델 미상)') AS label, COUNT(*) AS total,
            SUM(CASE WHEN ${STALE_SQL} THEN 1 ELSE 0 END) AS stale,
            MAX(CASE WHEN ${STALE_SQL} THEN last_seen_at END) AS lastSeenMax
     FROM vehicles GROUP BY label HAVING stale > 0 ORDER BY stale DESC, label ASC`
  ).all(cutoff, cutoff) as StaleBreakdownRow[];
}

/** 삭제 시점에도 여전히 미확인인 매물만 단일 트랜잭션으로 삭제 (자식 CASCADE). 실제 삭제 car_id 반환 */
export function deleteStaleVehicles(carIds: readonly string[], cutoff: string): string[] {
  const db = getDb();
  if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('foreign_keys가 꺼진 연결에서는 매물을 삭제할 수 없습니다 (자식 테이블이 남음)');
  const del = db.prepare(`DELETE FROM vehicles WHERE car_id = ? AND ${STALE_SQL}`);
  return db.transaction((): string[] => carIds.filter((id) => del.run(id, cutoff).changes > 0))();
}
