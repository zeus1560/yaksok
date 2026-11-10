import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IdentityLabel, IdentityProvider } from "./identity";

// 공통 화면 조각 (Figma Buttons·Form fields·Feedback 컴포넌트 기준, 029에서 PNG 측정값으로 맞춤)
// 색·크기·모서리는 app/globals.css 토큰만 쓴다

export function Header() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:h-header sm:px-6">
        <Link href="/" className="shrink-0 text-xl font-bold text-ink">
          ✓ 약속 잡기
        </Link>
        <IdentityLabel />
      </div>
    </header>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <IdentityProvider>
      <Header />
      <main className="mx-auto w-full max-w-page flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>
    </IdentityProvider>
  );
}

// 카드. center: 화면 가운데 카드 하나(완료·참여·안내 화면) — 폭 600px, 헤더 아래 80px 띄움
export function Card({
  children,
  className = "",
  center = false,
}: {
  children: ReactNode;
  className?: string;
  center?: boolean;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-paper p-6 sm:p-8 ${
        center ? "mx-auto max-w-card sm:mt-10" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

// 참여 뒤 화면의 칸. PANEL_BOX는 모양만, PANEL은 페이지 폭 가운데 정렬까지(방장 메뉴·명단·후보·결과·내 참여)
// 그리드·나란히 놓인 칸 안에서는 PANEL_BOX를 쓴다(mx-auto가 칸 폭을 내용 폭으로 줄인다)
export const PANEL_BOX = "rounded-card border border-line bg-paper";
export const PANEL = `mx-auto max-w-page ${PANEL_BOX}`;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "dark" | "danger";
};

// 기본 #4063d8 → 눌림·hover #294baf, 비활성 #eef2f8 + #68758a, 위험 #b63838, 포커스 2px #4063d8
const VARIANT = {
  primary: "bg-blue text-white hover:bg-ink active:bg-ink",
  secondary: "border border-line bg-paper text-ink hover:bg-faint active:bg-blue-soft",
  dark: "bg-text text-white",
  danger: "bg-danger text-white hover:bg-danger/90 active:bg-danger/80",
};

export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2";

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-control w-full items-center justify-center rounded-control px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:bg-muted disabled:text-sub ${FOCUS_RING} ${VARIANT[variant]} ${className}`}
    />
  );
}

// 아이콘 버튼 44×44 (‹ › ✕)
export function IconButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex size-icon shrink-0 items-center justify-center rounded-field border border-line bg-paper text-lg text-ink hover:bg-faint active:bg-blue-soft disabled:cursor-not-allowed disabled:text-sub/40 disabled:hover:bg-paper ${FOCUS_RING} ${className}`}
    />
  );
}

// 입력란 52px. 글자는 휴대폰에서 16px(14px 이하면 iOS가 화면을 확대한다), 넓은 화면에서 14px
export const FIELD =
  "h-field w-full rounded-field border border-line bg-paper px-4 text-base outline-none focus:border-blue aria-invalid:border-danger aria-invalid:text-danger disabled:bg-muted disabled:text-sub sm:text-sm";

export function FieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs text-danger">
      {message}
    </p>
  );
}

// 안내 (Figma Notice): info 파랑, attention 회색 바탕 + 진한 글자(주의), error 회색 바탕 + 빨강 글자
export type NoticeTone = "info" | "attention" | "error";

const NOTICE_TONE: Record<NoticeTone, string> = {
  info: "bg-blue-soft text-ink",
  attention: "bg-muted text-text",
  error: "bg-muted text-danger",
};

export function Notice({
  tone = "info",
  children,
  onClose,
  closeLabel = "안내 닫기",
  className = "",
  role,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  role?: "alert" | "status" | "note";
}) {
  return (
    <div
      role={role}
      className={`flex items-start justify-between gap-3 rounded-field px-4 py-3 text-sm ${NOTICE_TONE[tone]} ${className}`}
    >
      <div className="min-w-0">{children}</div>
      {onClose && (
        <button
          type="button"
          aria-label={closeLabel}
          className="shrink-0 opacity-70 hover:opacity-100"
          onClick={onClose}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// 배지 (Figma Badge): 모서리 8px 사각. status는 약속 상태 표시(높이 36px), 그 밖은 줄 안의 작은 표시
export type BadgeTone = "blue" | "muted" | "danger";

const BADGE_TONE: Record<BadgeTone, string> = {
  blue: "bg-blue-soft text-ink",
  muted: "bg-muted text-sub",
  danger: "bg-muted text-danger",
};

export function Badge({
  tone = "blue",
  size = "sm",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  size?: "sm" | "status";
  children: ReactNode;
  className?: string;
}) {
  const sizing =
    size === "status" ? "h-9 min-w-24 justify-center px-4 text-xs" : "px-2 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-field font-medium ${sizing} ${BADGE_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// 404·410·대기·임시 화면에 쓰는 안내 카드 (Figma 35:2666)
export function NoticeCard({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card center>
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="mt-2 text-sub">{body}</div>
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}

// 링크로 된 보조 버튼 (처음으로·새 약속 만들기)
export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex h-control w-full items-center justify-center rounded-control border border-line bg-paper text-sm font-medium text-ink hover:bg-faint ${FOCUS_RING}`}
    >
      {children}
    </Link>
  );
}
