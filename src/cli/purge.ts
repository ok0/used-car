import path from 'node:path';
import { getDb, DB_PATH } from '../db/connection';
import { getStaleDays, staleCutoffIso, countVehicles, getStaleCarIds, getStaleBreakdown, deleteStaleVehicles, findVehicleById } from '../db/repository';
import { rescoreAll, type RescoreSummary } from '../scoring/rescore';
import { DEFAULT_WEIGHTS } from '../scoring/calculator';
import { fmtManwon, fmtYY, fmtKst, vehicleLabel } from './format';

export const PURGE_MAX_RATIO = 0.5;
export const PURGE_BACKUP_FILE = 'used-car.purge-backup.db';
const PURGE_LIST_MAX = 20;

export interface PurgeOptions {
  apply: boolean;
}

export interface PurgeDeps {
  log: (line: string) => void;
  now: () => Date;
}

export const defaultPurgeDeps: PurgeDeps = { log: (l) => console.log(l), now: () => new Date() };

export interface PurgeReport {
  staleDays: number;
  cutoff: string | null;
  totalCount: number;
  candidates: string[];
  deleted: string[];
  backupPath: string | null;
  skippedReason: string | null;
  rescored: RescoreSummary | null;
}

export async function runPurge(opts: PurgeOptions, deps: PurgeDeps = defaultPurgeDeps): Promise<PurgeReport> {
  const log = deps.log;
  const now = deps.now();
  const days = getStaleDays();
  const cutoff = staleCutoffIso(now, days);
  const totalCount = countVehicles();

  const report: PurgeReport = {
    staleDays: days,
    cutoff,
    totalCount,
    candidates: [],
    deleted: [],
    backupPath: null,
    skippedReason: null,
    rescored: null,
  };

  if (cutoff === null) {
    report.skippedReason = 'STALE_DAYS=0 이라 미확인 기준이 꺼져 있어 삭제 대상을 정할 수 없습니다';
    log(report.skippedReason);
    return report;
  }

  report.candidates = getStaleCarIds(cutoff);
  const n = report.candidates.length;

  if (n === 0) {
    log(`✅ ${days}일 이상 엔카 목록에서 확인되지 않은 매물이 없습니다 (전체 ${totalCount}대)`);
    return report;
  }

  log(`🧹 ${days}일 이상 엔카 목록에서 확인되지 않은 매물 ${n}대 / 전체 ${totalCount}대 (마지막 확인이 ${fmtKst(cutoff)} 이전) — 판매 완료·광고 종료 또는 렌트/리스/중복매물로 바뀐 매물, 혹은 그 검색 조건을 ${days}일 넘게 다시 수집하지 않은 매물입니다`);
  log('   모델별 (미확인 / DB 전체):');
  const breakdown = getStaleBreakdown(cutoff);
  for (const row of breakdown) {
    const suffix = row.stale === row.total
      ? ' ← 이 모델 전체가 미확인: 판매보다는 최근 재수집하지 않았을 가능성이 큽니다. 계속 볼 모델이면 삭제 대신 collect로 다시 수집하세요'
      : '';
    log(`   - ${row.label}: ${row.stale}대 / ${row.total}대 (마지막 확인 ~${fmtKst(row.lastSeenMax)})${suffix}`);
  }

  log('');
  for (const id of report.candidates.slice(0, PURGE_LIST_MAX)) {
    const v = findVehicleById(id);
    log(v === null ? `   - ${id}` : `   - ${id} ${vehicleLabel(v)} ${v.year > 0 ? fmtYY(v.year) + '년식' : '연식미상'} ${fmtManwon(v.price)} (마지막 확인 ${fmtKst(v.lastSeenAt)})`);
  }
  if (n > PURGE_LIST_MAX) log(`   … 외 ${n - PURGE_LIST_MAX}대`);

  const overCap = n > totalCount * PURGE_MAX_RATIO;
  const pct = Math.round((n / totalCount) * 100);

  if (!opts.apply) {
    if (overCap) {
      log(`   ⚠ 대상이 전체의 ${pct}%로 안전 기준(${PURGE_MAX_RATIO * 100}%)을 넘어 --apply 해도 삭제되지 않습니다 — 먼저 계속 볼 검색 조건을 collect로 다시 수집하세요`);
    }
    log(`   (이 매물들은 이미 비교·시세·가격 점수 기준에서 제외되어 있습니다)`);
    log(`   삭제하려면: npx ts-node src/index.ts purge --apply  (되돌릴 수 없음, 삭제 직전 data/${PURGE_BACKUP_FILE} 로 자동 백업)`);
    return report;
  }

  if (overCap) {
    report.skippedReason = `삭제 대상 ${n}대가 전체 ${totalCount}대의 ${pct}%로 안전 기준(${PURGE_MAX_RATIO * 100}%)을 넘어 삭제하지 않았습니다 — 계속 볼 검색 조건을 먼저 collect로 다시 수집하세요`;
    log(`   ⚠ ${report.skippedReason}`);
    return report;
  }

  report.backupPath = path.join(path.dirname(DB_PATH), PURGE_BACKUP_FILE);
  await getDb().backup(report.backupPath);

  report.deleted = deleteStaleVehicles(report.candidates, cutoff);
  report.rescored = rescoreAll(DEFAULT_WEIGHTS, now);

  log(`🗑 ${report.deleted.length}대 삭제 완료${report.deleted.length < n ? ` (${n - report.deleted.length}대는 그사이 다시 확인되어 유지)` : ''} | 재채점: ${report.rescored.total}대 중 ${report.rescored.changed}대 변경`);
  log(`   삭제 전 백업: ${report.backupPath} (되돌리려면 이 파일을 data/used-car.db 로 복사. 다음 purge --apply 때 덮어씀)`);

  return report;
}

export async function purgeCommand(opts: PurgeOptions): Promise<number> {
  const r = await runPurge(opts);
  return r.skippedReason !== null ? 1 : 0;
}
