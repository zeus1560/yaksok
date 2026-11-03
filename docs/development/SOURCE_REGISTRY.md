# Notion 원본 색인

> 추출일: 2026-10-30
> 문서를 고칠 때는 **Notion 원본과 이 md를 함께** 수정해야 한다. 한쪽만 고치면 다음 추출 때 되돌아간다.

## 루트
| 문서 | Notion |
| --- | --- |
| yaksok (워크스페이스 루트) | https://app.notion.com/p/39f7085f318280cc929be4cdf17b76a6 |
| 문서 구조 | https://app.notion.com/p/4067085f31828038bc8dcea69375316f |

## 스펙 → `docs/product/`
| 문서 | Notion | 변환 |
| --- | --- | --- |
| PRD | https://app.notion.com/p/39f7085f318280cf8399fd2b34379762 | `product/PRD.md`, `product/MVP_SCOPE.md` |
| USER STORY (Backlog) | https://app.notion.com/p/3d37085f318280049b7ae8c6f4b2e6f2 | `product/user-stories/USER_STORIES.md` |

## 설계 → `docs/specs/`, `docs/architecture/`
| 문서 | Notion | 변환 |
| --- | --- | --- |
| 비즈니스 규칙 (DB) | https://app.notion.com/p/3f07085f3182804f899bca7d4cb28eb6 | `specs/rules/*.md` |
| ├ 참여 역할 권한 | `collection://c707085f-3182-82a5-8d58-07b33aee27ec` | `specs/rules/MEMBER.md` |
| ├ 약속 상태 전환 | `collection://5e37085f-3182-8232-9ca0-07d1ba34ff47` | `specs/rules/STATE.md` |
| ├ 시간·입력·마감 | `collection://3d37085f-3182-8261-b23d-872dfcbfe16c` | `specs/rules/TIME.md` |
| ├ 후보 계산 확정 | `collection://f877085f-3182-8225-8110-07371700024e` | `specs/rules/RESULT.md` |
| └ 예외 동시 처리 | `collection://2427085f-3182-82a1-9e5b-8787bb98f04a` | `specs/rules/EXCEPTION.md` |
| ERD (신버전) | https://app.notion.com/p/3f87085f318280dc973cf9f53bca34b5 | `architecture/DATABASE.md` |
| API (인덱스) | https://app.notion.com/p/39f7085f318280c7bb4ec9ce564d1c75 | — |
| ├ api 명세서 DB | `collection://82e7085f-3182-83bf-8087-87722e2873d5` | `specs/api/member.md`, `specs/api/state.md`, `specs/API_CONVENTIONS.md` |
| └ 승주 time api | https://app.notion.com/p/3f67085f3182808f9426e749d11d0aac | `specs/api/time.md` |
| └ api 명세서 (3) | `collection://d967085f-3182-83a9-93cb-871cd27eb497` | `specs/api/time.md` |

## 환경 → `docs/architecture/`
| 문서 | Notion | 변환 |
| --- | --- | --- |
| 기술 스택 | https://app.notion.com/p/3db7085f3182802099efd9da83c2d965 | `architecture/TECH_STACK.md` |
| 환경 설정 | https://app.notion.com/p/3db7085f3182802f9d7bcb4578320e9a | `architecture/SETUP.md` |
| DOCKER 설정 | https://app.notion.com/p/3db7085f318280ff87b0ce98d2421710 | 무효 (Neon 전환으로 Docker 미사용) |
| 카카오 챗봇 | https://app.notion.com/p/3e97085f3182803abc65ea7dccc9e0d4 | `architecture/TECH_STACK.md` |

## 미변환 (이번 추출 범위 밖)
| 문서 | Notion | 사유 |
| --- | --- | --- |
| 와이어프레임 | https://app.notion.com/p/3f17085f3182803d9a91ffe50617e7f1 | 이미지 중심, md 변환 부적합 |
| 이슈 DB | https://app.notion.com/p/3b97085f31828046915cd881a5a18206 | 운영 중인 트래커 |
| API Ticket | https://app.notion.com/p/3f17085f31828011b103cae550828b25 | 작업 관리용 |
| 벤치마킹 분석 | https://app.notion.com/p/3b07085f318280a5bf58ebc465acb57b | 기획 단계 산출물 |
| 아이디어 / 페르소나 / SWOT / 기대효과 | 루트 페이지 참고 | 기획 단계 산출물 |
