import { findVehicles, getOptionNamesByCarIds, getSummary, getStaleDays, staleCutoffIso, countStaleVehicles } from '../db/repository';
import { HttpError, InvalidUrlError, fetchText } from '../crawler/fetch-helper';
import { fetchHeydealerInput } from '../crawler/heydealer-parser';
import { fetchHyundaiCertifiedInput } from '../crawler/hyundai-certified-parser';
import { findMarketPeers, getMatchConfigFromEnv, matchPeers, type MatchConfig } from '../comparator/market-matcher';
import { computeKnn, getKnnConfigFromEnv, type KnnConfig } from '../comparator/knn';
import { analyzeComparison, specMaxAdjust, platformBasePremium, BASE_PLATFORM_PREMIUM, PLATFORM_PREMIUM_ENV } from '../comparator/analyzer';
import { fmtYY } from '../cli/format';
import type { ComparePlatform, CompareInput, CompareResult, CompareSettingsOverride, InspectionInfo, MarketMatch } from '../types';

export type UrlSite = 'heydealer' | 'hyundai_certified';
export const URL_SITE_LABEL: Record<UrlSite, string> = { heydealer: '헤이딜러', hyundai_certified: '현대 인증중고차' };

export type CompareErrorCode =
  | 'INVALID_CONFIG' | 'INVALID_INPUT' | 'INVALID_URL' | 'UNSUPPORTED_URL' | 'PLATFORM_MISMATCH'
  | 'LISTING_NOT_FOUND' | 'FETCH_FAILED' | 'EMPTY_DB' | 'NO_PEERS';

/** 비교 흐름의 예상 가능한 실패. details = 추가 안내 줄 (CLI는 3칸 들여써서 출력) */
export class CompareError extends Error {
  constructor(public readonly code: CompareErrorCode, message: string, public readonly details: string[] = []) {
    super(message);
    this.name = 'CompareError';
  }
}

function errMsg(err: unknown): string { return err instanceof Error ? err.message : String(err); }

export function detectUrlPlatform(url: string): UrlSite | null {
  let host: string;
  try { host = new URL(url.trim()).hostname.toLowerCase(); } catch { return null; }
  if (host === 'heydealer.com' || host === 'www.heydealer.com') return 'heydealer';
  if (host === 'certified.hyundai.com') return 'hyundai_certified';
  return null;
}

export interface CompareCliOptions {
  url?: string;
  platform?: ComparePlatform;
  model?: string;
  trim?: string;
  year?: number;
  month?: number;
  mileage?: number;
  price?: number;
  accidentCount?: number;
  accidentAmount?: number;
  ownerChanges?: number;
  rental?: boolean;
  inspection?: string;
}

/** 자유 텍스트 성능점검 요약 → InspectionInfo */
export function parseInspectionText(s: string): InspectionInfo {
  const label = s.trim();
  const rep = /교환/.test(label);
  const weld = /판금|용접/.test(label);
  const corr = /부식/.test(label);
  if (rep || weld || corr) {
    return { label, isClean: false, hasReplacement: rep, hasWelding: weld, hasCorrosion: corr };
  }
  if (/무사고|없음|이상\s*없음|정상/.test(label)) {
    return { label, isClean: true, hasReplacement: false, hasWelding: false, hasCorrosion: false };
  }
  return { label, isClean: null, hasReplacement: null, hasWelding: null, hasCorrosion: null };
}

function normalizeYear(y: number): number {
  if (!Number.isInteger(y)) throw new Error(`--year 는 정수여야 합니다: ${y}`);
  if (y >= 0 && y <= 99) return y;
  if (y >= 2000 && y <= 2099) return y % 100;
  throw new Error(`--year 는 2자리(예: 22) 또는 4자리(예: 2022, 2000년 이후)여야 합니다: ${y}`);
}

function checkNonNegInt(name: string, v: number | undefined): void {
  if (v !== undefined && (!Number.isInteger(v) || v < 0)) throw new Error(`${name} 는 0 이상의 정수여야 합니다: ${v}`);
}

/** 수동 옵션 값 검증 (제공된 값만) */
function validateManualValues(opts: CompareCliOptions): void {
  if (opts.month !== undefined && (!Number.isInteger(opts.month) || opts.month < 1 || opts.month > 12)) {
    throw new Error(`--month 는 1~12 정수여야 합니다: ${opts.month}`);
  }
  checkNonNegInt('--mileage', opts.mileage);
  if (opts.price !== undefined) {
    if (!(opts.price > 0)) throw new Error(`--price 는 0보다 커야 합니다: ${opts.price}`);
    if (opts.price >= 100000) throw new Error(`--price 는 만원 단위입니다 (예: 3650). 원 단위로 입력한 것 같습니다: ${opts.price}`);
  }
  checkNonNegInt('--accident-count', opts.accidentCount);
  if (opts.accidentAmount !== undefined && !(opts.accidentAmount >= 0)) {
    throw new Error(`--accident-amount 는 0 이상이어야 합니다 (원 단위): ${opts.accidentAmount}`);
  }
  checkNonNegInt('--owner-changes', opts.ownerChanges);
}

export function buildManualInput(opts: CompareCliOptions): CompareInput {
  if (!opts.platform) throw new Error('--url 또는 --platform <heydealer|kcar|hyundai_certified> 중 하나를 지정하세요');
  const missing: string[] = [];
  if (!opts.model || opts.model.trim() === '') missing.push('--model');
  if (opts.year === undefined) missing.push('--year');
  if (opts.mileage === undefined) missing.push('--mileage');
  if (opts.price === undefined) missing.push('--price');
  if (missing.length > 0) throw new Error(`수동 입력 필수 옵션 누락: ${missing.join(', ')}`);
  validateManualValues(opts);
  const accidentCount = opts.accidentCount ?? null;
  const accidentAmount = opts.accidentAmount ?? (accidentCount === 0 ? 0 : null);
  return {
    platform: opts.platform,
    sourceUrl: null,
    manufacturer: null,
    model: (opts.model as string).trim(),
    trim: opts.trim?.trim() || null,
    year: normalizeYear(opts.year as number),
    month: opts.month ?? null,
    modelYear: null,
    mileage: opts.mileage as number,
    price: opts.price as number,
    originPrice: null,
    fuelType: null,
    transmission: null,
    color: null,
    displacement: null,
    accidentCount,
    accidentAmount,
    hasSevereAccident: null,
    ownerChangeCount: opts.ownerChanges ?? null,
    hasRentalHistory: opts.rental ?? null,
    inspection: opts.inspection !== undefined ? parseInspectionText(opts.inspection) : null,
    optionItems: null,
    optionPackages: null,
  };
}

/** --url 사용 시 함께 준 수동 옵션으로 크롤링 값을 덮어씀. 덮어쓴 옵션 이름 목록 반환 */
export function applyOverrides(input: CompareInput, opts: CompareCliOptions): string[] {
  validateManualValues(opts);
  const applied: string[] = [];
  if (opts.model !== undefined && opts.model.trim() !== '') { input.model = opts.model.trim(); applied.push('--model'); }
  if (opts.trim !== undefined) { input.trim = opts.trim.trim() || null; applied.push('--trim'); }
  if (opts.year !== undefined) { input.year = normalizeYear(opts.year); applied.push('--year'); }
  if (opts.month !== undefined) { input.month = opts.month; applied.push('--month'); }
  if (opts.mileage !== undefined) { input.mileage = opts.mileage; applied.push('--mileage'); }
  if (opts.price !== undefined) { input.price = opts.price; applied.push('--price'); }
  if (opts.accidentCount !== undefined) { input.accidentCount = opts.accidentCount; applied.push('--accident-count'); }
  if (opts.accidentAmount !== undefined) { input.accidentAmount = opts.accidentAmount; applied.push('--accident-amount'); }
  if (opts.ownerChanges !== undefined) { input.ownerChangeCount = opts.ownerChanges; applied.push('--owner-changes'); }
  if (opts.rental !== undefined) { input.hasRentalHistory = opts.rental; applied.push(opts.rental ? '--rental' : '--no-rental'); }
  if (opts.inspection !== undefined) { input.inspection = parseInspectionText(opts.inspection); applied.push('--inspection'); }
  return applied;
}

// ───────── 비교 흐름 단계 (CLI는 단계 사이에 진행 메시지를 출력, 서버는 runCompare로 한 번에) ─────────

export interface CompareSettings { matchConfig: MatchConfig; specMaxAdjust: number; hyundaiPremium: number; premiums: Record<ComparePlatform, number>; knn: KnnConfig; }

/** 환경변수 검증 + 요청별 덮어쓰기 적용. 환경변수 오류 = INVALID_CONFIG, 덮어쓰기 값 오류 = INVALID_INPUT */
export function resolveCompareSettings(override: CompareSettingsOverride = {}, env: NodeJS.ProcessEnv = process.env): CompareSettings {
  let base: MatchConfig;
  let spec: number;
  let premiums: Record<ComparePlatform, number>;
  let hyundaiPremium: number;
  let knn: KnnConfig;
  try {
    base = getMatchConfigFromEnv(env);
    spec = specMaxAdjust(env);
    premiums = { heydealer: platformBasePremium('heydealer', env), kcar: platformBasePremium('kcar', env), hyundai_certified: platformBasePremium('hyundai_certified', env) };
    hyundaiPremium = premiums.hyundai_certified;
    knn = getKnnConfigFromEnv(env);
  } catch (err) {
    throw new CompareError('INVALID_CONFIG', errMsg(err));
  }
  const o = override;
  const isInt = (n: unknown, min: number, max: number): boolean => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
  if (o.yearRange !== undefined && !isInt(o.yearRange, 0, 10)) throw new CompareError('INVALID_INPUT', `연식 범위는 0~10 정수여야 합니다: ${o.yearRange}`);
  if (o.minSamples !== undefined && !isInt(o.minSamples, 1, 100)) throw new CompareError('INVALID_INPUT', `최소 표본은 1~100 정수여야 합니다: ${o.minSamples}`);
  if (o.specMaxAdjust !== undefined && !isInt(o.specMaxAdjust, 0, 30)) throw new CompareError('INVALID_INPUT', `사양 보정 상한은 0~30 정수여야 합니다: ${o.specMaxAdjust}`);
  if (o.knnN !== undefined && !isInt(o.knnN, 5, 200)) throw new CompareError('INVALID_INPUT', `유사 매물 수는 5~200 정수여야 합니다: ${o.knnN}`);
  let mileageRatios = base.mileageRatios;
  if (o.mileagePercents === null) mileageRatios = null;
  else if (o.mileagePercents !== undefined) {
    const ps = o.mileagePercents;
    if (!Array.isArray(ps) || ps.length < 1 || ps.length > 5 || ps.some((p) => typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 500)) {
      throw new CompareError('INVALID_INPUT', `주행거리 범위는 0 초과 500 이하 % 값 1~5개여야 합니다: ${JSON.stringify(ps)}`);
    }
    mileageRatios = [...new Set(ps)].sort((a, b) => a - b).map((p) => p / 100);
  }
  return {
    matchConfig: { minSamples: o.minSamples ?? base.minSamples, yearRange: o.yearRange ?? base.yearRange, mileageRatios },
    specMaxAdjust: o.specMaxAdjust ?? spec,
    hyundaiPremium,
    premiums,
    knn: { ...knn, n: o.knnN ?? knn.n },
  };
}

/** URL 사이트 판별 + --platform 일치 확인 */
export function resolveUrlSite(url: string, platform: ComparePlatform | undefined): UrlSite {
  const site = detectUrlPlatform(url);
  if (site === null) {
    throw new CompareError('UNSUPPORTED_URL', '--url 은 헤이딜러(https://www.heydealer.com/market/cars/{id}) 또는 현대 인증중고차(https://certified.hyundai.com/p/goods/goodsDetail.do?goodsNo={매물번호}) 상세 URL만 지원합니다 (케이카는 --platform kcar 수동 입력)');
  }
  if (platform && platform !== site) {
    throw new CompareError('PLATFORM_MISMATCH', `--platform ${platform} 과 --url 의 사이트(${URL_SITE_LABEL[site]})가 다릅니다. --platform 을 빼거나 맞춰 주세요`);
  }
  return site;
}

export interface FetchedInput { input: CompareInput; warnings: string[]; notes: string[]; }

/** 상세 페이지 조회·파싱. fetchHtml 주입으로 테스트 시 네트워크 없이 픽스처 사용 */
export async function fetchSiteInput(site: UrlSite, url: string, fetchHtml: (url: string) => Promise<string> = fetchText): Promise<FetchedInput> {
  try {
    if (site === 'heydealer') {
      const r = await fetchHeydealerInput(url, fetchHtml);
      return { input: r.input, warnings: r.warnings, notes: [] };
    }
    const r = await fetchHyundaiCertifiedInput(url, fetchHtml);
    return { input: r.input, warnings: r.warnings, notes: r.notes };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new CompareError('LISTING_NOT_FOUND', `${URL_SITE_LABEL[site]} 매물을 찾을 수 없습니다 (판매 완료 또는 삭제된 매물일 수 있음)`);
    }
    if (err instanceof InvalidUrlError) throw new CompareError('INVALID_URL', err.message);
    if (err instanceof CompareError) throw err;
    throw new CompareError('FETCH_FAILED', errMsg(err));
  }
}

export interface CompareAnalysis { result: CompareResult; match: MarketMatch; }

/** DB 동급매물 검색 + 분석. 수집 매물 없음 = EMPTY_DB, 동급 없음 = NO_PEERS (details에 원인 안내) */
export function analyzeInput(input: CompareInput, settings: CompareSettings, now: Date): CompareAnalysis {
  if (getSummary().totalCount === 0) {
    throw new CompareError('EMPTY_DB', '수집된 엔카 매물이 없습니다.', ['먼저 비교할 모델을 수집하세요: npx ts-node src/index.ts collect "<엔카 검색 URL>"']);
  }
  const matchConfig = settings.matchConfig;
  const pool = findVehicles({ excludeStaleAsOf: now }); // findMarketPeers 와 같은 후보 (유사 매물 평가에도 사용)
  const match = matchPeers(input, pool, matchConfig);
  if (match.peers.length === 0) {
    const details: string[] = [];
    const sc = staleCutoffIso(now);
    const staleN = sc === null ? 0 : countStaleVehicles(sc);
    if (staleN > 0) details.push(`(참고) 엔카 목록에서 ${getStaleDays()}일 이상 확인되지 않은 매물 ${staleN}대는 비교에서 제외됩니다 — 해당 검색 URL로 다시 collect 하세요.`);
    const anyYear = findMarketPeers(input, { ...matchConfig, yearRange: 99 }, now);
    if (anyYear.basePool.length > 0) {
      const ys = anyYear.basePool.map((v) => v.year);
      details.push(`모델은 일치하는 매물 ${anyYear.basePool.length}대가 있으나 연식 범위 밖입니다 (DB 연식 ${fmtYY(Math.min(...ys))}~${fmtYY(Math.max(...ys))}년식). COMPARE_YEAR_RANGE(현재 ±${matchConfig.yearRange}년)를 늘리거나 해당 연식 매물을 collect 하세요.`);
    } else {
      const models = getSummary().modelDistribution.map((d) => d.label).filter((l) => l.length > 0);
      if (models.length > 0) details.push(`DB에 있는 모델(상위): ${models.join(', ')}`);
      details.push('해당 모델의 엔카 검색 URL로 collect 하거나, --model 을 엔카 표기(예: "더 뉴 싼타페")로 지정하세요.');
    }
    throw new CompareError('NO_PEERS', `동급매물을 찾지 못했습니다: 모델 "${input.model}", 연식 ${fmtYY(match.criteria.yearFrom)}~${fmtYY(match.criteria.yearTo)}년식`, details);
  }
  const peerOptionNames = match.criteria.trimApplied && (input.optionPackages?.length ?? 0) > 0
    ? getOptionNamesByCarIds(match.basePool.map((v) => v.carId))
    : undefined;
  const base = analyzeComparison(input, match, now, peerOptionNames, {
    specMaxAdjust: settings.specMaxAdjust,
    basePremium: settings.premiums[input.platform],
  });
  const knn = settings.knn.enabled
    ? computeKnn(input, pool, now, { n: settings.knn.n, primary: settings.knn.primary, basePremium: settings.premiums[input.platform], judgement: base.judgement })
    : null;
  return { result: { ...base, knn }, match };
}

export interface CompareDeps { fetchHtml: (url: string) => Promise<string>; now: () => Date; }
export const defaultCompareDeps: CompareDeps = { fetchHtml: fetchText, now: () => new Date() };

export interface CompareOutcome {
  input: CompareInput;
  site: UrlSite | null;
  warnings: string[];
  notes: string[];
  overridden: string[]; // applyOverrides가 돌려준 CLI 옵션 이름 (--price 등)
  settings: CompareSettings;
  result: CompareResult;
  match: MarketMatch;
}

function asInvalidInput<T>(fn: () => T): T {
  try { return fn(); } catch (err) {
    if (err instanceof CompareError) throw err;
    throw new CompareError('INVALID_INPUT', errMsg(err));
  }
}

/** 서버용 전체 흐름 (출력 없음). 실패는 모두 CompareError */
export async function runCompare(opts: CompareCliOptions, override: CompareSettingsOverride = {}, deps: CompareDeps = defaultCompareDeps): Promise<CompareOutcome> {
  const settings = resolveCompareSettings(override);
  let input: CompareInput;
  let site: UrlSite | null = null;
  let warnings: string[] = [];
  let notes: string[] = [];
  let overridden: string[] = [];
  if (opts.url) {
    const s = resolveUrlSite(opts.url, opts.platform);
    site = s;
    const parsed = await fetchSiteInput(s, opts.url, deps.fetchHtml);
    const parsedInput = parsed.input;
    warnings = parsed.warnings;
    notes = parsed.notes;
    overridden = asInvalidInput(() => applyOverrides(parsedInput, opts));
    input = parsedInput;
  } else {
    input = asInvalidInput(() => buildManualInput(opts));
  }
  const { result, match } = analyzeInput(input, settings, deps.now());
  return { input, site, warnings, notes, overridden, settings, result, match };
}
