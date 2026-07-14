import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MZ Orator - AI Group Discussion Platform",
  description: "AI-powered Group Discussion assessment platform"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
