import type { Metadata } from "next";
import { ArticleEditorLoader } from "@/components/editor/ArticleEditorLoader";
import { EditorUnavailable } from "@/components/editor/EditorUnavailable";
import { getArticles } from "@/lib/data";
import { getReviewerOptions, requireEditorViewer } from "@/lib/editor/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New procedure · Dove Wiki" };

/**
 * `/articles/new` — a blank draft. Full-page editor, outside the master/detail
 * shell. Requires `author`+ (the API enforces it too); anyone below that sees a
 * plain notice instead of an editor they could not use.
 */
export default async function NewArticlePage() {
  const viewer = await requireEditorViewer("/articles/new");
  if (!viewer) {
    return (
      <EditorUnavailable
        title="Writing procedures needs the author role"
        message="Your account can read procedures but not create them. Ask an administrator if you should be able to."
      />
    );
  }

  const [articles, reviewers] = await Promise.all([getArticles(), getReviewerOptions()]);

  return (
    <ArticleEditorLoader
      mode="new"
      viewer={viewer}
      article={null}
      registrySource={articles.map((a) => ({ slug: a.slug, title: a.title, body_markdown: a.body_markdown }))}
      reviewers={reviewers}
    />
  );
}
