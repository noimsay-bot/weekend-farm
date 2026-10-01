import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/BottomNav";
import { GeoPrompt } from "@/components/GeoPrompt";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: "주말텃밭",
  description: "주말텃밭 계획·기록·알림",
  appleWebApp: { capable: true, title: "주말텃밭" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#3f7d3a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* 글꼴 CSS를 앱 CSS 안에서 @import하면 내려받기가 한 단계 늦어져 첫 화면이 느리다. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <BottomNav />
        <GeoPrompt />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
