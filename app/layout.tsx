import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TCG Grading Check",
  description: "Graded sold prices by company and grade, and whether grading a card pays.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
