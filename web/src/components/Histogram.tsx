import type { KnnResult, MarketStats, PriceComparison } from '../../../src/types';
import { histogramLayout } from '../lib/chart-layout';
import { fmtNum } from '../lib/format';

const W = 960;
const H = 300;
const MARKER_LABEL = { input: '이 매물', mean: '평균', median: '중앙값' } as const;
const MARKER_ROW = { input: 0, mean: 1, median: 2 } as const;

/** 동급 가격 분포 (구간은 analyzer 와 동일) + 이 매물 / 평균 / 중앙값 / P25~P75 */
export function Histogram({ price, market, knn = null }: { price: PriceComparison; market: MarketStats; knn?: KnnResult | null }) {
  const L = histogramLayout({
    buckets: price.buckets, bucketWidth: price.bucketWidth, inputPrice: price.inputPrice,
    mean: market.mean, median: market.median, p25: market.p25, p75: market.p75, width: W, height: H,
    knn: knn === null ? null : { expected: knn.expectedPrice, low: knn.intervalLow, high: knn.intervalHigh, neighborPrices: knn.neighbors.map((n) => n.adjustedPrice) },
  });
  const summary = `동급 ${market.sampleCount}대 가격 분포. 이 매물 ${fmtNum(price.inputPrice)}만원, 평균 ${fmtNum(market.mean)}만원, 중앙값 ${fmtNum(market.median)}만원, P25~P75 ${fmtNum(market.p25)}~${fmtNum(market.p75)}만원`
    + (knn === null ? '' : `. 유사 매물 기대 가격 ${fmtNum(knn.expectedPrice)}만원 (95% 구간 ${fmtNum(knn.intervalLow)}~${fmtNum(knn.intervalHigh)}만원)`);
  return (
    <figure className="hist">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="xMidYMid meet">
        <title>{summary}</title>
        <rect className="hist-iqr" x={L.iqr.x1} y={L.plot.top} width={Math.max(1, L.iqr.x2 - L.iqr.x1)} height={L.plot.bottom - L.plot.top} />
        <text className="hist-iqr-label" x={(L.iqr.x1 + L.iqr.x2) / 2} y={L.plot.bottom - 4} textAnchor="middle">P25~P75</text>
        {L.yTicks.map((t) => (
          <g key={`y${t.value}`}>
            <line className="hist-grid" x1={L.plot.left} x2={L.plot.right} y1={t.y} y2={t.y} />
            <text className="hist-tick" x={L.plot.left - 6} y={t.y + 4} textAnchor="end">{t.value}</text>
          </g>
        ))}
        {L.bars.map((b) => (
          <rect key={b.from} className={`hist-bar${b.isInput ? ' is-input' : ''}`} x={b.x} y={b.y} width={b.w} height={b.h}>
            <title>{`${fmtNum(b.from)}~${fmtNum(b.to)}만원: ${b.count}대`}</title>
          </rect>
        ))}
        {L.knn && (
          <g className="hist-knn">
            <rect className="hist-knn-band" x={L.knn.x1} y={L.plot.bottom - 10} width={Math.max(1, L.knn.x2 - L.knn.x1)} height={10} />
            {L.knn.rug.map((x, k) => <line key={k} className="hist-rug" x1={x} x2={x} y1={L.plot.bottom - 10} y2={L.plot.bottom} />)}
            <line className="hist-knn-mark" x1={L.knn.x} x2={L.knn.x} y1={L.plot.top} y2={L.plot.bottom} />
          </g>
        )}
        <line className="hist-axis" x1={L.plot.left} x2={L.plot.right} y1={L.plot.bottom} y2={L.plot.bottom} />
        {L.xTicks.map((t) => (
          <text key={`x${t.value}`} className="hist-tick" x={t.x} y={L.plot.bottom + 16} textAnchor="middle">{fmtNum(t.value)}</text>
        ))}
        {L.markers.map((m) => (
          <g key={m.kind} className={`hist-marker m-${m.kind}`}>
            <line x1={m.x} x2={m.x} y1={L.plot.top - 44 + MARKER_ROW[m.kind] * 17} y2={L.plot.bottom} />
            <text x={m.x} y={L.plot.top - 48 + MARKER_ROW[m.kind] * 17} textAnchor={m.x > W * 0.8 ? 'end' : m.x < W * 0.2 ? 'start' : 'middle'}>
              {`${MARKER_LABEL[m.kind]} ${fmtNum(m.value)}`}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="muted">가로축: 가격(만원) · 세로축: 대수 · 구간 폭 {fmtNum(price.bucketWidth)}만원 · 음영: P25~P75{knn !== null ? ' · 초록 점선: 유사 매물 기대 가격, 아래 띠: 95% 구간, 눈금: 유사 매물을 이 매물 조건으로 환산한 가격' : ''}</figcaption>
    </figure>
  );
}
