import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// 공통 화면 조각 (Figma Buttons 0:1, Form fields 5:73, Feedback 7:76 기준)

export function Header() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
        <Link href="/" className="text-lg font-bold text-ink">
          ✓ 약속 잡기
        </Link>
      </div>
    </header>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-paper p-6 sm:p-7 ${className}`}>
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "dark";
};

const VARIANT = {
  primary: "bg-blue text-white hover:bg-ink disabled:bg-line disabled:text-sub",
  secondary: "border border-line bg-paper text-ink hover:bg-faint disabled:text-sub",
  dark: "bg-text text-white",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    />
  );
}

export function FieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-danger">
      {message}
    </p>
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
    <Card className="mx-auto max-w-lg">
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="mt-2 text-sub">{body}</div>
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}
