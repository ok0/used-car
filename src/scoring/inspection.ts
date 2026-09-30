import type { DiagnosisTier, RankCounts } from '../types';
export interface InspectionInput {
  isInspectionPrivate: boolean; hasInspection: boolean; hasReplacement: boolean; hasWelding: boolean;
  hasCorrosion: boolean; hasDiagnosis: boolean; diagFrameReplacement: boolean; diagPanelReplacement: boolean;
  rankCounts: RankCounts | null; diagnosisTier: DiagnosisTier | null;
}
export function scoreInspection(input: InspectionInput, maxPoints: number): number {
  if (input.isInspectionPrivate) return 0;
  let score = maxPoints;
  const { hasInspection, hasReplacement, hasWelding, hasCorrosion,
          hasDiagnosis, diagFrameReplacement, diagPanelReplacement, rankCounts } = input;
  if (!hasDiagnosis) score -= 5;
  if (hasDiagnosis) {
    if (diagFrameReplacement) score -= 12;
    if (diagPanelReplacement) score -= 3;
    if (input.diagnosisTier === 'PLUSPLUS') score += 4;
    return Math.max(0, score);
  }
  if (!hasInspection) return Math.max(0, maxPoints * 0.5 - 5);
  if (rankCounts) {
    score -= rankCounts.B.X * 15;
    score -= rankCounts.B.W * 12;
    score -= rankCounts.A.X * 10;
    score -= rankCounts.A.W * 8;
    score -= rankCounts.TWO.X * 4;
    score -= rankCounts.TWO.W * 3;
    score -= rankCounts.ONE.X * 1;
    score -= rankCounts.ONE.W * 2;
    const totalCorrosion = rankCounts.ONE.C + rankCounts.TWO.C + rankCounts.A.C + rankCounts.B.C;
    score -= totalCorrosion * 2;
  } else {
    if (hasWelding) score -= 10;
    if (hasCorrosion) score -= 5;
    if (hasReplacement) score -= 2;
  }
  return Math.max(0, score);
}
