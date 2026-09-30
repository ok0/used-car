import { GRADES, type Grade, type VehicleData } from '../types';

export function fmtNum(n: number): string { return Math.round(n).toLocaleString('en-US'); }
export function fmtManwon(n: number | null | undefined): string { return n == null ? '-' : `${fmtNum(n)}만원`; }
export function fmtWon(n: number | null | undefined): string { return n == null ? '-' : `${fmtNum(n)}원`; }
export function fmtKm(n: number | null | undefined): string { return n == null ? '-' : `${fmtNum(n)}km`; }
export function fmtYY(year: number): string { return year > 0 ? String(year).padStart(2, '0') : '??'; }
export function fmtYearMonth(year: number, month: number): string {
  if (!(year > 0)) return '-';
  return month >= 1 && month <= 12 ? `${fmtYY(year)}/${String(month).padStart(2, '0')}` : `${fmtYY(year)}/--`;
}

export function fmtKst(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    const utc = d.getTime() + 9 * 60 * 60 * 1000;
    const kstDate = new Date(utc);
    const y = kstDate.getUTCFullYear();
    const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const d2 = String(kstDate.getUTCDate()).padStart(2, '0');
    const h = String(kstDate.getUTCHours()).padStart(2, '0');
    const min = String(kstDate.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${d2} ${h}:${min} KST`;
  } catch {
    return iso;
  }
}

export function fmtPoints(n: number): string { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
export function fmtBool(b: boolean): string { return b ? '있음' : '없음'; }
export function vehicleLabel(v: Pick<VehicleData, 'manufacturer' | 'modelName' | 'gradeName'>): string {
  const s = [v.manufacturer, v.modelName, v.gradeName].filter((x): x is string => !!x).join(' ');
  return s || '(모델 미상)';
}

export function fmtGradeDistribution(dist: Record<Grade, number>): string {
  return GRADES.map((g) => `${g}: ${dist[g]}대`).join(' | ');
}

export function charWidth(cp: number): number {
  if (cp >= 0x0300 && cp <= 0x036f) return 0;
  if (cp >= 0x200b && cp <= 0x200f) return 0;
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0;
  if (cp >= 0x1100 && cp <= 0x115f) return 2;
  if (cp >= 0x2e80 && cp <= 0x303e) return 2;
  if (cp >= 0x3041 && cp <= 0x33ff) return 2;
  if (cp >= 0x3400 && cp <= 0x4dbf) return 2;
  if (cp >= 0x4e00 && cp <= 0x9fff) return 2;
  if (cp >= 0xa960 && cp <= 0xa97f) return 2;
  if (cp >= 0xac00 && cp <= 0xd7a3) return 2;
  if (cp >= 0xf900 && cp <= 0xfaff) return 2;
  if (cp >= 0xfe30 && cp <= 0xfe4f) return 2;
  if (cp >= 0xff00 && cp <= 0xff60) return 2;
  if (cp >= 0xffe0 && cp <= 0xffe6) return 2;
  if (cp >= 0x1f300 && cp <= 0x1faff) return 2;
  return 1;
}

export function displayWidth(s: string): number { let w = 0; for (const ch of s) w += charWidth(ch.codePointAt(0)!); return w; }

export function truncateDisplay(s: string, max: number): string {
  if (max < 1) return '';
  let w = 0;
  let len = 0;
  for (const ch of s) {
    const chw = charWidth(ch.codePointAt(0)!);
    if (w + chw > max - 1) break;
    w += chw;
    len++;
  }
  const truncated = Array.from(s).slice(0, len).join('');
  return w < displayWidth(s) ? truncated + '…' : s;
}

export function padDisplay(s: string, width: number, align: 'left' | 'right' = 'left'): string {
  const gap = Math.max(0, width - displayWidth(s));
  return align === 'left' ? s + ' '.repeat(gap) : ' '.repeat(gap) + s;
}
