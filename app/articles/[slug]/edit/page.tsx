import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleEditorLoader } from "@/components/editor/ArticleEditorLoader";
import { EditorUnavailable } from "@/components/editor/EditorUnavailable";
import { getArticleBySlug, getArticles } from "@/lib/data";
import { getArticleReviewerId, getReviewerOptions, requireEditorViewer } from "@/lib/editor/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit procedure · Dove Wiki" };

/**
 * `/articles/<slug>/edit` — loads the current `body_markdown` and saves through
 * `PATCH /api/articles/<slug>`.
 *
 * Any `author` may edit any procedure, published or not. Saving a published
 * procedure republishes it: the PATCH omits `status`, so `updateArticle` keeps
 * it published and snapshots a new immutable version. Publishing a *draft* is
 * the clinical act that still needs `clinical_lead`+, and the editor surfaces
 * that refusal honestly rather than hiding it.
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

  const [article, articles, reviewers, reviewerId] = await Promise.all([
    getArticleBySlug(slug),
    getArticles(),
    getReviewerOptions(),
    getArticleReviewerId(slug),
  ]);
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
        reviewerId,
      }}
      registrySource={articles.map((a) => ({ slug: a.slug, title: a.title, body_markdown: a.body_markdown }))}
      reviewers={reviewers}
    />
  );
}
