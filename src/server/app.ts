import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { getSummary, getStaleDays } from '../db/repository';
import { DEFAULT_WEIGHTS } from '../scoring/calculator';
import { inputTitle, buildVerdictLines, buildRecommendations } from '../comparator/reporter';
import { CompareError, resolveCompareSettings, runCompare, type CompareSettings } from '../services/compare';
import { listVehicles, getVehicleDetail, toListItem } from '../services/vehicles';
import { BusyError, createExternalFetcher } from './external-fetch';
import { BodyError, CLI_FLAG_LABEL, parseCompareBody, replaceCliFlags } from './compare-body';
import {
  CLIENT_HEADER, CLIENT_HEADER_VALUE,
  type ApiErrorBody, type ApiErrorCode, type CompareResponse, type CompareSettingsInfo, type HealthResponse, type SettingsResponse,
  type SummaryResponse, type VehicleDetailResponse, type VehicleListResponse,
} from './api-types';
import type { VehicleSortField } from '../types';

/** 웹 빌드 산출물 기본 위치 (src/server 와 dist/server 모두에서 ../../web/dist) */
export const DEFAULT_WEB_ROOT = path.resolve(__dirname, '../../web/dist');

export interface AppOptions {
  webRoot: string | null;                        // null = 정적 파일 서빙 안 함 (개발 모드: Vite가 서빙)
  fetchHtml?: (url: string) => Promise<string>;  // 외부 HTML 조회 (테스트에서 픽스처 주입). 기본 fetch-helper.fetchText
  now?: () => Date;
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
      peers,
      analyzedAt: at.toISOString(),
    };
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
