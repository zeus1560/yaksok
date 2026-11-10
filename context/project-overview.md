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

## 현재 상태

개발 환경과 CI는 구축되어 있다. `prisma/schema.prisma`는 ERD 신버전 5개 테이블로 교체되었고, CHECK와 부분 UNIQUE 인덱스는 `erd_v2` 마이그레이션 SQL에 있다. 제품 기능 구현은 아직 시작하지 않았다.
