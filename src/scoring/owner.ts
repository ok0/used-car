export interface OwnerInput { ownerChangeCount: number; }
export function scoreOwnerHistory(input: OwnerInput, maxPoints: number): number {
  const ownerChangeCount = input.ownerChangeCount ?? 0;
  if (ownerChangeCount === 0) return maxPoints;
  let deductionRatio = 0;
  if (ownerChangeCount === 1) deductionRatio = 0.20;
  else if (ownerChangeCount === 2) deductionRatio = 0.47;
  else if (ownerChangeCount === 3) deductionRatio = 0.67;
  else if (ownerChangeCount >= 4) deductionRatio = 1.0;
  return Math.max(0, maxPoints * (1 - deductionRatio));
}
