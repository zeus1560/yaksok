import { setupStorageKey } from "@/lib/create-promise/countdown";

// 나가기·로그아웃 뒤 지울 이 약속의 브라우저 저장값 (028). 브라우저에서도 import하는 순수 함수다
// - 제출 전 입력 yaksok:availability:{promiseId}:{participantId} — 이 브라우저에서 같은 약속에 다른 닉네임으로
//   들어왔던 입력도 함께 지운다(쿠키는 약속마다 하나라 그 입력을 이어 쓸 세션이 없다)
// - 카운트다운 기준값 yaksok:setup:{inviteToken}
// 다른 약속의 저장값은 건드리지 않는다

export function promiseStorageKeys(
  existingKeys: readonly string[],
  promiseId: string,
  inviteToken: string,
): string[] {
  const draftPrefix = `yaksok:availability:${promiseId}:`;
  const setupKey = setupStorageKey(inviteToken);
  return existingKeys.filter((key) => key.startsWith(draftPrefix) || key === setupKey);
}
