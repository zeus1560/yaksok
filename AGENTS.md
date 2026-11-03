<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# yaksok — 약속 잡기 도우미

## 프로젝트

카카오톡 채팅방에서 봇 호출 → 웹 링크 → 다인원 약속(날짜·시간) 조율.
최대한 빠른 MVP 개발과 배포가 목표.

## 스택 (임의로 바꾸지 말 것)

- Next.js 16 App Router + TypeScript (웹과 챗봇 API를 한 프로젝트에서)
- Prisma 7 + @prisma/adapter-pg + PostgreSQL (Neon)
- Tailwind CSS 4

## 버전

- `prisma`, `@prisma/client`, `@prisma/adapter-pg`는 모두 7.10.0으로 고정한다.
- 버전 변경은 팀 합의 후 진행한다.

## Prisma 사용 규칙

- Prisma CLI 설정은 `prisma7.config.ts`에서 관리한다.
- DB 연결 문자열은 환경변수에서 읽는다. 코드에 실제 값을 직접 작성하지 않는다.
- `schema.prisma`에는 DB URL을 작성하지 않는다.
- generator provider는 `prisma-client`, output은 `../prisma/generated`.
- `lib/prisma.ts`에서 PrismaPg에 연결 문자열을 전달해 PrismaClient를 생성한다.
- 다른 파일에서는 `@/lib/prisma`의 싱글턴만 import한다.

## DB와 마이그레이션

- 개발·운영 DB는 별도의 Neon 브랜치 또는 프로젝트로 분리한다.
- 개발자마다 자기 개발 DB를 사용한다.
- 개발 DB의 스키마 변경은 `prisma migrate dev`로 마이그레이션 파일을 남긴다.
- 운영 DB에는 커밋된 마이그레이션을 `prisma migrate deploy`로 적용한다.
- `db push`는 사용하지 않는다.
- 리셋은 삭제 가능한 개인 개발 DB에 한해 허용한다.
- 공유 개발 DB의 리셋은 팀원과 협의하고, 운영 DB는 리셋하지 않는다.

## 비밀값

- 로컬 비밀값은 `.env`에, 배포 비밀값은 호스팅 서비스의 환경변수에 보관한다.
- 비밀값을 코드·커밋·클라이언트 번들에 포함하지 않는다.
- `.env.example`에는 변수 이름과 비밀이 아닌 예시값만 작성한다.

## 도메인 규칙

- Timestamptz(3) 저장 + 날짜 경계는 항상 Asia/Seoul 명시. daily_start_minute은 분 단위 SMALLINT
- 카카오 스킬 응답은 5초 안에 끝낸다. 오래 걸리는 작업은 분리한다.
- 약속 관리자 권한과 참여 링크 권한을 분리한다.
  참여 링크만으로 관리자 권한을 얻을 수 없어야 한다.

## 현재 상태

- ERD 확정. (5개 테이블)

## 커밋

`feat|fix|chore|docs|refactor|test: 한 줄 요약` (한국어)
