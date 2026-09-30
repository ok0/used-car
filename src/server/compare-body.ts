import type { CompareCliOptions } from '../services/compare';
import type { ComparePlatform, CompareSettingsOverride } from '../types';

/** 요청 본문 형식 오류 (400 INVALID_INPUT) */
export class BodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyError';
  }
}

/** CLI 옵션 이름 → 화면 라벨. 서비스 오류 메시지의 "--price" 등을 바꾸는 데 사용 */
export const CLI_FLAG_LABEL: Record<string, string> = {
  url: 'URL', platform: '플랫폼', model: '모델', trim: '트림', year: '연식', month: '월', mileage: '주행거리', price: '가격',
  'accident-count': '사고 건수', 'accident-amount': '사고 보험금', 'owner-changes': '소유주 변경', rental: '렌트 이력', 'no-rental': '렌트 이력',
  inspection: '성능점검',
};
export function replaceCliFlags(message: string): string {
  return message.replace(/--([a-z]+(?:-[a-z]+)*)/g, (m: string, k: string) => CLI_FLAG_LABEL[k] ?? m);
}

const PLATFORMS: readonly ComparePlatform[] = ['heydealer', 'kcar', 'hyundai_certified'];

function optString(o: Record<string, unknown>, key: string, label: string, max: number): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new BodyError(`${label}은(는) 문자열이어야 합니다`);
  const t = v.trim();
  if (t === '') return undefined;
  if (t.length > max) throw new BodyError(`${label}이(가) 너무 깁니다 (최대 ${max}자)`);
  return t;
}
function optNumber(o: Record<string, unknown>, key: string, label: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BodyError(`${label}은(는) 숫자여야 합니다`);
  return v;
}

/** POST /api/compare 본문 → 서비스 입력. 빈 문자열·null은 "지정 안 함" */
export function parseCompareBody(body: unknown): { opts: CompareCliOptions; override: CompareSettingsOverride } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BodyError('요청 본문은 JSON 객체여야 합니다');
  const o = body as Record<string, unknown>;
  const platformRaw = optString(o, 'platform', '플랫폼', 40);
  if (platformRaw !== undefined && !(PLATFORMS as readonly string[]).includes(platformRaw)) throw new BodyError(`지원하지 않는 플랫폼입니다: ${platformRaw}`);
  if (o.rental !== undefined && o.rental !== null && typeof o.rental !== 'boolean') throw new BodyError('렌트 이력은 true/false 여야 합니다');
  const opts: CompareCliOptions = {
    url: optString(o, 'url', 'URL', 2000),
    platform: platformRaw as ComparePlatform | undefined,
    model: optString(o, 'model', '모델', 100),
    trim: optString(o, 'trim', '트림', 200),
    year: optNumber(o, 'year', '연식'),
    month: optNumber(o, 'month', '월'),
    mileage: optNumber(o, 'mileage', '주행거리'),
    price: optNumber(o, 'price', '가격'),
    accidentCount: optNumber(o, 'accidentCount', '사고 건수'),
    accidentAmount: optNumber(o, 'accidentAmount', '사고 보험금'),
    ownerChanges: optNumber(o, 'ownerChanges', '소유주 변경'),
    rental: typeof o.rental === 'boolean' ? o.rental : undefined,
    inspection: optString(o, 'inspection', '성능점검', 200),
  };
  for (const k of Object.keys(opts) as (keyof CompareCliOptions)[]) if (opts[k] === undefined) delete opts[k];
  const s = o.settings;
  const override: CompareSettingsOverride = {};
  if (s !== undefined && s !== null) {
    if (typeof s !== 'object' || Array.isArray(s)) throw new BodyError('settings는 객체여야 합니다');
    const so = s as Record<string, unknown>;
    const yr = optNumber(so, 'yearRange', '연식 범위'); if (yr !== undefined) override.yearRange = yr;
    const ms = optNumber(so, 'minSamples', '최소 표본'); if (ms !== undefined) override.minSamples = ms;
    const sp = optNumber(so, 'specMaxAdjust', '사양 보정 상한'); if (sp !== undefined) override.specMaxAdjust = sp;
    if (so.mileagePercents === null) override.mileagePercents = null;
    else if (so.mileagePercents !== undefined) {
      if (!Array.isArray(so.mileagePercents) || so.mileagePercents.some((x) => typeof x !== 'number')) throw new BodyError('주행거리 범위는 숫자 배열이어야 합니다');
      override.mileagePercents = so.mileagePercents as number[];
    }
  }
  return { opts, override };
}
