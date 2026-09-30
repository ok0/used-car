// SVG 차트 좌표 계산 (순수 함수, 단위 테스트 대상)
export interface HistBucket { from: number; to: number; count: number }
export interface HistogramInput {
  buckets: HistBucket[];   // analyzer.buildPriceBuckets 결과 (≥1개, 오름차순, 폭 동일)
  bucketWidth: number;
  inputPrice: number;
  mean: number; median: number; p25: number; p75: number;
  width: number; height: number;
}
export interface HistBar { x: number; y: number; w: number; h: number; from: number; to: number; count: number; isInput: boolean }
export interface HistMarker { kind: 'input' | 'mean' | 'median'; value: number; x: number }
export interface HistogramLayout {
  plot: { left: number; top: number; right: number; bottom: number };
  domain: [number, number];
  yMax: number;
  bars: HistBar[];
  markers: HistMarker[];
  iqr: { x1: number; x2: number };
  xTicks: { x: number; value: number }[];
  yTicks: { y: number; value: number }[];
}
export const HIST_PAD = { left: 36, right: 16, top: 60, bottom: 28 } as const;

/** 가로축 = 가격(만원). 입력 가격이 분포 밖이면 축을 넓혀 항상 보이게 한다 (반 구간 여백) */
export function histogramLayout(i: HistogramInput): HistogramLayout {
  const first = i.buckets[0];
  const last = i.buckets[i.buckets.length - 1];
  const half = i.bucketWidth / 2;
  const d0 = Math.min(first.from, i.inputPrice - half);
  const d1 = Math.max(last.to, i.inputPrice + half);
  const plot = { left: HIST_PAD.left, top: HIST_PAD.top, right: i.width - HIST_PAD.right, bottom: i.height - HIST_PAD.bottom };
  const x = (v: number): number => plot.left + ((v - d0) / (d1 - d0)) * (plot.right - plot.left);
  const yMax = Math.max(1, ...i.buckets.map((b) => b.count));
  const y = (c: number): number => plot.bottom - (c / yMax) * (plot.bottom - plot.top);
  const bars = i.buckets.map((b): HistBar => {
    const x0 = x(b.from);
    const x1 = x(b.to);
    const gap = Math.min(2, (x1 - x0) * 0.15);
    return {
      x: x0 + gap / 2, w: Math.max(1, x1 - x0 - gap), y: y(b.count), h: plot.bottom - y(b.count),
      from: b.from, to: b.to, count: b.count, isInput: i.inputPrice >= b.from && i.inputPrice < b.to,
    };
  });
  const step = i.bucketWidth * Math.max(1, Math.ceil(i.buckets.length / 6));
  const xTicks: { x: number; value: number }[] = [];
  for (let v = first.from; v <= last.to + 1e-9; v += step) xTicks.push({ x: x(v), value: v });
  const yTicks = [0, ...(yMax >= 4 ? [Math.round(yMax / 2)] : []), yMax].map((value) => ({ y: y(value), value }));
  return {
    plot, domain: [d0, d1], yMax, bars,
    markers: [
      { kind: 'input', value: i.inputPrice, x: x(i.inputPrice) },
      { kind: 'mean', value: i.mean, x: x(i.mean) },
      { kind: 'median', value: i.median, x: x(i.median) },
    ],
    iqr: { x1: x(i.p25), x2: x(i.p75) },
    xTicks, yTicks,
  };
}

/** 0~1 로 자르기 (막대 너비용) */
export function clamp01(v: number): number { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
