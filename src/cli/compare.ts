import { getOptionNamesByCarIds, getSummary, getStaleDays, staleCutoffIso, countStaleVehicles } from '../db/repository';
import { HttpError } from '../crawler/fetch-helper';
import { fetchHeydealerInput } from '../crawler/heydealer-parser';
import { fetchHyundaiCertifiedInput } from '../crawler/hyundai-certified-parser';
import { findMarketPeers, getMatchConfigFromEnv, type MatchConfig } from '../comparator/market-matcher';
import { analyzeComparison, specMaxAdjust, platformBasePremium } from '../comparator/analyzer';
import { printCompareReport } from '../comparator/reporter';
import { fmtYY } from './format';
import type { ComparePlatform, CompareInput, InspectionInfo } from '../types';

export function detectUrlPlatform(url: string): 'heydealer' | 'hyundai_certified' | null {
  let host: string;
  try { host = new URL(url.trim()).hostname.toLowerCase(); } catch { return null; }
  if (host === 'heydealer.com' || host === 'www.heydealer.com') return 'heydealer';
  if (host === 'certified.hyundai.com') return 'hyundai_certified';
  return null;
}

const URL_SITE_LABEL = { heydealer: '헤이딜러', hyundai_certified: '현대 인증중고차' } as const;

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

export async function compareCommand(opts: CompareCliOptions, now: Date = new Date()): Promise<number> {
  let matchConfig: MatchConfig;
  try {
    matchConfig = getMatchConfigFromEnv(); // 네트워크 호출 전에 환경변수부터 검증
    specMaxAdjust(); // 사양 보정 상한값 검증
    platformBasePremium('hyundai_certified'); // 환경변수 검증
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  if (['COMPARE_MIN_SAMPLES', 'COMPARE_YEAR_RANGE', 'COMPARE_MILEAGE_RANGE'].some((k) => (process.env[k] ?? '').trim() !== '')) {
    const mil = matchConfig.mileageRatios === null ? '제한 없음' : matchConfig.mileageRatios.map((r) => `±${Math.round(r * 100)}%`).join(' → ');
    console.log(`ℹ 동급 조건(환경변수): 연식 ±${matchConfig.yearRange}년 | 주행거리 ${mil} | 최소 표본 ${matchConfig.minSamples}대`);
  }
  if ((process.env.STALE_DAYS ?? '').trim() !== '') {
    const d = getStaleDays();
    console.log(`ℹ 미확인 매물 제외(STALE_DAYS): ${d === 0 ? '꺼짐' : `엔카 목록에서 ${d}일 이상 확인되지 않은 매물 제외`}`);
  }
  let input: CompareInput;
  if (opts.url) {
    const site = detectUrlPlatform(opts.url);
    if (site === null) {
      console.error('❌ --url 은 헤이딜러(https://www.heydealer.com/market/cars/{id}) 또는 현대 인증중고차(https://certified.hyundai.com/p/goods/goodsDetail.do?goodsNo={매물번호}) 상세 URL만 지원합니다 (케이카는 --platform kcar 수동 입력)');
      return 1;
    }
    if (opts.platform && opts.platform !== site) {
      console.error(`❌ --platform ${opts.platform} 과 --url 의 사이트(${URL_SITE_LABEL[site]})가 다릅니다. --platform 을 빼거나 맞춰 주세요`);
      return 1;
    }
    console.log(`🔗 ${URL_SITE_LABEL[site]} 매물 조회 중: ${opts.url}`);
    try {
      const parsed = site === 'heydealer' ? await fetchHeydealerInput(opts.url) : await fetchHyundaiCertifiedInput(opts.url);
      input = parsed.input;
      for (const w of parsed.warnings) console.warn(`  ⚠ ${w}`);
      if ('notes' in parsed && Array.isArray(parsed.notes)) for (const n of parsed.notes) console.log(`  ℹ ${n}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        console.error(`❌ ${URL_SITE_LABEL[site]} 매물을 찾을 수 없습니다 (판매 완료 또는 삭제된 매물일 수 있음)`);
        return 1;
      }
      throw err;
    }
    const applied = applyOverrides(input, opts);
    if (applied.length > 0) console.log(`  ✎ 수동 입력값으로 덮어씀: ${applied.join(', ')}`);
  } else {
    input = buildManualInput(opts);
  }

  if (input.platform === 'hyundai_certified' && (process.env.COMPARE_PREMIUM_HYUNDAI_CERTIFIED ?? '').trim() !== '') {
    console.log(`ℹ 현대 인증중고차 기본 프리미엄(환경변수): ${platformBasePremium('hyundai_certified')}%`);
  }

  console.log();

  if (getSummary().totalCount === 0) {
    console.error('📭 수집된 엔카 매물이 없습니다.');
    console.error('   먼저 비교할 모델을 수집하세요: npx ts-node src/index.ts collect "<엔카 검색 URL>"');
    return 1;
  }

  const match = findMarketPeers(input, matchConfig, now);
  if (match.peers.length === 0) {
    console.error(`❌ 동급매물을 찾지 못했습니다: 모델 "${input.model}", 연식 ${fmtYY(match.criteria.yearFrom)}~${fmtYY(match.criteria.yearTo)}년식`);
    const sc = staleCutoffIso(now);
    const staleN = sc === null ? 0 : countStaleVehicles(sc);
    if (staleN > 0) console.error(`   (참고) 엔카 목록에서 ${getStaleDays()}일 이상 확인되지 않은 매물 ${staleN}대는 비교에서 제외됩니다 — 해당 검색 URL로 다시 collect 하세요.`);
    const anyYear = findMarketPeers(input, { ...matchConfig, yearRange: 99 }, now);
    if (anyYear.basePool.length > 0) {
      const ys = anyYear.basePool.map((v) => v.year);
      console.error(`   모델은 일치하는 매물 ${anyYear.basePool.length}대가 있으나 연식 범위 밖입니다 (DB 연식 ${fmtYY(Math.min(...ys))}~${fmtYY(Math.max(...ys))}년식). COMPARE_YEAR_RANGE(현재 ±${matchConfig.yearRange}년)를 늘리거나 해당 연식 매물을 collect 하세요.`);
      return 1;
    }
    const models = getSummary().modelDistribution.map((d) => d.label).filter((l) => l.length > 0);
    if (models.length > 0) console.error(`   DB에 있는 모델(상위): ${models.join(', ')}`);
    console.error('   해당 모델의 엔카 검색 URL로 collect 하거나, --model 을 엔카 표기(예: "더 뉴 싼타페")로 지정하세요.');
    return 1;
  }

  const peerOptionNames = match.criteria.trimApplied && (input.optionPackages?.length ?? 0) > 0
    ? getOptionNamesByCarIds(match.basePool.map((v) => v.carId))
    : undefined;
  printCompareReport(analyzeComparison(input, match, now, peerOptionNames));
  return 0;
}
