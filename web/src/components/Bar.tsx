import { clamp01 } from '../lib/chart-layout';

/** 가로 막대: value/max. 텍스트 값은 막대 옆에 항상 표시 (막대만으로 정보 전달하지 않음) */
export function HBar({ value, max, text, tone = 'accent' }: { value: number; max: number; text: string; tone?: 'accent' | 'muted' | 'good' | 'warn' | 'bad' }) {
  const pct = max > 0 ? clamp01(value / max) * 100 : 0;
  return (
    <div className="hbar">
      <div className="hbar-track" aria-hidden="true"><div className={`hbar-fill fill-${tone}`} style={{ width: `${pct}%` }} /></div>
      <span className="hbar-text num">{text}</span>
    </div>
  );
}

/** 백분위(0~100) 위치 표시 */
export function PercentileBar({ percentile, label }: { percentile: number; label: string }) {
  const p = Math.max(0, Math.min(100, percentile));
  return (
    <div className="pbar" role="img" aria-label={label}>
      <div className="pbar-track">
        <div className="pbar-mid" style={{ left: '25%', width: '50%' }} />
        <div className="pbar-dot" style={{ left: `${p}%` }} />
      </div>
      <div className="pbar-scale"><span>저렴</span><span>중간</span><span>비쌈</span></div>
    </div>
  );
}
