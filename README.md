# used-car

엔카 매물을 가격 기준선으로 삼아, 헤이딜러/케이카/현대 인증중고차 매물의 가격이 적정한지 비교하는 CLI.

## 목차

- [동작 방식](#동작-방식)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [명령어](#명령어)
- [환경변수](#환경변수)

## 동작 방식

1. **수집** — 엔카 검색 URL의 매물을 크롤링해 품질 점수를 매기고 SQLite(`data/used-car.db`)에 저장합니다.
2. **비교** — 비교할 매물(URL 또는 수동 입력)을 DB의 동급 엔카 매물과 견줘 가격·주행거리·사고·성능점검·소유주·렌트·옵션을 분석하고 종합 판정(저렴/적정/다소 비쌈/비쌈)을 냅니다.

| 플랫폼 | 입력 |
|--------|------|
| 엔카 | 검색 결과 URL (수집) |
| 헤이딜러 | 상세 URL 자동 파싱 / 수동 입력 |
| 현대 인증중고차 | 상세 URL 자동 파싱 |
| 케이카 | 수동 입력 |

## 설치

Node.js 22 이상.

```bash
npm install
cp .env.example .env   # 선택: 환경변수 설정
```

## 빠른 시작

```bash
# 1. 엔카에서 모델을 검색한 뒤 주소창 URL을 복사해 수집 (처음엔 소량으로)
npx ts-node src/index.ts collect "<엔카 검색 URL>" --max-pages 1 --limit 3
npx ts-node src/index.ts collect "<엔카 검색 URL>"

# 2. 확인
npx ts-node src/index.ts summary
npx ts-node src/index.ts list --sort price

# 3. 비교
npx ts-node src/index.ts compare --url "https://www.heydealer.com/market/cars/<id>"
```

## 명령어

```
npx ts-node src/index.ts <명령어> [옵션]
```

### collect

엔카 검색 URL의 매물을 수집해 DB에 저장합니다. 렌트/리스·중복매물은 제외합니다.

```
collect <url> [옵션]
```

| 옵션 | 설명 |
|------|------|
| `--start-page <n>` | 시작 페이지 (기본 1, 페이지당 20대) |
| `--max-pages <n>` | 시작 페이지부터 수집할 최대 페이지 수 |
| `--limit <n>` | 상세 수집할 최대 대수 |
| `--skip-existing` | DB에 이미 있는 매물은 건너뜀 (이어받기용) |
| `--prune` | 같은 검색 URL로 수집했으나 이번 목록에 없는(판매 완료 등) 매물을 삭제. 목록 전체를 수집할 때만 가능(`--start-page`/`--max-pages`/`--limit`과 함께 사용 불가). 삭제 전 재확인·자동 백업 |

### summary

수집 현황(총 매물, 등급 분포, 가격 범위, 모델 분포)을 출력합니다.

### list

```
list [--model <키워드>] [--min-score <n>] [--sort <필드>] [--limit <n>]
```

| 옵션 | 설명 |
|------|------|
| `--model <키워드>` | 공백으로 나눈 단어를 모두 포함하는 모델/트림 |
| `--min-score <n>` | 최소 품질 점수 |
| `--sort <필드>` | `price` · `score`(기본) · `mileage` · `year` |
| `--limit <n>` | 최대 표시 대수 (기본 50) |

### detail

```
detail <carId>
```

매물의 상세 정보, 항목별 점수, 사고·성능점검·옵션 등을 출력합니다. `carId`는 `list`의 매물ID입니다.

### purge

엔카 목록에서 14일(STALE_DAYS) 이상 확인되지 않은 매물을 삭제합니다. 기본은 대상만 표시, `--apply`로 삭제(자동 백업, 전체 50% 초과 시 중단, 되돌릴 수 없음). 미확인 매물은 삭제 전에도 비교·시세·가격 점수 기준에서 제외됩니다.

```bash
npx ts-node src/index.ts purge
npx ts-node src/index.ts purge --apply
```

### compare

엔카 동급 매물과 비교합니다. 먼저 같은 모델을 `collect` 해 두세요.

```
compare --url <상세 URL>
compare --platform <heydealer|kcar|hyundai_certified> --model <모델> --year <연식> --mileage <km> --price <만원> [옵션]
```

| 옵션 | 설명 |
|------|------|
| `--url <url>` | 헤이딜러 또는 현대 인증중고차 상세 URL |
| `--platform <이름>` | `heydealer` · `kcar` · `hyundai_certified` (수동 입력 시 필수) |
| `--model <모델>` | 모델명 (수동 입력 시 필수) |
| `--trim <트림>` | 트림/등급 |
| `--year <yy>` | 최초등록 연식, 2자리 또는 4자리 (수동 입력 시 필수) |
| `--month <m>` | 최초등록 월 (1~12) |
| `--mileage <km>` | 주행거리 (수동 입력 시 필수) |
| `--price <만원>` | 판매가, 만원 단위 (수동 입력 시 필수) |
| `--accident-count <n>` | 내차피해 사고 건수 |
| `--accident-amount <원>` | 내차피해 보험금 합계 |
| `--owner-changes <n>` | 소유주 변경 횟수 |
| `--rental` / `--no-rental` | 렌트 이력 있음 / 없음 |
| `--inspection <요약>` | 성능점검 요약 (예: `무사고`, `교환 1 판금 1`) |

`--url`에 수동 옵션을 함께 주면 파싱한 값을 덮어씁니다.

```bash
npx ts-node src/index.ts compare --platform kcar \
  --model "더 뉴 싼타페" --trim 프레스티지 --year 21 --month 5 \
  --mileage 80000 --price 2400 --accident-count 0 --owner-changes 1 --no-rental
```

## 환경변수

`.env`(또는 실행 시 `VAR=값`)로 설정합니다. 종류와 기본값은 `.env.example`을, 점수·판정 방식과 한계 등 자세한 설명은 [GUIDE.md](GUIDE.md)를 참고.
