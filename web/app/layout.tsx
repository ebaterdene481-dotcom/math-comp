import type { Metadata, Viewport } from "next";
import { Golos_Text, Unbounded } from "next/font/google";
import "./globals.css";

// Mongolian letters Ө and Ү live in the cyrillic-ext subset.
const golos = Golos_Text({
  subsets: ["cyrillic", "cyrillic-ext", "latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-body",
});
// Unbounded has no Ө/Ү, so it is used for numbers only (problems, scores).
const unbounded = Unbounded({
  subsets: ["cyrillic", "cyrillic-ext", "latin"],
  weight: ["500", "700", "800"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "5 секунд — математикийн тэмцээн",
  description: "100 бодлого, бодлого бүрт 5 секунд. Хурдан, зөв бодсон нь ялна.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn" className={`${golos.variable} ${unbounded.variable}`}>
      <body>{children}</body>
    </html>
  );
}
