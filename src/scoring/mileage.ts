export interface MileageInput { mileage: number; year: number; month: number; }
export function scoreMileage(input: MileageInput, maxPoints: number, now: Date = new Date()): number {
  const mileage = input.mileage ?? 0, year = input.year ?? 0, month = input.month ?? 0;
  if (!year || !mileage) return maxPoints * 0.5;
  const nowYear = now.getFullYear(), nowMonth = now.getMonth() + 1;
  const ageMonths = (month > 0)
    ? Math.max(1, (nowYear - (2000 + year)) * 12 + (nowMonth - month))
    : Math.max(12, (nowYear - (2000 + year)) * 12);
  const avgAnnualKm = mileage / ageMonths * 12;
  let deduction = 0;
  if (mileage >= 150000) {
    deduction += Math.floor((Math.min(mileage, 200000) - 150000) / 10000);
    if (mileage >= 200000) deduction += Math.floor((mileage - 200000) / 10000) * 2;
  }
  if (avgAnnualKm <= 5000) deduction += Math.floor((5000 - avgAnnualKm) / 1000) * 2;
  return Math.max(0, maxPoints - deduction);
}
