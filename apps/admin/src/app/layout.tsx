import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "稽核 AI 助手主管后台",
  description: "茶饮稽核 AI 助手主管后台、复核池与导出入口",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "稽核后台" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
