// 클라이언트 IP 키 (035, DECISION_CONFLICTS R-41). 레이트 리밋과 PIN 시도 제한이 같은 키를 쓴다. 순수 함수
//
// - Vercel은 요청이 들어올 때 x-forwarded-for를 실제 접속 IP로 덮어쓴다(클라이언트가 보낸 값은 버린다).
//   그래서 첫 값을 쓴다. 없으면 x-real-ip(Vercel이 같은 값으로 채운다)
// - 로컬(next dev·next start)과 통합 테스트에는 앞단 프록시가 없다. 이때는 Next.js가 x-forwarded-for가 없으면
//   소켓 주소로 채운다(node_modules/next/dist/server/base-server.js) — 로컬은 루프백 주소(::1 → "0:0:0:0::/64",
//   127.0.0.1) 하나가 키가 된다. 두 헤더 모두 없거나 IP 형식이 아니면 한 키(UNKNOWN_IP_KEY)로 묶는다
//   — 제한을 끄지 않고 가장 엄하게(모두가 한 IP인 것처럼) 센다
// - Vercel 밖에 배포한다면 앞단 프록시가 x-forwarded-for를 덮어써야 한다(그대로 넘기면 클라이언트가 IP를 고를 수 있다)
// - IPv6는 앞 64비트(/64)로 묶는다. 한 가입자·기기가 보통 /64 하나를 받아 그 안의 주소를 마음대로 바꿀 수 있기 때문이다
//   IPv4가 들어 있는 IPv6(::ffff:a.b.c.d)는 IPv4로 본다

export const UNKNOWN_IP_KEY = "unknown";

export function clientIpKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || headers.get("x-real-ip")?.trim();
  return (raw && normalizeIp(raw)) || UNKNOWN_IP_KEY;
}

// IP 문자열 → 키. 형식이 아니면 null
export function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  // [IPv6]:포트
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracket) value = bracket[1];
  // IPv4:포트
  const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4port) value = v4port[1];

  const v4 = parseIpv4(value);
  if (v4) return v4.join(".");
  const v6 = parseIpv6(value);
  if (!v6) return null;
  // ::ffff:a.b.c.d
  if (v6.slice(0, 5).every((h) => h === 0) && v6[5] === 0xffff) {
    return [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff].join(".");
  }
  return `${v6
    .slice(0, 4)
    .map((h) => h.toString(16))
    .join(":")}::/64`;
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

// 16비트 8개. 형식이 아니면 null
function parseIpv6(input: string): number[] | null {
  const value = input.split("%")[0].toLowerCase(); // 영역 표시(%eth0)는 뺀다
  if (!value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;

  const groups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const items = part.split(":");
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      // 마지막 자리에 IPv4가 올 수 있다
      if (i === items.length - 1 && item.includes(".")) {
        const v4 = parseIpv4(item);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(item)) {
        out.push(parseInt(item, 16));
      } else {
        return null;
      }
    }
    return out;
  };

  const head = groups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = groups(halves[1]);
  if (!tail || head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}
