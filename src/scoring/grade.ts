import type { Grade } from '../types';
export function getGrade(score: number): Grade {
  if (score >= 95) return 'S';
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score > 40)  return 'D';
  return 'F';
}
