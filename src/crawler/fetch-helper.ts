export const MIN_REQUEST_INTERVAL_MS = 200;
const MAX_RETRIES = 3;
const TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Referer': 'https://car.encar.com/',
  'Accept': 'application/json',
};

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string) {
    super(`HTTP ${status}: ${url}`);
    this.name = 'HttpError';
  }
}

export class BlockedError extends Error {
  constructor(public readonly url: string) {
    super(`엔카 API 차단됨 (has_been_cr_blocked) — 네트워크/IP 변경 필요: ${url}`);
    this.name = 'BlockedError';
  }
}

/** undici의 "fetch failed"는 실제 원인이 err.cause에 있음 (ECONNRESET, UND_ERR_* 등) */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return cause ? `${err.message}: ${cause.code ?? ''} ${cause.message ?? ''}`.trim() : err.message;
}

export function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

let nextSlotAt = 0;
/** 모든 호출자(동시 호출 포함)에 대해 요청 시작 간격을 최소 200ms로 보장. 슬롯은 동기적으로 예약. */
async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlotAt);
  nextSlotAt = start + MIN_REQUEST_INTERVAL_MS;
  if (start > now) await sleep(start - now);
}

export async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForSlot();

    try {
      const res = await fetch(url, {
        headers: DEFAULT_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      if (res.status === 403 || res.status === 404) {
        const body = await res.text().catch(() => '');
        if (body.includes('has_been_cr_blocked')) throw new BlockedError(url);
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
        console.warn(`  ⚠ 429 Too Many Requests, ${delay}ms 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        const delay = 1000 * 2 ** attempt;
        console.warn(`  ⚠ 네트워크 오류, ${delay}ms 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      throw new HttpError(res.status, url);
    } catch (err) {
      if (err instanceof HttpError || err instanceof BlockedError) throw err;
      if (attempt < MAX_RETRIES) {
        const delay = 1000 * 2 ** attempt;
        console.warn(`  ⚠ 네트워크 오류 (${describeError(err)}), ${delay}ms 후 재시도 (${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      if (err instanceof Error) err.message = `${describeError(err)} — ${url}`;
      throw err;
    }
  }

  throw new Error('unreachable');
}

const HTML_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};
const HTML_MAX_RETRIES = 2;

/** HTML 페이지 GET (헤이딜러 등 엔카 외 사이트용). 엔카 Referer 헤더를 보내지 않음. */
export async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt <= HTML_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: HTML_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
      if (res.ok) return await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < HTML_MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new HttpError(res.status, url);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt < HTML_MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (err instanceof Error) err.message = `${describeError(err)} — ${url}`;
      throw err;
    }
  }
  throw new Error('unreachable');
}
