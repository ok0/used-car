import { Fragment } from 'react';
import type { VehicleListItem } from '../../../src/types';
import { Link, navigate } from '../router';
import { fmtKm, fmtPoints, fmtPrice, fmtYearMonth, modelTrimLabel } from '../lib/format';
import { Chip, GradeBadge } from './Badge';

export interface VehicleTableProps {
  items: VehicleListItem[];
  startIndex?: number;                              // # 열 시작 번호 (기본 1)
  marker?: VehicleTableMarker | null;              // 비교 화면: 가격 순서상 위치에 "이 매물" 행 삽입
  highlightAccident?: boolean;                      // 비교 화면: 내차피해 1건 이상인 매물의 사고 칸 강조
}

export interface VehicleTableMarker {
  label: string;
  price: number;
  year: number;
  month: number | null;
  mileage: number;
  accident: string;            // 사고 열 표시 문구 (모르면 '-')
  ownerChangeCount: number | null;
  hasRentalHistory: boolean | null;
}

function accidentText(v: VehicleListItem): string {
  if (v.isInsurancePrivate) return '비공개';
  return v.myDamageCount === 0 ? '무사고' : `${v.myDamageCount}건`;
}

export function VehicleTable({ items, startIndex = 1, marker = null, highlightAccident = false }: VehicleTableProps) {
  const markerAt = marker === null ? -1 : (() => { const i = items.findIndex((v) => v.price > marker.price); return i === -1 ? items.length : i; })();
  const markerRow = marker === null ? null : (
    <tr className="row-marker">
      <td className="num">▶</td>
      <td>{marker.label}</td>
      <td className="num-plain">{fmtYearMonth(marker.year, marker.month)}</td>
      <td className="num">{fmtKm(marker.mileage)}</td>
      <td className="num">{fmtPrice(marker.price)}</td>
      <td className="muted">-</td>
      <td className="num muted">-</td>
      <td>{marker.accident}</td>
      <td className="num">{marker.ownerChangeCount === null ? '-' : `${marker.ownerChangeCount}회`}</td>
      <td>{marker.hasRentalHistory ? <Chip tone="bad">렌트</Chip> : <span className="muted">-</span>}</td>
    </tr>
  );
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="num">#</th><th>모델 / 트림</th><th>연식</th><th className="num">주행거리</th><th className="num">가격</th>
            <th>등급</th><th className="num">점수</th><th>사고</th><th className="num">소유주</th><th>상태</th>
          </tr>
        </thead>
        <tbody>
          {items.map((v, i) => (
            <Fragment key={v.carId}>
              {i === markerAt && markerRow}
              <tr className="row-link" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) navigate(`/vehicles/${encodeURIComponent(v.carId)}`); }}>
                <td className="num muted">{startIndex + i}</td>
                <td><Link to={`/vehicles/${encodeURIComponent(v.carId)}`}>{modelTrimLabel(v)}</Link>{v.gradeDetail ? <span className="muted"> {v.gradeDetail}</span> : null}</td>
                <td className="num-plain">{fmtYearMonth(v.year, v.month)}</td>
                <td className="num">{fmtKm(v.mileage)}</td>
                <td className="num">{fmtPrice(v.price)}</td>
                <td><GradeBadge grade={v.scoreGrade} /></td>
                <td className="num">{v.scoreTotal === null ? '-' : fmtPoints(v.scoreTotal)}</td>
                <td>{highlightAccident && !v.isInsurancePrivate && v.myDamageCount > 0 ? <Chip tone="warn">{accidentText(v)}</Chip> : accidentText(v)}</td>
                <td className="num">{v.ownerChangeCount}회</td>
                <td className="chips">
                  {v.stale || v.hasRentalHistory ? <>
                    {v.stale && <Chip tone="warn">미확인</Chip>}
                    {v.hasRentalHistory && <Chip tone="bad">렌트</Chip>}
                  </> : <span className="muted">-</span>}
                </td>
              </tr>
            </Fragment>
          ))}
          {markerAt === items.length && markerRow}
        </tbody>
      </table>
    </div>
  );
}
