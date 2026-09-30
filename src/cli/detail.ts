import {
  findVehicleById, getAccidentsByCarId, getOptionsByCarId, getOwnerChangesByCarId, getUsageHistoryByCarId,
  getMarketPriceByCarId, getYearlyPricesByCarId,
} from '../db/repository';
import { localBaselineFor } from '../scoring/rescore';
import { resolvePriceBaseline, MIN_LOCAL_PRICE_SAMPLES } from '../scoring/price';
import { DEFAULT_WEIGHTS } from '../scoring/calculator';
import {
  fmtNum, fmtManwon, fmtWon, fmtKm, fmtYearMonth, fmtKst, fmtPoints, fmtBool,
  vehicleLabel, padDisplay,
} from './format';

const USAGE_LABEL: Record<string, string> = {
  '1': '자가용',
  '2': '비영업용',
  '3': '영업/렌트',
  '4': '법인',
};

export function detailCommand(carId: string): number {
  const v = findVehicleById(carId);
  if (!v) {
    console.error(`❌ 매물을 찾을 수 없습니다: ${carId}`);
    return 1;
  }

  console.log(`🚗 ${vehicleLabel(v)}${v.gradeDetail ? ' ' + v.gradeDetail : ''}`);
  console.log(`   매물 ID: ${carId}${v.actualCarId ? ` (실제 차량 ID: ${v.actualCarId})` : ''} | 차량번호: ${v.vehicleNo ?? '-'} | ${v.isDomestic ? '국산' : '수입'}`);
  console.log(`   https://fem.encar.com/cars/detail/${carId}`);
  console.log();

  console.log('[기본 정보]');
  console.log(`  연식: ${fmtYearMonth(v.year, v.month)} (연형 ${v.formYear ?? '-'}) | 주행거리: ${fmtKm(v.mileage)} | 가격: ${fmtManwon(v.price)}`);
  console.log(`  신차가: 기본 ${fmtManwon(v.originPriceBase)} + 옵션 ${fmtManwon(v.originPriceOptions)} = ${fmtManwon(v.originPrice)}`);
  console.log(`  연료: ${v.fuelType ?? '-'} | 변속기: ${v.transmission ?? '-'} | 배기량: ${v.displacement == null ? '-' : fmtNum(v.displacement) + 'cc'} | 색상: ${v.color ?? '-'}`);
  console.log(`  지역: ${v.region ?? '-'} | 판매유형: ${v.sellType ?? '-'} | 리스: ${v.leaseType ?? '-'}`);
  console.log(`  최초등록: ${v.firstRegistrationDate ?? '-'} | 최초광고: ${v.firstAdvertisedAt ?? '-'}`);
  console.log(`  수집 시각: ${fmtKst(v.collectedAt)} | 검색조건: ${v.searchQuery ?? '-'}`);
  console.log();

  console.log('[품질 점수]');
  if (v.scoreBreakdown == null) {
    console.log('  채점 전 — npx ts-node src/scoring/rescore.ts 로 재채점하세요');
  } else {
    const b = v.scoreBreakdown;
    const items: [string, number, keyof typeof b][] = [
      ['가격', DEFAULT_WEIGHTS.price, 'price'],
      ['렌트이력', DEFAULT_WEIGHTS.rental, 'rental'],
      ['사고/보험', DEFAULT_WEIGHTS.accident, 'accident'],
      ['성능점검', DEFAULT_WEIGHTS.inspection, 'inspection'],
      ['소유주이력', DEFAULT_WEIGHTS.ownerChanges, 'ownerChanges'],
      ['주행거리', DEFAULT_WEIGHTS.mileage, 'mileage'],
    ];
    for (const [label, max, key] of items) {
      console.log(`  ${padDisplay(label, 10)} ${padDisplay(fmtPoints(b[key]), 5, 'right')} / ${max}`);
    }
    const total = b.accident + b.mileage + b.price + b.inspection + b.rental + b.ownerChanges;
    console.log(`  ${padDisplay('합계', 10)} ${padDisplay(fmtPoints(total), 5, 'right')} / 100`);
    if ((v.scorePenalty ?? 0) > 0) {
      console.log(`  비공개 패널티: -${v.scorePenalty} (보험이력 또는 성능점검 비공개)`);
    }
    console.log(`  ▶ 최종: ${v.scoreGrade}등급 ${fmtPoints(v.scoreTotal ?? 0)}점`);
  }
  console.log();

  console.log('[가격 기준]');
  const yearly = getYearlyPricesByCarId(carId);
  const local = localBaselineFor(v);
  const pb = resolvePriceBaseline({ price: v.price, year: v.year, yearlyPoints: yearly.length ? yearly : null, localBaseline: local });

  if (pb.source === 'yearly') {
    console.log(`  출처: 엔카 연식별 시세 (yearly) | 기준 평균 ${fmtManwon(pb.avgPrice)} | 표본 ${pb.sampleCount}대`);
  } else if (pb.source === 'local') {
    console.log(`  출처: 로컬 DB 동일 모델·트림·연식 평균 (local) | 기준 평균 ${fmtManwon(pb.avgPrice)} | 표본 ${pb.sampleCount}대`);
  } else {
    console.log(`  출처: 기준 없음 (none) — 로컬 동일 조건 표본 ${local?.sampleCount ?? 0}대 (최소 ${MIN_LOCAL_PRICE_SAMPLES}대 필요) → 가격 점수 중립(50%)`);
  }

  if (pb.avgPrice != null && v.price > 0) {
    console.log(`  가격 비율: ${(v.price / pb.avgPrice * 100).toFixed(1)}% (이 매물 ${fmtManwon(v.price)} ÷ 기준 ${fmtManwon(pb.avgPrice)})`);
  }
  console.log(`  ※ 현재 DB 기준으로 재구성한 값입니다 (collect 이후 DB가 바뀌었으면 저장된 가격 점수와 다를 수 있음)`);

  const market = getMarketPriceByCarId(carId);
  if (market) {
    console.log(`  동급매물 시세: 중앙값 ${fmtManwon(market.median)} (P25 ${fmtNum(market.p25)} ~ P75 ${fmtNum(market.p75)}, 최저 ${fmtNum(market.minPrice)} ~ 최고 ${fmtNum(market.maxPrice)}만원, ${market.sampleCount}대, ${fmtKst(market.collectedAt)})`);
  } else {
    console.log(`  동급매물 시세: 미수집 (ENCAR_FETCH_MARKET=1 로 collect 시 수집)`);
  }

  if (yearly.length > 0) {
    console.log(`  연식별 시세: ${yearly.map((p) => `${p.year}년 ${fmtManwon(p.avgPrice)}(${p.count}대)`).join(', ')}`);
  } else {
    console.log(`  연식별 시세: 미수집 (ENCAR_FETCH_YEARLY=1 로 collect 시 수집)`);
  }
  console.log();

  console.log('[보험/사고 이력]');
  if (v.isInsurancePrivate) {
    console.log('  보험이력: 비공개 (패널티 대상)');
  } else {
    console.log(`  보험처리 ${v.insuranceCount}건 | 내차피해 ${v.myDamageCount}건 ${fmtWon(v.myDamageAmount)} | 타차가해 ${v.otherDamageCount}건 ${fmtWon(v.otherDamageAmount)}`);
    console.log(`  정보제공 불가기간: ${v.unavailablePeriods.length ? v.unavailablePeriods.join(', ') : '없음'}`);
    const accidents = getAccidentsByCarId(carId);
    if (accidents.length === 0) {
      console.log('  사고 상세: 없음');
    } else {
      console.log(`  사고 상세 (${accidents.length}건):`);
      for (let i = 0; i < accidents.length; i++) {
        const a = accidents[i];
        console.log(`    ${i + 1}) ${a.accidentDate || '날짜 미상'} | 보험금 ${fmtWon(a.insuranceBenefit)} | 부품 ${fmtWon(a.partCost)} | 공임 ${fmtWon(a.laborCost)} | 도장 ${fmtWon(a.paintingCost)}${a.isMajor ? ' | ⚠ 큰 사고' : ''}`);
      }
    }
  }
  console.log();

  console.log('[성능점검 / 엔카진단]');
  if (v.isInspectionPrivate) {
    console.log('  성능점검: 비공개 (패널티 대상)');
  } else {
    console.log(`  성능점검: ${fmtBool(v.hasInspection)} | 교환 ${fmtBool(v.hasReplacement)} | 판금 ${fmtBool(v.hasWelding)} | 부식 ${fmtBool(v.hasCorrosion)}`);
    if (v.rankCounts) {
      const rankLabels: [keyof typeof v.rankCounts, string][] = [
        ['ONE', '외판1랭크'],
        ['TWO', '외판2랭크'],
        ['A', '골격A랭크'],
        ['B', '골격B랭크'],
      ];
      for (const [key, label] of rankLabels) {
        const r = v.rankCounts[key];
        console.log(`    ${label}: 교환 ${r.X} / 판금 ${r.W} / 부식 ${r.C}`);
      }
    }
  }
  console.log(`  엔카진단: ${v.hasDiagnosis ? (v.diagnosisTier ?? '있음') : '없음'} | 프레임 교환: ${fmtBool(v.diagFrameReplacement)} | 패널 교환: ${fmtBool(v.diagPanelReplacement)}`);
  console.log();

  console.log(`[소유주 변경] ${v.ownerChangeCount}회`);
  const ownerDates = getOwnerChangesByCarId(carId);
  if (ownerDates.length > 0) {
    console.log(`  ${ownerDates.map((d) => d.changeDate || '날짜 미상').join(', ')}`);
  }
  console.log();

  console.log('[용도 이력]');
  console.log(`  렌트이력: ${fmtBool(v.hasRentalHistory)} | 용도변경: ${fmtBool(v.hasUsageChange)}`);
  const usage = getUsageHistoryByCarId(carId);
  if (usage.length > 0) {
    console.log(`  ${usage.map((u) => `${u.usageCode}(${USAGE_LABEL[u.usageCode] ?? '기타'})`).join(' → ')}`);
  } else {
    console.log('  기록 없음');
  }
  console.log();

  const options = getOptionsByCarId(carId);
  console.log(`[선택옵션] ${options.length}개 (합계 ${fmtManwon(v.originPriceOptions)})`);
  if (options.length > 0) {
    console.log(`  ${options.map((o) => `${o.optionName ?? o.optionCode}(${fmtManwon(o.optionPrice)})`).join(', ')}`);
  } else {
    console.log('  없음');
  }
  if (v.optionsStatus === 'failed') console.log('  ⚠ 선택옵션 API 조회 실패 — 합계가 실제보다 작을 수 있음');
  console.log();

  console.log('[딜러]');
  console.log(`  ${v.dealerName ?? '-'} / ${v.dealerFirmName ?? '-'} | 가입: ${v.dealerJoinedAt?.slice(0, 10) ?? '-'} | 누적 판매: ${v.dealerTotalSales == null ? '-' : fmtNum(v.dealerTotalSales) + '대'}`);

  return 0;
}
