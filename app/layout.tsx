import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Domine, Palanquin } from "next/font/google";
import "./globals.css";

/**
 * Display face for the bulletin calling card *and* the reader's headlines:
 * Domine, self-hosted by `next/font` and exposed to the stylesheet as
 * `--font-display` (see `.dw-display` / `.dw-reader` in `globals.css`).
 * Weights 400–700 are needed because reader headlines set their own weight.
 */
const domine = Domine({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

/**
 * The reader's body / UI face (prompt 7a): Palanquin, exposed as `--font-reader`.
 * Scoped to the reading surface via `.dw-reader` so the rest of the app keeps
 * the system stack.
 */
const palanquin = Palanquin({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-reader",
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
    <html lang="en" className={`h-full ${domine.variable} ${palanquin.variable}`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}