import { parseEncarSearchUrl } from '../crawler/url-parser';
import { BodyError } from './compare-body';
import type { CollectJobParams } from './api-types';

/** 엔카 검색 URL 오류 (400 INVALID_URL) */
export class UrlBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlBodyError';
  }
}

function obj(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BodyError('요청 본문은 JSON 객체여야 합니다');
  return body as Record<string, unknown>;
}
function optInt(o: Record<string, unknown>, key: string, label: string, max: number): number | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) throw new BodyError(`${label}은(는) 1~${max} 정수여야 합니다`);
  return v;
}
function optBool(o: Record<string, unknown>, key: string, label: string): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new BodyError(`${label}은(는) true/false 여야 합니다`);
  return v;
}

export function parseSearchUrlBody(body: unknown): { url: string; searchQuery: string } {
  const o = obj(body);
  if (typeof o.url !== 'string' || o.url.trim() === '') throw new BodyError('엔카 검색 URL을 입력하세요');
  if (o.url.length > 8000) throw new BodyError('URL이 너무 깁니다');
  const url = o.url.trim();
  try {
    return { url, searchQuery: parseEncarSearchUrl(url).searchQuery };
  } catch (err) {
    throw new UrlBodyError(err instanceof Error ? err.message : String(err));
  }
}

/** POST /api/jobs/collect 본문 → 작업 파라미터 (시세 토글은 생략 시 undefined → 현재 환경변수) */
export function parseCollectBody(body: unknown): Omit<CollectJobParams, 'fetchMarket' | 'fetchYearly'> & { fetchMarket?: boolean; fetchYearly?: boolean } {
  const { url, searchQuery } = parseSearchUrlBody(body);
  const o = obj(body);
  const startPage = optInt(o, 'startPage', '시작 페이지', 10000) ?? 1;
  const maxPages = optInt(o, 'maxPages', '최대 페이지 수', 10000);
  const limit = optInt(o, 'limit', '최대 대수', 100000);
  const skipExisting = optBool(o, 'skipExisting', 'DB에 있는 매물 건너뛰기') ?? false;
  const prune = optBool(o, 'prune', '목록에 없는 매물 삭제') ?? false;
  if (prune && (startPage > 1 || maxPages !== null || limit !== null)) {
    throw new BodyError('목록에 없는 매물 삭제는 시작 페이지 1, 최대 페이지·최대 대수를 비운 전체 수집에서만 쓸 수 있습니다');
  }
  return {
    url, searchQuery, startPage, maxPages, limit, skipExisting, prune,
    fetchMarket: optBool(o, 'fetchMarket', '동급매물 시세'),
    fetchYearly: optBool(o, 'fetchYearly', '연식별 시세'),
  };
}

export function parsePurgeBody(body: unknown): { confirmCount: number } {
  const o = obj(body);
  const c = o.confirmCount;
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) throw new BodyError('확인용 대상 대수(confirmCount)를 정수로 보내야 합니다');
  return { confirmCount: c };
}

export function parseConfigBody(body: unknown): { revision: string; values: Record<string, unknown> } {
  const o = obj(body);
  if (typeof o.revision !== 'string') throw new BodyError('revision 이 필요합니다');
  const v = o.values;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BodyError('values 는 객체여야 합니다');
  return { revision: o.revision, values: v as Record<string, unknown> };
}
