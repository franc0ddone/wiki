import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleEditorLoader } from "@/components/editor/ArticleEditorLoader";
import { EditorUnavailable } from "@/components/editor/EditorUnavailable";
import { getArticleBySlug, getArticles } from "@/lib/data";
import { getArticleReviewerId, getReviewerOptions, requireEditorViewer } from "@/lib/editor/server";
import { roleAtLeast } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit procedure · Dove Wiki" };

/**
 * `/articles/<slug>/edit` — loads the current `body_markdown` and saves through
 * `PATCH /api/articles/<slug>`.
 *
 * A *published* procedure is live: changing it republishes it, which only a
 * clinical lead may do. Authors get an explanation instead of an editor whose
 * every save would be refused.
 */
export default async function EditArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireEditorViewer(`/articles/${slug}/edit`);
  if (!viewer) {
    return (
      <EditorUnavailable
        title="Editing procedures needs the author role"
        message="Your account can read procedures but not change them."
        backHref={`/?article=${encodeURIComponent(slug)}`}
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

  if (article.status === "published" && !roleAtLeast(viewer.role, "clinical_lead")) {
    return (
      <EditorUnavailable
        title="This procedure is live"
        message="Changing a published procedure republishes it, which needs the clinical lead role. Ask a clinical lead to make the change, or to return it to draft."
        backHref={`/?article=${encodeURIComponent(slug)}`}
        backLabel="Back to the procedure"
      />
    );
  }

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
