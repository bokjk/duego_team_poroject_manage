import type { Metadata } from "next";
import "./globals.scss";

export const metadata: Metadata = {
  title: "Plane 대시보드",
  description: "Plane 프로젝트 관리 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <div className="app-shell">
          <header className="app-topbar">
            <div className="app-topbar__title">Plane 대시보드</div>
            <div className="app-topbar__subtitle">연구개발본부</div>
          </header>
          <main className="app-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
