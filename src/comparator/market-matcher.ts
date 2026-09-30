import { findVehicles } from '../db/repository';
import { getCanonicalTrim, getPowertrainCluster } from '../crawler/detail-parsers';
import type { CompareInput, MarketMatch, MatchCriteria, ModelMatchLevel, VehicleData } from '../types';

/** 동급매물 선정 조건. 환경변수 COMPARE_MIN_SAMPLES / COMPARE_YEAR_RANGE / COMPARE_MILEAGE_RANGE 로 조정 */
export interface MatchConfig {
  minSamples: number;                        // 이 수 미만이면 조건을 완화하고 경고
  yearRange: number;                         // 최초등록 연식 ±N년
  mileageRatios: readonly number[] | null;   // 주행거리 ±비율 단계(오름차순, 예: [0.4, 0.6]). null = 주행거리 제한 없음
}
export const DEFAULT_MATCH_CONFIG: MatchConfig = { minSamples: 5, yearRange: 2, mileageRatios: [0.4, 0.6] };

function envInt(env: NodeJS.ProcessEnv, name: string, min: number, fallback: number): number {
  const raw = (env[name] ?? '').trim();
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name}는 ${min} 이상의 정수여야 합니다: ${raw}`);
  return n;
}

export function getMatchConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MatchConfig {
  const minSamples = envInt(env, 'COMPARE_MIN_SAMPLES', 1, DEFAULT_MATCH_CONFIG.minSamples);
  const yearRange = envInt(env, 'COMPARE_YEAR_RANGE', 0, DEFAULT_MATCH_CONFIG.yearRange);
  const raw = (env.COMPARE_MILEAGE_RANGE ?? '').trim();
  let mileageRatios: readonly number[] | null = DEFAULT_MATCH_CONFIG.mileageRatios;
  if (raw !== '') {
    if (/^(none|off|0)$/i.test(raw)) mileageRatios = null;
    else {
      const parts = raw.split(',').map((x) => x.trim());
      const pcts = parts.map(Number);
      if (pcts.some((p, i) => parts[i] === '' || !Number.isFinite(p) || p <= 0)) {
        throw new Error(`COMPARE_MILEAGE_RANGE는 % 값(예: 60 또는 40,60) 또는 none 이어야 합니다: ${raw}`);
      }
      mileageRatios = [...new Set(pcts)].sort((a, b) => a - b).map((p) => p / 100);
    }
  }
  return { minSamples, yearRange, mileageRatios };
}
const MODEL_LEVELS: readonly ModelMatchLevel[] = ['exact', 'base', 'tokens', 'loose'];
const GENERATION_WORDS: ReadonlySet<string> = new Set(['더', '뉴', '올', '디', 'the', 'new', 'all', '신형']);

export function normTokens(s: string | null | undefined): string[] {
  return (s ?? '').toLowerCase().replace(/[()（）[\]{},/·ㆍ_-]/g, ' ').split(/\s+/).filter((t) => t.length > 0);
}

export function compact(s: string | null | undefined): string {
  return normTokens(s).join('');
}

/** 괄호 속 세대/차대 코드("(MQ4)", "(G30)", "(DN8)", "(MQ4 PE)")를 분리. 코드는 괄호 안 첫 토큰(소문자) */
const MODEL_CODE_RE = /[(（]([^()（）]*)[)）]/g;
export function splitModelCodes(s: string | null | undefined): { base: string; codes: string[] } {
  const src = s ?? '';
  const codes: string[] = [];
  for (const m of src.matchAll(MODEL_CODE_RE)) {
    const first = normTokens(m[1])[0];
    if (first) codes.push(first);
  }
  return { base: src.replace(MODEL_CODE_RE, ' '), codes };
}

/** 한쪽이라도 코드가 없으면 호환, 둘 다 있으면 하나 이상 같아야 호환 (G30 vs G60 분리) */
function codesCompatible(a: readonly string[], b: readonly string[]): boolean {
  return a.length === 0 || b.length === 0 || a.some((c) => b.includes(c));
}

/** 렌트/리스 판매·중복매물·비정상 가격·연식 미상 제외 (렌트 "이력" 차량은 포함) */
export function isEligiblePeer(v: VehicleData): boolean {
  return v.price > 0 && v.price < 9999 && !v.isDuplication
    && v.sellType !== '렌트' && v.sellType !== '리스' && !v.leaseType && v.year > 0;
}

function brandTokens(...names: (string | null)[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const c = compact(n);
    if (c) out.add(c);
    for (const t of normTokens(n)) out.add(t);
  }
  return out;
}

export function matchesModel(v: VehicleData, input: CompareInput, level: ModelMatchLevel): boolean {
  const brands = brandTokens(input.manufacturer, v.manufacturer);
  if (level === 'exact') {
    const name = compact(v.modelName);
    return name.length > 0 && normTokens(input.model).filter((t) => !brands.has(t)).join('') === name;
  }
  // exact 이후 단계: 양쪽 괄호 코드를 떼고 비교하되, 둘 다 코드가 있으면 서로 같아야 함
  const inp = splitModelCodes(input.model);
  const veh = splitModelCodes(v.modelName);
  if (!codesCompatible(inp.codes, veh.codes)) return false;
  const inputTokens = normTokens(inp.base);
  if (level === 'base') {
    const name = compact(veh.base);
    return name.length > 0 && inputTokens.filter((t) => !brands.has(t)).join('') === name;
  }
  const hay = [v.manufacturer, v.modelGroup, v.modelName, v.gradeName, v.gradeDetail].map(compact).join(' ');
  const tokens = level === 'tokens'
    ? inputTokens
    : inputTokens.filter((t) => !GENERATION_WORDS.has(t) && !brands.has(t));
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}

/** 입력 트림에 같은 단어가 반복되면("... 캘리그래피 캘리그래피") 하나로 줄인다 */
function dedupeWords(s: string): string {
  const seen = new Set<string>();
  return s.split(/\s+/).filter((w) => w !== '' && !seen.has(w) && (seen.add(w), true)).join(' ');
}

type FuelClass = 'phev' | 'hybrid' | 'ev' | 'diesel' | 'lpg' | 'gasoline';

export function powertrainTraits(s: string): { fuel: FuelClass | null; drive: '2wd' | 'awd' | null; displacement: string | null } {
  const t = new Set(s.normalize('NFKC').toLowerCase().split(/[\s()/,·]+/).filter((x) => x.length > 0));
  const has = (...xs: string[]): boolean => xs.some((x) => t.has(x));
  const fuel: FuelClass | null = has('phev', '플러그인') ? 'phev' : has('hev', '하이브리드') ? 'hybrid' : has('ev', '전기') ? 'ev'
    : has('디젤') ? 'diesel' : has('lpi', 'lpg', 'lpe') ? 'lpg' : has('가솔린') ? 'gasoline' : null;
  const drive = has('4wd', 'awd', 'htrac', '4륜') ? 'awd' : has('2wd', 'fwd', 'rwd', '2륜') ? '2wd' : null;
  let displacement: string | null = null;
  for (const x of t) { const m = x.match(/^(\d\.\d)t?$/); if (m) { displacement = m[1]; break; } }
  return { fuel, drive, displacement };
}

export function powertrainCompatible(v: VehicleData, trim: string): boolean {
  const a = powertrainTraits(trim);
  const b = powertrainTraits(`${v.gradeName ?? ''} ${v.gradeDetail ?? ''}`);
  return (a.fuel === null || b.fuel === null || a.fuel === b.fuel)
    && (a.drive === null || b.drive === null || a.drive === b.drive)
    && (a.displacement === null || b.displacement === null || a.displacement === b.displacement);
}

export function trimMatches(v: VehicleData, trim: string): boolean {
  const targetCluster = getPowertrainCluster(trim, '');
  if (targetCluster) return getPowertrainCluster(v.gradeName, v.gradeDetail) === targetCluster;
  const t = compact(getCanonicalTrim(dedupeWords(trim), ''));
  const c = compact(getCanonicalTrim(v.gradeName, v.gradeDetail));
  return t.length > 0 && t === c && powertrainCompatible(v, trim);
}

/** 입력 트림 == 엔카 grade_name + grade_detail (공백 무시, 입력의 반복 단어 제거) */
export function trimMatchesExact(v: VehicleData, trim: string): boolean {
  const t = compact(dedupeWords(trim));
  const c = compact([v.gradeName, v.gradeDetail].filter((x): x is string => !!x).join(' '));
  return t.length > 0 && t === c;
}

function filterByMileage(pool: VehicleData[], mileage: number, ratio: number): VehicleData[] {
  const lo = Math.max(0, mileage * (1 - ratio));
  const hi = mileage * (1 + ratio);
  return pool.filter((v) => v.mileage >= lo && v.mileage <= hi);
}

export function matchPeers(input: CompareInput, candidates: VehicleData[], config: MatchConfig = getMatchConfigFromEnv()): MarketMatch {
  const yearFrom = input.year - config.yearRange;
  const yearTo = input.year + config.yearRange;
  const yearPool = candidates.filter((v) => isEligiblePeer(v) && v.year >= yearFrom && v.year <= yearTo);

  let level: ModelMatchLevel | null = null;
  let modelPool: VehicleData[] = [];
  for (const l of MODEL_LEVELS) {
    const p = yearPool.filter((v) => matchesModel(v, input, l));
    if (p.length > 0) { level = l; modelPool = p; break; }
  }

  const trim = input.trim;
  // 1단계: 등급명+세부등급 전체가 같은 매물(연료·엔진·구동 포함). 하나라도 있으면 이 단계 결과만 사용
  // 2단계: 1단계가 0대일 때만 느슨한 매칭(세부등급 이름/파워트레인 클러스터)
  const exactPool = trim ? modelPool.filter((v) => trimMatchesExact(v, trim)) : [];
  const trimPool = trim ? (exactPool.length > 0 ? exactPool : modelPool.filter((v) => trimMatches(v, trim))) : [];
  const trimApplied = trimPool.length > 0
    && (trimPool.length >= config.minSamples || trimPool.length === modelPool.length);
  const basePool = trimApplied ? trimPool : modelPool;

  let peers = basePool;
  let mileageRatio: number | null = null;
  if (input.mileage > 0 && config.mileageRatios !== null) {
    for (const r of config.mileageRatios) {
      const p = filterByMileage(basePool, input.mileage, r);
      if (p.length >= config.minSamples) { peers = p; mileageRatio = r; break; }
    }
  }

  const criteria: MatchCriteria = {
    modelMatchLevel: level,
    trim,
    trimApplied,
    trimSampleCount: trimPool.length,
    yearFrom,
    yearTo,
    yearRange: config.yearRange,
    minSamples: config.minSamples,
    mileageRatio,
    basePoolCount: basePool.length,
  };
  return { criteria, basePool, peers };
}

export function findMarketPeers(input: CompareInput, config: MatchConfig = getMatchConfigFromEnv()): MarketMatch {
  return matchPeers(input, findVehicles(), config);
}
