# 배포 전 정리 1

## 식별자와 상태

- 스펙 ID: `030-predeploy-cleanup-1`
- 상태: 검토 중 (구현·검증·커밋 완료, PR 대기)
- 문서 작성만으로 구현이나 검증을 완료 처리하지 않는다.

## 근거

- 스택·버전 규칙: `AGENTS.md` 「버전」(Prisma 3종 7.10.0 고정, 변경은 팀 합의), `docs/architecture/TECH_STACK.md` 「확정 버전」
- DB 연결: `docs/architecture/SETUP.md` 1-3·1-4, `lib/prisma.ts`(`@prisma/adapter-pg` → `pg`)
- 흔들리는 확인 항목: `context/fixes/001-availability-swr-join.md`, 029 메모(fix 회귀 20/21)
- 관련 미결·충돌: 없음

## 사용자와 문제

배포 전에 의존성 취약점(Next.js critical 포함), 느슨한 Prisma 버전 범위(`^7.10.0`), DB 연결 때마다 나오는 `sslmode` 경고, 서식이 맞지 않는 파일 79개, 네트워크에 따라 흔들리는 브라우저 확인 항목이 남아 있다.

## 목표와 범위

- 이번에 할 일 (기능 동작은 바꾸지 않는다)
  1. `npm audit` 정리: 패치·마이너 업데이트로 고칠 수 있는 것만 고친다. 메이저가 필요한 것은 목록으로 남긴다
  2. `prisma`·`@prisma/client`·`@prisma/adapter-pg`를 `package.json`에서 정확한 버전(7.10.0)으로 고정하고 generate·마이그레이션 상태를 확인한다
  3. `sslmode` 경고의 원인을 확인하고 `.env.example`·문서를 의도가 드러나는 값으로 고친다(`.env` 실제 값은 바꾸지 않는다)
  4. Prettier 전체 재포맷을 서식만 바꾸는 커밋 하나로 분리하고 그 해시를 `.git-blame-ignore-revs`에 넣는다
  5. `scripts/verify/fix-availability-intake.mjs`의 「재조율 뒤 3초 안에 채워짐」을 요청 순서 판정으로 바꾼다
- 하지 않을 일: PIN 시도 제한·레이트 리밋(팀 결정 대기), 확인 스크립트 저장소 이동·통합 테스트(다음 PR), 메이저 업데이트, Prisma 버전 변경

## 선행 작업

029(PR #34 병합). 029 완료 기록을 이 브랜치 첫 커밋에 넣는다.

## 수용 기준

- [x] AC-1: `npm audit`의 패치·마이너 수정분이 반영되고, 남은 취약점은 패키지·심각도·영향 기능·필요 버전과 고치지 않은 이유가 정리되어 있다
- [x] AC-2: Prisma 3종이 `^` 없이 7.10.0이고, 그 버전으로 `prisma generate`와 `prisma migrate status`(최신)가 확인된다
- [x] AC-3: `sslmode=require`가 지금 어떻게 해석되는지(경고 원문·`pg` 8 동작·`pg` 9 변경) 확인하고, 같은 동작을 명시하는 값(`verify-full`)이 앱(`pg`)과 Prisma CLI 양쪽에서 동작함을 `.env`를 바꾸지 않고 확인한다
- [x] AC-4: 재포맷 커밋은 서식만 바꾼다(코드 파일 AST·주석 동일), 재포맷 전후 test·lint·typecheck 결과가 같다
- [x] AC-5: 새 판정이 `main` 코드와 이 브랜치 코드에서 각각 10회 연속 통과하고, fix 001 이전 동작을 흉내 내면 실패한다
- [x] AC-6: 항목마다 test·lint·typecheck, 마지막에 build·`TZ=UTC`·`America/Los_Angeles` test, 027·028 브라우저 회귀, 확인 데이터 삭제·DB 원상 복구·dev 서버 종료

## 구현 계획

1. `next`·`eslint-config-next` 16.3.5 → 16.4.6(마이너), 전이 의존성 `npm update`(`fast-uri`·`zod`·`typescript-eslint` 계열). Next 16.4.6 `next dev`가 다시 만든 `AGENTS.md` 상단 블록도 같은 커밋
2. `package.json` Prisma 3종 `^` 제거
3. `.env.example`·`SETUP.md`의 `sslmode=verify-full`
4. `npx prettier --write .` → 다음 커밋에서 `.git-blame-ignore-revs`
5. 확인 스크립트(Git 제외 파일) 5번 수정

## 검증 계획

- 항목마다 `npm run test`·`lint`·`typecheck`
- 4: 재포맷 전후 결과 비교, TypeScript AST·주석 비교 스크립트
- 5: 새 판정 RED(합류 응답 무시를 임시로 넣음) → `main` 작업 트리 10회·이 브랜치 10회
- 마지막: `npm run build`(3000 포트 확인 뒤), PowerShell `$env:TZ` 두 값으로 test, 027·028 회귀 스크립트

## 미정 사항

- Prisma 7.10.1(취약점 수정분 포함) 업데이트 여부 — `AGENTS.md`상 팀 합의 필요
- `typescript-eslint`(→ `minimatch` 11 필요)는 상위 패키지 수정 대기

## 결과

검증 근거는 `context/current-feature.md` 참고.
