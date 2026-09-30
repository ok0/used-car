import { type VehicleSortField } from '../types';
import { findVehicles } from '../db/repository';
import { summaryCommand } from './summary';
import { fmtManwon, fmtKm, fmtYearMonth, fmtPoints, truncateDisplay, padDisplay, displayWidth } from './format';

export interface ListOptions { model?: string; minScore?: number; sort: VehicleSortField; limit: number; }

const SORT_LABEL: Record<VehicleSortField, string> = {
  price: '가격 낮은순',
  score: '점수 높은순',
  mileage: '주행거리 짧은순',
  year: '연식 최신순',
};

export function listCommand(opts: ListOptions): number {
  const all = findVehicles({ model: opts.model, minScore: opts.minScore, sort: opts.sort });
  const shown = all.slice(0, opts.limit);

  if (all.length === 0) {
    if (opts.model === undefined && opts.minScore === undefined) {
      return summaryCommand();
    }
    console.log('조건에 맞는 매물이 없습니다.');
    return 0;
  }

  const conds: string[] = [];
  if (opts.model !== undefined) conds.push(`모델 "${opts.model}"`);
  if (opts.minScore !== undefined) conds.push(`최소 점수 ${opts.minScore}`);
  conds.push(`정렬 ${SORT_LABEL[opts.sort]}`);
  console.log(`🔎 조건: ${conds.join(' | ')}`);
  console.log();

  const headers = ['#', '매물ID', '모델', '연식', '주행거리', '가격', '등급', '점수'];
  const aligns: ('left' | 'right')[] = ['right', 'left', 'left', 'left', 'right', 'right', 'left', 'right'];

  const rows: string[][] = shown.map((v, i) => [
    String(i + 1),
    v.carId,
    truncateDisplay([v.modelName, v.gradeName].filter(Boolean).join(' ') || '(모델 미상)', 34),
    fmtYearMonth(v.year, v.month),
    fmtKm(v.mileage),
    fmtManwon(v.price),
    v.scoreGrade ?? '-',
    v.scoreTotal == null ? '-' : fmtPoints(v.scoreTotal),
  ]);

  const widths: number[] = [];
  for (let c = 0; c < headers.length; c++) {
    widths[c] = displayWidth(headers[c]);
  }
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      widths[c] = Math.max(widths[c], displayWidth(row[c]));
    }
  }

  console.log(headers.map((h, c) => padDisplay(h, widths[c], aligns[c])).join(' | '));
  console.log(widths.map((w) => '-'.repeat(w)).join('-+-'));

  for (const row of rows) {
    console.log(row.map((s, c) => padDisplay(s, widths[c], aligns[c])).join(' | '));
  }

  console.log();
  let summary = `표시 ${shown.length}대 / 조건 일치 ${all.length}대`;
  if (all.length > shown.length) {
    summary += ' (더 보려면 --limit 조정)';
  }
  console.log(summary);

  return 0;
}
