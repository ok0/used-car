import '../env'; // 직접 실행(ts-node src/crawler/detail-crawler.ts) 시에도 .env 로드
import { fetchJson, HttpError, BlockedError } from './fetch-helper';
import { isDuplication, crawlList } from './list-crawler';
import { parseEncarSearchUrl } from './url-parser';
import {
  buildMarketQuery, buildYearlyQuery, computeMarketPrice, computeYearlyPrices,
  parseRecord, parseInspection, parseDiagnosis, computeOriginPrice, parseYearMonth,
  buildAccidentRecords, str, num,
  type RawVehicle, type RawRecord, type RawInspection, type RawDiagnosis, type RawOptionItem, type RawUser, type RawSearchResponse,
} from './detail-parsers';
import { parseEncarSearchUrl as parseSearchUrlForCrawl } from './url-parser';
import type { CollectedVehicle, SearchResult, VehicleData, MarketPrice, YearlyPrice } from '../types';

const READSIDE = 'https://api.encar.com/v1/readside';
export const DETAIL_CONCURRENCY = 4;

/** 동급매물/연식별 시세 조회는 매물당 검색 API를 1~2회(최대 500건) 호출하므로 기본 OFF.
 *  켜려면 ENCAR_FETCH_MARKET=1 / ENCAR_FETCH_YEARLY=1 (1, true, on, yes) */
function envFlag(name: string): boolean {
  return /^(1|true|on|yes)$/i.test((process.env[name] ?? '').trim());
}
export const isMarketFetchEnabled = (): boolean => envFlag('ENCAR_FETCH_MARKET');
export const isYearlyFetchEnabled = (): boolean => envFlag('ENCAR_FETCH_YEARLY');

// ===== Helpers =====
async function fetchOptional<T>(url: string, label: string): Promise<T | null> {
  try {
    return await fetchJson<T>(url);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status !== 404) console.warn(`  ⚠ ${label} API HTTP ${err.status} → 데이터 없음 처리`);
      return null;
    }
    throw err;
  }
}

const searchCache = new Map<string, Promise<RawSearchResponse>>();
function fetchSearchCached(url: string): Promise<RawSearchResponse> {
  let p = searchCache.get(url);
  if (!p) {
    p = fetchJson<RawSearchResponse>(url);
    searchCache.set(url, p);
    p.catch(() => searchCache.delete(url));
  }
  return p;
}

export async function fetchMarketPrice(v: RawVehicle, collectedAt: string): Promise<MarketPrice | null> {
  const q = buildMarketQuery(v);
  if (!q) return null;

  try {
    const d = await fetchSearchCached(q.url);
    if (!d?.SearchResults?.length) return null;
    return computeMarketPrice(d.SearchResults, q, collectedAt);
  } catch (e) {
    if (e instanceof BlockedError) throw e;
    console.warn('  ⚠ 동급매물 시세 조회 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function fetchYearlyPrices(v: RawVehicle, collectedAt: string): Promise<YearlyPrice[]> {
  const q = buildYearlyQuery(v);
  if (!q) return [];

  try {
    const d = await fetchSearchCached(q.url);
    if (!d?.SearchResults?.length) return [];
    return computeYearlyPrices(d.SearchResults, q, new Date().getFullYear(), collectedAt);
  } catch (e) {
    if (e instanceof BlockedError) throw e;
    console.warn('  ⚠ 연식별 시세 조회 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ===== Main function =====
export interface FetchDetailOptions {
  search?: SearchResult | null;
  searchQuery?: string | null;
  fetchMarket?: boolean;   // 기본: ENCAR_FETCH_MARKET
  fetchYearly?: boolean;   // 기본: ENCAR_FETCH_YEARLY
}

export async function fetchCollectedVehicle(carId: string, opts: FetchDetailOptions = {}): Promise<CollectedVehicle> {
  const collectedAt = new Date().toISOString();

  // 1. Fetch vehicle data
  const v = await fetchJson<RawVehicle>(`${READSIDE}/vehicle/${encodeURIComponent(carId)}`);
  const vehicleNo = str(v.vehicleNo);
  const actualId = String(v.vehicleId ?? carId);

  if (actualId !== carId) {
    console.log(`  ℹ Dummy 매물: URL=${carId}, 실제 vehicleId=${actualId}`);
  }

  const recordViewable = v.condition?.accident?.recordView !== false;
  const userId = str(v.contact?.userId);

  // 2. Parallel fetch of optional data
  const [record, inspection, diagnosis, optionList, marketPrice, yearlyPrices, user] = await Promise.all([
    vehicleNo && recordViewable
      ? fetchOptional<RawRecord>(`${READSIDE}/record/vehicle/${actualId}/open?vehicleNo=${encodeURIComponent(vehicleNo)}`, 'record')
      : Promise.resolve(null),
    fetchOptional<RawInspection>(`${READSIDE}/inspection/vehicle/${actualId}`, 'inspection'),
    fetchOptional<RawDiagnosis>(`${READSIDE}/diagnosis/vehicle/${actualId}`, 'diagnosis'),
    fetchOptional<RawOptionItem[]>(`${READSIDE}/vehicles/car/${actualId}/options/choice`, 'options'),
    (opts.fetchMarket ?? isMarketFetchEnabled()) ? fetchMarketPrice(v, collectedAt) : Promise.resolve(null),
    (opts.fetchYearly ?? isYearlyFetchEnabled()) ? fetchYearlyPrices(v, collectedAt) : Promise.resolve([] as YearlyPrice[]),
    userId ? fetchOptional<RawUser>(`${READSIDE}/user/${encodeURIComponent(userId)}`, 'user') : Promise.resolve(null),
  ]);

  // 3. Parse fetched data
  const rec = parseRecord(record, !recordViewable);
  const insp = parseInspection(inspection);
  const diag = parseDiagnosis(diagnosis, v);
  const op = computeOriginPrice(v, Array.isArray(optionList) ? optionList : null);
  if (op.status === 'failed') console.warn(`  ⚠ ${carId} 선택옵션 API 조회 실패 → 옵션 합계 0으로 저장 (options_status=failed)`);
  const ym = parseYearMonth(v.category?.yearMonth);
  const s = opts.search ?? null;

  // 4. Build VehicleData
  const c = v.category;
  const vehicle: VehicleData = {
    carId,
    actualCarId: actualId !== carId ? actualId : null,
    vehicleNo,
    manufacturer: str(c?.manufacturerName),
    modelGroup: str(c?.modelGroupName),
    modelName: str(c?.modelName),
    gradeName: str(c?.gradeName),
    gradeDetail: str(c?.gradeDetailName),
    powertrainCluster: getPowertrainCluster(c?.gradeName, c?.gradeDetailName),
    isDomestic: c?.domestic === true,
    year: ym.year,
    month: ym.month,
    formYear: str(c?.formYear),
    mileage: num(v.spec?.mileage) ?? 0,
    price: num(v.advertisement?.price) ?? 0,
    originPriceBase: op.base,
    originPriceOptions: op.optionTotal,
    originPrice: op.total,
    optionsStatus: op.status,
    fuelType: s?.fuelType ?? str(v.spec?.fuelName),
    color: s?.color ?? str(v.spec?.colorName),
    region: s?.region ?? null,
    transmission: str(v.spec?.transmissionName),
    displacement: num(v.spec?.displacement),
    sellType: s?.sellType ?? null,
    leaseType: s?.leaseType ?? null,
    isDuplication: s ? isDuplication(s) : false,
    firstAdvertisedAt: str(v.manage?.firstAdvertisedDateTime),
    firstRegistrationDate: rec.firstRegistrationDate,
    insuranceCount: rec.insuranceCount,
    myDamageCount: rec.myDamageCount,
    myDamageAmount: rec.myDamageAmount,
    otherDamageCount: rec.otherDamageCount,
    otherDamageAmount: rec.otherDamageAmount,
    isInsurancePrivate: rec.isInsurancePrivate,
    hasUnavailablePeriod: rec.hasUnavailablePeriod,
    unavailablePeriods: rec.unavailablePeriods,
    ownerChangeCount: rec.ownerChangeCount,
    hasInspection: insp.hasInspection,
    isInspectionPrivate: (v.condition?.inspection?.formats ?? []).length === 0,
    hasReplacement: insp.hasReplacement,
    hasWelding: insp.hasWelding,
    hasCorrosion: insp.hasCorrosion,
    rankCounts: insp.rankCounts,
    hasDiagnosis: diag.hasDiagnosis,
    diagnosisTier: diag.diagnosisTier,
    diagFrameReplacement: diag.diagFrameReplacement,
    diagPanelReplacement: diag.diagPanelReplacement,
    hasRentalHistory: rec.hasRentalHistory,
    hasUsageChange: rec.hasUsageChange,
    dealerUserId: userId,
    dealerName: str(v.partnership?.dealer?.name),
    dealerFirmName: str(v.partnership?.dealer?.firm?.name),
    dealerJoinedAt: user ? str(user.joinedDatetime) : null,
    dealerTotalSales: user ? (num(user.salesStatus?.totalSales) ?? 0) : null,
    scoreTotal: null,
    scoreGrade: null,
    scoreBreakdown: null,
    scorePenalty: null,
    collectedAt,
    searchQuery: opts.searchQuery ?? null,
    lastSeenAt: collectedAt,
  };

  // 5. Build CollectedVehicle
  return {
    vehicle,
    accidents: buildAccidentRecords(rec.rawAccidents, op.total),
    options: op.options,
    ownerChanges: rec.ownerChanges.map(d => ({ changeDate: d })),
    usageHistory: rec.usageCodes.map((c, i) => ({ usageCode: c, seq: i })),
    marketPrice,
    yearlyPrices,
  };
}

// ===== Import helper from detail-parsers =====
import { getPowertrainCluster } from './detail-parsers';

// ===== Concurrency handler =====
export interface DetailResultEvent {
  index: number;
  completed: number;
  total: number;
  carId: string;
  bundle: CollectedVehicle | null;
  error: Error | null;
}

export interface CrawlDetailsOptions {
  concurrency?: number;
  searchQuery?: string | null;
  onResult?: (e: DetailResultEvent) => void;
  log?: (line: string) => void;
  shouldStop?: () => boolean;
  fetchMarket?: boolean;   // 기본: ENCAR_FETCH_MARKET
  fetchYearly?: boolean;   // 기본: ENCAR_FETCH_YEARLY
}

export interface CrawlDetailsResult {
  bundles: CollectedVehicle[];
  failed: { carId: string; error: string }[];
}

export async function crawlDetails(items: SearchResult[], opts: CrawlDetailsOptions = {}): Promise<CrawlDetailsResult> {
  const total = items.length;
  const results: (CollectedVehicle | null)[] = new Array(total).fill(null);
  const failed: { carId: string; error: string }[] = [];

  let next = 0;
  let completed = 0;
  let blocked: BlockedError | null = null;

  const log = opts.log ?? console.log;

  const worker = async (): Promise<void> => {
    while (blocked === null && !(opts.shouldStop?.() ?? false)) {
      const i = next++;
      if (i >= total) return;

      const item = items[i];
      let bundle: CollectedVehicle | null = null;
      let error: Error | null = null;

      try {
        bundle = await fetchCollectedVehicle(item.carId, {
          search: item,
          searchQuery: opts.searchQuery ?? null,
          fetchMarket: opts.fetchMarket,
          fetchYearly: opts.fetchYearly,
        });
        results[i] = bundle;
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
        if (err instanceof BlockedError) blocked = err;
        failed.push({ carId: item.carId, error: error.message });
      }

      // Success log
      if (bundle) {
        const { vehicle } = bundle;
        log(`[${completed + 1}/${total}] ${item.carId} ${vehicle.modelName ?? ''} ${vehicle.gradeName ?? ''} ${vehicle.year}년식 ${vehicle.price.toLocaleString()}만원 ✅`);
      } else if (error) {
        log(`[${completed + 1}/${total}] ${item.carId} → ⚠️ ${error.message} (스킵)`);
      }

      completed++;

      // Callback
      try {
        opts.onResult?.({
          index: i,
          completed,
          total,
          carId: item.carId,
          bundle,
          error,
        });
      } catch (cbErr) {
        log(`  ⚠ onResult 오류 (${item.carId}): ${cbErr instanceof Error ? cbErr.message : cbErr}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? DETAIL_CONCURRENCY, total) }, () => worker()));

  log(`상세 수집 완료: ${total - failed.length}/${total}대 성공, ${failed.length}대 실패`);

  if (blocked) throw blocked;

  return {
    bundles: results.filter((b): b is CollectedVehicle => b !== null),
    failed,
  };
}

// ===== Direct execution =====
if (require.main === module) {
  (async () => {
    const [arg1, arg2] = process.argv.slice(2);

    if (!arg1) {
      console.error('사용법 1: npx ts-node src/crawler/detail-crawler.ts <carId>');
      console.error('사용법 2: npx ts-node src/crawler/detail-crawler.ts --url "<엔카 검색 URL>" [N=4]');
      process.exit(1);
    }

    try {
      if (arg1 === '--url') {
        if (!arg2) {
          console.error('사용법: npx ts-node src/crawler/detail-crawler.ts --url "<엔카 검색 URL>" [N=4]');
          process.exit(1);
        }

        const { searchQuery } = parseEncarSearchUrl(arg2);
        const maxN = arg2 ? Number(process.argv[4] ?? '4') : 4;
        const list = await crawlList(searchQuery, { maxPages: 1 });
        const selected = list.slice(0, maxN);

        const { bundles, failed } = await crawlDetails(selected, { searchQuery });

        if (failed.length > 0) {
          console.log('\n실패 목록:');
          for (const f of failed) {
            console.log(`  ${f.carId}: ${f.error}`);
          }
        }

        console.log(`\n총 ${bundles.length}대 수집 완료`);
      } else {
        // Single carId mode
        const bundle = await fetchCollectedVehicle(arg1);
        console.log(JSON.stringify(bundle, null, 2));

        const { accidents, options, ownerChanges, usageHistory, marketPrice, yearlyPrices } = bundle;
        const summary = `사고 ${accidents.length}건 / 옵션 ${options.length}개 / 소유주변경 ${ownerChanges.length}건 / 용도 ${usageHistory.map(u => u.usageCode).join('→')} / 시세 ${marketPrice ? marketPrice.median + '만원(' + marketPrice.sampleCount + '대)' : '없음'} / 연식별 ${yearlyPrices.length}개`;
        console.log('\n' + summary);
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
  })();
}
