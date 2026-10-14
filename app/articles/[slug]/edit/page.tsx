import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleEditorLoader } from "@/components/editor/ArticleEditorLoader";
import { EditorUnavailable } from "@/components/editor/EditorUnavailable";
import { getArticleBySlug, getArticles } from "@/lib/data";
import { requireEditorViewer } from "@/lib/editor/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit procedure · Dove Hub" };

/**
 * `/articles/<slug>/edit` — loads the current `body_markdown` and saves through
 * `PATCH /api/articles/<slug>`.
 *
 * Anyone with the `author` role may edit any procedure, published or not.
 * Saving a published procedure keeps it live and records a new immutable
 * version. Publishing a draft is now the same single click it is for a bulletin
 * (prompt 7c removed the review step) — the `author` floor is the only gate.
 *
 * `requireEditorViewer` floors the page at `author`; that is the only gate this
 * page needs.
 */
export default async function EditArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireEditorViewer(`/articles/${slug}/edit`);
  if (!viewer) {
    return (
      <EditorUnavailable
        title="Editing procedures needs the author role"
        message="Your account can read procedures but not change them."
        backHref={`/portal?article=${encodeURIComponent(slug)}`}
        backLabel="Back to the procedure"
      />
    );
  }

  const [article, articles] = await Promise.all([getArticleBySlug(slug), getArticles()]);
  if (!article) notFound();

  return (
    <ArticleEditorLoader
      mode="edit"
      viewer={viewer}
      article={{
        slug: article.slug,
        title: article.title,
        body_markdown: article.body_markdown,
        departments: article.departments,
        status: article.status,
        audience: article.audience,
        isEssential: article.is_essential,
      }}
      registrySource={articles.map((a) => ({ slug: a.slug, title: a.title, body_markdown: a.body_markdown }))}
    />
  );
}
