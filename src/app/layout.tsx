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
      <body className="min-h-full flex flex-col">
        {children}
        <BottomNav />
        <GeoPrompt />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
