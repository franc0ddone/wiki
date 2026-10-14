import type { ClinicalDepartment, KnowledgeArticleStatus } from "@/types/portal";

/**
 * The compact summary a reader sees when hovering an internal SOP link
 * (prompt 7a, item 4). Built from data the portal already holds — no new
 * endpoint: the caller passes a lookup over the in-memory article list.
 */
export interface ArticlePreview {
  title: string;
  /** A short plain-text excerpt of the procedure body. */
  excerpt: string;
  status: KnowledgeArticleStatus;
  departments: ClinicalDepartment[];
}
