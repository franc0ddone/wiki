"use client";

import dynamic from "next/dynamic";
import type { ArticleEditorProps } from "@/components/editor/ArticleEditor";

/**
 * Code-split boundary for the editor.
 *
 * Tiptap, ProseMirror and `tiptap-markdown` are fetched only when the author
 * opens `/articles/new` or `/articles/<slug>/edit` — never on the reading path
 * (`/`, where the reader lives). `ssr: false` because the editor is
 * browser-only (it owns a contenteditable) and must not run during prerender.
 */
const ArticleEditor = dynamic(() => import("@/components/editor/ArticleEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-[#F4F4F5]" role="status">
      <p className="text-[13px] text-zinc-500">Loading editor…</p>
    </div>
  ),
});

export function ArticleEditorLoader(props: ArticleEditorProps) {
  return <ArticleEditor {...props} />;
}
