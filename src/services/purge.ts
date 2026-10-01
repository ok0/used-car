import path from 'node:path';
import { getDb, DB_PATH } from '../db/connection';
import {
  getStaleDays, staleCutoffIso, countVehicles, getStaleCarIds, getStaleBreakdown, deleteStaleVehicles, type StaleBreakdownRow,
} from '../db/repository';
import { rescoreAll, type RescoreSummary } from '../scoring/rescore';
import { DEFAULT_WEIGHTS } from '../scoring/calculator';

export const PURGE_MAX_RATIO = 0.5;
export const PURGE_BACKUP_FILE = 'used-car.purge-backup.db';

/** 미확인 매물 삭제 계획 (읽기만 함). CLI purge 와 GUI 정리 화면이 공유 */
export interface PurgePlan {
  staleDays: number;
  cutoff: string | null;          // null = STALE_DAYS=0 (끔)
  totalCount: number;
  candidates: string[];           // 마지막 확인 오래된 순
  breakdown: StaleBreakdownRow[]; // 모델별 (미확인 있는 모델만)
  overCap: boolean;               // 대상 > 전체 × PURGE_MAX_RATIO
  pct: number;                    // 대상/전체 % (정수)
  backupPath: string;             // 삭제 직전 백업 위치
}

export function planPurge(now: Date): PurgePlan {
  const staleDays = getStaleDays();
  const cutoff = staleCutoffIso(now, staleDays);
  const totalCount = countVehicles();
  const candidates = cutoff === null ? [] : getStaleCarIds(cutoff);
  const n = candidates.length;
  return {
    staleDays, cutoff, totalCount, candidates,
    breakdown: cutoff === null || n === 0 ? [] : getStaleBreakdown(cutoff),
    overCap: n > totalCount * PURGE_MAX_RATIO,
    pct: totalCount > 0 ? Math.round((n / totalCount) * 100) : 0,
    backupPath: path.join(path.dirname(DB_PATH), PURGE_BACKUP_FILE),
  };
}

export interface PurgeExecution { deleted: string[]; backupPath: string; rescored: RescoreSummary; }

/** 백업 → 삭제(삭제 시점에도 미확인인 것만) → 전체 재채점. 쓰기 연결 필요. 호출 전에 cutoff!==null, !overCap, 대상>0 확인 */
export async function executePurge(plan: PurgePlan, now: Date): Promise<PurgeExecution> {
  if (plan.cutoff === null || plan.overCap || plan.candidates.length === 0) throw new Error('삭제할 수 없는 계획입니다');
  await getDb().backup(plan.backupPath);
  const deleted = deleteStaleVehicles(plan.candidates, plan.cutoff);
  const rescored = rescoreAll(DEFAULT_WEIGHTS, now);
  return { deleted, backupPath: plan.backupPath, rescored };
}
