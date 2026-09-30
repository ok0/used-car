// 숫자·날짜 표시 규칙 (src/cli/format.ts 와 동일한 결과 — verify-web-lib.ts 가 대조)
export function fmtNum(n: number): string { return Math.round(n).toLocaleString('en-US'); }
export function fmtManwon(n: number | null | undefined): string { return n == null ? '-' : `${fmtNum(n)}만원`; }
export function fmtWon(n: number | null | undefined): string { return n == null ? '-' : `${fmtNum(n)}원`; }
export function fmtKm(n: number | null | undefined): string { return n == null ? '-' : `${fmtNum(n)}km`; }
export function fmtYY(year: number): string { return year > 0 ? String(year).padStart(2, '0') : '??'; }
export function fmtYearMonth(year: number, month: number | null): string {
  if (!(year > 0)) return '-';
  return month !== null && month >= 1 && month <= 12 ? `${fmtYY(year)}/${String(month).padStart(2, '0')}` : `${fmtYY(year)}/--`;
}
export function fmtKst(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} KST`;
}
export function fmtPoints(n: number): string { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
/** 비율(0~1) → 정수 % */
export function fmtPct(r: number | null | undefined): string { return r == null ? '-' : `${Math.round(r * 100)}%`; }
export function fmtSigned(n: number, digits = 1): string { return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`; }
export function fmtSignedInt(n: number): string { return `${n > 0 ? '+' : n < 0 ? '-' : ''}${fmtNum(Math.abs(n))}`; }
/** 9,999만원 이상·0 이하는 엔카의 가격 미정 자리표시 */
export function isPlaceholderPrice(price: number): boolean { return !(price > 0 && price < 9999); }
export function fmtPrice(price: number): string { return isPlaceholderPrice(price) ? '가격 미정' : fmtManwon(price); }
export function fmtBool(b: boolean): string { return b ? '있음' : '없음'; }
export function fmtYn(b: boolean | null): string { return b === null ? '?' : b ? '있음' : '없음'; }
export function vehicleLabel(v: { manufacturer: string | null; modelName: string | null; gradeName: string | null }): string {
  const s = [v.manufacturer, v.modelName, v.gradeName].filter((x): x is string => !!x).join(' ');
  return s || '(모델 미상)';
}
export function modelTrimLabel(v: { modelName: string | null; gradeName: string | null }): string {
  return [v.modelName, v.gradeName].filter(Boolean).join(' ') || '(모델 미상)';
}
