#!/usr/bin/env node
import './env'; // .env 로드 (다른 모듈보다 먼저)
import { Command, Option, InvalidArgumentError } from 'commander';
import { getDb, closeDb } from './db/connection';
import type { VehicleSortField } from './types';
import { collectCommand } from './cli/collect';
import { summaryCommand } from './cli/summary';
import { listCommand } from './cli/list';
import { detailCommand } from './cli/detail';
import { compareCommand, type CompareCliOptions } from './cli/compare';
import { purgeCommand } from './cli/purge';
import { getStaleDays } from './db/repository';

const program = new Command();

program
  .name('used-car')
  .description('중고차 가격 객관성 검증 도구 — 엔카 시세 수집 및 가격 적정성 비교')
  .version('0.1.0');

function toNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InvalidArgumentError(`숫자가 아닙니다: ${value}`);
  return n;
}

function toPositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError(`1 이상의 정수가 아닙니다: ${value}`);
  return n;
}

async function runCommand(fn: () => number | Promise<number>): Promise<void> {
  let code = 1;
  try {
    code = await fn();
  } catch (err) {
    console.error(`❌ 오류: ${err instanceof Error ? err.message : String(err)}`);
    code = 1;
  } finally {
    closeDb();
  }
  process.exitCode = code;
}

program
  .command('collect')
  .description('엔카 검색 URL의 모든 페이지 매물을 수집하여 DB에 저장 (시세 추가수집: ENCAR_FETCH_MARKET=1, ENCAR_FETCH_YEARLY=1)')
  .argument('<url>', '엔카 검색 결과 URL (https://car.encar.com/list/car?search=...)')
  .option('--start-page <n>', '수집을 시작할 목록 페이지 (기본 1, 페이지당 20대)', toPositiveInt)
  .option('--max-pages <n>', '시작 페이지부터 수집할 최대 페이지 수 (페이지당 20대, 테스트용. 시작 페이지는 --start-page)', toPositiveInt)
  .option('--limit <n>', '상세 수집 최대 대수 (목록 앞에서부터)', toPositiveInt)
  .option('--skip-existing', 'DB에 이미 있는 매물은 상세 수집 생략 (중단 후 이어받기용)')
  .option('--prune', '이번 검색 목록에 없는 기존 매물(같은 검색 조건으로 수집된 것)을 DB에서 삭제. 목록 전체를 수집한 완주 실행에서만 동작하며 삭제 전 목록 재확인·자동 백업(data/used-car.prune-backup.db)')
  .action((url: string, opts: { startPage?: number; maxPages?: number; limit?: number; skipExisting?: boolean; prune?: boolean }) =>
    runCommand(() => collectCommand(url, { startPage: opts.startPage, maxPages: opts.maxPages, limit: opts.limit, skipExisting: opts.skipExisting === true, prune: opts.prune === true }))
  );

program
  .command('summary')
  .description('수집된 매물 현황 요약')
  .action(() => runCommand(() => summaryCommand()));

program
  .command('list')
  .description('수집된 매물 목록 조회')
  .option('--model <keyword>', '모델/트림 키워드 (공백 구분, 모두 포함)')
  .option('--min-score <number>', '최소 품질 점수', toNumber)
  .addOption(
    new Option('--sort <field>', '정렬 기준')
      .choices(['price', 'score', 'mileage', 'year'])
      .default('score')
  )
  .option('--limit <n>', '최대 표시 대수', toPositiveInt, 50)
  .action((opts: { model?: string; minScore?: number; sort: VehicleSortField; limit: number }) =>
    runCommand(() => listCommand(opts))
  );

program
  .command('detail')
  .description('특정 매물 상세 + 스코어링 조회')
  .argument('<carId>', '엔카 매물 ID')
  .action((carId: string) => runCommand(() => detailCommand(carId)));

program
  .command('purge')
  .description('엔카 목록에서 STALE_DAYS(기본 14)일 이상 확인되지 않은 매물을 DB에서 삭제. 기본은 대상만 표시하고, --apply 일 때만 삭제(삭제 직전 data/used-car.purge-backup.db 로 자동 백업, 전체의 50% 초과 시 중단)')
  .option('--apply', '실제로 삭제 (되돌릴 수 없음, 백업 파일로만 복구 가능)')
  .action((opts: { apply?: boolean }) => runCommand(() => purgeCommand({ apply: opts.apply === true })));

program
  .command('compare')
  .description('헤이딜러/케이카/현대 인증중고차 매물의 가격 적정성을 엔카 동급매물과 비교')
  .option('--url <url>', '헤이딜러 또는 현대 인증중고차 상세 페이지 URL')
  .addOption(new Option('--platform <platform>', '플랫폼 (수동 입력 시 필수)').choices(['heydealer', 'kcar', 'hyundai_certified']))
  .option('--model <model>', '모델명 (e.g., "BMW 520d", "더 뉴 싼타페")')
  .option('--trim <trim>', '트림/등급 (e.g., "프레스티지")')
  .option('--year <yy>', '최초등록 연식 2자리 또는 4자리 (e.g., 22 또는 2022)', toNumber)
  .option('--month <m>', '최초등록 월 (1~12)', toNumber)
  .option('--mileage <km>', '주행거리 (km)', toNumber)
  .option('--price <manwon>', '판매가 (만원)', toNumber)
  .option('--accident-count <n>', '내차피해 사고 건수', toNumber)
  .option('--accident-amount <won>', '내차피해 보험 지급금 합계 (원)', toNumber)
  .option('--owner-changes <n>', '소유주 변경 횟수', toNumber)
  .option('--rental', '렌트 이력 있음')
  .option('--no-rental', '렌트 이력 없음')
  .option('--inspection <summary>', '성능점검 요약 (e.g., "무사고", "교환 1 판금 1")')
  .action((opts: CompareCliOptions) => runCommand(() => compareCommand(opts)));

try {
  getStaleDays();
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

getDb();

if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  void program.parseAsync(process.argv);
}
