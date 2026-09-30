import type { AccidentRecord, LocalPriceBaseline, ScoreBreakdown, ScoreResult, ScoreWeights, VehicleData, YearlyPrice } from '../types';
import { scoreAccident, toAccidentAmounts, type AccidentInput } from './accident';
import { scoreMileage, type MileageInput } from './mileage';
import { scorePrice, type PriceInput } from './price';
import { scoreInspection, type InspectionInput } from './inspection';
import { scoreRental, type RentalInput } from './rental';
import { scoreOwnerHistory, type OwnerInput } from './owner';
import { getGrade } from './grade';

export const DEFAULT_WEIGHTS: Readonly<ScoreWeights> = Object.freeze({
  accident: 15, mileage: 10, price: 25, inspection: 15, rental: 20, ownerChanges: 15,
});
export const PRIVATE_PENALTY = 40;
export type ScoreInput = AccidentInput & MileageInput & PriceInput & InspectionInput & RentalInput & OwnerInput;

export function buildScoreInput(
  v: VehicleData, accidents: AccidentRecord[], yearlyPrices: YearlyPrice[], localBaseline: LocalPriceBaseline | null,
): ScoreInput {
  return {
    isInsurancePrivate: v.isInsurancePrivate,
    originPrice: v.originPrice ?? 0,
    accidentAmounts: toAccidentAmounts(accidents),
    hasUnavailablePeriod: v.hasUnavailablePeriod,
    unavailablePeriods: v.unavailablePeriods ?? [],
    mileage: v.mileage ?? 0,
    year: v.year ?? 0,
    month: v.month ?? 0,
    price: v.price ?? 0,
    yearlyPoints: yearlyPrices.length > 0 ? yearlyPrices : null,
    localBaseline,
    isInspectionPrivate: v.isInspectionPrivate,
    hasInspection: v.hasInspection,
    hasReplacement: v.hasReplacement,
    hasWelding: v.hasWelding,
    hasCorrosion: v.hasCorrosion,
    hasDiagnosis: v.hasDiagnosis,
    diagFrameReplacement: v.diagFrameReplacement,
    diagPanelReplacement: v.diagPanelReplacement,
    rankCounts: v.rankCounts ?? null,
    diagnosisTier: v.diagnosisTier ?? null,
    hasRentalHistory: v.hasRentalHistory,
    hasUsageChange: v.hasUsageChange,
    ownerChangeCount: v.ownerChangeCount ?? 0,
  };
}

export function calculateScore(input: ScoreInput, weights: ScoreWeights = DEFAULT_WEIGHTS, now: Date = new Date()): ScoreResult {
  const breakdown: ScoreBreakdown = {
    accident:     scoreAccident(input, weights.accident),
    mileage:      scoreMileage(input, weights.mileage, now),
    price:        scorePrice(input, weights.price, now),
    inspection:   scoreInspection(input, weights.inspection),
    rental:       scoreRental(input, weights.rental),
    ownerChanges: scoreOwnerHistory(input, weights.ownerChanges ?? 0),
  };
  let totalScore = Math.round(
    breakdown.accident + breakdown.mileage + breakdown.price +
    breakdown.inspection + breakdown.rental + breakdown.ownerChanges
  );
  let penalty = 0;
  if (input.isInsurancePrivate || input.isInspectionPrivate) {
    penalty = PRIVATE_PENALTY;
    totalScore -= penalty;
  }
  return {
    total: Math.min(100, Math.max(0, totalScore)),
    grade: getGrade(totalScore),
    breakdown,
    penalty,
  };
}
