export const SEARCH_API_BASE = 'https://api.encar.com/search/car/list/general';
export const SEARCH_SORT = 'ModifiedDate';

export interface ParsedSearchUrl { searchQuery: string; apiUrl: string; }

export function buildSearchApiUrl(searchQuery: string, offset: number, limit: number): string {
  return `${SEARCH_API_BASE}?q=${encodeURIComponent(searchQuery)}` +
    `&sr=${encodeURIComponent(`|${SEARCH_SORT}|${offset}|${limit}`)}&count=true`;
}

export function parseEncarSearchUrl(input: string): ParsedSearchUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`유효한 URL이 아닙니다: ${input}`);
  }

  if (url.hostname !== 'encar.com' && !url.hostname.endsWith('.encar.com')) {
    throw new Error(`엔카 URL이 아닙니다: ${url.hostname}`);
  }

  const raw = url.searchParams.get('search');
  if (raw === null || raw.trim() === '') {
    throw new Error(`URL에 search 파라미터가 없습니다. 엔카 검색 결과 페이지 URL(https://car.encar.com/list/car?search=...)을 입력하세요.`);
  }

  const trimmed = raw.trim();
  let searchQuery: string;

  if (trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`search 파라미터 JSON 파싱 실패`);
    }

    const obj = parsed as Record<string, unknown>;
    if (typeof obj.action !== 'string' || obj.action === '') {
      throw new Error(`search 파라미터에 action(검색 조건)이 없습니다`);
    }
    searchQuery = obj.action.trim();
  } else if (trimmed.startsWith('(')) {
    searchQuery = trimmed;
  } else {
    throw new Error(`지원하지 않는 search 형식입니다: ${trimmed.slice(0, 80)}`);
  }

  if (!searchQuery.startsWith('(') || !searchQuery.endsWith(')')) {
    throw new Error(`검색 조건(action) 형식이 올바르지 않습니다: ${searchQuery}`);
  }

  return { searchQuery, apiUrl: buildSearchApiUrl(searchQuery, 0, 20) };
}
