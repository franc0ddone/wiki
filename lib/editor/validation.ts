/**
 * Save-time validation for the procedure editor. Pure (no React, no DOM) so it
 * can be exercised from `scripts/verify-frontend.ts`.
 *
 * Errors block the save and name the exact thing to fix. Warnings never block.
 * A vet following a link mid-emergency and landing on nothing is a
 * patient-safety failure, so broken internal links are errors — the actual
 * link checking is `lib/links.ts#validateLinks`, not reimplemented here.
 */
import { validateLinks, type LinkRegistry } from "@/lib/links";
import { collectHeadings, parseMarkdown } from "@/lib/markdown/parser";

export const TITLE_MAX_LENGTH = 300;
export const CHANGE_SUMMARY_MAX_LENGTH = 2000;

export type EditorIntent = "create" | "save" | "submit_review" | "publish";

export type IssueField = "title" | "body" | "departments" | "reviewer" | "summary";

export interface EditorIssue {
  field: IssueField;
  /** Stable machine code, handy for tests and for focusing the right control. */
  code: string;
  message: string;
  /** For link problems: the raw target, so the UI can point at it. */
  target?: string;
}

export interface ValidationInput {
  title: string;
  markdown: string;
  departments: readonly string[];
  intent: EditorIntent;
  reviewerId: string | null;
  changeSummary: string;
  /** True when title or body differs from what was loaded (existing articles only). */
  contentChanged: boolean;
}

export interface ValidationResult {
  errors: EditorIssue[];
  warnings: EditorIssue[];
}

/** tiptap-markdown writes `[nodeName]` when it cannot express a node as Markdown. */
const UNSERIALIZABLE_RE =
  /^\[(table|tableRow|tableCell|tableHeader|details|callout|image|taskList|taskItem|hardBreak|markdownHTMLNode)\]\s*$/m;

export function validateArticle(input: ValidationInput, registry: LinkRegistry): ValidationResult {
  const errors: EditorIssue[] = [];
  const warnings: EditorIssue[] = [];

  const title = input.title.trim();
  if (title.length === 0) {
    errors.push({ field: "title", code: "title_empty", message: "Add a title." });
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.push({
      field: "title",
      code: "title_too_long",
      message: `The title is ${title.length} characters; the limit is ${TITLE_MAX_LENGTH}. Shorten it by ${title.length - TITLE_MAX_LENGTH}.`,
    });
  }

  const body = input.markdown.trim();
  if (body.length === 0) {
    errors.push({ field: "body", code: "body_empty", message: "The procedure body is empty. Write the procedure before saving." });
  }

  if (input.departments.length === 0) {
    errors.push({
      field: "departments",
      code: "no_departments",
      message: "Choose at least one department so the right team finds this procedure.",
    });
  }

  if ((input.intent === "submit_review" || input.intent === "publish") && !input.reviewerId) {
    errors.push({
      field: "reviewer",
      code: "reviewer_required",
      message:
        input.intent === "publish"
          ? "Choose the clinical lead who reviewed this procedure before publishing."
          : "Assign a reviewer before submitting for review.",
    });
  }

  if (input.intent !== "create" && input.contentChanged) {
    const summary = input.changeSummary.trim();
    if (summary.length === 0) {
      errors.push({
        field: "summary",
        code: "summary_required",
        message: "Describe what changed. The change summary becomes this version’s changelog.",
      });
    } else if (summary.length > CHANGE_SUMMARY_MAX_LENGTH) {
      errors.push({
        field: "summary",
        code: "summary_too_long",
        message: `The change summary is ${summary.length} characters; the limit is ${CHANGE_SUMMARY_MAX_LENGTH}.`,
      });
    }
  }

  if (body.length > 0) {
    const unserializable = UNSERIALIZABLE_RE.exec(input.markdown);
    if (unserializable) {
      errors.push({
        field: "body",
        code: "unserializable_content",
        message: `Part of the content (${unserializable[1]}) could not be converted to Markdown and would be lost. Simplify it — table cells hold one paragraph, and the first table row must be a header row.`,
      });
    }

    if (/!\[\s*\]\(/.test(input.markdown)) {
      errors.push({
        field: "body",
        code: "image_alt_missing",
        message: "An image has no alt text. Select the image and use “Edit alt text” — readers who cannot see it depend on it.",
      });
    }

    for (const broken of validateLinks(input.markdown, registry)) {
      const label = broken.label.trim() || broken.target;
      errors.push({
        field: "body",
        code: broken.reason === "unknown_article" ? "link_unknown_article" : "link_unknown_anchor",
        target: broken.target,
        message: `Broken link “${label}” → ${broken.target}: ${broken.message.replace(/`/g, "")}`,
      });
    }

    // Skipped heading levels (warning only). The title is the page's H1, so the
    // first heading in the body should be H2.
    let previous = 1;
    for (const heading of collectHeadings(parseMarkdown(input.markdown))) {
      if (heading.level - previous > 1) {
        warnings.push({
          field: "body",
          code: "heading_level_skipped",
          message: `“${heading.text}” is an H${heading.level} straight after ${previous === 1 ? "the title" : `an H${previous}`}. Skipped heading levels make the outline hard to navigate — use H${previous + 1}.`,
        });
      }
      previous = heading.level;
    }
  }

  return { errors, warnings };
}
