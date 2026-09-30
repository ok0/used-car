import path from 'node:path';
import { getDb, closeDb, DB_PATH } from '../db/connection';
import {
  findVehicleById, hasVehicle, upsertVehicle, upsertAccidents, upsertOptions,
  upsertOwnerChanges, upsertUsageHistory, upsertMarketPrice, upsertYearlyPrices,
  getYearlyPricesByCarId, updateVehicleScore, getCarIdsBySearchQuery, deleteVehiclesOwnedBy,
} from '../db/repository';
import { parseEncarSearchUrl } from '../crawler/url-parser';
import { crawlList, type CrawlListOptions } from '../crawler/list-crawler';
import {
  crawlDetails, isMarketFetchEnabled, isYearlyFetchEnabled,
  DETAIL_CONCURRENCY, type CrawlDetailsOptions, type CrawlDetailsResult, type DetailResultEvent,
} from '../crawler/detail-crawler';
import { BlockedError } from '../crawler/fetch-helper';
import { scoreVehicle, rescoreAll, type RescoreSummary } from '../scoring/rescore';
import { GRADES, type CollectedVehicle, type Grade, type ScoreResult, type SearchResult } from '../types';
import { fmtManwon, fmtYY, fmtGradeDistribution, vehicleLabel } from './format';

export interface CollectOptions { startPage?: number; maxPages?: number; limit?: number; skipExisting?: boolean; prune?: boolean; }
export const PRUNE_MAX_RATIO = 0.5;
export const PRUNE_BACKUP_FILE = 'used-car.prune-backup.db';
const PRUNE_LIST_MAX = 20;
export interface PruneReport {
  mode: 'report' | 'prune';
  ownedCount: number;        // 판단 시점에 이 search_query로 저장된 매물 수
  candidates: string[];      // 1차 목록에 없던 매물
  recheckFound: number;      // (prune) 재조회 목록에서 다시 보여 삭제에서 제외된 수
  deleted: string[];         // 실제 삭제된 car_id
  backupPath: string | null; // (prune) 삭제 직전 백업 파일
  skippedReason: string | null;
}
export interface CollectDeps {
  crawlList: (searchQuery: string, options: CrawlListOptions) => Promise<SearchResult[]>;
  crawlDetails: (items: SearchResult[], opts: CrawlDetailsOptions) => Promise<CrawlDetailsResult>;
  log: (line: string) => void;
}
export const defaultCollectDeps: CollectDeps = { crawlList, crawlDetails, log: (l) => console.log(l) };
export type CollectStatus = 'completed' | 'blocked' | 'interrupted';
export interface CollectReport {
  status: CollectStatus; searchQuery: string;
  listed: number; skippedExisting: number; targeted: number;
  saved: string[]; failed: { carId: string; error: string }[];
  rescored: RescoreSummary | null;
  prune: PruneReport | null;
}

export function saveCollectedVehicle(b: CollectedVehicle, opts: { replaceYearly: boolean }): ScoreResult {
  const carId = b.vehicle.carId;
  return getDb().transaction((): ScoreResult => {
    upsertVehicle({ ...b.vehicle, scoreTotal: null, scoreGrade: null, scoreBreakdown: null, scorePenalty: null });
    upsertAccidents(carId, b.accidents);
    upsertOptions(carId, b.options);
    upsertOwnerChanges(carId, b.ownerChanges.map((o) => o.changeDate));
    upsertUsageHistory(carId, [...b.usageHistory].sort((x, y) => x.seq - y.seq).map((u) => u.usageCode));
    if (b.marketPrice) upsertMarketPrice(carId, b.marketPrice);
    if (opts.replaceYearly) upsertYearlyPrices(carId, b.yearlyPrices);
    const score = scoreVehicle(b.vehicle, b.accidents, getYearlyPricesByCarId(carId));
    updateVehicleScore(carId, score);
    return score;
  })();
}

function skippedPrune(reason: string): PruneReport {
  return { mode: 'prune', ownedCount: 0, candidates: [], recheckFound: 0, deleted: [], backupPath: null, skippedReason: reason };
}

function logVehicleIds(ids: readonly string[], log: (line: string) => void): void {
  for (const id of ids.slice(0, PRUNE_LIST_MAX)) {
    const v = findVehicleById(id);
    log(v === null ? `   - ${id}` : `   - ${id} ${vehicleLabel(v)} ${v.year > 0 ? fmtYY(v.year) + '년식' : '연식미상'} ${fmtManwon(v.price)} (수집 ${v.collectedAt.slice(0, 10)})`);
  }
  if (ids.length > PRUNE_LIST_MAX) log(`   … 외 ${ids.length - PRUNE_LIST_MAX}대`);
}

async function evaluatePrune(
  searchQuery: string, listed: SearchResult[], prune: boolean, deps: CollectDeps, shouldStop: () => boolean,
): Promise<PruneReport> {
  const log = deps.log;
  const listedIds = new Set(listed.map((r) => r.carId));
  const owned = getCarIdsBySearchQuery(searchQuery);
  const candidates = owned.filter((id) => !listedIds.has(id));
  const out: PruneReport = {
    mode: prune ? 'prune' : 'report', ownedCount: owned.length, candidates,
    recheckFound: 0, deleted: [], backupPath: null, skippedReason: null,
  };
  if (candidates.length === 0) return out;
  log('');
  log(`🧹 이번 목록에 없던 기존 매물 ${candidates.length}대 (이 검색 조건으로 저장된 ${owned.length}대 중) — 판매 완료·광고 종료 또는 렌트/리스/중복매물로 바뀐 매물일 수 있습니다`);
  if (!prune) {
    logVehicleIds(candidates, log);
    log('   삭제하려면 같은 명령에 --prune 을 붙여 다시 실행하세요 (삭제 전에 목록을 한 번 더 확인합니다).');
    return out;
  }
  if (listed.length === 0) { out.skippedReason = '검색 결과가 0대라 엔카 응답 이상일 수 있어 삭제하지 않았습니다'; return out; }
  log('🔎 삭제 전 목록을 한 번 더 조회해 확인합니다...');
  let recheck: SearchResult[];
  try {
    recheck = await deps.crawlList(searchQuery, { startPage: 1, log: () => {} });
  } catch (err) {
    out.skippedReason = err instanceof BlockedError
      ? '목록 재확인 중 엔카 차단 — 삭제하지 않았습니다'
      : `목록 재확인 실패(${err instanceof Error ? err.message : String(err)}) — 삭제하지 않았습니다`;
    return out;
  }
  if (shouldStop()) { out.skippedReason = '사용자 중단 요청 — 삭제하지 않았습니다'; return out; }
  if (recheck.length === 0) { out.skippedReason = '재확인 목록이 0대라 엔카 응답 이상일 수 있어 삭제하지 않았습니다'; return out; }
  const recheckIds = new Set(recheck.map((r) => r.carId));
  const confirmed = candidates.filter((id) => !recheckIds.has(id));
  out.recheckFound = candidates.length - confirmed.length;
  if (out.recheckFound > 0) log(`   재확인 목록에서 다시 보인 ${out.recheckFound}대는 유지합니다 (수집 중 목록 순서 변동으로 누락된 매물)`);
  if (confirmed.length === 0) return out;
  if (confirmed.length > owned.length * PRUNE_MAX_RATIO) {
    out.skippedReason = `삭제 대상 ${confirmed.length}대가 이 검색 조건 매물 ${owned.length}대의 ${Math.round((confirmed.length / owned.length) * 100)}%로 안전 기준(${Math.round(PRUNE_MAX_RATIO * 100)}%)을 넘어 삭제하지 않았습니다 — 검색 URL이 바뀌었거나 엔카 응답 이상일 수 있습니다`;
    return out;
  }
  log(`   삭제 대상 ${confirmed.length}대 (두 번 조회한 목록 모두에 없음):`);
  logVehicleIds(confirmed, log);
  out.backupPath = path.join(path.dirname(DB_PATH), PRUNE_BACKUP_FILE);
  await getDb().backup(out.backupPath);
  out.deleted = deleteVehiclesOwnedBy(searchQuery, confirmed);
  log(`🗑 ${out.deleted.length}대 삭제 완료 (삭제 전 백업: ${out.backupPath})`);
  return out;
}

export async function runCollect(
  url: string,
  opts: CollectOptions = {},
  deps: CollectDeps = defaultCollectDeps,
  shouldStop: () => boolean = () => false,
): Promise<CollectReport> {
  const { searchQuery } = parseEncarSearchUrl(url);
  const fullList = (opts.startPage ?? 1) === 1 && opts.maxPages === undefined && opts.limit === undefined;
  if (opts.prune === true && !fullList) {
    const bad = [
      (opts.startPage ?? 1) > 1 ? '--start-page' : null,
      opts.maxPages !== undefined ? '--max-pages' : null,
      opts.limit !== undefined ? '--limit' : null,
    ].filter((x): x is string => x !== null);
    throw new Error(`--prune은 ${bad.join(', ')} 와 함께 쓸 수 없습니다 — 목록 전체를 수집하는 실행에서만 삭제할 수 있습니다`);
  }
  const log = deps.log;
  const replaceYearly = isYearlyFetchEnabled();

  log(`🔍 검색 조건: ${searchQuery}`);
  log(`ℹ 동급매물 시세(ENCAR_FETCH_MARKET): ${isMarketFetchEnabled() ? 'ON' : 'OFF'} | 연식별 시세(ENCAR_FETCH_YEARLY): ${replaceYearly ? 'ON' : 'OFF'}`);
  if (!replaceYearly) {
    log(`  가격 점수 기준: 로컬 DB 동일 모델·트림·연식 평균가(표본 3대 이상, 없으면 중립 50%). 엔카 연식별 시세를 쓰려면 ENCAR_FETCH_YEARLY=1 (매물당 검색 API 호출 증가)`);
  }
  log('');
  log('📄 페이지 수집 중...');

  const startPage = opts.startPage ?? 1;
  if (startPage > 1) log(`ℹ 시작 페이지: ${startPage} (--start-page)`);
  const listed = await deps.crawlList(searchQuery, { startPage, maxPages: opts.maxPages, log: (l) => log(`  ${l}`) });

  const report: CollectReport = {
    status: 'completed',
    searchQuery,
    listed: listed.length,
    skippedExisting: 0,
    targeted: 0,
    saved: [],
    failed: [],
    rescored: null,
    prune: null,
  };

  let targets = listed;
  if (opts.skipExisting) {
    targets = listed.filter((r) => !hasVehicle(r.carId));
    report.skippedExisting = listed.length - targets.length;
    if (report.skippedExisting > 0) {
      log(`  --skip-existing: DB에 이미 있는 ${report.skippedExisting}대 제외`);
    }
  }

  if (opts.limit !== undefined && targets.length > opts.limit) {
    log(`  --limit ${opts.limit}: ${targets.length}대 중 ${opts.limit}대만 상세 수집`);
    targets = targets.slice(0, opts.limit);
  }

  report.targeted = targets.length;

  if (shouldStop()) {
    report.status = 'interrupted';
    return report;
  }

  if (targets.length > 0) {
    log('');
    log(`📥 상세 데이터 수집 중... (${targets.length}대, 동시 ${DETAIL_CONCURRENCY}건)`);
    log(`   ※ "(잠정)" 점수는 수집 도중의 로컬 시세 기준 임시값입니다. 수집 종료 후 DB 전체를 재채점합니다.`);

    const onResult = (e: DetailResultEvent): void => {
      const prefix = `  [${e.completed}/${e.total}]`;
      if (!e.bundle) {
        const msg = e.error?.message ?? '알 수 없는 오류';
        report.failed.push({ carId: e.carId, error: msg });
        log(`${prefix} ${e.carId} → ${e.error instanceof BlockedError ? '⛔ 차단됨' : '⚠️ ' + msg} (스킵)`);
        return;
      }
      try {
        const score = saveCollectedVehicle(e.bundle, { replaceYearly });
        report.saved.push(e.carId);
        const v = e.bundle.vehicle;
        log(`${prefix} ${vehicleLabel(v)} ${v.year > 0 ? fmtYY(v.year) + '년식' : '연식미상'} ${fmtManwon(v.price)} → ${score.grade}등급 ${score.total}점(잠정) ✅`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.failed.push({ carId: e.carId, error: `DB 저장 실패: ${msg}` });
        log(`${prefix} ${e.carId} → ⚠️ DB 저장 실패: ${msg} (스킵)`);
      }
    };

    try {
      await deps.crawlDetails(targets, { searchQuery, onResult, log: (_l: string) => {}, shouldStop });
      if (shouldStop()) report.status = 'interrupted';
    } catch (err) {
      if (err instanceof BlockedError) report.status = 'blocked';
      else throw err;
    }
  }

  if (fullList) {
    if (report.status === 'completed') {
      report.prune = await evaluatePrune(searchQuery, listed, opts.prune === true, deps, shouldStop);
    } else if (opts.prune === true) {
      report.prune = skippedPrune(report.status === 'blocked'
        ? '엔카 차단으로 수집이 끝나지 않아 삭제하지 않았습니다'
        : '수집이 중단되어 삭제하지 않았습니다');
    }
  }

  if (report.saved.length > 0 || (report.prune?.deleted.length ?? 0) > 0) {
    log('');
    log('🔄 DB 전체 재채점 중...');
    report.rescored = rescoreAll();
  }

  return report;
}

function pruneSummaryLine(p: PruneReport | null): string | null {
  if (p === null) return null;
  if (p.skippedReason !== null) return `   ⚠ 정리(--prune) 건너뜀: ${p.skippedReason}`;
  if (p.mode === 'report') return p.candidates.length > 0 ? `   이번 목록에 없던 기존 매물 ${p.candidates.length}대는 DB에 남아 있습니다 (삭제하려면 --prune)` : null;
  if (p.candidates.length === 0) return '   정리(--prune): 이번 목록에 없던 기존 매물 없음';
  return `   정리(--prune): ${p.deleted.length}대 삭제${p.recheckFound > 0 ? `, 재확인에서 다시 보인 ${p.recheckFound}대 유지` : ''}${p.backupPath !== null ? ` (삭제 전 백업: ${p.backupPath})` : ''}`;
}

export function printCollectReport(r: CollectReport, log: (line: string) => void = console.log): void {
  const done = r.saved.length + r.failed.length;
  const pending = r.targeted - done;
  const vehicles = r.saved.map(findVehicleById).filter((v): v is typeof v & {} => v !== null);
  const dist = Object.fromEntries(GRADES.map((g) => [g, 0])) as Record<Grade, number>;
  for (const v of vehicles) {
    if (v.scoreGrade) dist[v.scoreGrade]++;
  }
  const scored = vehicles.filter((v) => v.scoreTotal != null);

  log('');
  const pruneLine = pruneSummaryLine(r.prune);
  if (r.status === 'completed' && r.targeted === 0) {
    log(`ℹ 상세 수집 대상이 없습니다 (검색 결과 ${r.listed}대, 기존 제외 ${r.skippedExisting}대).`);
    if (pruneLine !== null) log(pruneLine);
    if (r.rescored) log(`   재채점: DB 전체 ${r.rescored.total}대 중 ${r.rescored.changed}대 점수 변경`);
    return;
  }

  if (r.status === 'completed') {
    log(`✅ 수집 완료: ${r.saved.length}/${r.targeted}대 성공, ${r.failed.length}대 실패`);
  } else if (r.status === 'blocked') {
    log(`⛔ 엔카 API 차단으로 중단: ${r.saved.length}/${r.targeted}대 저장, ${r.failed.length}대 실패, ${pending}대 미처리`);
  } else if (r.status === 'interrupted') {
    log(`⏹ 사용자 요청으로 중단: ${r.saved.length}/${r.targeted}대 저장, ${r.failed.length}대 실패, ${pending}대 미처리`);
  }

  if (vehicles.length > 0) {
    log(`   ${fmtGradeDistribution(dist)}`);
    const avgScore = scored.length ? (scored.reduce((sum, v) => sum + (v.scoreTotal ?? 0), 0) / scored.length).toFixed(1) : '-';
    const avgPrice = vehicles.length ? (vehicles.reduce((sum, v) => sum + v.price, 0) / vehicles.length) : 0;
    log(`   평균 점수: ${avgScore}점 | 평균 가격: ${fmtManwon(avgPrice)}`);
  }

  if (r.rescored) {
    log(`   재채점: DB 전체 ${r.rescored.total}대 중 ${r.rescored.changed}대 점수 변경 (위 등급·점수는 재채점 후 값)`);
  }

  if (pruneLine !== null) log(pruneLine);

  if (r.failed.length > 0) {
    log(`   실패 목록 (${r.failed.length}대):`);
    for (const f of r.failed) {
      log(`     - ${f.carId}: ${f.error}`);
    }
  }

  if (r.status === 'blocked') {
    log(`   지금까지 수집한 ${r.saved.length}대는 저장·재채점되었습니다.`);
    log(`   네트워크(IP)를 바꾸거나 잠시 후, 같은 명령에 --skip-existing 을 붙여 이어서 수집하세요.`);
  } else if (r.status === 'interrupted' && pending > 0) {
    log(`   이어서 수집하려면 같은 명령에 --skip-existing 을 붙여 다시 실행하세요.`);
  }
}

export async function collectCommand(url: string, opts: CollectOptions): Promise<number> {
  let stopRequested = false;

  const onSigint = (): void => {
    if (stopRequested) {
      console.error('\n⛔ 강제 종료합니다. 저장된 매물의 점수는 잠정치입니다 — 나중에 npx ts-node src/scoring/rescore.ts 로 재채점하세요.');
      closeDb();
      process.exit(130);
    }
    stopRequested = true;
    console.error('\n⏹ 중단 요청됨 — 진행 중인 매물까지 저장·재채점 후 종료합니다. (즉시 강제 종료: Ctrl+C 한 번 더)');
  };

  process.on('SIGINT', onSigint);

  try {
    const r = await runCollect(url, opts, defaultCollectDeps, () => stopRequested);
    printCollectReport(r);
    if (r.status === 'blocked') return 2;
    if (r.status === 'interrupted') return 130;
    if (r.targeted > 0 && r.saved.length === 0) return 1;
    return 0;
  } catch (err) {
    if (err instanceof BlockedError) {
      console.error(`⛔ 목록 수집 중 엔카 API 차단: ${err.message}`);
      console.error('   저장된 매물은 없습니다. 네트워크(IP)를 바꾸거나 잠시 후 다시 시도하세요.');
      return 2;
    }
    console.error(`❌ 수집 실패: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    process.off('SIGINT', onSigint);
  }
}
