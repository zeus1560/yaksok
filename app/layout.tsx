import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "약속 잡기",
  description: "링크 하나로 여러 사람이 함께 가능한 시간을 찾아요",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
