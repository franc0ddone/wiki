import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dove Wiki",
  description: "Dove Wiki — bulletin board, knowledge base, and staff directory for Dove Lewis Emergency Animal Hospital.",
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
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}