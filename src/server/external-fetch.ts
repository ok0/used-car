import { fetchText, sleep } from '../crawler/fetch-helper';

/** 이미 다른 외부 조회가 진행 중 */
export class BusyError extends Error {
  constructor() {
    super('다른 매물 조회가 진행 중입니다. 끝난 뒤 다시 시도하세요');
    this.name = 'BusyError';
  }
}

export interface ExternalFetcherOptions {
  fetchHtml?: (url: string) => Promise<string>; // 기본 fetch-helper.fetchText (테스트에서 픽스처 주입)
  minIntervalMs?: number;  // 외부 요청 시작 간 최소 간격 (기본 2000)
  ttlMs?: number;          // 같은 URL 재조회 생략 기간 (기본 10분)
  maxEntries?: number;     // 캐시 최대 개수 (기본 20)
}

/** 서버의 외부 사이트(헤이딜러 등) HTML 조회: 동시 1건, 요청 간 최소 간격, URL별 짧은 캐시 (개인용 1회 조회 원칙) */
export function createExternalFetcher(opts: ExternalFetcherOptions = {}): (url: string) => Promise<string> {
  const fetchHtml = opts.fetchHtml ?? fetchText;
  const minIntervalMs = opts.minIntervalMs ?? 2000;
  const ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = opts.maxEntries ?? 20;
  const cache = new Map<string, { at: number; html: string }>();
  let inflight = false;
  let lastStartAt = 0;
  return async (url: string): Promise<string> => {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.html;
    if (inflight) throw new BusyError();
    inflight = true;
    try {
      const wait = lastStartAt + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStartAt = Date.now();
      const html = await fetchHtml(url);
      cache.delete(url);
      cache.set(url, { at: Date.now(), html });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
      return html;
    } finally {
      inflight = false;
    }
  };
}
