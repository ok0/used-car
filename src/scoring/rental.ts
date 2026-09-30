export interface RentalInput { hasRentalHistory: boolean; hasUsageChange: boolean; }
export function scoreRental(input: RentalInput, maxPoints: number): number {
  if (input.hasRentalHistory) return 0;
  if (input.hasUsageChange) return maxPoints * 0.3;
  return maxPoints;
}
