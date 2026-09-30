import { scoreOwnerHistory } from '../scoring/owner';
import type {
  AccidentComparison, AccidentSeverity, ComparePlatform, CompareInput, CompareResult, CompareVerdict, InspectionComparison, InputOptionPackage,
  MarketMatch, MarketStats, MileageComparison, OptionComparison, OwnerComparison, PackagePeerStats, PriceBucket, PriceComparison, QualityAxis,
  QualityFactor, RentalComparison, VehicleData, VerdictDetail,
} from '../types';

export const BASE_PLATFORM_PREMIUM = 5;
export const MAX_PLATFORM_PREMIUM = 10;
export const CHEAP_THRESHOLD = -5;
export const EXPENSIVE_EXCESS = 10;
export const LOW_ANNUAL_KM = 5000;
export const HIGH_ANNUAL_KM = 25000;
export const SPEC_DEADBAND = 2;
export const MIN_SPEC_PEERS = 3;

export function specMaxAdjust(env: NodeJS.ProcessEnv = process.env): number {
  const val = (env['COMPARE_SPEC_MAX_ADJUST'] ?? '').trim();
  if (val === '') return 7;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(`COMPARE_SPEC_MAX_ADJUST는 0 이상의 숫자여야 합니다: ${val}`);
  }
  return n;
}

export function platformBasePremium(platform: ComparePlatform, env: NodeJS.ProcessEnv = process.env): number {
  if (platform !== 'hyundai_certified') return BASE_PLATFORM_PREMIUM;
  const raw = (env['COMPARE_PREMIUM_HYUNDAI_CERTIFIED'] ?? '').trim();
  if (raw === '') return BASE_PLATFORM_PREMIUM;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_PLATFORM_PREMIUM) throw new Error(`COMPARE_PREMIUM_HYUNDAI_CERTIFIED는 0~${MAX_PLATFORM_PREMIUM} 정수여야 합니다: ${raw}`);
  return n;
}

function avg(xs: number[]): number | null {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

/** 백분위 방식은 detail-parsers.computeMarketPrice와 동일 (중앙값 평균, P25/P75 = sorted[floor(n*q)]) */
export function computeMarketStats(prices: number[]): MarketStats {
  const s = [...prices].sort((a, b) => a - b);
  const n = s.length;
  const median = n % 2 === 0 ? (s[n / 2 - 1] + s[n / 2]) / 2 : s[Math.floor(n / 2)];
  return {
    sampleCount: n,
    mean: s.reduce((a, b) => a + b, 0) / n,
    median,
    p25: s[Math.floor(n * 0.25)],
    p75: s[Math.floor(n * 0.75)],
    min: s[0],
    max: s[n - 1],
  };
}

export function buildPriceBuckets(prices: number[], meanPrice: number): { width: number; buckets: PriceBucket[] } {
  const width = Math.max(10, Math.round((meanPrice * 0.05) / 10) * 10);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const start = Math.floor(min / width) * width;
  const count = Math.floor((max - start) / width) + 1;
  const buckets: PriceBucket[] = Array.from({ length: count }, (_, i) => ({
    from: start + i * width, to: start + (i + 1) * width, count: 0,
  }));
  for (const p of prices) buckets[Math.floor((p - start) / width)].count++;
  return { width, buckets };
}

function comparePrice(input: CompareInput, peers: VehicleData[], stats: MarketStats): PriceComparison {
  const prices = peers.map((v) => v.price);
  const n = prices.length;
  const cheaper = prices.filter((p) => p < input.price).length;
  const equal = prices.filter((p) => p === input.price).length;
  const { width, buckets } = buildPriceBuckets(prices, stats.mean);
  const idx = Math.floor((input.price - buckets[0].from) / width);
  const densest = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]);
  const sameYearPrices = peers.filter((v) => v.year === input.year).map((v) => v.price);
  const sameYearMean = avg(sameYearPrices);
  return {
    inputPrice: input.price,
    diffAmount: input.price - stats.mean,
    diffPercent: ((input.price - stats.mean) / stats.mean) * 100,
    medianDiff: input.price - stats.median,
    percentile: Math.round(((cheaper + 0.5 * equal) / n) * 100),
    withinIqr: input.price >= stats.p25 && input.price <= stats.p75,
    iqrExcess: input.price > stats.p75 ? input.price - stats.p75 : input.price < stats.p25 ? input.price - stats.p25 : 0,
    bucketWidth: width,
    buckets,
    densestBucket: densest,
    inputBucket: idx >= 0 && idx < buckets.length ? buckets[idx] : null,
    sameYear: sameYearPrices.length >= 3 && sameYearMean !== null ? { count: sameYearPrices.length, mean: sameYearMean } : null,
  };
}

/** scoring/mileage.ts scoreMileage와 동일한 차령(월) 계산 */
export function calcAgeMonths(year: number, month: number | null, now: Date): number {
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  return month !== null && month > 0
    ? Math.max(1, (nowYear - (2000 + year)) * 12 + (nowMonth - month))
    : Math.max(12, (nowYear - (2000 + year)) * 12);
}

function compareMileage(input: CompareInput, basePool: VehicleData[], now: Date): MileageComparison {
  const peerAvg = avg(basePool.map((v) => v.mileage).filter((m) => m > 0));
  const ageMonths = calcAgeMonths(input.year, input.month, now);
  const annual = (input.mileage / ageMonths) * 12;
  return {
    inputMileage: input.mileage,
    peerAvgMileage: peerAvg,
    peerRatio: peerAvg !== null && peerAvg > 0 ? input.mileage / peerAvg : null,
    ageMonths,
    annualMileage: annual,
    judgement: annual < LOW_ANNUAL_KM ? 'low' : annual >= HIGH_ANNUAL_KM ? 'high' : 'normal',
  };
}

export function classifyAccident(
  count: number | null, amount: number | null, hasSevere: boolean | null, originPrice: number | null,
): { severity: AccidentSeverity | null; ratio: number | null } {
  if (count === null && amount === null) return { severity: null, ratio: null };
  if ((count ?? 0) === 0 && (amount ?? 0) === 0) return { severity: 'none', ratio: null };
  const r = amount !== null && amount > 0 && originPrice !== null && originPrice > 0 ? amount / (originPrice * 10000) : null;
  if (hasSevere === true) return { severity: 'severe', ratio: r };
  if (amount === null || amount <= 0) return { severity: 'unknown', ratio: null };
  if (r !== null) return { severity: r <= 0.08 ? 'minor' : r <= 0.15 ? 'moderate' : 'severe', ratio: r };
  return { severity: amount < 2_000_000 ? 'minor' : amount < 5_000_000 ? 'moderate' : 'severe', ratio: null };
}

function compareAccident(input: CompareInput, peers: VehicleData[]): AccidentComparison {
  const peerOrigin = avg(peers.map((v) => v.originPrice ?? 0).filter((p) => p > 0));
  const hasInputOrigin = input.originPrice !== null && input.originPrice > 0;
  const originPriceUsed = hasInputOrigin ? input.originPrice : peerOrigin !== null ? Math.round(peerOrigin) : null;
  const originPriceSource = hasInputOrigin ? 'input' : peerOrigin !== null ? 'peer_avg' : null;
  const { severity, ratio: amountRatio } = classifyAccident(
    input.accidentCount, input.accidentAmount, input.hasSevereAccident, originPriceUsed,
  );
  const known = peers.filter((v) => !v.isInsurancePrivate);
  const free = known.filter((v) => v.myDamageCount === 0).length;
  return {
    inputAccidentCount: input.accidentCount,
    inputAccidentAmount: input.accidentAmount,
    originPriceUsed,
    originPriceSource,
    amountRatio,
    severity,
    peerKnownCount: known.length,
    peerAccidentFreeCount: free,
    peerAccidentFreeRatio: ratio(free, known.length),
    peerAvgAccidentCount: avg(known.map((v) => v.myDamageCount)),
  };
}

function peerReplaced(v: VehicleData): boolean {
  return v.hasReplacement || v.diagPanelReplacement || v.diagFrameReplacement;
}

function compareInspection(input: CompareInput, peers: VehicleData[]): InspectionComparison {
  const insp = peers.filter((v) => !v.isInspectionPrivate && (v.hasInspection || v.hasDiagnosis));
  const clean = insp.filter((v) => !peerReplaced(v) && !v.hasWelding && !v.hasCorrosion).length;
  const i = input.inspection;
  const same = i !== null && i.hasReplacement !== null && i.hasWelding !== null
    ? insp.filter((v) => peerReplaced(v) === i.hasReplacement && v.hasWelding === i.hasWelding).length
    : null;
  return {
    input: i,
    peerInspectableCount: insp.length,
    peerCleanCount: clean,
    peerCleanRatio: ratio(clean, insp.length),
    peerSameStateRatio: same === null ? null : ratio(same, insp.length),
    peerDiagnosisRatio: ratio(peers.filter((v) => v.hasDiagnosis).length, peers.length),
  };
}

function compareOwner(input: CompareInput, peers: VehicleData[]): OwnerComparison {
  const known = peers.filter((v) => !v.isInsurancePrivate);
  return {
    inputCount: input.ownerChangeCount,
    peerAvgCount: avg(known.map((v) => v.ownerChangeCount)),
    deductionRate: input.ownerChangeCount === null ? null : 1 - scoreOwnerHistory({ ownerChangeCount: input.ownerChangeCount }, 1),
  };
}

const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'] as const;

/** 매칭 키에서 빼는 수식어 토큰 (실데이터 근거가 있는 것만).
 *  MODIFIER: 뒤에 다른 토큰이 있을 때만 제거 — "KRELL 프리미엄 사운드"(싼타페 2022~ 표기), "10.25인치 UVO 내비게이션"(쏘렌토 2021 표기).
 *            마지막 토큰이면 등급어일 수 있어 유지.
 *  TRAILING_GENERIC: 마지막 토큰(첫 토큰 제외)일 때만 제거 — "KRELL 사운드 시스템" ↔ "KRELL 사운드".
 *  로마숫자·플러스·라이트 등 등급어는 사전에 넣지 않는다 → 서로 다른 키로 남는다. */
const MODIFIER_TOKENS: ReadonlySet<string> = new Set(['프리미엄', 'uvo']);
const TRAILING_GENERIC_TOKENS: ReadonlySet<string> = new Set(['시스템']);

/** '+' 세그먼트별 토큰 배열. NFKC → 첫 줄/※ 앞 → 괄호 제거 → "1) "·제조사 접두 제거 → 세그먼트 끝 숫자→로마숫자
 *  → 공백 분리 → 토큰별 소문자·[0-9a-z가-힣] 외 제거. 빈 토큰·빈 세그먼트 제외 */
function optionNameSegments(name: string): string[][] {
  return name.normalize('NFKC')
    .split(/\n|※/)[0]
    .replace(/[(\[][^()[\]]*[)\]]/g, ' ')
    .replace(/^\s*\d+\)\s*/, '')
    .replace(/^\s*(현대|기아|제네시스)\s+/, '')
    .split('+')
    .map((seg) => seg.trim().replace(/(^|[^0-9.])([1-9])$/, (_m: string, pre: string, d: string) => pre + ROMAN_NUMERALS[Number(d)]))
    .map((seg) => seg.split(/\s+/).map((t) => t.toLowerCase().replace(/[^0-9a-z가-힣]/g, '')).filter((t) => t.length > 0))
    .filter((tokens) => tokens.length > 0);
}

export function normalizeOptionName(name: string): string {
  return optionNameSegments(name).map((tokens) => tokens.join('')).join('+');
}

function stripModifierTokens(tokens: readonly string[]): string[] {
  const last = tokens.length - 1;
  const kept = tokens.filter((t, i) =>
    !(MODIFIER_TOKENS.has(t) && i < last) && !(TRAILING_GENERIC_TOKENS.has(t) && i === last && i > 0));
  return kept.length > 0 ? kept : [...tokens];
}

/** 선택옵션 동일성 키: 첫 '+' 세그먼트(핵심 옵션)에서 수식어 토큰을 뺀 뒤 이어 붙인 문자열 (키 동등성으로 비교) */
export function optionMatchKey(name: string): string {
  const segs = optionNameSegments(name);
  return segs.length === 0 ? '' : stripModifierTokens(segs[0]).join('');
}

/** 보고서 표시용 엔카 원문 (첫 줄, ※ 앞) */
function optionDisplayName(name: string): string {
  return name.split(/\n|※/)[0].trim();
}

export function comparePackagePeers(
  packages: InputOptionPackage[] | null,
  pool: VehicleData[],
  trimApplied: boolean,
  peerOptionNames: ReadonlyMap<string, readonly (string | null)[]> | undefined,
): PackagePeerStats | null {
  if (!trimApplied || peerOptionNames === undefined || packages === null) return null;
  const pkgs = packages.map((p) => ({ name: p.name, key: optionMatchKey(p.name) })).filter((p) => p.key !== '');
  if (pkgs.length === 0) return null;
  const known: Map<string, string>[] = []; // 매물별: 매칭 키 → 엔카 원문(표시용, 첫 번째)
  for (const v of pool) {
    if (v.optionsStatus !== 'ok' && v.optionsStatus !== 'none') continue;
    const names = peerOptionNames.get(v.carId) ?? [];
    if (names.some((n) => n === null)) continue;
    if (v.optionsStatus === 'ok' && names.length === 0) continue;
    const m = new Map<string, string>();
    for (const n of names as string[]) {
      const k = optionMatchKey(n);
      if (k !== '' && !m.has(k)) m.set(k, optionDisplayName(n));
    }
    known.push(m);
  }
  const knownCount = known.length;
  return {
    poolCount: pool.length,
    knownCount,
    items: knownCount < MIN_SPEC_PEERS
      ? null
      : pkgs.map((p) => {
        const counts = new Map<string, number>();
        let withCount = 0;
        for (const m of known) {
          const d = m.get(p.key);
          if (d === undefined) continue;
          withCount++;
          counts.set(d, (counts.get(d) ?? 0) + 1);
        }
        const matchedNames = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d);
        return { name: p.name, withCount, matchedNames };
      }),
  };
}

export function computeSpecAdjustment(specDiffPercent: number | null, maxAdjust: number = specMaxAdjust()): number {
  if (specDiffPercent === null || Math.abs(specDiffPercent) < SPEC_DEADBAND) return 0;
  return Math.max(-maxAdjust, Math.min(maxAdjust, Math.round(specDiffPercent * 10) / 10));
}

function compareOptions(
  input: CompareInput, peers: VehicleData[], trimApplied: boolean,
  basePool: VehicleData[], peerOptionNames: ReadonlyMap<string, readonly (string | null)[]> | undefined,
): OptionComparison {
  const withOrigin = peers.filter((v) => v.originPriceBase !== null && v.originPrice !== null && v.originPrice > 0 && v.optionsStatus !== 'failed');
  const same = withOrigin.filter((v) => v.year === input.year);
  const pool = same.length >= MIN_SPEC_PEERS ? same : withOrigin;
  const peerOriginAvg = pool.length >= MIN_SPEC_PEERS ? avg(pool.map((v) => v.originPrice as number)) : null;
  const inputOrigin = input.originPrice !== null && input.originPrice > 0 ? input.originPrice : null;
  const specDiffPercent = inputOrigin !== null && peerOriginAvg !== null ? (inputOrigin / peerOriginAvg - 1) * 100 : null;
  const pk = input.optionPackages;
  const packagesTotal = pk === null ? null : pk.length === 0 ? 0 : pk.every((p) => p.price !== null) ? pk.reduce((s, p) => s + (p.price as number), 0) : null;
  const optPool = trimApplied ? withOrigin : [];
  return {
    items: input.optionItems,
    packages: pk,
    packagesTotal,
    inputOriginPrice: inputOrigin,
    peerOriginAvg,
    peerOriginCount: pool.length,
    peerOriginScope: peerOriginAvg === null ? null : pool === same ? 'same_year' : 'all',
    specDiffPercent,
    scope: specDiffPercent === null ? null : trimApplied ? 'options' : 'trim_and_options',
    peerOptionAvg: optPool.length > 0 ? avg(optPool.map((v) => v.originPriceOptions ?? 0)) : null,
    peerNoOptionRatio: optPool.length > 0 ? ratio(optPool.filter((v) => (v.originPriceOptions ?? 0) === 0).length, optPool.length) : null,
    packagePeers: comparePackagePeers(input.optionPackages, basePool, trimApplied, peerOptionNames),
  };
}

function compareRental(input: CompareInput, peers: VehicleData[]): RentalComparison {
  const known = peers.filter((v) => !v.isInsurancePrivate);
  const rental = known.filter((v) => v.hasRentalHistory).length;
  return {
    inputHasRental: input.hasRentalHistory,
    peerRentalRatio: ratio(rental, known.length),
    peerRentalCount: rental,
    peerKnownCount: known.length,
  };
}

export function buildQualityFactors(input: CompareInput, mileage: MileageComparison, accident: AccidentComparison): QualityFactor[] {
  const factors: QualityFactor[] = [];
  const add = (axis: QualityAxis, points: number, reason: string): void => {
    if (points !== 0) factors.push({ axis, points, reason });
  };
  if (accident.severity === 'none') add('accident', 2, '무사고');
  else if (accident.severity === 'moderate') add('accident', -3, '중간 규모 사고');
  else if (accident.severity === 'severe') add('accident', -6, '대형 사고');
  const i = input.inspection;
  if (i !== null) {
    if (i.isClean === true) add('inspection', 1, '성능점검 무사고');
    else if (i.hasWelding === true) add('inspection', -2, '판금 이력');
    else if (i.hasReplacement === true) add('inspection', -1, '교환 이력');
  }
  const o = input.ownerChangeCount;
  if (o === 0) add('owner', 1, '1인 소유(변경 0회)');
  else if (o !== null && o >= 3) add('owner', -2, `소유주 변경 ${o}회`);
  if (mileage.peerRatio !== null) {
    if (mileage.peerRatio <= 0.8) add('mileage', 2, '동급 대비 저주행');
    else if (mileage.peerRatio >= 1.2) add('mileage', -2, '동급 대비 고주행');
  }
  if (input.hasRentalHistory === true) add('rental', -5, '렌트 이력');
  return factors;
}

export function decideVerdict(
  diffPercent: number, factors: QualityFactor[], input: CompareInput, severity: AccidentSeverity | null, specAdjustment: number = 0,
  basePremium: number = BASE_PLATFORM_PREMIUM,
): VerdictDetail {
  const adjusted = diffPercent - specAdjustment;
  const qualityAdjustment = factors.reduce((s, f) => s + f.points, 0);
  const allowedPremium = Math.min(MAX_PLATFORM_PREMIUM, Math.max(0, basePremium + qualityAdjustment));
  const excess = adjusted - allowedPremium;
  const criticalReasons: string[] = [];
  if (severity === 'severe') criticalReasons.push('대형 사고');
  if (input.hasRentalHistory === true) criticalReasons.push('렌트 이력');
  if (input.ownerChangeCount !== null && input.ownerChangeCount >= 4) criticalReasons.push('소유주 변경 4회 이상');
  let verdict: CompareVerdict;
  if (adjusted <= CHEAP_THRESHOLD) verdict = criticalReasons.length === 0 ? 'cheap' : 'fair';
  else if (excess <= 0) verdict = 'fair';
  else if (excess < EXPENSIVE_EXCESS) verdict = 'slightly_expensive';
  else verdict = 'expensive';
  return {
    verdict,
    diffPercent,
    specAdjustment,
    adjustedDiffPercent: adjusted,
    basePremium,
    qualityAdjustment,
    allowedPremium,
    excessOverAllowance: excess,
    factors,
    criticalReasons,
  };
}

export function analyzeComparison(
  input: CompareInput, match: MarketMatch, now: Date = new Date(),
  peerOptionNames?: ReadonlyMap<string, readonly (string | null)[]>,
): CompareResult {
  const peers = match.peers;
  if (peers.length === 0) throw new Error('동급매물이 없어 비교할 수 없습니다');
  const market = computeMarketStats(peers.map((v) => v.price));
  const price = comparePrice(input, peers, market);
  const mileage = compareMileage(input, match.basePool, now);
  const accident = compareAccident(input, peers);
  const option = compareOptions(input, peers, match.criteria.trimApplied, match.basePool, peerOptionNames);
  const factors = buildQualityFactors(input, mileage, accident);
  return {
    input,
    criteria: match.criteria,
    sampleCount: peers.length,
    isLowSample: peers.length < match.criteria.minSamples,
    market,
    price,
    mileage,
    accident,
    inspection: compareInspection(input, peers),
    owner: compareOwner(input, peers),
    rental: compareRental(input, peers),
    option,
    judgement: decideVerdict(price.diffPercent, factors, input, accident.severity, computeSpecAdjustment(option.specDiffPercent), platformBasePremium(input.platform)),
  };
}
