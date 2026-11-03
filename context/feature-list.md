# 기능 스펙 목록

`context/features/`의 스펙과 진행 상태를 정리한다. 스펙을 작성한 것과 구현을 완료한 것을 구분한다.

| 순서 | 스펙 ID | 기능 | 스펙 | 선행 스펙·이유 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 1 | 001-link-issue-api | 웹 초대 링크 발급 (MEMBER-API-09) | `context/features/001-link-issue-api.md` | 없음 | 완료 |
| 2 | 002-link-lookup-api | 초대 링크 조회 (MEMBER-API-01) | `context/features/002-link-lookup-api.md` | 001 — 에러 헬퍼·토큰 형식 재사용 | 완료 |
| 3 | 003-host-registration-api | 방장 등록 (MEMBER-API-02) | `context/features/003-host-registration-api.md` | 002 — `resolveLinkStatus` 재사용, 001 — Origin·에러 헬퍼 | 완료 |
