import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { getSummary, getStaleDays, findVehicleById } from '../db/repository';
import { DB_PATH } from '../db/connection';
import { DEFAULT_ENV_PATH } from '../env';
import { BlockedError } from '../crawler/fetch-helper';
import { fetchSearchCount, PAGE_SIZE } from '../crawler/list-crawler';
import { planPurge, executePurge, PURGE_MAX_RATIO } from '../services/purge';
import { ENV_KEYS, EnvSettingsError, readEnvFile, saveEnvChanges, type EnvFileState } from '../services/env-settings';
import { createJobManager, defaultCollectParams, JobError, type JobManager, type JobManagerOptions } from './jobs';
import { UrlBodyError, parseCollectBody, parseConfigBody, parsePurgeBody, parseSearchUrlBody } from './job-body';
import { DEFAULT_WEIGHTS } from '../scoring/calculator';
import { inputTitle, buildVerdictLines, buildRecommendations, buildKnnLines } from '../comparator/reporter';
import { CompareError, resolveCompareSettings, runCompare, type CompareSettings } from '../services/compare';
import { listVehicles, getVehicleDetail, toListItem } from '../services/vehicles';
import { BusyError, createExternalFetcher } from './external-fetch';
import { BodyError, CLI_FLAG_LABEL, parseCompareBody, replaceCliFlags } from './compare-body';
import {
  CLIENT_HEADER, CLIENT_HEADER_VALUE,
  type ApiErrorBody, type ApiErrorCode, type CompareResponse, type CompareSettingsInfo, type HealthResponse, type SettingsResponse,
  type SummaryResponse, type VehicleDetailResponse, type VehicleListResponse,
  type CollectPreviewResponse, type ConfigResponse, type ConfigSaveResponse, type CurrentJobResponse, type JobResponse, type JobStreamEvent,
  type PurgeApplyResponse, type PurgePreviewResponse,
} from './api-types';
import type { VehicleSortField } from '../types';

/** 웹 빌드 산출물 기본 위치 (src/server 와 dist/server 모두에서 ../../web/dist) */
export const DEFAULT_WEB_ROOT = path.resolve(__dirname, '../../web/dist');

export interface AppOptions {
  webRoot: string | null;                        // null = 정적 파일 서빙 안 함 (개발 모드: Vite가 서빙)
  fetchHtml?: (url: string) => Promise<string>;  // 외부 HTML 조회 (테스트에서 픽스처 주입). 기본 fetch-helper.fetchText
  now?: () => Date;
  jobs?: JobManager;                                              // 기본: createJobManager({ collectDeps })
  collectDeps?: JobManagerOptions['collectDeps'];                 // 테스트: 크롤러 스텁
  searchCount?: (searchQuery: string) => Promise<number | null>;  // 테스트: 검색 총건수 스텁. 기본 list-crawler.fetchSearchCount
  envPath?: string;                                               // 테스트: .env 경로. 기본 프로젝트 루트 .env
}

/** 오류 응답용 예외 */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: ApiErrorCode, message: string, public readonly details: string[] = []) {
    super(message);
    this.name = 'ApiError';
  }
}

const COMPARE_STATUS: Record<CompareError['code'], number> = {
  INVALID_CONFIG: 500, INVALID_INPUT: 400, INVALID_URL: 400, UNSUPPORTED_URL: 400, PLATFORM_MISMATCH: 400,
  LISTING_NOT_FOUND: 422, FETCH_FAILED: 502, EMPTY_DB: 422, NO_PEERS: 422,
};
const SORTS: readonly VehicleSortField[] = ['price', 'score', 'mileage', 'year'];
const CAR_ID_RE = /^[0-9A-Za-z_-]{1,40}$/;
const JOB_ID_RE = /^[0-9a-f-]{36}$/;
const JOB_ERROR_STATUS: Record<JobError['code'], number> = { JOB_RUNNING: 409, LOCKED: 409, NOT_FOUND: 404 };
const HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;

function sendError(reply: FastifyReply, status: number, code: ApiErrorCode, message: string, details: string[] = []): FastifyReply {
  const body: ApiErrorBody = { error: { code, message, details } };
  return reply.code(status).header('cache-control', 'no-store').type('application/json; charset=utf-8').send(body);
}

export function settingsInfo(s: CompareSettings): CompareSettingsInfo {
  const r = s.matchConfig.mileageRatios;
  return {
    yearRange: s.matchConfig.yearRange,
    mileagePercents: r === null ? null : r.map((x) => Math.round(x * 10000) / 100),
    minSamples: s.matchConfig.minSamples,
    specMaxAdjust: s.specMaxAdjust,
    hyundaiPremium: s.hyundaiPremium,
    knnEnabled: s.knn.enabled,
    knnN: s.knn.n,
    verdictSource: s.knn.primary ? 'knn' : 'current',
  };
}

function queryString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const now = opts.now ?? ((): Date => new Date());
  const fetchHtml = createExternalFetcher({ fetchHtml: opts.fetchHtml });
  const jobs = opts.jobs ?? createJobManager({ collectDeps: opts.collectDeps });
  const searchCount = opts.searchCount ?? fetchSearchCount;
  const envPath = opts.envPath ?? DEFAULT_ENV_PATH;
  let previewBusy = false;

  // 1) 로컬 전용: Host / Origin 검증 (DNS rebinding·타 사이트 요청 차단). CORS 헤더는 어디에서도 내보내지 않는다.
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    if (!HOST_RE.test(host)) return sendError(reply, 403, 'FORBIDDEN', `허용되지 않은 Host: ${host}`);
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return sendError(reply, 403, 'FORBIDDEN', `허용되지 않은 Origin: ${origin}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) return sendError(reply, 403, 'FORBIDDEN', `${CLIENT_HEADER} 헤더가 필요합니다`);
      const ct = req.headers['content-type'] ?? '';
      if (!/^application\/json\b/i.test(ct)) return sendError(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type: application/json 만 허용합니다');
    }
  });

  // 2) 공통 보안 헤더
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    else reply.header('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    return payload;
  });

  // 3) API 요청 한 줄 로그
  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/api/')) console.log(`${req.method} ${req.url} → ${reply.statusCode} (${Math.round(reply.elapsedTime)}ms)`);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) return sendError(reply, err.status, err.code, err.message, err.details);
    if (err instanceof CompareError) {
      return sendError(reply, COMPARE_STATUS[err.code], err.code, replaceCliFlags(err.message), err.details.map(replaceCliFlags));
    }
    if (err instanceof BodyError) return sendError(reply, 400, 'INVALID_INPUT', err.message);
    if (err instanceof BusyError) return sendError(reply, 429, 'BUSY', err.message);
    if (err instanceof UrlBodyError) return sendError(reply, 400, 'INVALID_URL', err.message);
    if (err instanceof JobError) return sendError(reply, JOB_ERROR_STATUS[err.code], err.code, err.message);
    if (err instanceof EnvSettingsError) return sendError(reply, err.code === 'ENV_CHANGED' ? 409 : 400, err.code, err.message, err.details);
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return sendError(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type: application/json 만 허용합니다');
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      return sendError(reply, 400, 'BAD_REQUEST', e.code?.startsWith('FST_ERR_CTP') ? '요청 본문 JSON이 올바르지 않습니다' : (e.message ?? '잘못된 요청'));
    }
    console.error(err);
    return sendError(reply, 500, 'INTERNAL', `서버 오류: ${e.message ?? String(err)}`);
  });

  // ───── API ─────
  app.get('/api/health', async (): Promise<HealthResponse> => ({ ok: true }));

  app.get('/api/settings', async (): Promise<SettingsResponse> => ({
    compare: settingsInfo(resolveCompareSettings()),
    staleDays: getStaleDays(),
  }));

  app.get('/api/summary', async (): Promise<SummaryResponse> => ({ summary: getSummary(now()) }));

  app.get('/api/vehicles', async (req): Promise<VehicleListResponse> => {
    const q = req.query as Record<string, unknown>;
    const model = queryString(q.model);
    if (model !== undefined && model.length > 100) throw new ApiError(400, 'INVALID_INPUT', '모델 키워드가 너무 깁니다 (최대 100자)');
    const minScoreRaw = queryString(q.minScore);
    const minScore = minScoreRaw === undefined ? undefined : Number(minScoreRaw);
    if (minScore !== undefined && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) throw new ApiError(400, 'INVALID_INPUT', `최소 점수는 0~100 숫자여야 합니다: ${minScoreRaw}`);
    const sortRaw = queryString(q.sort) ?? 'score';
    if (!(SORTS as readonly string[]).includes(sortRaw)) throw new ApiError(400, 'INVALID_INPUT', `정렬 기준이 올바르지 않습니다: ${sortRaw}`);
    const sort = sortRaw as VehicleSortField;
    const r = listVehicles({ model, minScore, sort }, now());
    return { items: r.items, staleDays: r.staleDays, query: { model: model ?? null, minScore: minScore ?? null, sort } };
  });

  app.get('/api/vehicles/:carId', async (req): Promise<VehicleDetailResponse> => {
    const { carId } = req.params as { carId: string };
    if (!CAR_ID_RE.test(carId)) throw new ApiError(400, 'INVALID_INPUT', `매물 ID 형식이 올바르지 않습니다: ${carId}`);
    const d = getVehicleDetail(carId, now());
    if (!d) throw new ApiError(404, 'NOT_FOUND', `매물을 찾을 수 없습니다: ${carId}`);
    return { ...d, weights: { ...DEFAULT_WEIGHTS }, encarUrl: `https://fem.encar.com/cars/detail/${encodeURIComponent(carId)}` };
  });

  app.post('/api/compare', async (req): Promise<CompareResponse> => {
    const { opts: cliOpts, override } = parseCompareBody(req.body);
    const at = now();
    const o = await runCompare(cliOpts, override, { fetchHtml, now: () => at });
    const peers = [...o.match.peers]
      .sort((a, b) => a.price - b.price || (a.carId < b.carId ? -1 : a.carId > b.carId ? 1 : 0))
      .map((v) => toListItem(v, null));
    return {
      title: inputTitle(o.input),
      site: o.site,
      warnings: o.warnings,
      notes: o.notes,
      overridden: [...new Set(o.overridden.map((f) => CLI_FLAG_LABEL[f.replace(/^--/, '')] ?? f))],
      settings: settingsInfo(o.settings),
      input: o.input,
      result: o.result,
      verdictLines: buildVerdictLines(o.result),
      recommendations: buildRecommendations(o.result),
      knnLines: buildKnnLines(o.result),
      peers,
      analyzedAt: at.toISOString(),
    };
  });

  // ───── 수집 작업 ─────
  const jobIdParam = (req: { params: unknown }): string => {
    const { id } = req.params as { id: string };
    if (!JOB_ID_RE.test(id)) throw new ApiError(400, 'INVALID_INPUT', `작업 ID 형식이 올바르지 않습니다: ${id}`);
    return id;
  };

  app.post('/api/collect/preview', async (req): Promise<CollectPreviewResponse> => {
    const { searchQuery } = parseSearchUrlBody(req.body);
    if (jobs.isRunning()) throw new ApiError(409, 'JOB_RUNNING', '수집·정리 작업 중에는 검색 결과 수를 확인하지 않습니다 (엔카 요청 절약)');
    if (previewBusy) throw new ApiError(429, 'BUSY', '검색 결과 수를 확인하는 중입니다');
    previewBusy = true;
    try {
      const totalCount = await searchCount(searchQuery);
      return { searchQuery, totalCount, pages: totalCount === null ? null : Math.ceil(totalCount / PAGE_SIZE), pageSize: PAGE_SIZE };
    } catch (err) {
      if (err instanceof BlockedError) throw new ApiError(502, 'BLOCKED', '엔카가 이 네트워크(IP)의 요청을 차단했습니다. 네트워크를 바꾸거나 잠시 후 다시 시도하세요');
      throw new ApiError(502, 'FETCH_FAILED', `엔카 검색 결과 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      previewBusy = false;
    }
  });

  app.post('/api/jobs/collect', async (req, reply): Promise<JobResponse> => {
    const params = defaultCollectParams(parseCollectBody(req.body));
    const job = jobs.startCollect(params);
    reply.code(202);
    return { job };
  });

  app.get('/api/jobs/current', async (): Promise<CurrentJobResponse> => ({ job: jobs.current() }));

  app.get('/api/jobs/:id', async (req): Promise<JobResponse> => {
    const id = jobIdParam(req);
    const job = jobs.get(id);
    if (job === null) throw new ApiError(404, 'NOT_FOUND', `작업을 찾을 수 없습니다 (서버를 다시 시작하면 이전 작업 기록은 사라집니다): ${id}`);
    return { job };
  });

  app.post('/api/jobs/:id/stop', async (req): Promise<JobResponse> => ({ job: jobs.requestStop(jobIdParam(req)) }));

  // 진행 이벤트 (Server-Sent Events). 연결마다 snapshot → 변경분 → end(종료 시 서버가 닫음)
  app.get('/api/jobs/:id/events', async (req, reply) => {
    const id = jobIdParam(req);
    if (jobs.get(id) === null) throw new ApiError(404, 'NOT_FOUND', `작업을 찾을 수 없습니다: ${id}`);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    });
    res.write('retry: 3000\n\n');
    let closed = false;
    let unsub: () => void = () => {};
    const ping = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      unsub();
      res.end();
    };
    req.raw.on('close', close);
    const send = (e: JobStreamEvent): void => {
      if (closed) return;
      res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      if (e.event === 'end') close();
    };
    unsub = jobs.subscribe(id, send) ?? ((): void => {});
    if (closed) unsub();
  });

  // ───── 정리(미확인 매물 삭제) ─────
  app.get('/api/purge/preview', async (): Promise<PurgePreviewResponse> => {
    const plan = planPurge(now());
    return {
      staleDays: plan.staleDays, cutoff: plan.cutoff, totalCount: plan.totalCount, candidateCount: plan.candidates.length,
      pct: plan.pct, maxRatio: PURGE_MAX_RATIO, overCap: plan.overCap, backupPath: plan.backupPath,
      breakdown: plan.breakdown.map((b) => ({ label: b.label, total: b.total, stale: b.stale, lastSeenMax: b.lastSeenMax })),
      candidates: plan.candidates.map(findVehicleById).filter((v): v is NonNullable<typeof v> => v !== null).map((v) => toListItem(v, plan.cutoff)),
      jobRunning: jobs.isRunning(),
    };
  });

  app.post('/api/purge', async (req): Promise<PurgeApplyResponse> => {
    const { confirmCount } = parsePurgeBody(req.body);
    return jobs.runExclusive('gui-purge', async () => {
      const at = now();
      const plan = planPurge(at);
      const n = plan.candidates.length;
      if (plan.cutoff === null) throw new ApiError(422, 'PURGE_DISABLED', 'STALE_DAYS=0 이라 미확인 기준이 꺼져 있어 삭제 대상을 정할 수 없습니다');
      if (n === 0) throw new ApiError(422, 'NOTHING_TO_PURGE', `${plan.staleDays}일 이상 확인되지 않은 매물이 없습니다`);
      if (plan.overCap) {
        throw new ApiError(422, 'PURGE_OVER_CAP', `삭제 대상 ${n}대가 전체 ${plan.totalCount}대의 ${plan.pct}%로 안전 기준(${PURGE_MAX_RATIO * 100}%)을 넘어 삭제하지 않았습니다 — 계속 볼 검색 조건을 먼저 수집 화면에서 다시 수집하세요`);
      }
      if (n !== confirmCount) {
        throw new ApiError(409, 'PURGE_CHANGED', `입력한 대수(${confirmCount}대)가 지금 삭제 대상(${n}대)과 다릅니다 — 미리보기를 새로 불러와 다시 확인하세요`);
      }
      const ex = await executePurge(plan, at);
      return { deleted: ex.deleted.length, kept: n - ex.deleted.length, backupPath: ex.backupPath, rescored: ex.rescored };
    });
  });

  // ───── 설정 (.env) ─────
  const configResponse = (st: EnvFileState): ConfigResponse => ({
    envPath: st.envPath, exists: st.exists, revision: st.revision, dbPath: DB_PATH, jobRunning: jobs.isRunning(),
    entries: st.entries.map((e) => {
      const spec = ENV_KEYS.find((s) => s.key === e.key)!;
      return { ...e, kind: spec.kind, defaultText: spec.defaultText, restartRequired: spec.restartRequired };
    }),
  });

  app.get('/api/config', async (): Promise<ConfigResponse> => configResponse(readEnvFile(envPath)));

  app.post('/api/config', async (req): Promise<ConfigSaveResponse> => {
    const { revision, values } = parseConfigBody(req.body);
    if (jobs.isRunning()) throw new ApiError(409, 'JOB_RUNNING', '수집·정리 작업 중에는 설정을 저장할 수 없습니다. 끝난 뒤 다시 저장하세요');
    const r = saveEnvChanges(values, revision, envPath);
    return { ...configResponse(r.state), changed: r.changed, applied: r.applied, restartRequired: r.restartRequired, shellOverridden: r.shellOverridden };
  });

  // 알 수 없는 /api 경로 → JSON 404, 그 외 GET → SPA index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url === '/api') return sendError(reply, 404, 'NOT_FOUND', `없는 API입니다: ${req.method} ${req.url}`);
    if (opts.webRoot !== null && req.method === 'GET') return reply.header('cache-control', 'no-cache').sendFile('index.html');
    return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
  });

  if (opts.webRoot !== null) {
    const root = opts.webRoot;
    if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`웹 빌드가 없습니다: ${root}/index.html — 먼저 npm run gui:build`);
    app.register(fastifyStatic, {
      root,
      wildcard: true,
      index: ['index.html'],
      setHeaders: (res, filePath) => {
        res.header('cache-control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  return app;
}
