import type { VehicleListItem } from '../../../src/server/api-types';

/** 목록 범위 필터 입력값(문자열, URL 쿼리와 1:1). 빈 문자열 = 제한 없음 */
export interface RangeInputs {
  yearMin: string; yearMax: string;
  kmMin: string; kmMax: string;
  priceMin: string; priceMax: string;
}
export const RANGE_KEYS = ['yearMin', 'yearMax', 'kmMin', 'kmMax', 'priceMin', 'priceMax'] as const;
export const EMPTY_RANGES: RangeInputs = { yearMin: '', yearMax: '', kmMin: '', kmMax: '', priceMin: '', priceMax: '' };

/** 숫자 입력 파싱. 비었거나 숫자가 아니면 null (무시) */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 연식 입력은 2자리(22)와 4자리(2022) 모두 허용 → 2자리로 통일. 1900 미만 4자리 등 비정상은 null */
export function normalizeYear(s: string): number | null {
  const n = parseNum(s);
  if (n === null || !Number.isInteger(n) || n < 0) return null;
  return n >= 100 ? (n >= 2000 ? n - 2000 : null) : n;
}

export function hasRangeFilter(r: RangeInputs): boolean {
  return RANGE_KEYS.some((k) => r[k].trim() !== '');
}

/** 연식(최초등록 연도, 2자리)·주행거리(km)·가격(만원) 범위 필터. min/max는 양끝 포함, min > max이면 결과 없음 */
export function applyRangeFilters(items: readonly VehicleListItem[], r: RangeInputs): VehicleListItem[] {
  const yMin = normalizeYear(r.yearMin), yMax = normalizeYear(r.yearMax);
  const kMin = parseNum(r.kmMin), kMax = parseNum(r.kmMax);
  const pMin = parseNum(r.priceMin), pMax = parseNum(r.priceMax);
  return items.filter((v) =>
    (yMin === null || v.year >= yMin) && (yMax === null || v.year <= yMax)
    && (kMin === null || v.mileage >= kMin) && (kMax === null || v.mileage <= kMax)
    && (pMin === null || v.price >= pMin) && (pMax === null || v.price <= pMax));
}
