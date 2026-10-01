import { fetchJson, sleep } from './fetch-helper';
import { buildSearchApiUrl, parseEncarSearchUrl } from './url-parser';
import type { SearchResult } from '../types';

export const PAGE_SIZE = 20;

interface RawSearchItem { [key: string]: unknown; }
interface RawSearchResponse { Count?: number; SearchResults?: RawSearchItem[]; }

export interface CrawlListOptions {
  startPage?: number;              // 시작 페이지 (1부터, 기본 1)
  maxPages?: number;               // startPage부터 수집할 최대 페이지 수 (기본 Infinity)
  log?: (line: string) => void;    // 기본 console.log
  shouldStop?: () => boolean;      // true면 다음 페이지 요청 전에 멈춤 (지금까지 모은 목록 반환)
  onPage?: (e: { page: number; lastPage: number | null; collected: number }) => void; // 페이지 처리 후 (GUI 진행 표시용)
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function toSearchResult(r: RawSearchItem): SearchResult {
  return {
    carId: String(r.Id),
    manufacturer: str(r.Manufacturer), model: str(r.Model), badge: str(r.Badge),
    badgeDetail: str(r.BadgeDetail), yearMonth: num(r.Year), formYear: str(r.FormYear),
    mileage: num(r.Mileage), price: num(r.Price), fuelType: str(r.FuelType), color: str(r.Color),
    region: str(r.OfficeCityState), sellType: str(r.SellType), leaseType: str(r.LeaseType),
    serviceCopyCar: str(r.ServiceCopyCar),
  };
}

/** 렌트/리스 승계 매물 (detail-parser.js:502-504와 동일 기준) */
export function isRentOrLease(r: SearchResult): boolean {
  return r.sellType === '렌트' || r.sellType === '리스' || r.leaseType !== null;
}
/** 중복매물 (detail-parser.js:505와 동일 기준) */
export function isDuplication(r: SearchResult): boolean {
  return r.serviceCopyCar === 'DUPLICATION';
}

/** 검색 결과 총 대수만 조회 (목록 API 1회, 렌트·리스·중복매물 제외 전). GUI 수집 화면의 사전 확인용 */
export async function fetchSearchCount(searchQuery: string): Promise<number | null> {
  const data = await fetchJson<RawSearchResponse>(buildSearchApiUrl(searchQuery, 0, 1));
  return typeof data.Count === 'number' ? data.Count : null;
}

export async function crawlList(searchQuery: string, options: CrawlListOptions = {}): Promise<SearchResult[]> {
  const startPage = options.startPage ?? 1;
  if (!Number.isInteger(startPage) || startPage < 1) throw new Error(`startPage는 1 이상의 정수여야 합니다: ${startPage}`);
  const maxPages = options.maxPages ?? Infinity;
  const log = options.log ?? console.log;
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  let excludedRentLease = 0;
  let excludedDup = 0;
  let excludedSeen = 0;

  for (let page = startPage; ; page++) {
    if (options.shouldStop?.() ?? false) {
      log(`[중단] 사용자 요청 (${page - 1}페이지까지 수집)`);
      break;
    }
    if (page - startPage >= maxPages) {
      log(`[중단] maxPages(${maxPages}) 도달`);
      break;
    }

    const offset = (page - 1) * PAGE_SIZE;
    let data: RawSearchResponse;
    try {
      data = await fetchJson<RawSearchResponse>(buildSearchApiUrl(searchQuery, offset, PAGE_SIZE));
    } catch (err) {
      if (err instanceof Error) {
        err.message = `[Page ${page}] ${err.message}`;
      }
      throw err;
    }

    const total = typeof data.Count === 'number' ? data.Count : null;
    if (page === startPage) {
      log(`검색 결과 총 ${total ?? '?'}대${startPage > 1 ? ` (${startPage}페이지부터 수집)` : ''}`);
    }

    const items = Array.isArray(data.SearchResults) ? data.SearchResults : [];
    if (items.length === 0) {
      log(`[Page ${page}] 0대 → 수집 완료 (총 ${out.length}대)`);
      break;
    }

    let kept = 0;
    let rl = 0;
    let dup = 0;
    let sn = 0;

    for (const item of items) {
      const r = toSearchResult(item);

      if (r.carId === 'undefined' || r.carId === '') {
        continue;
      }

      if (seen.has(r.carId)) {
        sn++;
        excludedSeen++;
        continue;
      }

      if (isRentOrLease(r)) {
        rl++;
        excludedRentLease++;
        continue;
      }

      if (isDuplication(r)) {
        dup++;
        excludedDup++;
        continue;
      }

      seen.add(r.carId);
      out.push(r);
      kept++;
    }

    log(`[Page ${page}] ${items.length}대 수집 → 유효 ${kept}대 (렌트/리스 ${rl}, 중복매물 ${dup}, 중복ID ${sn} 제외)`);
    const lastByCount = total === null ? null : Math.max(startPage, Math.ceil(total / PAGE_SIZE));
    options.onPage?.({ page, lastPage: lastByCount === null ? null : Math.min(lastByCount, startPage + maxPages - 1), collected: out.length });
    await sleep(500 + Math.random() * 1000);

    if (items.length < PAGE_SIZE || (total !== null && offset + PAGE_SIZE >= total)) {
      log(`마지막 페이지 도달 → 수집 완료 (총 ${out.length}대)`);
      break;
    }
  }

  log(`제외 합계: 렌트/리스 ${excludedRentLease}대, 중복매물 ${excludedDup}대, 중복ID ${excludedSeen}대`);
  return out;
}

if (require.main === module) {
  (async () => {
    const [url, maxPagesArg] = process.argv.slice(2);
    if (!url) { console.error('사용법: npx ts-node src/crawler/list-crawler.ts "<엔카 검색 URL>" [maxPages]'); process.exit(1); }
    const { searchQuery, apiUrl } = parseEncarSearchUrl(url);
    console.log(`검색 쿼리: ${searchQuery}`);
    console.log(`API URL: ${apiUrl}`);
    const results = await crawlList(searchQuery, { maxPages: maxPagesArg ? Number(maxPagesArg) : undefined });
    for (const r of results) console.log(`${r.carId}\t${r.manufacturer ?? ''} ${r.model ?? ''} ${r.badge ?? ''}\t${r.yearMonth ?? ''}\t${r.mileage ?? ''}km\t${r.price ?? ''}만원\t${r.region ?? ''}`);
    console.log(`총 ${results.length}대`);
  })().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
