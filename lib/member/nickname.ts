// 닉네임 검증 (MEMBER-05-01·05-03·05-04). 글자 수는 사용자가 보는 글자(grapheme) 단위로 센다
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

export type NicknameResult =
  { ok: true; nickname: string } | { ok: false; reason: "length" | "emoji" };

const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
const EMOJI = /\p{Extended_Pictographic}/u;

// trim → NFC. 조합형으로 들어온 같은 닉네임이 다른 값으로 저장되지 않게 한다 (DECISION_CONFLICTS R-10).
// NFKC는 쓰지 않는다: 호환 문자까지 바꿔 원문 보존·대소문자 구분 규칙과 충돌한다.
// MEMBER-API-03(중복 판정)·04(로그인)도 저장값과 비교하기 전에 이 함수를 거친다
export function normalizeNickname(input: string): string {
  return input.trim().normalize("NFC");
}

// 중간 공백·대소문자는 그대로 둔다. 반환값을 nickname과 normalized_nickname에 같이 저장한다
export function validateNickname(input: string): NicknameResult {
  const nickname = normalizeNickname(input);
  if (EMOJI.test(nickname)) return { ok: false, reason: "emoji" };

  const length = Array.from(segmenter.segment(nickname)).length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) return { ok: false, reason: "length" };

  return { ok: true, nickname };
}
