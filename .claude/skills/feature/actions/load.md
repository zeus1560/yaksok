# 기능 불러오기

1. 인수가 파일이면 `context/features/`에서 정확한 경로 또는 이름으로 찾는다. 수정 기록을 지정했다면 `context/fixes/` 문서를 사용한다. 후보가 여러 개면 임의로 선택하지 않는다.
2. 인수가 자연어 요구사항이면 `context/features/_template.md`를 바탕으로 스펙을 작성한다. 이때 `docs/specs/rules/`, `docs/architecture/DATABASE.md`, `docs/specs/api/`에서 관련 규칙 ID를 찾아 근거로 연결한다. 근거를 찾지 못한 요구사항은 그렇다고 표시한다. 인수가 없으면 파일명 또는 설명을 요청한다.
3. `docs/product/MVP_SCOPE.md`로 범위 안인지 확인한다. 범위 밖이면 스펙을 만들지 않고 알린다.
4. 근거 규칙 중 ❗미결이 있거나 `docs/development/DECISION_CONFLICTS.md`에 걸린 항목이 있으면 미정 사항에 ID와 함께 적는다.
5. `context/current-feature.md`의 현재 작업 영역을 갱신한다. 상태는 `대기`, 스펙은 실제 상대 경로로 기록한다. 완료 이력은 그대로 둔다. `context/feature-list.md`에 없으면 추가한다.
6. 불러온 기능, 수용 기준, 미정 사항을 요약한다. 불러오기만 요청받았다면 구현을 시작하지 않는다.
