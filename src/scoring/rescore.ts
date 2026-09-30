import { getDb } from '../db/connection';
import { findVehicles, getAccidentsByCarId, getYearlyPricesByCarId, getLocalPriceBaseline, updateVehicleScore } from '../db/repository';
import { hasValidDetail } from '../crawler/detail-parsers';
import { buildScoreInput, calculateScore, DEFAULT_WEIGHTS } from './calculator';
import type { AccidentRecord, LocalPriceBaseline, ScoreResult, ScoreWeights, VehicleData, YearlyPrice } from '../types';

export function localBaselineFor(v: VehicleData): LocalPriceBaseline | null {
  return getLocalPriceBaseline({
    carId: v.carId, modelGroup: v.modelGroup, modelName: v.modelName, gradeName: v.gradeName,
    gradeDetail: hasValidDetail(v.gradeDetail) ? v.gradeDetail : null,
    powertrainCluster: v.powertrainCluster, year: v.year,
  });
}

/** 수집 직후 1대 채점 (collect에서 upsert 전후 호출; 결과는 잠정치 — 수집 종료 후 rescoreAll 필수) */
export function scoreVehicle(
  vehicle: VehicleData, accidents: AccidentRecord[], yearlyPrices: YearlyPrice[],
  weights: ScoreWeights = DEFAULT_WEIGHTS, now: Date = new Date(),
): ScoreResult {
  return calculateScore(buildScoreInput(vehicle, accidents, yearlyPrices, localBaselineFor(vehicle)), weights, now);
}

export interface RescoreSummary { total: number; changed: number; }

/** DB 전체 vehicles 재채점. 1) 전량 계산(읽기) → 2) 단일 트랜잭션으로 갱신(쓰기).
 *  기준가는 price·모델 필드에만 의존하고 score에는 의존하지 않으므로 처리 순서와 무관한 결정적 결과. */
export function rescoreAll(weights: ScoreWeights = DEFAULT_WEIGHTS, now: Date = new Date()): RescoreSummary {
  const vehicles = findVehicles();
  const updates: { carId: string; score: ScoreResult; changed: boolean }[] = vehicles.map((v) => {
    const score = scoreVehicle(v, getAccidentsByCarId(v.carId), getYearlyPricesByCarId(v.carId), weights, now);
    const changed = v.scoreTotal !== score.total || v.scoreGrade !== score.grade || v.scorePenalty !== score.penalty
      || JSON.stringify(v.scoreBreakdown) !== JSON.stringify(score.breakdown);
    return { carId: v.carId, score, changed };
  });
  getDb().transaction(() => { for (const u of updates) updateVehicleScore(u.carId, u.score); })();
  return { total: updates.length, changed: updates.filter((u) => u.changed).length };
}

if (require.main === module) {
  const r = rescoreAll();
  console.log(`재채점 완료: ${r.total}대 중 ${r.changed}대 점수 변경`);
}
