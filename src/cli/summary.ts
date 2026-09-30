import { GRADES } from '../types';
import { getSummary } from '../db/repository';
import { fmtNum, fmtManwon, fmtKst, fmtGradeDistribution, vehicleLabel } from './format';

export function summaryCommand(): number {
  const s = getSummary();

  if (s.totalCount === 0) {
    console.log('📭 수집된 매물이 없습니다.');
    console.log('   먼저 수집하세요: npx ts-node src/index.ts collect "<엔카 검색 URL>"');
    return 0;
  }

  const graded = GRADES.reduce((acc, g) => acc + s.gradeDistribution[g], 0);
  const total = s.totalCount;

  const scoreAvg = s.scoreAvg;
  const priceMin = s.priceMin;
  const priceMax = s.priceMax;
  const priceAvg = s.priceAvg;

  console.log('📊 수집 현황');
  console.log(`  총 매물: ${fmtNum(total)}대${s.staleDays > 0 ? ` (활성 ${fmtNum(s.activeCount)}대 | ${s.staleDays}일 이상 미확인 ${fmtNum(s.staleCount)}대)` : ''} | 마지막 수집: ${fmtKst(s.lastCollectedAt)} | 마지막 목록 확인: ${fmtKst(s.lastSeenAt)}`);
  if (s.staleCount > 0) console.log(`  ※ 아래 통계는 활성 매물 기준입니다. 미확인 매물은 비교·시세·가격 점수 기준에서 제외되며, 확인·삭제는 npx ts-node src/index.ts purge`);
  if (s.activeCount === 0) console.log('  ⚠ 모든 매물이 미확인 상태입니다 — 계속 볼 검색 URL로 다시 collect 하세요');
  let gradeLine = `  등급 분포: ${fmtGradeDistribution(s.gradeDistribution)}`;
  if (s.activeCount - graded > 0) {
    gradeLine += ` | 미채점: ${s.activeCount - graded}대`;
  }
  console.log(gradeLine);
  console.log(`  평균 점수: ${scoreAvg == null ? '-' : scoreAvg.toFixed(1) + '점'}`);
  console.log(`  가격 범위: ${priceMin == null ? '-' : fmtNum(priceMin)} ~ ${fmtManwon(priceMax)} (평균 ${fmtManwon(priceAvg)})`);
  console.log(`  모델 분포 (상위 ${s.modelDistribution.length}):`);
  for (const m of s.modelDistribution) {
    const label = m.label || '(모델 미상)';
    console.log(`    - ${label}: ${fmtNum(m.count)}대`);
  }

  return 0;
}
