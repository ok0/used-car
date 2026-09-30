import { Fragment } from 'react';
import type { VehicleListItem } from '../../../src/types';
import { Link, navigate } from '../router';
import { fmtKm, fmtPoints, fmtPrice, fmtYearMonth, modelTrimLabel, fmtNum } from '../lib/format';
import { Chip, GradeBadge } from './Badge';

export interface VehicleTableProps {
  items: VehicleListItem[];
  startIndex?: number;                              // # 열 시작 번호 (기본 1)
  marker?: { price: number; label: string } | null; // 비교 화면: 가격 순서상 위치에 "이 매물" 행 삽입
}

function accidentText(v: VehicleListItem): string {
  if (v.isInsurancePrivate) return '비공개';
  return v.myDamageCount === 0 ? '무사고' : `${v.myDamageCount}건`;
}

export function VehicleTable({ items, startIndex = 1, marker = null }: VehicleTableProps) {
  const markerAt = marker === null ? -1 : (() => { const i = items.findIndex((v) => v.price > marker.price); return i === -1 ? items.length : i; })();
  const markerRow = marker === null ? null : (
    <tr className="row-marker">
      <td className="num">▶</td>
      <td colSpan={3}>{marker.label}</td>
      <td className="num">{fmtNum(marker.price)}만원</td>
      <td colSpan={5} />
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
                <td>{accidentText(v)}</td>
                <td className="num">{v.ownerChangeCount}회</td>
                <td className="chips">
                  {v.stale && <Chip tone="warn">미확인</Chip>}
                  {v.hasRentalHistory && <Chip tone="bad">렌트</Chip>}
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
