import { describe, expect, it } from "vitest";
import { allowedOrigins, inviteBaseUrl } from "./public-url";

// Vercel이 넣어 주는 시스템 환경변수는 스킴 없는 호스트다(예: yaksok-abc123-team.vercel.app)
const PREVIEW = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "yaksok-abc123-team.vercel.app",
  VERCEL_BRANCH_URL: "yaksok-git-ahn-feat-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "yaksok.vercel.app",
};
const PRODUCTION = {
  NEXT_PUBLIC_BASE_URL: "https://yaksok.vercel.app",
  VERCEL_ENV: "production",
  VERCEL_URL: "yaksok-def456-team.vercel.app",
  VERCEL_BRANCH_URL: "yaksok-git-main-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "yaksok.vercel.app",
};

describe("allowedOrigins", () => {
  it("로컬 개발: NEXT_PUBLIC_BASE_URL의 origin 하나", () => {
    expect(allowedOrigins({ NEXT_PUBLIC_BASE_URL: "http://localhost:3000/" })).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("미리보기: 그 배포의 주소(VERCEL_URL)와 브랜치 주소(VERCEL_BRANCH_URL)를 https로 허용한다", () => {
    expect(allowedOrigins(PREVIEW).sort()).toEqual([
      "https://yaksok-abc123-team.vercel.app",
      "https://yaksok-git-ahn-feat-team.vercel.app",
    ]);
  });

  it("미리보기는 운영 주소를 허용하지 않는다(NEXT_PUBLIC_BASE_URL을 넣었을 때만 포함)", () => {
    expect(allowedOrigins(PREVIEW)).not.toContain("https://yaksok.vercel.app");
    expect(
      allowedOrigins({ ...PREVIEW, NEXT_PUBLIC_BASE_URL: "https://yaksok.vercel.app" }),
    ).toContain("https://yaksok.vercel.app");
  });

  it("운영: NEXT_PUBLIC_BASE_URL과 운영 도메인만. 배포별·브랜치 주소는 허용하지 않는다", () => {
    expect(allowedOrigins(PRODUCTION)).toEqual(["https://yaksok.vercel.app"]);
    expect(
      allowedOrigins({ ...PRODUCTION, NEXT_PUBLIC_BASE_URL: "https://yaksok.example.com" }).sort(),
    ).toEqual(["https://yaksok.example.com", "https://yaksok.vercel.app"]);
  });

  it("비었거나 잘못된 값은 버린다(스킴·경로가 붙은 호스트, 빈 문자열)", () => {
    expect(
      allowedOrigins({
        NEXT_PUBLIC_BASE_URL: "",
        VERCEL_ENV: "preview",
        VERCEL_URL: "https://evil.example/x",
        VERCEL_BRANCH_URL: " ",
      }),
    ).toEqual([]);
    expect(allowedOrigins({ NEXT_PUBLIC_BASE_URL: "not a url" })).toEqual([]);
    expect(allowedOrigins({})).toEqual([]);
  });

  it("VERCEL_ENV가 없으면(로컬·CI) Vercel 주소 변수를 보지 않는다", () => {
    expect(
      allowedOrigins({ NEXT_PUBLIC_BASE_URL: "http://localhost:3000", VERCEL_URL: "x.vercel.app" }),
    ).toEqual(["http://localhost:3000"]);
  });
});

describe("inviteBaseUrl", () => {
  it("로컬·운영: NEXT_PUBLIC_BASE_URL 그대로(요청 출처와 관계없음)", () => {
    expect(inviteBaseUrl({ NEXT_PUBLIC_BASE_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
    expect(inviteBaseUrl(PRODUCTION, "https://yaksok.vercel.app")).toBe(
      "https://yaksok.vercel.app",
    );
  });

  it("운영에서 NEXT_PUBLIC_BASE_URL이 없으면 운영 도메인(VERCEL_PROJECT_PRODUCTION_URL)", () => {
    expect(inviteBaseUrl({ ...PRODUCTION, NEXT_PUBLIC_BASE_URL: undefined })).toBe(
      "https://yaksok.vercel.app",
    );
  });

  it("미리보기: 요청이 온 배포 주소로 만든다(배포별·브랜치 주소 모두)", () => {
    expect(inviteBaseUrl(PREVIEW, "https://yaksok-abc123-team.vercel.app")).toBe(
      "https://yaksok-abc123-team.vercel.app",
    );
    expect(inviteBaseUrl(PREVIEW, "https://yaksok-git-ahn-feat-team.vercel.app")).toBe(
      "https://yaksok-git-ahn-feat-team.vercel.app",
    );
  });

  it("미리보기: NEXT_PUBLIC_BASE_URL(운영 주소)이 들어 있어도 미리보기 주소가 우선한다", () => {
    expect(
      inviteBaseUrl(
        { ...PREVIEW, NEXT_PUBLIC_BASE_URL: "https://yaksok.vercel.app" },
        "https://yaksok-abc123-team.vercel.app",
      ),
    ).toBe("https://yaksok-abc123-team.vercel.app");
  });

  it("미리보기: 요청 출처가 없거나 이 배포 주소가 아니면 브랜치 주소, 없으면 배포 주소", () => {
    expect(inviteBaseUrl(PREVIEW)).toBe("https://yaksok-git-ahn-feat-team.vercel.app");
    expect(inviteBaseUrl(PREVIEW, "https://evil.example")).toBe(
      "https://yaksok-git-ahn-feat-team.vercel.app",
    );
    expect(inviteBaseUrl({ ...PREVIEW, VERCEL_BRANCH_URL: undefined })).toBe(
      "https://yaksok-abc123-team.vercel.app",
    );
  });

  it("화면(Vercel 주소 변수 없음): 미리보기면 현재 주소, 아니면 NEXT_PUBLIC_BASE_URL → 현재 주소", () => {
    expect(inviteBaseUrl({ VERCEL_ENV: "preview" }, "https://yaksok-abc123-team.vercel.app")).toBe(
      "https://yaksok-abc123-team.vercel.app",
    );
    expect(
      inviteBaseUrl(
        { VERCEL_ENV: "preview", NEXT_PUBLIC_BASE_URL: "https://yaksok.vercel.app" },
        "https://yaksok-abc123-team.vercel.app",
      ),
    ).toBe("https://yaksok-abc123-team.vercel.app");
    expect(inviteBaseUrl({}, "http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("아무 값도 없으면 null(서버는 링크를 만들지 않는다)", () => {
    expect(inviteBaseUrl({})).toBeNull();
    expect(inviteBaseUrl({ VERCEL_ENV: "preview" })).toBeNull();
  });
});
