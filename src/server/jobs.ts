// 서버 작업 큐: DB를 쓰는 작업(수집·정리)은 동시에 1개. 실행 중에만 쓰기 연결 + 파일 잠금(CLI와 공유)
import crypto from 'node:crypto';
import { withWritableDb } from '../db/connection';
import { tryAcquireJobLock, lockHeldMessage, JOB_LOCK_PATH } from '../db/job-lock';
import { BlockedError } from '../crawler/fetch-helper';
import { isMarketFetchEnabled, isYearlyFetchEnabled } from '../crawler/detail-crawler';
import {
  runCollect, printCollectReport, collectSavedStats, defaultCollectDeps,
  type CollectDeps, type CollectProgressEvent, type CollectReport,
} from '../cli/collect';
import {
  MAX_JOB_LOG_LINES,
  type CollectJobParams, type CollectJobResult, type CollectProgress, type JobSnapshot, type JobState, type JobStreamEvent,
} from './api-types';

export class JobError extends Error {
  constructor(public readonly code: 'JOB_RUNNING' | 'LOCKED' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'JobError';
  }
}

export type JobListener = (e: JobStreamEvent) => void;

export interface JobManagerOptions {
  collectDeps?: Pick<CollectDeps, 'crawlList' | 'crawlDetails' | 'now'>; // 테스트에서 스텁 주입. 기본 실제 크롤러
  lockPath?: string;
  maxLogLines?: number;
}

interface Job {
  snap: JobSnapshot;
  log: (line: string) => void;
  listeners: Set<JobListener>;
  done: Promise<void>;
}

export interface JobManager {
  startCollect(params: CollectJobParams): JobSnapshot;
  get(id: string): JobSnapshot | null;
  current(): JobSnapshot | null;          // 실행 중, 없으면 마지막 작업
  isRunning(): boolean;
  requestStop(id: string): JobSnapshot;
  subscribe(id: string, listener: JobListener): (() => void) | null;
  /** 정리(purge) 등 짧은 쓰기 작업을 같은 규칙(동시 1개·잠금·쓰기 연결)으로 실행 */
  runExclusive<T>(kind: string, fn: () => Promise<T>): Promise<T>;
  /** 서버 종료: 실행 중 수집에 중단을 요청하고 끝날 때까지 기다림 */
  shutdown(): Promise<void>;
  /** 강제 종료 직전: 이 프로세스가 잡은 잠금 파일만 지움 */
  forceRelease(): void;
}

export function defaultCollectParams(p: Omit<CollectJobParams, 'fetchMarket' | 'fetchYearly'> & { fetchMarket?: boolean; fetchYearly?: boolean }): CollectJobParams {
  return { ...p, fetchMarket: p.fetchMarket ?? isMarketFetchEnabled(), fetchYearly: p.fetchYearly ?? isYearlyFetchEnabled() };
}

function toResult(r: CollectReport): CollectJobResult {
  const st = collectSavedStats(r);
  return {
    status: r.status, searchQuery: r.searchQuery,
    listed: r.listed, skippedExisting: r.skippedExisting, targeted: r.targeted,
    saved: r.saved.length, failed: r.failed, pending: st.pending,
    gradeDistribution: st.gradeDistribution, avgScore: st.avgScore, avgPrice: st.avgPrice,
    rescored: r.rescored,
    prune: r.prune === null ? null : {
      mode: r.prune.mode, ownedCount: r.prune.ownedCount, candidates: r.prune.candidates.length, recheckFound: r.prune.recheckFound,
      deleted: r.prune.deleted.length, backupPath: r.prune.backupPath, skippedReason: r.prune.skippedReason,
    },
    seenUpdated: r.seenUpdated, stale: r.stale,
  };
}

export function createJobManager(opts: JobManagerOptions = {}): JobManager {
  const lockPath = opts.lockPath ?? JOB_LOCK_PATH;
  const maxLog = opts.maxLogLines ?? MAX_JOB_LOG_LINES;
  const deps = opts.collectDeps ?? defaultCollectDeps;
  const jobs = new Map<string, Job>();   // 최근 작업만 보관 (새 작업 시작 때 이전 것 삭제)
  let running: Job | null = null;
  let last: Job | null = null;
  let exclusiveBusy = false;
  let heldRelease: (() => void) | null = null;

  const emit = (job: Job, e: JobStreamEvent): void => {
    for (const l of job.listeners) {
      try { l(e); } catch { /* 연결 끊긴 구독자 */ }
    }
  };

  function takeSlot(kind: string): () => void {
    if (running !== null || exclusiveBusy) throw new JobError('JOB_RUNNING', '다른 수집·정리 작업이 실행 중입니다. 끝난 뒤 다시 시도하세요');
    const lock = tryAcquireJobLock(kind, lockPath);
    if (!lock.ok) throw new JobError('LOCKED', lockHeldMessage(lock.holder, lockPath));
    heldRelease = lock.release;
    return (): void => { lock.release(); heldRelease = null; };
  }

  function startCollect(params: CollectJobParams): JobSnapshot {
    const release = takeSlot('gui-collect');
    const snap: JobSnapshot = {
      id: crypto.randomUUID(), kind: 'collect', state: 'running', stopRequested: false, params,
      startedAt: new Date().toISOString(), finishedAt: null,
      progress: { phase: 'starting', listPage: null, listLastPage: null, listed: null, skippedExisting: 0, targeted: null, completed: 0, saved: 0, failed: 0 },
      log: [], logDropped: 0, result: null, error: null,
    };
    const job: Job = { snap, log: () => {}, listeners: new Set(), done: Promise.resolve() };
    if (last !== null) jobs.delete(last.snap.id);
    jobs.set(snap.id, job);
    running = job;

    // 로그는 짧은 간격으로 모아 보낸다 (상세 1건마다 1줄)
    let pendingLines: string[] = [];
    let pendingFrom = 0;
    let flushTimer: NodeJS.Timeout | null = null;
    const flush = (): void => {
      if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
      if (pendingLines.length === 0) return;
      const lines = pendingLines;
      pendingLines = [];
      emit(job, { event: 'log', data: { from: pendingFrom, lines } });
    };
    const log = (line: string): void => {
      if (pendingLines.length === 0) pendingFrom = snap.logDropped + snap.log.length;
      snap.log.push(line);
      if (snap.log.length > maxLog) { const n = snap.log.length - maxLog; snap.log.splice(0, n); snap.logDropped += n; }
      pendingLines.push(line);
      if (flushTimer === null) flushTimer = setTimeout(flush, 100);
    };
    job.log = log;
    const onProgress = (e: CollectProgressEvent): void => {
      const p = snap.progress;
      if (e.type === 'phase') p.phase = e.phase;
      else if (e.type === 'listPage') { p.listPage = e.page; p.listLastPage = e.lastPage; p.listed = e.collected; }
      else if (e.type === 'listed') { p.listed = e.listed; p.skippedExisting = e.skippedExisting; p.targeted = e.targeted; }
      else { p.completed = e.completed; p.saved = e.saved; p.failed = e.failed; }
      flush();
      emit(job, { event: 'progress', data: { ...p } });
    };

    job.done = (async (): Promise<void> => {
      try {
        await withWritableDb(async () => {
          const r = await runCollect(params.url, {
            startPage: params.startPage, maxPages: params.maxPages ?? undefined, limit: params.limit ?? undefined,
            skipExisting: params.skipExisting, prune: params.prune, fetchMarket: params.fetchMarket, fetchYearly: params.fetchYearly,
          }, { ...deps, log, onProgress }, () => snap.stopRequested);
          printCollectReport(r, log);
          snap.result = toResult(r);
          snap.state = r.status;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof BlockedError) {
          snap.state = 'blocked';
          snap.error = `목록 수집 중 엔카 API 차단: ${msg}`;
          log(`⛔ ${snap.error}`);
          log('   저장된 매물은 없습니다. 네트워크(IP)를 바꾸거나 잠시 후 다시 시도하세요.');
        } else {
          snap.state = 'failed';
          snap.error = msg;
          log(`❌ 수집 실패: ${msg}`);
        }
      } finally {
        release();
        snap.progress.phase = 'done';
        snap.finishedAt = new Date().toISOString();
        running = null;
        last = job;
        flush();
        emit(job, { event: 'end', data: structuredClone(snap) });
        job.listeners.clear();
      }
    })();
    return structuredClone(snap);
  }

  function find(id: string): Job {
    const j = jobs.get(id);
    if (!j) throw new JobError('NOT_FOUND', `작업을 찾을 수 없습니다: ${id}`);
    return j;
  }

  return {
    startCollect,
    get: (id) => { const j = jobs.get(id); return j ? structuredClone(j.snap) : null; },
    current: () => { const j = running ?? last; return j ? structuredClone(j.snap) : null; },
    isRunning: () => running !== null || exclusiveBusy,
    requestStop: (id) => {
      const j = find(id);
      if (j.snap.state === 'running' && !j.snap.stopRequested) {
        j.snap.stopRequested = true;
        j.log('⏹ 중단 요청됨 — 진행 중인 매물까지 저장·재채점 후 종료합니다.');
        emit(j, { event: 'state', data: { state: j.snap.state, stopRequested: true } });
      }
      return structuredClone(j.snap);
    },
    subscribe: (id, listener) => {
      const j = jobs.get(id);
      if (!j) return null;
      listener({ event: 'snapshot', data: structuredClone(j.snap) });
      if (j.snap.state !== 'running') { listener({ event: 'end', data: structuredClone(j.snap) }); return () => {}; }
      j.listeners.add(listener);
      return () => { j.listeners.delete(listener); };
    },
    runExclusive: async <T>(kind: string, fn: () => Promise<T>): Promise<T> => {
      const release = takeSlot(kind);
      exclusiveBusy = true;
      try {
        return await withWritableDb(fn);
      } finally {
        exclusiveBusy = false;
        release();
      }
    },
    shutdown: async () => {
      const j = running;
      if (j === null) return;
      j.snap.stopRequested = true;
      await j.done;
    },
    forceRelease: () => { heldRelease?.(); },
  };
}
