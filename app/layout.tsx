import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Domine } from "next/font/google";
import "./globals.css";

/**
 * The display face for the bulletin calling card: Domine 700, self-hosted by
 * `next/font` and exposed to the stylesheet as `--font-display`
 * (see the `.dw-display` rule in `globals.css`).
 */
const domine = Domine({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dove Hub",
  description: "Dove Hub — bulletin board, knowledge base, and staff directory for Dove Lewis Emergency Animal Hospital.",
};

/**
 * Root layout.
 *
 * The App Router requires the root layout to render <html> and <body>. Keep that
 * structure even when the child page manages its own full-height flex shell
 * (`h-dvh flex flex-col`), which is why <body> here stays a plain flex column.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`h-full ${domine.variable}`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}