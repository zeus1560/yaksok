import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// PIN 해시 (MEMBER-06-01). 저장 형식: scrypt$N$r$p$salt$hash (salt·hash는 base64url)
// N=2^15, r=8, p=1 (요청당 메모리 32MiB). OWASP 최소값(N=2^17)보다 의도적으로 낮췄다.
// PIN은 1만 조합이라 해시 강도로는 유출 시 대입을 막지 못하고, 128MiB는 동시 요청·로그인 반복에서
// 메모리 부족과 서비스 거부 위험이 된다. 실제 방어는 시도 제한(MEMBER-06-04)이 맡는다 (DECISION_CONFLICTS R-10)
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
// 기본값 32MiB는 N=2^15·r=8에 필요한 128·N·r 바이트와 같아 거절되므로 명시한다
const MAXMEM = 64 * 1024 * 1024;

export function isPinFormat(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}

function derive(pin: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: MAXMEM };
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(pin, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

// MEMBER-API-04에서 재사용한다. 저장된 매개변수로 다시 계산하므로 N을 올려도 기존 해시를 검증할 수 있다
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((value) => Number.isSafeInteger(value) && value > 0)) return false;

  const expected = Buffer.from(parts[5], "base64url");
  const actual = await derive(pin, Buffer.from(parts[4], "base64url"), n, r, p);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
