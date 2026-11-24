# yaksok — 약속 잡기 도우미

앱을 설치하지 않고 **링크 하나로** 여러 사람이 함께 가능한 시간을 찾는 그룹 일정 조율 웹 서비스입니다.
카카오톡을 쓰는 대학 스터디·동아리가 주 사용자입니다.

```
약속 만들기 → 참여자 등록(닉네임 + PIN) → 30분 단위로 가능 시간 입력 → 후보 시간 추천 → 방장이 직접 확정
```

- 회원가입·로그인 없이 **닉네임과 PIN**으로 참여합니다. 다른 기기에서도 같은 닉네임과 PIN으로 다시 들어올 수 있습니다.
- 확정은 **방장이 직접** 합니다. 전원이 입력을 마쳐도 자동으로 마감하거나 확정하지 않습니다.
- 카카오 로그인, 톡캘린더, 위치·중간 지점, 장소 추천·투표는 MVP 범위 밖입니다([MVP_SCOPE.md](docs/product/MVP_SCOPE.md)).

## 주요 기능

| 구분      | 내용                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------ |
| 약속 생성 | 초대 링크 발급 → 방장 등록 → 날짜 범위·하루 시간대·소요 시간·정원·응답 마감 설정(등록 후 10분 안)      |
| 참여      | 초대 링크로 닉네임 + PIN 등록, 다른 기기 재로그인, 로그아웃(이 기기·모든 기기), 약속 나가기            |
| 시간 입력 | 30분 칸 그리드에서 드래그·탭으로 선택, 「모두의 시간」 겹침 보기, 5초 주기 동기화, 휴대폰 전용 보기    |
| 후보·확정 | 공통 가능 인원이 많은 순서로 후보 추천, 방장이 마감 후 후보 중 하나를 확정, 결과 화면                  |
| 방장 관리 | 모집 중 설정 변경(정원 증가·마감 연장), 재조율, 약속 취소, 참여자 명단·내보내기, 방장 나가면 자동 승계 |
| 보안      | PIN scrypt 저장, 세션 쿠키 분리(참여 링크만으로 방장 권한 불가), PIN 시도 제한, IP 요청 수 제한        |

약속 상태는 `draft`(설정 중) → `collecting`(모집 중) → `closed`(마감) → `confirmed`(확정)로 흐릅니다. 마감·확정 뒤에는 재조율로 다시 `collecting`이 될 수 있고, 방장이 취소하거나 방장이 나갔는데 이어받을 참여자가 없으면 `cancelled`(취소)가 됩니다. 상태 전환 규칙은 [STATE.md](docs/specs/rules/STATE.md)에 있습니다.

## 기술 스택

| 항목        | 사용 기술                                               |
| ----------- | ------------------------------------------------------- |
| 프레임워크  | Next.js 16 App Router (화면과 API를 한 프로젝트에서)    |
| 언어·런타임 | TypeScript 5 (strict), Node.js 24                       |
| 데이터      | Prisma 7.10.0 + `@prisma/adapter-pg` + PostgreSQL       |
| DB·배포     | Neon, Vercel                                            |
| 스타일      | Tailwind CSS 4                                          |
| 테스트      | Vitest(단위), Playwright(통합 — chromium·webkit·모바일) |

버전은 고정되어 있으며 팀 합의 없이 올리지 않습니다([TECH_STACK.md](docs/architecture/TECH_STACK.md)).

## 시작하기

Windows와 Node.js 24(`.nvmrc`) 기준입니다. 명령은 저장소 루트에서 실행합니다.

```bash
npm install
cp .env.example .env      # DATABASE_URL에 본인 Neon 개발 DB 주소를 넣는다 (DIRECT_URL은 선택)
npm run db:generate       # Prisma 클라이언트 생성
npm run db:deploy         # 개발 DB에 마이그레이션 적용
npm run dev               # http://localhost:3000
```

- 개발 DB는 개발자마다 따로 씁니다. 운영 DB로 개발·테스트하지 않습니다.
- 비밀값은 `.env`에만 두고 커밋하지 않습니다.
- 자세한 환경 구축과 자주 나는 오류는 [SETUP.md](docs/architecture/SETUP.md)를 봅니다.

## 자주 쓰는 명령

| 명령                                    | 설명                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                           | 개발 서버                                                          |
| `npm run test`                          | 단위 테스트(Vitest). **PowerShell에서 실행** (Git Bash에서는 실패) |
| `npm run test:e2e`                      | 통합 테스트(Playwright). `.env.e2e` 필요, dev 서버를 끈 뒤 실행    |
| `npm run lint` / `npm run typecheck`    | ESLint / 타입 검사                                                 |
| `npm run format:check`                  | Prettier 검사                                                      |
| `npm run build`                         | 운영 빌드. dev 서버를 끈 뒤 실행                                   |
| `npm run db:migrate -- --name <변경명>` | 스키마 변경 마이그레이션 생성 (`db push`는 쓰지 않음)              |

`npm run build`와 `npm run test:e2e`는 dev 서버와 같은 `.next` 폴더를 쓰므로, 실행 전에 dev 서버를 꼭 끕니다.

## 폴더 구조

```
app/
  page.tsx                  홈 (약속 만들기)
  p/[inviteToken]/          초대 링크 화면 (등록·설정·시간 입력·후보·결과)
  api/v1/**/route.ts        API (같은 폴더에 route.test.ts)
components/<기능>/          기능별 화면 컴포넌트, common/은 공통 UI
lib/
  member/                   링크·방장/참여자 등록·로그인·세션 인증
  state/                    약속 상태 전환·설정 검증·후보 계산·확정
  time/                     서울 시간 헬퍼·슬롯 파싱·가능 시간 제출/조회
  limit/                    PIN 시도 제한·요청 수 제한
  <화면 기능>/              화면용 순수 로직 (브라우저에서도 import)
prisma/                     schema.prisma, migrations/
tests/e2e/                  통합 테스트 (Playwright)
docs/                       제품·규칙·ERD·API 명세
context/                    기능 스펙과 진행 기록
```

전체 경로별 역할은 [project-overview.md](context/project-overview.md)의 「코드 구조」를 봅니다.

## 설계 원칙

- **시간과 권한의 최종 판정은 서버가 합니다.** 화면은 기기 시계나 브라우저 저장값으로 만료·권한을 확정하지 않습니다.
- **화면 검증과 서버 검증이 같은 코드를 씁니다.** 검증 함수와 상수는 `lib/`에 두고 양쪽에서 import합니다.
- **화면의 실패 처리는 HTTP 상태가 아니라 에러 코드로 나눕니다.**
- 모든 API 응답에 `Cache-Control: no-store`, 시각은 `+09:00` 표기, 날짜 경계는 항상 Asia/Seoul 기준입니다.

API 공통 규약은 [API_CONVENTIONS.md](docs/specs/API_CONVENTIONS.md)에 있습니다.

## 문서 안내

| 문서                                                            | 내용                               |
| --------------------------------------------------------------- | ---------------------------------- |
| [docs/README.md](docs/README.md)                                | 문서 목차와 우선순위               |
| [MVP_SCOPE.md](docs/product/MVP_SCOPE.md)                       | MVP 범위 안·밖, 핵심 제약값        |
| [docs/specs/rules/](docs/specs/rules/)                          | 비즈니스 규칙 (가장 우선하는 기준) |
| [DATABASE.md](docs/architecture/DATABASE.md)                    | ERD, DB 제약, 트랜잭션·잠금 규칙   |
| [docs/specs/api/](docs/specs/api/)                              | API 명세                           |
| [DECISION_CONFLICTS.md](docs/development/DECISION_CONFLICTS.md) | 미결 규칙·문서 간 충돌과 판단 기록 |
| [DEPLOY.md](docs/architecture/DEPLOY.md)                        | Vercel 미리보기 배포와 배포 확인   |
| [feature-list.md](context/feature-list.md)                      | 기능별 스펙과 진행 상태, 남은 항목 |

문서끼리 내용이 다르면 **비즈니스 규칙 > ERD > API 명세 > PRD** 순서로 따릅니다.

## 진행 상황

웹 MVP 흐름은 기능 001~035로 구현을 마쳤습니다(API 20개, 전체 화면, 통합 테스트, Vercel 미리보기 배포, PIN 시도 제한). 남은 항목은 다음과 같습니다. 자세한 내용은 [feature-list.md](context/feature-list.md)의 「MVP 범위 대비 남은 항목」을 봅니다.

- **카카오톡 챗봇 링크 발급** — 카카오 제휴 승인 대기
- **아이폰 Safari 실기기 확인** — 공개 배포 전 팀원 기기로 확인
- **잠정 결정·미결 규칙 팀 확정** — PIN 잠금 기준값, 정원 범위, 기록 보관 기간 등
- **운영 배포** — 운영 DB·도메인 결정 대기, CI 통합 테스트 연결

## 기여 규칙

- 새 브랜치는 `origin/main`에서 `<이름>/<타입>-<영어 설명>` 형식으로 만듭니다(예: `ahn/feat-preview-deploy`). `main`에 직접 커밋하지 않습니다.
- 커밋 메시지는 `feat|fix|chore|docs|refactor|test: 한 줄 요약` 형식의 한국어로 씁니다.
- PR 본문은 한국어로 씁니다. CI(`.github/workflows/ci.yml`)가 lint·타입 검사·테스트·빌드를 확인합니다.
- 스키마가 바뀌는 브랜치는 push 전에 `npm run db:deploy:preview`로 미리보기 DB에 마이그레이션을 먼저 적용합니다.
