import { useSyncExternalStore } from "react";

// 화면 조건 훅. 서버 렌더와 첫 하이드레이션은 getServerSnapshot 값을 쓴다

function useMedia(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

// 터치가 주 입력인 기기(손가락으로 쓰는 화면, 033). 서버는 false(「드래그로 선택」 버튼 없음)
export function useCoarsePointer(): boolean {
  return useMedia("(pointer: coarse)", false);
}

// 한 그리드만 보이는 좁은 화면(Tailwind lg 64rem 미만 — 「내 시간」·「모두의 시간」 탭, 034).
// 서버는 넓은 화면으로 본다. 시간 입력 화면은 조회 응답을 받은 뒤(하이드레이션 뒤)에 그리드를 그린다
export function useNarrow(): boolean {
  return !useMedia("(min-width: 64rem)", true);
}
