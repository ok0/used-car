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
  console.log(`  총 매물: ${fmtNum(total)}대 | 마지막 수집: ${fmtKst(s.lastCollectedAt)}`);
  let gradeLine = `  등급 분포: ${fmtGradeDistribution(s.gradeDistribution)}`;
  if (total - graded > 0) {
    gradeLine += ` | 미채점: ${total - graded}대`;
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
