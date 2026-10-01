// 비교 입력 폼 상태 ↔ 요청 본문 (순수 함수)
import type { CompareRequestBody, CompareSettingsInfo, CompareSettingsOverride } from '../../../src/server/api-types';
import type { ComparePlatform } from '../../../src/types';

export interface CompareFormState {
  mode: 'url' | 'manual';
  url: string;
  platform: ComparePlatform | '';
  model: string; trim: string; year: string; month: string; mileage: string; price: string;
  accidentCount: string; accidentAmount: string; ownerChanges: string; rental: '' | 'yes' | 'no'; inspection: string;
  useCustomSettings: boolean;
  yearRange: string; mileagePercents: string; minSamples: string; specMaxAdjust: string; knnN: string;
}

export const EMPTY_FORM: CompareFormState = {
  mode: 'url', url: '', platform: '', model: '', trim: '', year: '', month: '', mileage: '', price: '',
  accidentCount: '', accidentAmount: '', ownerChanges: '', rental: '', inspection: '',
  useCustomSettings: false, yearRange: '', mileagePercents: '', minSamples: '', specMaxAdjust: '', knnN: '',
};

export const FORM_STORAGE_KEY = 'used-car:compare-form:v1';

export function settingsToForm(s: CompareSettingsInfo): Pick<CompareFormState, 'yearRange' | 'mileagePercents' | 'minSamples' | 'specMaxAdjust'> & Partial<Pick<CompareFormState, 'knnN'>> {
  return {
    yearRange: String(s.yearRange),
    mileagePercents: s.mileagePercents === null ? '없음' : s.mileagePercents.join(','),
    minSamples: String(s.minSamples),
    specMaxAdjust: String(s.specMaxAdjust),
    ...(Number.isInteger(s.knnN) ? { knnN: String(s.knnN) } : {}), // 필드 없는 응답이면 키 생략 (기존 4필드 결과 불변)
  };
}

function num(label: string, raw: string, errors: string[]): number | undefined {
  const t = raw.trim().replace(/,/g, '');
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) { errors.push(`${label}: 숫자를 입력하세요`); return undefined; }
  return n;
}

/** 폼 → 요청 본문. 입력 오류가 있으면 errors 에 사람이 읽을 문장으로 */
export function formToRequest(f: CompareFormState): { body: CompareRequestBody | null; errors: string[] } {
  const errors: string[] = [];
  const body: CompareRequestBody = {};
  if (f.mode === 'url') {
    const u = f.url.trim();
    if (u === '') errors.push('URL을 입력하세요');
    else if (!/^https?:\/\//i.test(u)) errors.push('URL은 https:// 로 시작해야 합니다');
    else body.url = u;
  } else {
    if (f.platform === '') errors.push('플랫폼을 선택하세요');
    else body.platform = f.platform;
    if (f.model.trim() === '') errors.push('모델을 입력하세요');
    if (f.year.trim() === '') errors.push('연식을 입력하세요');
    if (f.mileage.trim() === '') errors.push('주행거리를 입력하세요');
    if (f.price.trim() === '') errors.push('가격을 입력하세요');
  }
  if (f.model.trim() !== '') body.model = f.model.trim();
  if (f.trim.trim() !== '') body.trim = f.trim.trim();
  const numeric: [keyof CompareRequestBody, string, string][] = [
    ['year', '연식', f.year], ['month', '월', f.month], ['mileage', '주행거리', f.mileage], ['price', '가격', f.price],
    ['accidentCount', '사고 건수', f.accidentCount], ['accidentAmount', '사고 보험금', f.accidentAmount], ['ownerChanges', '소유주 변경', f.ownerChanges],
  ];
  for (const [key, label, raw] of numeric) {
    const n = num(label, raw, errors);
    if (n !== undefined) (body as Record<string, unknown>)[key] = n;
  }
  if (f.rental !== '') body.rental = f.rental === 'yes';
  if (f.inspection.trim() !== '') body.inspection = f.inspection.trim();
  if (f.useCustomSettings) {
    const s: CompareSettingsOverride = {};
    const yr = num('연식 범위', f.yearRange, errors); if (yr !== undefined) s.yearRange = yr;
    const ms = num('최소 표본', f.minSamples, errors); if (ms !== undefined) s.minSamples = ms;
    const sp = num('사양 보정 상한', f.specMaxAdjust, errors); if (sp !== undefined) s.specMaxAdjust = sp;
    const kn = num('유사 매물 수', f.knnN, errors); if (kn !== undefined) s.knnN = kn;
    const mp = f.mileagePercents.trim();
    if (/^(없음|제한\s*없음|none|off)$/i.test(mp)) s.mileagePercents = null;
    else if (mp !== '') {
      const parts = mp.split(',').map((x) => Number(x.trim()));
      if (parts.some((p) => !Number.isFinite(p) || p <= 0)) errors.push('주행거리 범위: 40,60 처럼 % 숫자를 쉼표로 구분하거나 "없음"');
      else s.mileagePercents = parts;
    }
    body.settings = s;
  }
  return { body: errors.length > 0 ? null : body, errors };
}

export function loadForm(): CompareFormState {
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY);
    if (!raw) return EMPTY_FORM;
    const parsed = JSON.parse(raw) as Partial<CompareFormState>;
    return { ...EMPTY_FORM, ...parsed };
  } catch {
    return EMPTY_FORM;
  }
}
export function saveForm(f: CompareFormState): void {
  try { localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(f)); } catch { /* 무시 */ }
}
