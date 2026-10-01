# used-car

엔카 매물을 가격 기준선으로 삼아, 헤이딜러/케이카/현대 인증중고차 매물의 가격이 적정한지 비교하는 CLI.

## 목차

- [동작 방식](#동작-방식)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [명령어](#명령어)
- [GUI](#gui)
- [환경변수](#환경변수)

## 동작 방식

1. **수집** — 엔카 검색 URL의 매물을 크롤링해 품질 점수를 매기고 SQLite(`data/used-car.db`)에 저장합니다.
2. **비교** — 비교할 매물(URL 또는 수동 입력)을 DB의 동급 엔카 매물과 견줘 가격·주행거리·사고·성능점검·소유주·렌트·옵션을 분석하고 종합 판정(저렴/적정/다소 비쌈/비쌈)을 냅니다. 조건이 가장 비슷한 엔카 매물 40대로 계산한 **유사 매물 평가**(가중 최근접 이웃)도 함께 표시합니다.

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

## GUI

웹 브라우저로 대시보드·매물 목록·상세·비교를 조회하고, 수집·정리(미확인 매물 삭제)·설정(`.env`)을 실행합니다 (로컬 전용).

- **수집**: 엔카 검색 URL과 옵션(시작 페이지·최대 페이지·최대 대수·DB에 있는 매물 건너뛰기·목록에 없는 매물 삭제)을 넣고 실행. 진행 상황·로그를 실시간으로 보고 중단할 수 있습니다. 시세 API(동급매물·연식별)는 이번 실행에만 켜고 끌 수 있습니다.
- **정리**: `purge`와 같은 대상·규칙(자동 백업, 전체 50% 초과 시 삭제 안 함). 삭제하려면 대상 대수를 직접 입력해 확인합니다.
- **설정**: `.env`의 지원 항목만 고칩니다(주석·다른 줄은 그대로). 대부분 바로 반영되고 `GUI_PORT`는 서버를 다시 시작해야 합니다. 실행 시 직접 지정한 환경변수가 있으면 그 값이 우선합니다.
- 조회는 DB를 읽기 전용으로 열고, 수집·정리 중에만 쓰기로 엽니다. 수집·정리는 한 번에 하나만 돌며, CLI `collect`·`purge --apply`와도 동시에 돌지 않습니다(DB 옆 `used-car.db.lock`).
- 서버를 끄면(Ctrl+C) 실행 중인 수집에 중단을 요청하고 진행분을 저장한 뒤 종료합니다. 작업 기록은 서버를 다시 시작하면 사라집니다.

```bash
npm run gui
# http://127.0.0.1:5174 에서 열림 (--no-open으로 자동 열기 방지)
```

옵션:
- `--port <n>` / `GUI_PORT` 환경변수: 포트 변경 (기본 5174)
- `--no-open`: 브라우저 자동 열기 안 함
- `--dev`: 개발 모드 (Vite 5173, API 프록시)

테스트용: `USED_CAR_DB=<복사본>` 로 다른 DB 사용.

## 환경변수

`.env`(또는 실행 시 `VAR=값`)로 설정합니다. 종류와 기본값은 `.env.example`을, 점수·판정 방식과 한계 등 자세한 설명은 [GUIDE.md](GUIDE.md)를 참고.
