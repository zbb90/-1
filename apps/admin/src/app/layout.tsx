import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "稽核 AI 助手后台",
  description: "茶饮稽核 AI 助手后台与接口骨架",
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
