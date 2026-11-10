# 코딩 규칙

경로는 저장소 루트 기준이다. 앱은 루트의 단일 Next.js 앱이며 `src/`나 `apps/` 폴더를 만들지 않는다.

## TypeScript와 Next.js

- TypeScript `strict`를 유지한다. `any` 대신 정확한 타입이나 `unknown`과 검증을 사용한다.
- Server Component를 기본으로 하고, 상태·이벤트·브라우저 API가 필요한 경계에만 `"use client"`를 둔다.
- `docs/specs/api/`에 명세된 엔드포인트는 Route Handler(`app/api/.../route.ts`)로 구현한다. 상태 코드·에러 포맷·시간 표기는 `docs/specs/API_CONVENTIONS.md`를 따른다.
- 서버 컴포넌트는 서버 전용 데이터 계층(`lib/`)을 직접 호출하고, 같은 앱의 Route Handler를 HTTP로 우회 호출하지 않는다.
- 입력 검증과 권한 확인(세션·역할·참여 상태·약속 상태)은 각 서버 진입점에서 수행한다. 화면에서의 제어로 대체하지 않는다.
- Next.js 16의 비동기 요청 API와 라우트 매개변수는 해당 버전 공식 문서에 맞춘다.
- DB를 조회하는 페이지·라우트는 동적 렌더링으로 둔다. CI 빌드는 가짜 DB 주소로 실행된다.

## 시간 처리

- 기준 시간대는 `Asia/Seoul` 고정이다. 날짜 경계·하루 시간 범위 계산에는 항상 시간대를 명시한다.
- 시점 컬럼은 `@db.Timestamptz(3)`을 쓴다. 하루 시간 경계는 자정부터의 분(`SMALLINT`, 24:00 = 1440)으로 저장한다.
- 마감 판정은 서버 시각 기준이며 클라이언트 시각을 신뢰하지 않는다.

## Tailwind CSS 4

`postcss.config.mjs`의 `@tailwindcss/postcss`를 사용하고 테마는 CSS의 `@theme`에서 정의한다. `tailwind.config.js`를 새로 만들지 않는다.

## 데이터

- Prisma Client는 항상 `import { prisma } from "@/lib/prisma"`로 가져온다. `new PrismaClient()`를 직접 호출하지 않는다.
- 생성 코드는 `prisma/generated/`에 있으며 Git에서 제외한다. 스키마 변경 후 `npm run db:generate`를 실행한다.
- Prisma 모델 `Promise`는 JS 전역 Promise와 이름이 겹친다. 생성된 클라이언트에서 타입으로 가져올 때는 항상 `import type { Promise as PromiseModel } from "@/prisma/generated/client"`처럼 별칭을 쓴다.
- 스키마 변경은 `npm run db:migrate -- --name <변경명>`으로 기록한다.
- 부분 UNIQUE 인덱스(`WHERE role='host'` 등)와 CHECK 제약처럼 Prisma 스키마로 표현할 수 없는 제약은 마이그레이션 SQL에 직접 작성한다 (`docs/architecture/DATABASE.md` 4절).
- 트랜잭션 범위와 잠금 순서는 `docs/architecture/DATABASE.md` 8절을 따른다. 모든 FK는 `ON DELETE RESTRICT`이며 CASCADE를 쓰지 않는다.
- 취소·탈퇴는 상태 변경으로 처리하고 데이터를 물리 삭제하지 않는다. 물리 삭제 예외는 DATABASE.md 10절의 draft 정리뿐이다.

## 파일 배치

| 경로                 | 역할                                                   |
| -------------------- | ------------------------------------------------------ |
| `app/`               | 페이지, 레이아웃                                       |
| `app/api/`           | Route Handler (API 명세 엔드포인트)                    |
| `components/<기능>/` | UI 컴포넌트                                            |
| `lib/prisma.ts`      | Prisma Client 싱글턴                                   |
| `lib/<도메인>/`      | 서버 전용 서비스 로직 (예: `lib/time/`, `lib/member/`) |
| `lib/`               | 공통 유틸리티                                          |
| `types/`             | 공유 타입                                              |
| `prisma/`            | 스키마와 마이그레이션                                  |

## 오류와 검증

예상 가능한 오류는 API 명세의 에러 코드로 반환하고, 원시 DB 오류·스택·비밀값을 응답에 노출하지 않는다. Next.js의 `redirect` 같은 제어 흐름을 일반 오류로 삼키지 않는다.

Vitest는 권한·입력 검증·상태 전이·후보 계산·시간 계산 같은 의미 있는 동작을 검증한다. 테스트는 대상 파일 옆에 `<이름>.test.ts`로 둔다. 단순 CSS 변경에 구현을 따라 쓴 테스트를 추가하지 않는다.

`npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`를 각각 실행한다. 빌드는 린트를 대신하지 않는다. UI가 생기면 실제 브라우저로 기본 흐름과 모바일 화면을 확인한다.
