@AGENTS.md

# 작업 규칙

위 `AGENTS.md`(스택·Prisma·DB·비밀값·도메인 규칙)와 함께 읽는다. 여기에는 기능이 바뀌어도 유효한 내용만 둔다.

**진행 상태와 다음 작업은 `context/current-feature.md`와 `context/feature-list.md`를 따른다.**

## 1. 프로젝트 목표

앱 설치 없이 링크만으로 여러 사람의 공통 가능 시간을 찾는 그룹 일정 조율 웹 서비스다. 주 사용자는 카카오톡을 쓰는 대학 스터디·동아리다. 빠른 MVP 개발과 배포가 목표다.

MVP 흐름: 약속 생성 → 참여자 등록(닉네임 + PIN) → 30분 슬롯 시간 조율 → 후보 추천 → **방장 수동 확정**.

- 자동 확정이 없고, 전원이 제출해도 자동 마감하지 않는다.
- 카카오 로그인, 톡캘린더, 위치·중간지점, 장소 추천·투표는 MVP 밖이다(`docs/product/MVP_SCOPE.md`).
- ❗미결 규칙은 임의로 정하지 않는다. 막히면 멈추고 사람에게 묻는다.
- 문서끼리 충돌할 때 우선순위: `docs/specs/rules/` > `docs/architecture/DATABASE.md` > `docs/specs/api/` > PRD.
- 충돌을 발견하면 `docs/development/DECISION_CONFLICTS.md`를 먼저 확인한다. 이미 있으면 그 판단을 따르고, 새로운 충돌이면 그 파일에 추가한다.

## 2. 전체 구조

경로별 역할(`app/`·`components/`·`lib/<기능>/`·`prisma/`·`docs/`·`context/`·`.claude/skills/`)은 `context/project-overview.md`의 「코드 구조」를 본다. 구현된 API와 남은 기능은 `context/feature-list.md`를 본다.

## 3. 실행·빌드·테스트

Windows, Node.js 24(`.nvmrc`)를 쓴다. 명령은 저장소 루트에서 실행한다.

```bash
npm install
cp .env.example .env      # DATABASE_URL에 본인 Neon 개발 DB 주소를 넣는다. DIRECT_URL은 선택이다
npm run db:generate       # prisma generate
npm run db:deploy         # 개발 DB에 커밋된 마이그레이션을 적용한다
npm run dev               # http://localhost:3000

npm run test              # Vitest (Windows는 PowerShell에서 실행)
npm run test:e2e          # 통합 테스트(Playwright). .env.e2e 필요, dev 서버를 끈 뒤 실행한다
npm run lint
npm run typecheck         # next typegen && tsc --noEmit
npm run build             # prisma generate && next build. dev 서버를 끈 뒤 실행한다
```

- 스키마를 바꿀 때는 `npm run db:migrate -- --name <변경명>`을 쓴다. `db push`는 쓰지 않는다.
- CI는 `.github/workflows/ci.yml`에 있다. CI 빌드는 가짜 DB 주소로 돌기 때문에 DB를 읽는 페이지는 동적 렌더링이어야 한다.
- 배포(Vercel + Neon, 미리보기 DB 마이그레이션, `@smoke` 확인, 함수 지역)는 `docs/architecture/DEPLOY.md`를 따른다. 스키마가 바뀌는 브랜치는 push 전에 `npm run db:deploy:preview`를 먼저 실행한다.
- 통합 테스트(`tests/e2e/`, `.env.e2e`)는 `docs/architecture/SETUP.md` 4-5, 확인 스크립트(`scripts/verify/`)와 개발 DB 확인 데이터 정리는 4-6을 따른다.

## 4. 설계 원칙

- **화면용 순수 로직은 `lib/<기능>/`에 두고 브라우저에서도 import한다.** 서버 검증에 쓰는 순수 함수와 상수(`lib/state/start-settings.ts`, `lib/time/seoul.ts`, `lib/member/nickname.ts` 등)를 재사용해서 화면 검증과 서버 검증 값이 어긋나지 않게 한다.
- **화면의 실패 분기는 HTTP 상태가 아니라 에러 코드로 한다.** 같은 403이라도 `INVALID_ORIGIN`(다시 시도)과 `FORBIDDEN`(권한 없음)은 처리가 다르다.
- **시간과 권한의 최종 판정은 서버가 한다.** 화면은 기기 시계나 브라우저 저장값으로 권한·만료를 확정하지 않고, 서버 응답(예: 410 `DRAFT_EXPIRED`)을 따른다.
- **API 공통 규칙:**
  - 모든 API 응답에 `Cache-Control: no-store`를 붙인다.
  - 시각은 `+09:00` 표기다.
  - DB 시각은 `clock_timestamp()`로 읽는다.
  - 잠금 순서는 links → promises `FOR UPDATE`다.
  - 세션 인증 순서는 `session-auth.ts`를 따르고, 인증 성공 뒤 모든 응답에서 쿠키를 갱신한다.
  - PIN은 scrypt(N=2^15)로 저장한다.
  - 기능별 세부 결정은 `docs/development/DECISION_CONFLICTS.md`의 R 항목과 각 스펙에 있다.

## 5. 작업 시 주의

- **Windows 인코딩:** PowerShell `Get-Content`를 옵션 없이 쓰면 한글이 깨진다. `-Encoding utf8`을 붙이거나 Read 도구를 쓴다.
- **dev 서버:** `npm run build`와 `npm run test:e2e` 전에 dev 서버를 반드시 끈다. 둘 다 같은 `.next`에 운영 빌드를 만들어 dev 서버가 500을 낸다. `test:e2e` 뒤 배포용 빌드가 필요하면 `npm run build`를 다시 돌린다. 작업이 끝나면 3000·3100·3101 포트와 남은 `next` 프로세스를 정리한다.
- **통합 테스트 결과 보존:** 다시 돌릴 때 이전 결과 폴더를 덮어쓰지 않는다(`SETUP.md` 4-5).
- **Vitest는 PowerShell에서:** Git Bash(경로가 소문자 `c:`)에서 `npm run test`를 돌리면 Vitest가 모듈을 두 번 읽어 모든 파일이 `Cannot read properties of undefined (reading 'config')`로 실패한다. PowerShell에서 실행한다.
- **DB 확인 데이터:** 확인 뒤 지우고 스냅샷을 비교한다(`SETUP.md` 4-6). 운영 DB로는 테스트하지 않는다.
- **Prisma 타입 이름:** 모델 `Promise`는 전역 Promise와 이름이 겹친다. `import type { Promise as PromiseModel } from "@/prisma/generated/client"`처럼 별칭을 쓴다.
- **Git 규칙:**
  - 원격: `origin` = 개인 저장소 `zeus1560/yaksok`(작업 브랜치를 push, Vercel 연결), `team` = 팀 저장소 `yeonseong0224/yaksok`(2026-11-12까지의 이력과 옛 `ahn/` 브랜치). 새 브랜치는 `origin/main`에서 만든다.
  - 브랜치 이름은 `<이름>/<타입>-<영어 설명>` 형식이다(예: `ahn/feat-preview-deploy`). 한글은 Vercel 브랜치 주소에서 지워져 브랜치끼리 주소가 겹친다(`DEPLOY.md` 8절). 이미 만든 한글 브랜치는 그대로 둔다.
  - `main`에 직접 커밋하지 않는다.
  - 커밋과 푸시는 사용자가 요청할 때만 한다.
  - 커밋에 AI 공동 작성자 표시를 넣지 않는다.
  - 보고와 PR 본문은 한국어로 쓴다.
- **`AGENTS.md` 상단 Next.js 블록:** `next dev`가 자동으로 다시 만든다. 지우지 않는다.

## 6. 세션 운영 규칙

진행 기록 파일은 `context/current-feature.md`(현재 기능과 완료 이력)와 `context/feature-list.md`(남은 기능)이다.

- 한 세션에서는 한 가지 작업 단위(기능 하나, 버그 하나 등)만 처리한다.
- 작업 범위가 크면 시작 전에 작은 단위로 나눈 계획을 제시하고, 첫 단위만 진행한다.
- 코드를 탐색할 때는 필요한 파일만 열고, 레포 전체를 훑지 않는다.
- 코드를 찾거나 수정할 때는 파일 전체를 읽기보다 Serena의 심볼 단위 도구를 우선 사용한다.
- 작업 단위가 끝나면 진행 기록 파일을 갱신한 뒤 "이 작업은 끝났습니다. 새 세션에서 이어가세요."라고 알리고, 다음 작업을 이어서 시작하지 않는다.
- 새 세션은 CLAUDE.md와 진행 기록 파일을 먼저 읽고 이어서 시작한다.
