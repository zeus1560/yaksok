# 프로젝트 개요 — yaksok (약속 잡기 도우미)

## 서비스 정의

앱 설치 없이 링크만으로 여러 사람의 공통 가능 시간을 찾아 주는 그룹 일정 조율 웹 서비스다. 주 사용자는 카카오톡을 쓰는 대학 스터디·동아리다.

MVP 흐름: 약속 생성 → 참여자 등록(닉네임 + PIN) → 30분 슬롯 시간 조율 → 후보 추천 → **방장 수동 확정**. 자동 확정과 전원 제출 시 자동 마감은 없다.

## 기준 문서

제품·규칙의 상세는 `docs/`에 있다. 이 폴더(`context/`)는 AI 작업 흐름과 기능 스펙만 다룬다.

| 문서                                                   | 용도                               |
| ------------------------------------------------------ | ---------------------------------- |
| `docs/README.md`                                       | 문서 우선순위와 에이전트 필수 규칙 |
| `docs/product/MVP_SCOPE.md`                            | MVP 범위 안·밖, 핵심 제약값        |
| `docs/specs/rules/*.md`                                | 비즈니스 규칙 (최상위 기준)        |
| `docs/architecture/DATABASE.md`                        | ERD, DB 제약, 트랜잭션·잠금        |
| `docs/specs/API_CONVENTIONS.md`, `docs/specs/api/*.md` | API 명세                           |
| `docs/development/DECISION_CONFLICTS.md`               | 미결·모순 목록. 착수 전 필독       |
| `docs/architecture/SETUP.md`                           | 환경 구축, 브랜치·커밋 규칙        |

충돌 시 우선순위: 비즈니스 규칙 > ERD > API 명세 > PRD.

## 기술 결정

| 항목        | 기준                                                  |
| ----------- | ----------------------------------------------------- |
| 구조        | 저장소 루트의 단일 Next.js 16 App Router 풀스택 앱    |
| 언어·런타임 | TypeScript 5 (strict), Node.js 24                     |
| 데이터      | Prisma 7 + `@prisma/adapter-pg` + PostgreSQL          |
| DB          | 개발은 각자 Neon 프로젝트, 운영도 Neon. Docker 미사용 |
| 배포        | Vercel                                                |
| 스타일      | Tailwind CSS 4                                        |
| 테스트      | Vitest                                                |

버전은 `docs/architecture/TECH_STACK.md` 기준으로 고정이며 임의로 올리지 않는다.

## 코드 구조

| 경로                                                   | 역할                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `app/api/v1/**/route.ts`                               | API Route Handler. 같은 폴더에 `route.test.ts`가 있다                                                   |
| `app/page.tsx`                                         | 홈                                                                                                      |
| `app/p/[inviteToken]/page.tsx`                         | 초대 링크 화면                                                                                          |
| `components/<기능>/`                                   | 기능별 클라이언트 UI                                                                                    |
| `components/common/`                                   | 공통 헤더·카드·버튼                                                                                     |
| `lib/member/`                                          | 링크, 방장·참여자 등록, 로그인, 닉네임·PIN·세션, 세션 인증(`session-auth.ts`)                           |
| `lib/state/`                                           | 약속 상태 전환과 설정 검증                                                                              |
| `lib/time/`                                            | 서울 시간 헬퍼(`seoul.ts`), 슬롯 파싱(`slots.ts`), 가능 시간 제출과 현황 조회                           |
| `lib/create-promise/`                                  | 화면용 순수 로직. 브라우저에서도 import한다                                                             |
| `lib/api-error.ts`, `lib/origin.ts`, `lib/no-store.ts` | 에러 응답 헬퍼, Origin 검사, `Cache-Control: no-store`                                                  |
| `lib/public-url.ts`                                    | 배포 환경별 허용 Origin·초대 링크 기준 주소(로컬·운영·Vercel 미리보기). 브라우저에서도 import한다       |
| `lib/prisma.ts`                                        | Prisma Client 싱글턴. 다른 곳에서는 `import { prisma } from "@/lib/prisma"`만 쓴다                      |
| `prisma/schema.prisma`, `prisma/migrations/`           | 스키마와 마이그레이션. CHECK 제약과 부분 UNIQUE 인덱스는 마이그레이션 SQL에 있다                        |
| `prisma/generated/`                                    | 생성된 클라이언트. Git에서 제외되어 있다                                                                |
| `tests/e2e/`                                           | 통합 테스트(Playwright). 준비·실행은 `docs/architecture/SETUP.md` 4-5                                   |
| `docs/`                                                | 제품·규칙·ERD·API 명세. 입구는 `docs/README.md`                                                         |
| `context/`                                             | AI 작업 기록. `current-feature.md`(현재 기능과 완료 이력), `feature-list.md`, `features/NNN-*.md`(스펙) |
| `.claude/skills/`                                      | `/feature`(load·start·review·test·explain·complete), `/cleanup`, `/research`, `/list-components`        |

## 현재 상태

2026-11-16 기준. 자세한 진행은 `context/current-feature.md`, 기능 목록은 `context/feature-list.md`를 본다.

- **MVP 기능은 구현되어 있다(001~033 완료).** MEMBER·STATE·TIME API 20개, 약속 만들기·참여·가능 시간 입력·후보·확정·결과·방장 관리·참여자 마무리 화면, Figma 대조, 공통 상태 가드 점검(`docs/development/GUARD_MATRIX.md`).
- **배포 준비:** 통합 테스트(`tests/e2e/`, Playwright 세 프로젝트), Vercel 미리보기 배포(함수 지역 `sin1`, `main` 자동 배포 끔)와 `@smoke` 확인 묶음(`docs/architecture/DEPLOY.md`)이 갖춰져 있다. 저장소는 개인 저장소(`origin`)로 옮겼다.
- **진행 중:** 034 휴대폰 그리드 보기 개선(브랜치 `ahn/feat-mobile-grid-view`) — 날짜 4일씩 넘기기, 표시 단위 30분·1시간·2시간(내 시간·모두의 시간, R-39·R-40), 드래그 중 자동 스크롤. 구현·로컬 통합 테스트·미리보기 `@smoke`·안드로이드 실기기 확인을 마치고 PR 대기 중이다.
- **남은 것:** 아이폰 Safari 실기기 확인(공개 배포 전 팀원 기기), 운영 공개·운영 DB·도메인(팀 결정 대기), CI의 통합 테스트 연결, PIN 시도 제한 등 ❗미결 규칙(`docs/development/DECISION_CONFLICTS.md`).
