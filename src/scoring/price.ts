import type { LocalPriceBaseline, YearlyPrice } from '../types';
export type YearlyPricePoint = Pick<YearlyPrice, 'age' | 'year' | 'avgPrice' | 'count'>;
export interface PriceInput {
  price: number;                         // 만원
  year: number;                          // 2자리 연식
  yearlyPoints: YearlyPricePoint[] | null;
  localBaseline: LocalPriceBaseline | null;
}
export const MIN_LOCAL_PRICE_SAMPLES = 3;
export type PriceBaselineSource = 'yearly' | 'local' | 'none';
export interface PriceBaseline { source: PriceBaselineSource; avgPrice: number | null; sampleCount: number | null; }

export function ratioToScore(priceRatio: number, maxPoints: number): number {
  if (priceRatio <= 0.85) return maxPoints;
  if (priceRatio <= 0.95) return maxPoints * 0.9;
  if (priceRatio <= 1.00) return maxPoints * 0.8;
  if (priceRatio <= 1.05) return maxPoints * 0.7;
  if (priceRatio <= 1.10) return maxPoints * 0.6;
  if (priceRatio <= 1.15) return maxPoints * 0.5;
  if (priceRatio <= 1.25) return maxPoints * 0.35;
  if (priceRatio <= 1.35) return maxPoints * 0.2;
  return maxPoints * 0.1;
}
export function toFullYear(year: number): number {
  if (!Number.isFinite(year)) return 0;
  const parsed = Math.trunc(year);
  if (parsed <= 0) return 0;
  return parsed < 100 ? 2000 + parsed : parsed;
}
export function getYearlyPricePoint(year: number, points: YearlyPricePoint[] | null, now: Date = new Date()): YearlyPricePoint | null {
  const fullYear = toFullYear(year);
  if (!fullYear || !Array.isArray(points)) return null;
  const carAge = Math.max(0, now.getFullYear() - fullYear);
  const point = points.find((p) => Number(p.year) === fullYear)
    || points.find((p) => Number(p.age) === carAge);
  if (!point || !Number.isFinite(point.avgPrice) || point.avgPrice <= 0) return null;
  return point;
}
export function resolvePriceBaseline(input: PriceInput, now: Date = new Date()): PriceBaseline {
  const yp = getYearlyPricePoint(input.year, input.yearlyPoints, now);
  if (yp) return { source: 'yearly', avgPrice: yp.avgPrice, sampleCount: yp.count };
  const lb = input.localBaseline;
  // 연식 미상이면 동일 연식 기준가 자체가 성립하지 않음 (참조: getFullYear(year)=0 → 데이터 없음)
  if (toFullYear(input.year) > 0 && lb && lb.sampleCount >= MIN_LOCAL_PRICE_SAMPLES && Number.isFinite(lb.avgPrice) && lb.avgPrice > 0) {
    return { source: 'local', avgPrice: lb.avgPrice, sampleCount: lb.sampleCount };
  }
  return { source: 'none', avgPrice: null, sampleCount: null };
}
export function scorePrice(input: PriceInput, maxPoints: number, now: Date = new Date()): number {
  const price = input.price ?? 0;
  if (!price) return maxPoints * 0.5;
  const b = resolvePriceBaseline(input, now);
  if (b.avgPrice !== null) return ratioToScore(price / b.avgPrice, maxPoints);
  return maxPoints * 0.5;
}
