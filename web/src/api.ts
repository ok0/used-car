import { useEffect, useState } from 'react';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, type ApiErrorBody } from '../../src/server/api-types';

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details: string[] = []) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function toClientError(err: unknown): ApiClientError {
  if (err instanceof ApiClientError) return err;
  return new ApiClientError(0, 'UNKNOWN', err instanceof Error ? err.message : String(err));
}

async function request<T>(method: 'GET' | 'POST', path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: method === 'POST'
        ? { 'content-type': 'application/json', accept: 'application/json', [CLIENT_HEADER]: CLIENT_HEADER_VALUE }
        : { accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiClientError(0, 'NETWORK', '서버에 연결할 수 없습니다. 터미널에서 npm run gui 가 실행 중인지 확인하세요');
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 본문이 JSON이 아님 */ }
  if (!res.ok) {
    const e = (json as ApiErrorBody | null)?.error;
    throw new ApiClientError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? `요청 실패 (HTTP ${res.status})`, e?.details ?? []);
  }
  return json as T;
}

export function getJson<T>(path: string, signal?: AbortSignal): Promise<T> { return request<T>('GET', path, undefined, signal); }
export function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> { return request<T>('POST', path, body, signal); }

export interface ApiState<T> { data: T | null; error: ApiClientError | null; loading: boolean; reload: () => void }

/** GET 조회 훅. path 가 바뀌면 이전 요청을 취소하고 다시 조회 (이전 data 는 로딩 중에도 유지). path=null 이면 조회 안 함 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiClientError | null; loading: boolean }>({ data: null, error: null, loading: path !== null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (path === null) return;
    const ac = new AbortController();
    setState((s) => ({ data: s.data, error: null, loading: true }));
    getJson<T>(path, ac.signal).then(
      (data) => setState({ data, error: null, loading: false }),
      (err: unknown) => { if (!ac.signal.aborted) setState({ data: null, error: toClientError(err), loading: false }); },
    );
    return () => ac.abort();
  }, [path, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}
