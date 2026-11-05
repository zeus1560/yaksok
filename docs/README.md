# yaksok 개발 문서

> Notion 원본에서 추출: 2026-10-30
> 원본 워크스페이스: https://app.notion.com/p/39f7085f318280cc929be4cdf17b76a6

## 문서 우선순위 (충돌 시 이 순서로 따른다)

```
1. docs/specs/rules/     비즈니스 규칙   ← 최상위 기준
2. docs/architecture/DATABASE.md   ERD
3. docs/specs/api/       API 명세
4. docs/product/PRD.md   PRD            ← 가장 나중
```

PRD는 제품 비전 문서다. 구현 세부가 PRD와 비즈니스 규칙에서 다르면 **비즈니스 규칙이 맞다.**

## 에이전트가 지켜야 할 3가지

1. **MVP 범위 밖을 구현하지 않는다.** 카카오 로그인, 톡캘린더, 위치·중간지점, 장소 추천·투표는 전부 MVP 이후다. `docs/product/MVP_SCOPE.md` 참고.
2. **❗미결 표시된 규칙을 임의로 결정하지 않는다.** 구현이 막히면 멈추고 사람에게 묻는다. 현재 전체 규칙 153개 중 **79개가 미결**이다.
3. **문서 간 불일치를 발견하면 `docs/development/DECISION_CONFLICTS.md`를 먼저 확인한다.** 이미 알려진 충돌이면 거기 적힌 판단을 따르고, 새로운 충돌이면 그 파일에 추가한다.

## 목차

### product — 무엇을 만드는가
| 파일 | 내용 |
| --- | --- |
| `product/PRD.md` | 제품 요구사항 전문 (2026-10-30 정합화 개정본) |
| `product/MVP_SCOPE.md` | MVP 범위 안/밖 + 핵심 제약값 |
| `product/user-stories/USER_STORIES.md` | User Story 32개 (MVP 16 / 후속 16) |

### architecture — 어떻게 만드는가
| 파일 | 내용 |
| --- | --- |
| `architecture/DATABASE.md` | ERD 신버전. 테이블 5개, DB 제약, 트랜잭션·잠금 규칙, 검증 체크리스트 36개 |
| `architecture/TECH_STACK.md` | 확정 버전, 아키텍처, 외부 API, 카카오 챗봇 |
| `architecture/SETUP.md` | 팀원 온보딩, 개발 규칙, 자주 터지는 오류 |

### specs — 정확히 무엇이 규칙인가
| 파일 | 내용 |
| --- | --- |
| `specs/rules/MEMBER.md` | 참여·역할·권한 38개 |
| `specs/rules/STATE.md` | 약속 상태 전환 27개 |
| `specs/rules/TIME.md` | 시간·입력·마감 40개 |
| `specs/rules/RESULT.md` | 후보 계산·확정 25개 |
| `specs/rules/EXCEPTION.md` | 예외·동시 처리 23개 |
| `specs/API_CONVENTIONS.md` | API 공통 규약 (인증, 에러 포맷, 시간 표기) |
| `specs/api/member.md` | MEMBER API 8개 |
| `specs/api/state.md` | STATE API 11개 |
| `specs/api/time.md` | TIME API 2개 + 동기화 흐름 |

### development — 작업 전 확인
| 파일 | 내용 |
| --- | --- |
| `development/DECISION_CONFLICTS.md` | **착수 전 필독.** 미결·모순 전수 목록 |
| `development/SOURCE_REGISTRY.md` | Notion 원본 링크 색인 |

## MVP 한 줄 정의

약속 생성 → 참여자 등록(닉네임+PIN) → 30분 슬롯 시간 조율 → 후보 추천 → **방장 수동 확정**

자동 확정은 없다. 전원이 제출해도 자동 마감하지 않는다.
