// 수집 폼 상태 ↔ 요청 본문 (순수 함수)
import type { CollectJobParams, CollectJobRequest, CollectPhase, JobState } from '../../../src/server/api-types';
import { parseEncarSearchUrl } from '../../../src/crawler/url-parser';

export interface CollectFormState {
  url: string; startPage: string; maxPages: string; limit: string;
  skipExisting: boolean; prune: boolean;
  fetchMarket: boolean; fetchYearly: boolean;   // 이번 실행에만 (저장하지 않음, 화면을 열 때 설정값으로 초기화)
}
export const EMPTY_COLLECT_FORM: CollectFormState = {
  url: '', startPage: '1', maxPages: '', limit: '', skipExisting: false, prune: false, fetchMarket: false, fetchYearly: false,
};
export const COLLECT_FORM_KEY = 'used-car:collect-form:v1';
type Saved = Pick<CollectFormState, 'url' | 'startPage' | 'maxPages' | 'limit' | 'skipExisting' | 'prune'>;

export function loadCollectForm(flags: { fetchMarket: boolean; fetchYearly: boolean }): CollectFormState {
  let saved: Partial<Saved> = {};
  try { saved = JSON.parse(localStorage.getItem(COLLECT_FORM_KEY) ?? '{}') as Partial<Saved>; } catch { /* 무시 */ }
  const pick = <K extends keyof Saved>(k: K): Saved[K] => (typeof saved[k] === typeof EMPTY_COLLECT_FORM[k] ? saved[k] as Saved[K] : EMPTY_COLLECT_FORM[k]);
  return { url: pick('url'), startPage: pick('startPage'), maxPages: pick('maxPages'), limit: pick('limit'), skipExisting: pick('skipExisting'), prune: pick('prune'), ...flags };
}
export function saveCollectForm(f: CollectFormState): void {
  const s: Saved = { url: f.url, startPage: f.startPage, maxPages: f.maxPages, limit: f.limit, skipExisting: f.skipExisting, prune: f.prune };
  try { localStorage.setItem(COLLECT_FORM_KEY, JSON.stringify(s)); } catch { /* 무시 */ }
}

/** URL 즉시 검사: 검색 조건 또는 오류 문장 (빈 입력은 둘 다 null) */
export function checkSearchUrl(url: string): { searchQuery: string | null; error: string | null } {
  if (url.trim() === '') return { searchQuery: null, error: null };
  try { return { searchQuery: parseEncarSearchUrl(url).searchQuery, error: null }; } catch (err) { return { searchQuery: null, error: err instanceof Error ? err.message : String(err) }; }
}

function posInt(label: string, raw: string, errors: string[]): number | null {
  const t = raw.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1) { errors.push(`${label}: 1 이상의 정수를 입력하세요`); return null; }
  return n;
}

/** 정리(prune)는 전체 수집(시작 1페이지, 최대 페이지·대수 없음)에서만 */
export function isFullList(f: CollectFormState): boolean {
  return (f.startPage.trim() === '' || f.startPage.trim() === '1') && f.maxPages.trim() === '' && f.limit.trim() === '';
}

export function collectFormToRequest(f: CollectFormState): { body: CollectJobRequest | null; errors: string[] } {
  const errors: string[] = [];
  const u = checkSearchUrl(f.url);
  if (f.url.trim() === '') errors.push('엔카 검색 URL을 입력하세요');
  else if (u.error !== null) errors.push(u.error);
  const startPage = posInt('시작 페이지', f.startPage, errors) ?? 1;
  const maxPages = posInt('최대 페이지 수', f.maxPages, errors);
  const limit = posInt('최대 대수', f.limit, errors);
  if (f.prune && !isFullList(f)) errors.push('목록에 없는 매물 삭제는 시작 페이지 1, 최대 페이지·최대 대수를 비운 전체 수집에서만 쓸 수 있습니다');
  if (errors.length > 0) return { body: null, errors };
  return { body: { url: f.url.trim(), startPage, maxPages, limit, skipExisting: f.skipExisting, prune: f.prune, fetchMarket: f.fetchMarket, fetchYearly: f.fetchYearly }, errors };
}

/** 중단·차단 후 이어받기: 같은 조건 + DB에 있는 매물 건너뛰기, 삭제는 끔 */
export function resumeRequest(p: CollectJobParams): CollectJobRequest {
  return { url: p.url, startPage: p.startPage, maxPages: p.maxPages, limit: p.limit, skipExisting: true, prune: false, fetchMarket: p.fetchMarket, fetchYearly: p.fetchYearly };
}

export const PHASE_LABEL: Record<CollectPhase, string> = {
  starting: '시작 중', list: '목록 조회 중', detail: '상세 수집 중', prune: '정리 확인 중', rescore: '재채점 중', done: '종료',
};
export const STATE_LABEL: Record<JobState, string> = {
  running: '실행 중', completed: '완료', interrupted: '중단됨', blocked: '엔카 차단', failed: '실패',
};

/** 진행 막대 값: [value, max] 또는 null(진행률 모름) */
export function progressValue(p: { phase: CollectPhase; listPage: number | null; listLastPage: number | null; targeted: number | null; completed: number }, startPage: number): [number, number] | null {
  if (p.phase === 'list') {
    if (p.listPage === null || p.listLastPage === null) return null;
    const max = Math.max(1, p.listLastPage - startPage + 1);
    return [Math.min(max, p.listPage - startPage + 1), max];
  }
  if (p.phase === 'detail' && p.targeted !== null && p.targeted > 0) return [p.completed, p.targeted];
  if (p.phase === 'done') return [1, 1];
  return null;
}

export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}분 ${s % 60}초` : `${s}초`;
}
