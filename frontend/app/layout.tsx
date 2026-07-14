import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mount Zion GD - Group Discussion Platform",
  description: "Group Discussion assessment platform with AI-powered evaluation"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
