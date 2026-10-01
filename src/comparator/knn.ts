// 유사 매물 평가 (가중 최근접 이웃, Weighted KNN) — 현재 동급 평가와 별도로 병기한다.
// 거리 = 두 매물의 차이가 가격에 주는 영향(%)의 절대값 합 (총 보정량). 이웃 가격은 같은 계수로 입력 조건에 맞춰 보정한 뒤 가중 평균한다.
// 근거·평가: 2026-10-01 DB(엔카 1,125대: 더 뉴 싼타페·쏘렌토 4세대·투싼 NX4) 모델 홀드아웃 LOO — MAE 4.84% (현재 방식 5.56%)
import { getCanonicalTrim } from '../crawler/detail-parsers';
import { MODEL_LEVELS, compact, dedupeWords, isEligiblePeer, matchesModel, powertrainTraits, trimMatchesExact } from './market-matcher';
import { EXPENSIVE_EXCESS, FAIR_BAND, calcAgeMonths } from './analyzer';
import type {
  CompareInput, CompareVerdict, KnnConfidence, KnnContribution, KnnNeighbor, KnnResult, KnnTermKey, VehicleData, VerdictDetail,
} from '../types';

type Feature = Exclude<KnnTermKey, 'trim' | 'powertrain'>;
/** 특성 순서 = 점(Point) 벡터 순서. 단위: 차령 년, 주행 만km, 렌트 0/1, 사고 보험금 100만원, 교환 0/1, 판금 0/1, 기본 신차가 100·ln(만원), 옵션 = 선택옵션/기본 신차가 % */
export const KNN_FEATURES: readonly Feature[] = ['age', 'mileage', 'rental', 'accident', 'replacement', 'welding', 'basePrice', 'options'];
/** 단위당 가격 영향(% = 100·Δln가격). 2026-10-01 DB 회귀(모델×파워트레인 고정효과 + 위 특성, n=1,125, R² 0.868) */
export const KNN_COEF: Readonly<Record<Feature, number>> = {
  age: -2.23, mileage: -2.36, rental: -2.23, accident: -0.59, replacement: -3.71, welding: -2.83, basePrice: 0.82, options: 0.53,
};
export const KNN_TRIM_PENALTY = 5;        // 세부등급(캘리그래피 등)이 다르면 거리 +5%p
export const KNN_POWERTRAIN_PENALTY = 5;  // 연료·구동·배기량 중 하나라도 다르면 +5%p
export const KNN_BANDWIDTH = 0.5;         // 가우시안 대역폭 = 0.5 × N번째 이웃 거리 (최소 1%p)
export const KNN_INTERVAL_MULT = 1.1;     // 95% 예측구간 보정 배수 (LOO 커버리지 93%→95%)
export const KNN_CLOSE_DISTANCE = 10;     // "가까운 이웃" 기준 (%p)
export const DEFAULT_KNN_N = 40;
export const KNN_TERM_LABEL: Record<KnnTermKey, string> = {
  age: '차령', mileage: '주행거리', rental: '렌트 이력', accident: '사고 보험금', replacement: '교환', welding: '판금',
  basePrice: '트림 신차가', options: '선택옵션', trim: '세부등급', powertrain: '파워트레인',
};

export interface KnnConfig { enabled: boolean; n: number; primary: boolean; }
export const DEFAULT_KNN_CONFIG: KnnConfig = { enabled: true, n: DEFAULT_KNN_N, primary: false };

/** COMPARE_KNN(기본 켜짐, 0=끔) / COMPARE_KNN_N(5~200, 기본 40) / COMPARE_VERDICT_SOURCE(current|knn, 기본 current) */
export function getKnnConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KnnConfig {
  const on = (env.COMPARE_KNN ?? '').trim();
  if (on !== '' && !/^(1|true|on|yes|0|false|off|no)$/i.test(on)) throw new Error(`COMPARE_KNN는 1(켜짐) 또는 0(꺼짐)이어야 합니다: ${on}`);
  const nRaw = (env.COMPARE_KNN_N ?? '').trim();
  let n = DEFAULT_KNN_N;
  if (nRaw !== '') {
    const x = Number(nRaw);
    if (!Number.isInteger(x) || x < 5 || x > 200) throw new Error(`COMPARE_KNN_N는 5~200 정수여야 합니다: ${nRaw}`);
    n = x;
  }
  const src = (env.COMPARE_VERDICT_SOURCE ?? '').trim().toLowerCase();
  if (src !== '' && src !== 'current' && src !== 'knn') throw new Error(`COMPARE_VERDICT_SOURCE는 current 또는 knn 이어야 합니다: ${src}`);
  const enabled = on === '' || /^(1|true|on|yes)$/i.test(on);
  return { enabled, n, primary: enabled && src === 'knn' };
}

interface Point { x: (number | null)[]; grade: string; fuel: string | null; drive: string | null; disp: string | null; }

export function vehicleKnnPoint(v: VehicleData, now: Date): Point {
  const priv = v.isInsurancePrivate;
  const insp = !v.isInspectionPrivate && (v.hasInspection || v.hasDiagnosis);
  const base = v.originPriceBase !== null && v.originPriceBase > 0 ? v.originPriceBase : null;
  const t = powertrainTraits(`${v.gradeName ?? ''} ${v.gradeDetail ?? ''}`);
  return {
    x: [
      calcAgeMonths(v.year, v.month, now) / 12,
      v.mileage / 1e4,
      priv ? null : v.hasRentalHistory ? 1 : 0,
      priv ? null : v.myDamageAmount / 1e6,
      insp ? (v.hasReplacement || v.diagPanelReplacement || v.diagFrameReplacement ? 1 : 0) : null,
      insp ? (v.hasWelding ? 1 : 0) : null,
      base === null ? null : 100 * Math.log(base),
      base === null || v.originPriceOptions === null ? null : (v.originPriceOptions / base) * 100,
    ],
    grade: compact(getCanonicalTrim(v.gradeName, v.gradeDetail)),
    fuel: t.fuel, drive: t.drive, disp: t.displacement,
  };
}

function ptMismatch(a: Point, b: Point): boolean {
  const diff = (p: string | null, q: string | null): boolean => p !== null && q !== null && p !== q;
  return diff(a.fuel, b.fuel) || diff(a.drive, b.drive) || diff(a.disp, b.disp);
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

interface InputPoint { point: Point; base: number | null; source: KnnResult['basePriceSource']; optPct: number | null; warnings: string[]; }

/** 입력 → 점. 기본 신차가: ① 입력 신차가 − 선택옵션 합계(가격 모두 있을 때) ② 같은 세부등급·파워트레인 엔카 매물(가장 가까운 연식) 중앙값 ③ 입력 신차가 ÷ (1 + 후보 평균 옵션 비중) ④ 없음 */
export function inputKnnPoint(input: CompareInput, cands: VehicleData[], candPts: Point[], now: Date): InputPoint {
  const trimText = input.trim ? dedupeWords(input.trim) : '';
  const t = powertrainTraits(trimText);
  // 세부등급 키: 엔카 등급명+세부등급과 글자 그대로 같은 후보가 있으면 그 후보의 키(예: "가솔린 1.6 터보 2WD 인스퍼레이션"), 없으면 입력 트림의 정규화 이름
  const exact = trimText === '' ? -1 : cands.findIndex((v) => trimMatchesExact(v, trimText));
  const grade = exact >= 0 ? candPts[exact].grade : trimText ? compact(getCanonicalTrim(trimText, '')) : '';
  const b01 = (b: boolean | null | undefined): number | null => (b === null || b === undefined ? null : b ? 1 : 0);
  const accident = input.accidentAmount !== null ? input.accidentAmount / 1e6 : input.accidentCount === 0 ? 0 : null;
  const warnings: string[] = [];
  const origin = input.originPrice !== null && input.originPrice > 0 ? input.originPrice : null;
  const pk = input.optionPackages;
  const pkTotal = pk === null ? null : pk.every((p) => p.price !== null) ? pk.reduce((s, p) => s + (p.price as number), 0) : null;
  const probe: Point = { x: [], grade, fuel: t.fuel, drive: t.drive, disp: t.displacement };
  const trimIdx = grade === '' ? [] : cands.map((_, j) => j).filter((j) => candPts[j].grade === grade && !ptMismatch(probe, candPts[j]) && candPts[j].x[6] !== null);
  let peerBase: number | null = null;
  if (trimIdx.length > 0) {
    const gap = Math.min(...trimIdx.map((j) => Math.abs(cands[j].year - input.year)));
    peerBase = median(trimIdx.filter((j) => Math.abs(cands[j].year - input.year) === gap).map((j) => cands[j].originPriceBase as number));
  }
  let base: number | null = null;
  let source: KnnResult['basePriceSource'] = null;
  let optPct: number | null = null;
  if (origin !== null && pkTotal !== null && origin - pkTotal > 0) {
    base = origin - pkTotal; source = 'input'; optPct = (pkTotal / base) * 100;
    if (peerBase !== null && Math.abs(Math.log(base / peerBase)) > 0.15) {
      warnings.push(`입력 신차가로 계산한 기본가 ${Math.round(base)}만원이 같은 트림 엔카 매물(${Math.round(peerBase)}만원)과 15% 넘게 다릅니다 — 트림 표기를 확인하세요`);
    }
  } else if (peerBase !== null) {
    base = peerBase; source = 'trim_peers'; optPct = origin !== null ? (Math.max(0, origin - base) / base) * 100 : null;
  } else if (origin !== null) {
    const opts = candPts.map((p) => p.x[7]).filter((v): v is number => v !== null);
    const meanOpt = opts.length > 0 ? opts.reduce((s, v) => s + v, 0) / opts.length : 0;
    base = origin / (1 + meanOpt / 100); source = 'origin_estimate';
    warnings.push('같은 트림 엔카 매물을 찾지 못해 입력 신차가로 기본가를 추정했습니다');
  } else {
    warnings.push('트림·신차가를 확인하지 못해 트림 차이를 거리에 넣지 못했습니다 — 예측구간이 넓습니다');
  }
  const x = [
    calcAgeMonths(input.year, input.month, now) / 12,
    input.mileage / 1e4,
    b01(input.hasRentalHistory),
    accident,
    b01(input.inspection?.hasReplacement),
    b01(input.inspection?.hasWelding),
    base === null ? null : 100 * Math.log(base),
    optPct,
  ];
  return { point: { x, grade, fuel: t.fuel, drive: t.drive, disp: t.displacement }, base, source, optPct, warnings };
}

export function knnVerdict(excess: number, criticalReasons: readonly string[]): CompareVerdict {
  if (excess <= -FAIR_BAND) return criticalReasons.length === 0 ? 'cheap' : 'fair';
  if (excess <= FAIR_BAND) return 'fair';
  if (excess < FAIR_BAND + EXPENSIVE_EXCESS) return 'slightly_expensive';
  return 'expensive';
}

/** 높음: 평균 거리 ≤12%p·유효 이웃 ≥10·입력 결측 특성 ≤1개 / 낮음: 기본가 미상·평균 거리 >18%p·유효 이웃 <5 / 나머지 보통 */
export function knnConfidence(meanDistance: number, effectiveCount: number, hasBase: boolean, missingFeatures: number): KnnConfidence {
  if (!hasBase || meanDistance > 18 || effectiveCount < 5) return 'low';
  if (meanDistance <= 12 && effectiveCount >= 10 && missingFeatures <= 1) return 'high';
  return 'medium';
}

export interface KnnContext { n: number; primary: boolean; basePremium: number; judgement: VerdictDetail; }

/** pool = 활성 엔카 매물 전체 (stale 제외 완료). 같은 모델 후보가 없으면 null */
export function computeKnn(input: CompareInput, pool: VehicleData[], now: Date, ctx: KnnContext): KnnResult | null {
  // 같은 차량번호 재등록(엔카 중복 게시)은 한 대만 — 매물번호가 가장 큰(최근) 것
  const latestByNo = new Map<string, string>();
  for (const v of pool) if (v.vehicleNo && (latestByNo.get(v.vehicleNo) ?? '') < v.carId) latestByNo.set(v.vehicleNo, v.carId);
  const eligible = pool.filter((v) => isEligiblePeer(v) && (!v.vehicleNo || latestByNo.get(v.vehicleNo) === v.carId));
  let cands: VehicleData[] = [];
  for (const l of MODEL_LEVELS) {
    cands = eligible.filter((v) => matchesModel(v, input, l));
    if (cands.length > 0) break;
  }
  if (cands.length === 0) return null;
  const pts = cands.map((v) => vehicleKnnPoint(v, now));
  const ip = inputKnnPoint(input, cands, pts, now);
  const inp = ip.point;
  const b = KNN_FEATURES.map((f) => KNN_COEF[f]);
  const D = KNN_FEATURES.length;
  const known = KNN_FEATURES.map((_, i) => i).filter((i) => inp.x[i] !== null);
  const candMean: number[] = [];
  let unknownVar = 0;
  for (let i = 0; i < D; i++) {
    const xs = pts.map((p) => p.x[i]).filter((v): v is number => v !== null);
    const m = xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
    candMean.push(m);
    if (inp.x[i] === null && xs.length > 1) unknownVar += b[i] ** 2 * (xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
  }
  const scored = cands.map((v, j) => {
    const p = pts[j];
    const contrib: KnnContribution[] = [];
    let d = 0;
    let adj = 0;
    for (const i of known) {
      const delta = (inp.x[i] as number) - (p.x[i] ?? candMean[i]);
      const c = Math.abs(b[i] * delta);
      d += c; adj += b[i] * delta;
      if (c > 0) contrib.push({ key: KNN_FEATURES[i], percent: c });
    }
    if (inp.grade !== '' && p.grade !== '' && inp.grade !== p.grade) { d += KNN_TRIM_PENALTY; contrib.push({ key: 'trim', percent: KNN_TRIM_PENALTY }); }
    if (ptMismatch(inp, p)) { d += KNN_POWERTRAIN_PENALTY; contrib.push({ key: 'powertrain', percent: KNN_POWERTRAIN_PENALTY }); }
    contrib.sort((x, y) => y.percent - x.percent);
    return { v, p, d, adj, contrib };
  }).sort((x, y) => x.d - y.d || (x.v.carId < y.v.carId ? -1 : x.v.carId > y.v.carId ? 1 : 0));
  const nb = scored.slice(0, Math.min(ctx.n, scored.length));
  const h = Math.max(1, KNN_BANDWIDTH * nb[nb.length - 1].d);
  const w = nb.map((s) => Math.exp(-0.5 * (s.d / h) ** 2));
  const W = w.reduce((s, x) => s + x, 0);
  const W2 = w.reduce((s, x) => s + x * x, 0);
  const ys = nb.map((s) => 100 * Math.log(s.v.price) + s.adj);
  const yhat = ys.reduce((s, y, k) => s + w[k] * y, 0) / W;
  const nEff = (W * W) / W2;
  const variance = (ys.reduce((s, y, k) => s + w[k] * (y - yhat) ** 2, 0) / W) * (nEff / Math.max(1, nEff - 1));
  const half = KNN_INTERVAL_MULT * 1.96 * Math.sqrt(variance * (1 + 1 / nEff) + unknownVar);
  const expected = Math.exp(yhat / 100);
  const diffPercent = (input.price / expected - 1) * 100;
  const meanDistance = nb.reduce((s, x, k) => s + w[k] * x.d, 0) / W;
  const excess = diffPercent - ctx.basePremium;
  const verdict = knnVerdict(excess, ctx.judgement.criticalReasons);
  const gap = diffPercent - ctx.judgement.adjustedDiffPercent;
  const usedTerms: KnnTermKey[] = known.map((i) => KNN_FEATURES[i]);
  const missingTerms: KnnTermKey[] = KNN_FEATURES.filter((_, i) => inp.x[i] === null);
  if (inp.grade !== '') usedTerms.push('trim'); else missingTerms.push('trim');
  const warnings = [...ip.warnings];
  if (cands.length < ctx.n) warnings.push(`같은 모델 엔카 매물이 ${cands.length}대뿐이라 이웃 ${cands.length}대로 계산했습니다`);
  const missingLabels = missingTerms.filter((k) => k !== 'basePrice' && k !== 'trim').map((k) => KNN_TERM_LABEL[k]);
  if (missingLabels.length > 0) warnings.push(`입력에 없는 정보(${missingLabels.join('·')})는 거리에서 빼고 예측구간에 불확실성으로 반영했습니다`);
  if (meanDistance > 18) warnings.push(`비슷한 매물이 적습니다 (이웃 평균 거리 ${meanDistance.toFixed(1)}%p)`);
  const neighbors: KnnNeighbor[] = nb.map((s, k) => ({
    carId: s.v.carId, modelName: s.v.modelName, gradeName: s.v.gradeName, gradeDetail: s.v.gradeDetail,
    year: s.v.year, month: s.v.month, mileage: s.v.mileage, price: s.v.price,
    hasRentalHistory: s.v.isInsurancePrivate ? null : s.v.hasRentalHistory,
    accidentAmount: s.v.isInsurancePrivate ? null : s.v.myDamageAmount,
    hasReplacement: s.p.x[4] === null ? null : s.p.x[4] === 1,
    hasWelding: s.p.x[5] === null ? null : s.p.x[5] === 1,
    originPriceBase: s.v.originPriceBase, originPriceOptions: s.v.originPriceOptions,
    distance: s.d, weight: w[k] / W, adjustmentPercent: s.adj, adjustedPrice: Math.exp(ys[k] / 100), contributions: s.contrib,
  }));
  return {
    k: nb.length, candidateCount: cands.length, neighbors,
    expectedPrice: expected, intervalLow: Math.exp((yhat - half) / 100), intervalHigh: Math.exp((yhat + half) / 100),
    diffPercent, meanDistance, effectiveCount: nEff, closeCount: nb.filter((s) => s.d <= KNN_CLOSE_DISTANCE).length,
    confidence: knnConfidence(meanDistance, nEff, ip.base !== null, KNN_FEATURES.filter((_, i) => inp.x[i] === null).length),
    usedTerms, missingTerms, inputBasePrice: ip.base, basePriceSource: ip.source, inputOptionPercent: ip.optPct,
    basePremium: ctx.basePremium, excessOverAllowance: excess, verdict,
    agreement: {
      currentPercent: ctx.judgement.adjustedDiffPercent, knnPercent: diffPercent, gap,
      sameVerdict: verdict === ctx.judgement.verdict, level: Math.abs(gap) < 3 ? 'agree' : Math.abs(gap) < 6 ? 'minor' : 'major',
    },
    primary: ctx.primary,
    warnings,
  };
}
