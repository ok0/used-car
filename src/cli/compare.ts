import { getStaleDays } from '../db/repository';
import { fetchText } from '../crawler/fetch-helper';
import { printCompareReport } from '../comparator/reporter';
import {
  CompareError, URL_SITE_LABEL, resolveCompareSettings, resolveUrlSite, fetchSiteInput, analyzeInput,
  applyOverrides, buildManualInput, type CompareCliOptions, type CompareSettings, type FetchedInput, type UrlSite, type CompareAnalysis,
} from '../services/compare';
import { PLATFORM_PREMIUM_ENV } from '../comparator/analyzer';
import type { CompareInput } from '../types';

// 기존 import 경로 호환 (함수 본체는 services/compare.ts로 이동)
export { detectUrlPlatform, parseInspectionText, buildManualInput, applyOverrides, type CompareCliOptions } from '../services/compare';

export async function compareCommand(opts: CompareCliOptions, now: Date = new Date()): Promise<number> {
  let settings: CompareSettings;
  try {
    settings = resolveCompareSettings(); // 네트워크 호출 전에 환경변수부터 검증
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const matchConfig = settings.matchConfig;
  if (['COMPARE_MIN_SAMPLES', 'COMPARE_YEAR_RANGE', 'COMPARE_MILEAGE_RANGE'].some((k) => (process.env[k] ?? '').trim() !== '')) {
    const mil = matchConfig.mileageRatios === null ? '제한 없음' : matchConfig.mileageRatios.map((r) => `±${Math.round(r * 100)}%`).join(' → ');
    console.log(`ℹ 동급 조건(환경변수): 연식 ±${matchConfig.yearRange}년 | 주행거리 ${mil} | 최소 표본 ${matchConfig.minSamples}대`);
  }
  if (['COMPARE_KNN', 'COMPARE_KNN_N', 'COMPARE_VERDICT_SOURCE'].some((k) => (process.env[k] ?? '').trim() !== '')) {
    const k = settings.knn;
    console.log(`ℹ 유사 매물 평가(환경변수): ${k.enabled ? `이웃 ${k.n}대 | 종합 판정 기준 ${k.primary ? '유사 매물 평가' : '현재 평가'}` : '꺼짐'}`);
  }
  if ((process.env.STALE_DAYS ?? '').trim() !== '') {
    const d = getStaleDays();
    console.log(`ℹ 미확인 매물 제외(STALE_DAYS): ${d === 0 ? '꺼짐' : `엔카 목록에서 ${d}일 이상 확인되지 않은 매물 제외`}`);
  }
  let input: CompareInput;
  if (opts.url) {
    let site: UrlSite;
    try {
      site = resolveUrlSite(opts.url, opts.platform);
    } catch (err) {
      console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    console.log(`🔗 ${URL_SITE_LABEL[site]} 매물 조회 중: ${opts.url}`);
    let parsed: FetchedInput;
    try {
      parsed = await fetchSiteInput(site, opts.url, fetchText);
    } catch (err) {
      if (err instanceof CompareError && err.code === 'LISTING_NOT_FOUND') {
        console.error(`❌ ${err.message}`);
        return 1;
      }
      throw err;
    }
    input = parsed.input;
    for (const w of parsed.warnings) console.warn(`  ⚠ ${w}`);
    for (const n of parsed.notes) console.log(`  ℹ ${n}`);
    const applied = applyOverrides(input, opts);
    if (applied.length > 0) console.log(`  ✎ 수동 입력값으로 덮어씀: ${applied.join(', ')}`);
  } else {
    input = buildManualInput(opts);
  }

  const premiumEnv = PLATFORM_PREMIUM_ENV[input.platform];
  if ((process.env[premiumEnv] ?? '').trim() !== '') {
    const label = { heydealer: '헤이딜러', kcar: '케이카', hyundai_certified: '현대 인증중고차' }[input.platform];
    console.log(`ℹ ${label} 기본 프리미엄(환경변수): ${settings.premiums[input.platform]}%`);
  }

  console.log();

  let analysis: CompareAnalysis;
  try {
    analysis = analyzeInput(input, settings, now);
  } catch (err) {
    if (err instanceof CompareError && (err.code === 'EMPTY_DB' || err.code === 'NO_PEERS')) {
      console.error(`${err.code === 'EMPTY_DB' ? '📭' : '❌'} ${err.message}`);
      for (const d of err.details) console.error(`   ${d}`);
      return 1;
    }
    throw err;
  }
  printCompareReport(analysis.result);
  return 0;
}
