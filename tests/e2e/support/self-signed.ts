// 테스트 전용 localhost 자체 서명 인증서(RSA 2048, SHA-256, 30일). 외부 도구 없이 node:crypto와 DER 조립으로 만든다
// 로컬 https 프록시(serve.ts)만 쓴다. 브라우저는 ignoreHTTPSErrors로 받는다
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
}
const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);
const set = (...parts: Buffer[]) => tlv(0x31, ...parts);
function oid(text: string): Buffer {
  const [a, b, ...rest] = text.split(".").map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
const utcTime = (d: Date) =>
  tlv(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, "")}Z`));

export function createLocalhostCertificate(): { cert: string; key: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sha256WithRsa = seq(oid("1.2.840.113549.1.1.11"), Buffer.from([0x05, 0x00]));
  const name = seq(set(seq(oid("2.5.4.3"), utf8("localhost"))));
  const now = Date.now();
  const serial = randomBytes(8);
  serial[0] &= 0x7f;
  const san = seq(
    tlv(0x82, Buffer.from("localhost")), // dNSName
    tlv(0x87, Buffer.from([127, 0, 0, 1])), // iPAddress
  );
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), // v3
    tlv(0x02, serial),
    sha256WithRsa,
    name,
    seq(utcTime(new Date(now - 86400e3)), utcTime(new Date(now + 30 * 86400e3))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(seq(oid("2.5.29.17"), tlv(0x04, san)))),
  );
  const signature = sign("sha256", tbs, privateKey);
  const der = seq(tbs, sha256WithRsa, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  const cert = `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
  // 형식이 틀리면 여기서 바로 실패한다
  if (!new X509Certificate(cert).verify(publicKey)) throw new Error("자체 서명 인증서 검증 실패");
  return { cert, key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
