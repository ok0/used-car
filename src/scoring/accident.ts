import type { AccidentRecord } from '../types';
export interface AccidentInput {
  isInsurancePrivate: boolean; originPrice: number; accidentAmounts: number[];
  hasUnavailablePeriod: boolean; unavailablePeriods: string[];
}
export function calcUnavailableMonths(periods: string[]): number {
  let total = 0;
  for (const p of periods) {
    const m = p.match(/(\d{6})~(\d{6})/);
    if (!m) continue;
    const sy = parseInt(m[1].slice(0, 4)), sm = parseInt(m[1].slice(4, 6));
    const ey = parseInt(m[2].slice(0, 4)), em = parseInt(m[2].slice(4, 6));
    total += (ey - sy) * 12 + (em - sm) + 1;
  }
  return total;
}
/** 건당 유효금액(원) = max(보험지급금, 부품+공임+도장), 0 이하 제외 */
export function toAccidentAmounts(accidents: AccidentRecord[]): number[] {
  return accidents
    .map((a) => {
      const repair = (a.partCost ?? 0) + (a.laborCost ?? 0) + (a.paintingCost ?? 0);
      return Math.max(a.insuranceBenefit ?? 0, repair);
    })
    .filter((x) => x > 0);
}
export function scoreAccident(input: AccidentInput, maxPoints: number): number {
  const isInsurancePrivate = input.isInsurancePrivate ?? false;
  const originPrice = input.originPrice ?? 0;
  const accidentAmounts = input.accidentAmounts ?? [];
  const hasUnavailablePeriod = input.hasUnavailablePeriod ?? false;
  const unavailablePeriods = input.unavailablePeriods ?? [];
  if (isInsurancePrivate) return 0;
  let baseScore: number;
  if (accidentAmounts.length === 0) {
    baseScore = maxPoints;
  } else if (originPrice > 0) {
    const originWon = originPrice * 10000;
    const maxSingleRatio = Math.max(...accidentAmounts) / originWon;
    if (maxSingleRatio <= 0.08) baseScore = maxPoints * 0.75;
    else if (maxSingleRatio <= 0.15) baseScore = maxPoints * 0.45;
    else baseScore = maxPoints * 0.1;
  } else {
    const maxSingle = Math.max(...accidentAmounts);
    if (maxSingle < 500000) baseScore = maxPoints * 0.85;
    else if (maxSingle < 2000000) baseScore = maxPoints * 0.6;
    else if (maxSingle < 5000000) baseScore = maxPoints * 0.35;
    else baseScore = maxPoints * 0.1;
  }
  if (accidentAmounts.length >= 4) baseScore = Math.max(0, baseScore - 5);
  else if (accidentAmounts.length >= 2) baseScore = Math.max(0, baseScore - 2);
  if (hasUnavailablePeriod) {
    const months = calcUnavailableMonths(unavailablePeriods);
    const penalty = months <= 1 ? 0 : months <= 6 ? 10 : 20;
    baseScore = Math.max(0, baseScore - penalty);
  }
  return baseScore;
}
