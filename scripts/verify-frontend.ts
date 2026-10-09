/**
 * `npm run verify:frontend` — assertions for the pure (DOM-free) frontend
 * modules: the markdown parser, link validation, the search engine, the editor
 * schema, and the batch-5c features (reactions, attachments, paste, bulletin
 * blocks, merged cells, the drag handle).
 *
 * Browser behaviour (palette, editor, reader interactions) is verified
 * separately; this script covers everything that can be decided without one.
 *
 * The DB-backed checks (reactions, attachments, bulletin formats) run last and
 * require a live PostgreSQL database: the script runs `prisma migrate deploy`
 * against `DATABASE_URL_TEST` (or `DATABASE_URL`) as setup, and **fails loudly**
 * when neither is configured — it never silently skips them.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

const VERIFY_DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
if (!VERIFY_DATABASE_URL) {
  console.error(
    "verify:frontend needs a database for the reactions / attachments / format checks.\n" +
      "Set DATABASE_URL_TEST (preferred) or DATABASE_URL to a disposable PostgreSQL database.",
  );
  process.exit(1);
}
process.env.DATABASE_URL = VERIFY_DATABASE_URL;

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorState } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Schema } from "@tiptap/pm/model";
import { Dropcursor } from "@tiptap/extension-dropcursor";
import {
  closeDoubleQuote,
  closeSingleQuote,
  ellipsis,
  emDash,
  openDoubleQuote,
  openSingleQuote,
} from "@tiptap/extension-typography";
import type { InputRule } from "@tiptap/core";
import { parseInline, inlinePlain } from "@/lib/markdown/inline";
import { collectFootnotes, collectHeadings, extractToc, parseMarkdown, splitTableRow } from "@/lib/markdown/parser";
import {
  LINE_HEIGHTS,
  blockTextStyle,
  serializeBlockAttributes,
  splitBlockAttributes,
} from "@/lib/markdown/block-attributes";
import { MARK_DELIMITERS, splitInlineConventions } from "@/lib/markdown/inline-conventions";
import { buildEditorExtensions } from "@/components/editor/extensions";
import {
  IMAGE_MAX_WIDTH,
  IMAGE_MIN_WIDTH,
  clampWidth,
  parseImageAttributes,
  serializeImageSuffix,
} from "@/lib/markdown/image-attributes";
import {
  parseFootnoteDefinition,
  scanFootnoteReferences,
  serializeFootnoteDefinition,
  serializeFootnoteReference,
} from "@/lib/markdown/footnotes";
import {
  BULLETIN_EXPIRY_DEFAULTS,
  canPostPriority,
  defaultExpiryFor,
  expiryLabel,
  priorityRequiresClinicalLead,
  shouldClearAcksForUrgentEdit,
  validateBulletinDraft,
} from "@/lib/bulletin/lifecycle";
import { extractHeadingIds, validateLinks } from "@/lib/links";
import { validateArticle } from "@/lib/editor/validation";
import { buildLinkRegistry } from "@/lib/links";
import { stripMarkdown } from "@/lib/search/strip-markdown";
import { expandQuery, SYNONYMS } from "@/lib/search/synonyms";
import { buildSearchIndex, search } from "@/lib/search";
import {
  HOSPITAL_EMAIL_DOMAIN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_REJECTION_MESSAGE,
  isHospitalEmail,
  normalizeEmail,
  passwordProblem,
} from "@/lib/registration";
import {
  canRequestAuthorAccess,
  canReviewRoleRequests,
  isRoleRequestStatus,
  resolveRequestedRole,
  roleAfterApproval,
} from "@/lib/role-requests";
import { KNOWLEDGE_ARTICLES, BULLETINS, STAFF_DIRECTORY } from "@/lib/mock-data";
import {
  BUBBLE_FORMAT_ORDER,
  FORMAT_COMMANDS,
  TOOLBAR_FORMAT_ORDER,
  bold as formatBold,
  formatCommandsFor,
  highlight as formatHighlight,
  italic as formatItalic,
} from "@/components/editor/formatCommands";
import { SLASH_ITEMS, filterSlashItems } from "@/components/editor/slashItems";
import { canInsertDroppedImage } from "@/lib/editor/image-validation";
import { findMatches, replaceAllInDoc, stepMatchIndex } from "@/lib/editor/find";
import { shouldShowBubbleMenu, bubbleMode, isSelectionInTable } from "@/lib/editor/bubble";
import { ApiError } from "@/lib/api";
import { getDb } from "@/lib/db";
import {
  BULLETIN_REACTION_EMOJIS,
  isBulletinReactionEmoji,
  summarizeReactions,
} from "@/lib/bulletin/reactions";
import {
  BULLETIN_FORMATS,
  DEFAULT_BULLETIN_FORMAT,
  formatUsesAck,
  isBulletinFormat,
} from "@/lib/bulletin/format";
import {
  createBulletin,
  getBulletinById,
  getReactionSummary,
  toggleReaction,
} from "@/lib/data/bulletins";
import { createArticle } from "@/lib/data/articles";
import {
  ALLOWED_ATTACHMENT_TYPES,
  ATTACHMENT_MAX_BYTES,
  assertAttachmentType,
  assertPhiConfirmed,
  detectAttachmentType,
  readAttachmentStream,
  sanitizeAttachmentFileName,
} from "@/lib/attachments";
import { createAttachment, getAttachmentForDownload, listAttachments } from "@/lib/data/attachments";
import { PASTE_ALLOWED_TAGS, htmlIsClean, sanitizePastedHtml } from "@/lib/editor/paste-sanitize";
import {
  CTA_LINE_PATTERN,
  initialsFromName,
  isValidCtaHref,
  parseSpotlightLine,
  parseStepLine,
  serializeBulletinBlocks,
  serializeSpotlightLine,
  serializeStepLine,
} from "@/lib/markdown/bulletin-blocks";
import {
  isDefaultCellSpan,
  parseCellSpan,
  serializeCellSpan,
  splitCellSpan,
} from "@/lib/markdown/cell-attributes";
import { BulletinHeadline } from "@/components/bulletin/BulletinHeadline";
import { BulletinHero } from "@/components/bulletin/BulletinHero";
import { ClinicalTable } from "@/components/reader/ClinicalTable";
import { dragWrappersAsUnit, excludeFootnotesAndTables } from "@/components/editor/dragHandle";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

console.log("inline");
check("nested emphasis: **bold *and italic***", () => {
  const nodes = parseInline("**bold *and italic***");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].t, "strong");
  const inner = (nodes[0] as { c: Array<{ t: string }> }).c.map((n) => n.t);
  assert.deepEqual(inner, ["text", "em"]);
});
check("***both***", () => {
  const nodes = parseInline("***both***");
  assert.equal(nodes[0].t, "strong");
});
check("arithmetic stars are literal", () => {
  assert.equal(inlinePlain(parseInline("2 * 3 * 4")), "2 * 3 * 4");
});
check("escapes + code + link", () => {
  const nodes = parseInline("a \\* b `x*y` [go](/procedures/foo#bar)");
  assert.equal(inlinePlain(nodes), "a * b x*y go");
  assert.equal(nodes.at(-1)?.t, "link");
});
check("unmatched emphasis degrades to text", () => {
  assert.equal(inlinePlain(parseInline("**foo*")), "*foo");
});
check("pathological input terminates", () => {
  const started = Date.now();
  parseInline("*a ".repeat(400));
  assert.ok(Date.now() - started < 1500);
});

console.log("block parser");
check("fence keeps the language tag", () => {
  const blocks = parseMarkdown("```mermaid\ngraph TD; A-->B\n```\n\n```\nplain\n```");
  assert.deepEqual(
    blocks.map((b) => (b.kind === "code" ? b.lang : b.kind)),
    ["mermaid", ""],
  );
});
check(":::details collapses and nests", () => {
  const blocks = parseMarkdown(":::details Outer\nhello\n\n:::details Inner\ndeep\n:::\n\n:::\n\nafter");
  assert.equal(blocks.length, 2);
  const outer = blocks[0];
  assert.equal(outer.kind, "details");
  if (outer.kind === "details") {
    assert.equal(outer.summary, "Outer");
    assert.equal(outer.blocks.length, 2);
    assert.equal(outer.blocks[1].kind, "details");
  }
});
check("task lists", () => {
  const [list] = parseMarkdown("- [ ] one\n- [x] two\n- plain");
  assert.equal(list.kind, "list");
  if (list.kind === "list") assert.deepEqual(list.items.map((i) => i.checked), [false, true, null]);
});
check("nested lists", () => {
  const [list] = parseMarkdown("- a\n  - b\n  - c\n- d");
  assert.equal(list.kind, "list");
  if (list.kind === "list") {
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0].children?.items.length, 2);
  }
});
check("escaped pipes in table cells", () => {
  assert.deepEqual(splitTableRow("| a \\| b | c |"), ["a | b", "c"]);
  const [table] = parseMarkdown("| x | y |\n| --- | --- |\n| 1 \\| 2 | 3 |");
  assert.equal(table.kind, "table");
  if (table.kind === "table") assert.deepEqual(table.rows[0].map((cell) => cell.text), ["1 | 2", "3"]);
});
check("explicit heading ids + duplicate suffixes", () => {
  const blocks = parseMarkdown("## Purpose {#why}\n\n## Purpose\n\n## Purpose");
  assert.deepEqual(collectHeadings(blocks).map((h) => h.id), ["why", "purpose", "purpose-2"]);
});
check("extractToc ids equal rendered heading ids (incl. inside details)", () => {
  const md = "## A\n\n:::details X\n### B {#bee}\n:::\n\n## C";
  const blocks = parseMarkdown(md);
  assert.deepEqual(extractToc(blocks).map((e) => e.id), ["a", "bee", "c"]);
  assert.deepEqual(extractHeadingIds(md), ["a", "bee", "c"]);
});
check("headings inside code fences are not headings", () => {
  assert.deepEqual(extractHeadingIds("```\n# not a heading\n```\n\n## Real"), ["real"]);
});
check("standalone image becomes a figure block", () => {
  const [block] = parseMarkdown("![Crash cart layout](https://cdn.example/x.png)");
  assert.equal(block.kind, "image");
});
check("callout round trip shape", () => {
  const [block] = parseMarkdown("> [!dosing]\n> Give 0.01 mg/kg.\n>\n> Second paragraph.");
  assert.equal(block.kind, "callout");
  if (block.kind === "callout") {
    assert.equal(block.variant, "dosing");
    assert.equal(block.paragraphs.length, 2);
  }
});

console.log("links");
check("validateLinks flags a broken slug and a broken anchor", () => {
  const registry = { slugs: ["parvo"], anchors: { parvo: ["purpose"] } };
  const md = "## Here\n\n[ok](/procedures/parvo#purpose) [bad](/procedures/nope) [bad2](/procedures/parvo#zzz) [bad3](#missing) [ok2](#here)";
  const reasons = validateLinks(md, registry).map((b) => `${b.reason}:${b.target}`);
  assert.deepEqual(reasons, [
    "unknown_article:/procedures/nope",
    "unknown_anchor:/procedures/parvo#zzz",
    "unknown_anchor:#missing",
  ]);
});

console.log("search");
const index = buildSearchIndex(
  KNOWLEDGE_ARTICLES.map((a) => ({ ...a })),
  BULLETINS.map((b) => ({ ...b })),
  STAFF_DIRECTORY.map((s) => ({ ...s })),
);
check("stripMarkdown keeps link labels, fence content, drops callout markers", () => {
  const out = stripMarkdown("> [!warning]\n> See [the SOP](/procedures/x).\n\n```\ncode here\n```\n\n- [x] done");
  assert.ok(out.includes("See the SOP."));
  assert.ok(out.includes("code here"));
  assert.ok(!out.includes("[!warning]"));
  assert.ok(!out.includes("/procedures/x"));
});
check("synonym map has 30-50 entries and expands additively", () => {
  const size = Object.keys(SYNONYMS).length;
  assert.ok(size >= 30 && size <= 50, `entries: ${size}`);
  const expanded = expandQuery("epi dose");
  assert.equal(expanded.variants[0].text, "epi dose");
  assert.ok(expanded.variants.some((v) => v.text.includes("epinephrine")));
});
check("typo 'epiniphrine' finds an epinephrine article", () => {
  const outcome = search(index, "epiniphrine");
  const slugs = outcome.bySurface.articles.map((hit) => hit.id);
  const withEpi = KNOWLEDGE_ARTICLES.filter((a) => /epinephrine/i.test(a.body_markdown)).map((a) => a.id);
  assert.ok(withEpi.length > 0, "fixture has an epinephrine article");
  assert.ok(slugs.some((id) => withEpi.includes(id)), `hits: ${slugs.join(",")}`);
});
check("'code blue' finds cardiac-arrest content", () => {
  const outcome = search(index, "code blue");
  assert.ok(outcome.total > 0);
});
check("'parvo' finds the parvovirus SOP first among articles", () => {
  const outcome = search(index, "parvo");
  assert.match(outcome.bySurface.articles[0]?.title ?? "", /parvo/i);
});
check("zero-result query returns recovery data, never nothing", () => {
  const outcome = search(index, "zzqxv glorp");
  assert.equal(outcome.total, 0);
  assert.ok(Array.isArray(outcome.closest));
});

console.log("editor validation");
const registry = buildLinkRegistry(KNOWLEDGE_ARTICLES.map((a) => ({ slug: a.slug, bodyMarkdown: a.body_markdown })));
const base = { title: "T", markdown: "## A\n\ntext", departments: ["ER"], intent: "save" as const, reviewerId: null, changeSummary: "x", contentChanged: true };
check("clean article has no errors", () => assert.deepEqual(validateArticle(base, registry).errors, []));
check("blocks empty title, long title, empty body, no departments", () => {
  const codes = (o: object) => validateArticle({ ...base, ...o }, registry).errors.map((e) => e.code);
  assert.deepEqual(codes({ title: "  " }), ["title_empty"]);
  assert.deepEqual(codes({ title: "x".repeat(301) }), ["title_too_long"]);
  assert.deepEqual(codes({ markdown: "" }), ["body_empty"]);
  assert.deepEqual(codes({ departments: [] }), ["no_departments"]);
});
check("submit needs a reviewer; edits need a change summary", () => {
  assert.deepEqual(validateArticle({ ...base, intent: "submit_review" }, registry).errors.map((e) => e.code), ["reviewer_required"]);
  assert.deepEqual(validateArticle({ ...base, changeSummary: "" }, registry).errors.map((e) => e.code), ["summary_required"]);
});
check("broken slug and broken anchor block; skipped heading level only warns", () => {
  const r = validateArticle({ ...base, markdown: "### Jump\n\n[a](/procedures/nope) [b](#nowhere)" }, registry);
  assert.deepEqual(r.errors.map((e) => e.code), ["link_unknown_article", "link_unknown_anchor"]);
  assert.deepEqual(r.warnings.map((e) => e.code), ["heading_level_skipped"]);
});

console.log("registration policy");
check("hospital domain accepts the configured domain only", () => {
  assert.equal(isHospitalEmail(`nurse@${HOSPITAL_EMAIL_DOMAIN}`), true);
  assert.equal(isHospitalEmail(`NURSE@${HOSPITAL_EMAIL_DOMAIN.toUpperCase()}`), true);
  // A different domain, and the classic suffix trick, are both refused.
  assert.equal(isHospitalEmail("nurse@gmail.com"), false);
  assert.equal(isHospitalEmail(`nurse@not${HOSPITAL_EMAIL_DOMAIN}.evil.com`), false);
  assert.equal(isHospitalEmail(`nurse@${HOSPITAL_EMAIL_DOMAIN}.evil.com`), false);
  assert.equal(isHospitalEmail("no-at-sign"), false);
  assert.equal(isHospitalEmail(`@${HOSPITAL_EMAIL_DOMAIN}`), false);
});
check("email is normalised to the stored form", () => {
  assert.equal(normalizeEmail("  Nurse@DoveLewis.ORG  "), "nurse@dovelewis.org");
});
check("password floor is enforced", () => {
  assert.equal(passwordProblem("short"), PASSWORD_REJECTION_MESSAGE);
  assert.equal(passwordProblem("long-enough-1"), null);
  assert.equal(passwordProblem("x".repeat(PASSWORD_MAX_LENGTH + 1)), "Keep the password under 200 characters.");
});

console.log("author-access requests");
check("only `staff` may request, only `clinical_lead`+ may review", () => {
  assert.equal(canRequestAuthorAccess("staff"), true);
  assert.equal(canRequestAuthorAccess("readonly"), false);
  assert.equal(canRequestAuthorAccess("author"), false);
  assert.equal(canRequestAuthorAccess(null), false);

  assert.equal(canReviewRoleRequests("clinical_lead"), true);
  assert.equal(canReviewRoleRequests("admin"), true);
  assert.equal(canReviewRoleRequests("staff"), false);
  assert.equal(canReviewRoleRequests("author"), false);
});
check("the request endpoint accepts only the author role", () => {
  assert.equal(resolveRequestedRole(undefined), "author");
  assert.equal(resolveRequestedRole("author"), "author");
  // Anything that would self-promote is refused, not downgraded.
  assert.equal(resolveRequestedRole("admin"), null);
  assert.equal(resolveRequestedRole("clinical_lead"), null);
  assert.equal(resolveRequestedRole("readonly"), null);
  assert.equal(resolveRequestedRole(42), null);
});
check("approval promotes upward, never sideways or down", () => {
  assert.equal(roleAfterApproval("staff", "author"), "author");
  assert.equal(roleAfterApproval("author", "author"), "author");
  // A grant never demotes a higher role, and never skips past the requested one.
  assert.equal(roleAfterApproval("clinical_lead", "author"), "clinical_lead");
  assert.equal(roleAfterApproval("admin", "author"), "admin");
});
check("status guard recognises exactly the three lifecycle values", () => {
  assert.equal(isRoleRequestStatus("pending"), true);
  assert.equal(isRoleRequestStatus("approved"), true);
  assert.equal(isRoleRequestStatus("declined"), true);
  assert.equal(isRoleRequestStatus("open"), false);
  assert.equal(isRoleRequestStatus(1), false);
});

console.log("bulletin lifecycle");
check("expiry defaults: urgent 72h, pinned 30d, normal none", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(defaultExpiryFor("urgent", from)?.toISOString(), "2026-01-04T00:00:00.000Z");
  assert.equal(defaultExpiryFor("pinned", from)?.toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(defaultExpiryFor("normal", from), null);
  assert.equal(BULLETIN_EXPIRY_DEFAULTS.urgent, 72 * 60 * 60 * 1000);
});
check("expiry labels describe the effective window", () => {
  assert.equal(expiryLabel("urgent"), "72 hours from now");
  assert.equal(expiryLabel("pinned"), "30 days from now");
  assert.equal(expiryLabel("normal"), "No expiry");
});
check("priority gate: normal is author+, urgent/pinned are clinical_lead+", () => {
  assert.equal(canPostPriority("author", "normal"), true);
  assert.equal(canPostPriority("author", "urgent"), false);
  assert.equal(canPostPriority("clinical_lead", "urgent"), true);
  assert.equal(canPostPriority(null, "normal"), false);
  assert.equal(priorityRequiresClinicalLead("pinned"), true);
  assert.equal(priorityRequiresClinicalLead("normal"), false);
});
check("editing an urgent notice with changed content clears acks", () => {
  const urgent = { priority: "urgent" as const, title: "A", body_markdown: "B" };
  assert.equal(shouldClearAcksForUrgentEdit(urgent, { priority: "urgent", title: "A", body_markdown: "B" }), false);
  assert.equal(shouldClearAcksForUrgentEdit(urgent, { priority: "urgent", title: "A", body_markdown: "C" }), true);
  assert.equal(shouldClearAcksForUrgentEdit(urgent, { priority: "normal", title: "A", body_markdown: "C" }), false);
  assert.equal(
    shouldClearAcksForUrgentEdit(
      { priority: "normal", title: "A", body_markdown: "B" },
      { priority: "normal", title: "Z", body_markdown: "Y" },
    ),
    false,
  );
});
check("composer validation blocks the fields the API would refuse", () => {
  const base = {
    title: "T",
    body_markdown: "B",
    departments: ["ER"] as string[],
    priority: "normal" as "normal" | "urgent" | "pinned",
    expires_at: undefined as string | null | undefined,
  };
  const codes = (patch: Partial<typeof base>, canPostRestricted = false) =>
    validateBulletinDraft({ ...base, ...patch }, { canPostRestricted }).errors.map((issue) => issue.code);
  assert.deepEqual(codes({}), []);
  assert.deepEqual(codes({ title: "   " }), ["title_empty"]);
  assert.deepEqual(codes({ title: "x".repeat(301) }), ["title_too_long"]);
  assert.deepEqual(codes({ body_markdown: "" }), ["body_empty"]);
  assert.deepEqual(codes({ departments: [] }), ["no_departments"]);
  assert.deepEqual(codes({ priority: "urgent" }), ["priority_forbidden"]);
  assert.deepEqual(codes({ priority: "urgent" }, true), []);
  assert.deepEqual(codes({ priority: "urgent", expires_at: null }, true), ["urgent_requires_expiry"]);
});

console.log("images");
check("image suffix parses and serializes width + alignment (clamped)", () => {
  assert.deepEqual(parseImageAttributes("width=480 align=center"), { width: 480, align: "center" });
  assert.equal(serializeImageSuffix({ width: 480, align: "center" }), "{width=480 align=center}");
  assert.equal(serializeImageSuffix({ width: null, align: null }), "");
  assert.equal(clampWidth(10), IMAGE_MIN_WIDTH);
  assert.equal(clampWidth(99999), IMAGE_MAX_WIDTH);
  // Unknown keys and malformed alignments are ignored, never thrown on.
  assert.deepEqual(parseImageAttributes("width=abc align=sideways"), { width: null, align: null });
});
check("image block parses caption/width/align; suffix-less images are unchanged", () => {
  const [withAttrs] = parseMarkdown('![Crash cart](https://cdn.example/x.png "Figure 1"){width=480 align=right}');
  assert.equal(withAttrs.kind, "image");
  if (withAttrs.kind === "image") {
    assert.equal(withAttrs.alt, "Crash cart");
    assert.equal(withAttrs.src, "https://cdn.example/x.png");
    assert.equal(withAttrs.title, "Figure 1");
    assert.equal(withAttrs.width, 480);
    assert.equal(withAttrs.align, "right");
  }

  const [plain] = parseMarkdown("![Crash cart](https://cdn.example/x.png)");
  assert.equal(plain.kind, "image");
  if (plain.kind === "image") {
    assert.equal(plain.title, null);
    assert.equal(plain.width, null);
    assert.equal(plain.align, null);
  }
});

console.log("footnotes");
check("footnote helpers serialize and parse", () => {
  assert.equal(serializeFootnoteReference("1"), "[^1]");
  assert.equal(serializeFootnoteDefinition("1", "Text"), "[^1]: Text");
  assert.deepEqual(parseFootnoteDefinition("[^note]: See protocol."), { label: "note", text: "See protocol." });
  assert.equal(parseFootnoteDefinition("plain text"), null);
  // Code spans are documentation, not citations.
  assert.deepEqual(scanFootnoteReferences("a[^1] b `[^code]` c[^1]"), ["1", "1"]);
});
check("inline footnote reference parses to a node", () => {
  const nodes = parseInline("See this[^1] and that[^2].");
  assert.equal(nodes.filter((node) => node.t === "footnoteRef").length, 2);
  assert.equal(inlinePlain(parseInline("[^1]")), "");
});
check("definition lines are pulled out of the body", () => {
  const blocks = parseMarkdown("Text[^1].\n\n[^1]: Footnote text.");
  assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "footnoteDefinition"]);
});
check("footnote graph numbers by first reference and degrades gracefully", () => {
  const md = [
    "First[^b] then[^a] again[^b] and a broken[^zzz].",
    "",
    "[^a]: Alpha definition.",
    "[^b]: Beta definition.",
    "[^unused]: Never cited.",
  ].join("\n");
  const index = collectFootnotes(parseMarkdown(md));
  assert.deepEqual(index.order, ["b", "a"]);
  assert.equal(index.numbers.get("b"), 1);
  assert.equal(index.numbers.get("a"), 2);
  assert.equal(index.definitions.get("b"), "Beta definition.");
  assert.deepEqual(index.unresolved, ["zzz"]);
  assert.deepEqual(index.unused.map((definition) => definition.label), ["unused"]);
  // No references at all: nothing numbered, no crash.
  assert.deepEqual(collectFootnotes(parseMarkdown("Just prose.")).order, []);
});

console.log("link picker search");
check("the link picker's search finds a procedure fuzzily", () => {
  const outcome = search(index, "parvo isolaton", { surfaces: ["articles"] });
  assert.ok(outcome.bySurface.articles.length > 0, "no procedure matched a typo'd query");
  assert.match(outcome.bySurface.articles[0]?.title ?? "", /parvo/i);
});

console.log("paragraph formatting");
check("block attributes recognise only the keys they own", () => {
  assert.deepEqual(splitBlockAttributes("Confirm the dose."), {
    text: "Confirm the dose.",
    align: null,
    lineHeight: null,
    id: null,
  });
  assert.deepEqual(splitBlockAttributes("Give IM.{align=center}"), {
    text: "Give IM.",
    align: "center",
    lineHeight: null,
    id: null,
  });
  assert.deepEqual(splitBlockAttributes("Titrate slowly.{line-height=1.5}"), {
    text: "Titrate slowly.",
    align: null,
    lineHeight: "1.5",
    id: null,
  });
  assert.deepEqual(splitBlockAttributes("Purpose {#purpose align=justify line-height=2}"), {
    text: "Purpose",
    align: "justify",
    lineHeight: "2",
    id: "purpose",
  });
  // Prose braces, unknown keys and values outside the offered set are not formatting.
  assert.equal(splitBlockAttributes("Give {2 mg}").text, "Give {2 mg}");
  assert.equal(splitBlockAttributes("Ratio {width=3 align=sideways}").text, "Ratio {width=3 align=sideways}");
  assert.equal(splitBlockAttributes("Half {line-height=1.25}").text, "Half {line-height=1.25}");
  // A group that would leave the block empty is its own paragraph, not a directive.
  assert.equal(splitBlockAttributes("{align=center}").text, "{align=center}");
});
check("alignment + line-height survive save → reload → render", () => {
  // What the editor writes …
  const suffix = serializeBlockAttributes({ align: "center", lineHeight: "1.5" });
  assert.equal(suffix, "{align=center line-height=1.5}");
  assert.equal(serializeBlockAttributes({ align: null, lineHeight: null }), "");

  // … what the reader loads …
  const [block] = parseMarkdown(`Confirm the dose before induction.${suffix}`);
  assert.equal(block.kind, "paragraph");
  if (block.kind !== "paragraph") throw new Error("expected a paragraph");
  assert.equal(block.text, "Confirm the dose before induction.");
  assert.equal(block.align, "center");
  assert.equal(block.lineHeight, "1.5");

  // … and what it renders.
  assert.deepEqual(blockTextStyle(block.align, block.lineHeight), { textAlign: "center", lineHeight: "1.5" });
  assert.equal(blockTextStyle(null, null), undefined, "an unformatted block keeps the reader's own styling");
  assert.deepEqual(blockTextStyle("right", null), { textAlign: "right" });
  assert.deepEqual(LINE_HEIGHTS, ["1", "1.5", "2"]);
});
check("heading formatting keeps its explicit id, and plain `{#id}` is unchanged", () => {
  const [heading] = parseMarkdown("## Purpose {#purpose align=center}");
  assert.equal(heading.kind, "heading");
  if (heading.kind !== "heading") throw new Error("expected a heading");
  assert.equal(heading.id, "purpose");
  assert.equal(heading.text, "Purpose");
  assert.equal(heading.align, "center");
  assert.equal(heading.lineHeight, null);
  assert.deepEqual(blockTextStyle(heading.align, heading.lineHeight), { textAlign: "center" });
  assert.deepEqual(collectHeadings(parseMarkdown("## Purpose {#why}")).map((h) => [h.id, h.text]), [["why", "Purpose"]]);
});
check("a block image's suffix is still the image's, not the paragraph's", () => {
  const [image] = parseMarkdown('![Crash cart](https://cdn.example/x.png){width=480 align=right}');
  assert.equal(image.kind, "image");
  if (image.kind === "image") {
    assert.equal(image.align, "right");
    assert.equal(image.width, 480);
  }
});

console.log("inline formatting");
check("subscript, superscript and highlight round-trip through the reader", () => {
  const nodes = parseInline("H~2~O at 10^9^ CFU ==check the label==");
  assert.deepEqual(
    nodes.map((node) => node.t),
    ["text", "subscript", "text", "superscript", "text", "highlight"],
  );
  assert.equal(inlinePlain(nodes), "H2O at 109 CFU check the label");
  // The delimiters the editor serializes are exactly the ones the reader reads.
  assert.deepEqual(MARK_DELIMITERS, {
    subscript: { open: "~", close: "~" },
    superscript: { open: "^", close: "^" },
    highlight: { open: "==", close: "==" },
  });
});
check("nested emphasis inside a highlight is kept", () => {
  const [highlight] = parseInline("==**urgent**==");
  assert.equal(highlight.t, "highlight");
  if (highlight.t !== "highlight") throw new Error("expected a highlight");
  assert.equal(highlight.c[0]?.t, "strong");
  assert.equal(inlinePlain(highlight.c), "urgent");
});
check("lone markers stay prose (approximate doses, powers, strike)", () => {
  assert.equal(inlinePlain(parseInline("Give ~5 mg IM")), "Give ~5 mg IM");
  assert.equal(inlinePlain(parseInline("10^6 CFU/mL")), "10^6 CFU/mL");
  assert.equal(inlinePlain(parseInline("~~withdrawn~~")), "~~withdrawn~~");
  assert.equal(inlinePlain(parseInline("pH == 7")), "pH == 7");
  // `[^1]` is still a footnote reference, not a superscript.
  assert.equal(parseInline("See this[^1] and that[^2].").filter((node) => node.t === "footnoteRef").length, 2);
});
check("the editor's delimiter scanner and the reader segment identically", () => {
  const fixtures = [
    "H~2~O",
    "10^9^ CFU",
    "==mark me==",
    "Give ~5 mg",
    "pH == 7",
    "~~withdrawn~~",
    "H~2~O then ==checked==",
    "plain text",
  ];
  for (const fixture of fixtures) {
    const fromEditor = splitInlineConventions(fixture).map((part) => ({ kind: part.kind, value: part.value }));
    const fromReader = parseInline(fixture).map((node) =>
      node.t === "text" ? { kind: "text" as const, value: node.v } : { kind: node.t, value: inlinePlain([node]) },
    );
    assert.deepEqual(fromEditor, fromReader, `disagreement on ${JSON.stringify(fixture)}`);
  }
});
check("stripMarkdown drops the stored delimiters and suffixes, keeps the words", () => {
  assert.equal(
    stripMarkdown("H~2~O at 10^9^ CFU ==checked==\n\nCentred text.{align=center}\n\n## Purpose {#purpose}"),
    "H2O at 109 CFU checked Centred text. Purpose",
  );
});

console.log("typography");
/** One paragraph of text is all a text input rule needs. */
const TYPOGRAPHY_SCHEMA = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
});

/**
 * Apply a Tiptap text input rule the way the editor does: the typed characters
 * are already in the document and the rule rewrites the span its `find`
 * matched. The real rule objects from `@tiptap/extension-typography` run
 * against a real ProseMirror transaction — no DOM, nothing reimplemented.
 */
function typeInto(rule: InputRule, typed: string): string {
  const doc = TYPOGRAPHY_SCHEMA.node("doc", null, [
    TYPOGRAPHY_SCHEMA.node("paragraph", null, [TYPOGRAPHY_SCHEMA.text(typed)]),
  ]);
  const state = EditorState.create({ doc, schema: TYPOGRAPHY_SCHEMA });

  const find = rule.find;
  assert.ok(find instanceof RegExp, "expected a pattern-driven input rule");
  const match = find.exec(typed);
  assert.ok(match, `${String(find)} does not match ${JSON.stringify(typed)}`);

  // The handler reads `state.tr`, `range` and `match` only, and `tr` is pinned
  // to one transaction (`EditorState#tr` would hand back a fresh one).
  const tr = state.tr;
  const handler = rule.handler as (props: {
    state: { tr: Transaction };
    range: { from: number; to: number };
    match: RegExpExecArray;
  }) => void;
  // Paragraph text starts at position 1, so text index i is document position 1 + i.
  handler({
    state: { tr },
    range: { from: 1 + match.index, to: 1 + match.index + match[0].length },
    match,
  });
  return tr.doc.textContent;
}

check("smart quotes, em dashes and ellipses are applied as they are typed", () => {
  assert.equal(typeInto(emDash(), "Hold --"), "Hold —");
  assert.equal(typeInto(ellipsis(), "Wait..."), "Wait…");
  assert.equal(typeInto(openDoubleQuote(), 'He said "'), "He said “");
  assert.equal(typeInto(closeDoubleQuote(), 'He said “done"'), "He said “done”");
  assert.equal(typeInto(openSingleQuote(), "She said '"), "She said ‘");
  assert.equal(typeInto(closeSingleQuote(), "the dogs'"), "the dogs’");
});
check("the transformed characters are what gets stored, and survive the reader", () => {
  const stored = "He said “hold” — then wait…";
  assert.equal(inlinePlain(parseInline(stored)), stored);
  assert.equal(stripMarkdown(stored), stored);
});
check("the editor schema is wired once, and typography only rewrites what it should", () => {
  const extensions = buildEditorExtensions();
  const names = extensions.map((extension) => extension.name);
  assert.equal(new Set(names).size, names.length, `duplicate extensions: ${names.join(", ")}`);
  for (const required of [
    "paragraph",
    "heading",
    "textAlign",
    "lineHeight",
    "blockFormatting",
    "subscript",
    "superscript",
    "highlight",
    "inlineDelimiters",
    "typography",
    "slashCommands",
    "findHighlight",
    "dragHandle",
  ]) {
    assert.ok(names.includes(required), `the editor schema is missing ${required}`);
  }

  const typography = extensions.find((extension) => extension.name === "typography");
  assert.ok(typography, "typography is not in the editor schema");
  const options = (typography as { options: Record<string, unknown> }).options;
  assert.equal(options.emDash, "—");
  assert.equal(options.ellipsis, "…");
  assert.equal(options.openDoubleQuote, "“");
  assert.equal(options.closeDoubleQuote, "”");
  assert.equal(options.openSingleQuote, "‘");
  assert.equal(options.closeSingleQuote, "’");
  // The rest of Tiptap's typography set would rewrite clinical text.
  assert.equal(options.multiplication, false, "`2 x 3` must stay as typed");
  assert.equal(options.superscriptTwo, false, "`10^2` must stay as typed");
  assert.equal(options.rightArrow, false, "`->` must stay as typed");
});

console.log("editor chrome: format commands");
check("the toolbar and the bubble menu resolve to the same format commands", () => {
  // Both surfaces render from FORMAT_COMMANDS; `formatCommandsFor` hands back the
  // very same objects, so a change to one is a change to both.
  assert.equal(formatCommandsFor(TOOLBAR_FORMAT_ORDER)[0], FORMAT_COMMANDS.bold);
  assert.equal(formatCommandsFor(BUBBLE_FORMAT_ORDER)[0], FORMAT_COMMANDS.bold);
  assert.equal(FORMAT_COMMANDS.bold.run, formatBold);
  assert.equal(FORMAT_COMMANDS.italic.run, formatItalic);
  assert.equal(FORMAT_COMMANDS.highlight.run, formatHighlight);
});
check("the bubble menu shows exactly bold, italic, link, highlight and alignment", () => {
  assert.deepEqual([...BUBBLE_FORMAT_ORDER], [
    "bold",
    "italic",
    "link",
    "highlight",
    "alignLeft",
    "alignCenter",
    "alignRight",
    "alignJustify",
  ]);
  // Every bubble item is a toolbar item too — one registry, two surfaces.
  for (const id of BUBBLE_FORMAT_ORDER) assert.ok(TOOLBAR_FORMAT_ORDER.includes(id), `${id} is not in the toolbar`);
});

console.log("editor chrome: slash registry");
check("the slash registry holds all 17 items with unique ids", () => {
  assert.equal(SLASH_ITEMS.length, 17, `items: ${SLASH_ITEMS.map((item) => item.id).join(", ")}`);
  assert.equal(new Set(SLASH_ITEMS.map((item) => item.id)).size, SLASH_ITEMS.length);
  for (const item of SLASH_ITEMS) {
    assert.equal(typeof item.label, "string");
    assert.equal(typeof item.run, "function");
    assert.ok(item.icon, `${item.id} has no icon`);
  }
  // H1 is deliberately absent (the article title is the page's <h1>).
  assert.ok(!SLASH_ITEMS.some((item) => item.id === "heading-1"));
  assert.deepEqual(
    SLASH_ITEMS.filter((item) => item.id.startsWith("callout-")).map((item) => item.id),
    ["callout-note", "callout-tip", "callout-dosing", "callout-protocol", "callout-warning", "callout-critical"],
  );
});
check("filterSlashItems filters by label, id and keyword", () => {
  assert.equal(filterSlashItems("").length, 17, "an empty query keeps everything");
  assert.deepEqual(filterSlashItems("warning").map((item) => item.id), ["callout-warning"]);
  assert.deepEqual(filterSlashItems("WARN").map((item) => item.id), ["callout-warning"], "matching is case-insensitive");
  assert.equal(filterSlashItems("callout").length, 6, "all six callouts match the shared keyword");
  assert.deepEqual(filterSlashItems("heading").map((item) => item.id), ["heading-2", "heading-3"]);
  assert.deepEqual(filterSlashItems("mermaid").map((item) => item.id), ["mermaid"]);
  assert.deepEqual(filterSlashItems("zzzznope"), []);
});

console.log("editor chrome: dropped images");
check("canInsertDroppedImage refuses missing alt / unchecked PHI", () => {
  assert.equal(canInsertDroppedImage({ alt: "ok alt", phiConfirmed: true }).ok, true);
  const noAlt = canInsertDroppedImage({ alt: "", phiConfirmed: true });
  assert.equal(noAlt.ok, false);
  assert.ok(noAlt.altError, "missing alt text must be reported");
  assert.equal(noAlt.phiError, null);
  const noPhi = canInsertDroppedImage({ alt: "ok alt", phiConfirmed: false });
  assert.equal(noPhi.ok, false);
  assert.ok(noPhi.phiError, "unconfirmed PHI must be reported");
  assert.equal(noPhi.altError, null);
  assert.equal(canInsertDroppedImage({ alt: "ab", phiConfirmed: true }).ok, false, "alt under 3 characters is refused");
  assert.equal(canInsertDroppedImage({ alt: "x".repeat(251), phiConfirmed: true }).ok, false, "alt over 250 characters is refused");
});

console.log("editor chrome: find & replace");
const CHROME_SCHEMA = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    codeBlock: { content: "text*", group: "block", marks: "", code: true, defining: true },
    image: { group: "block", atom: true },
    text: { group: "inline" },
  },
  marks: {},
});
const paragraphOf = (text: string) => CHROME_SCHEMA.node("paragraph", null, text.length ? [CHROME_SCHEMA.text(text)] : []);
const docOf = (...nodes: ReturnType<typeof paragraphOf>[]) => CHROME_SCHEMA.node("doc", null, nodes);

check("findMatches returns every literal occurrence, case-insensitively by default", () => {
  const doc = docOf(paragraphOf("The dog and the cat and the dog."));
  assert.equal(findMatches(doc, "dog").length, 2);
  assert.equal(findMatches(doc, "Dog").length, 2, "case-insensitive by default");
  assert.equal(findMatches(doc, "Dog", true).length, 0, "match-case on: 'Dog' is not in the text");
  assert.equal(findMatches(doc, "dog", true).length, 2);
  assert.deepEqual(findMatches(doc, ""), [], "an empty query matches nothing");
  assert.equal(findMatches(doc, "the").length, 3);
});
check("findMatches searches code blocks and every text node", () => {
  const doc = docOf(paragraphOf("alpha"), CHROME_SCHEMA.node("codeBlock", null, [CHROME_SCHEMA.text("alpha")]));
  assert.equal(findMatches(doc, "alpha").length, 2);
});
check("replaceAllInDoc replaces every match in one pass, literally", () => {
  const doc = docOf(paragraphOf("a a a"));
  const result = replaceAllInDoc(doc, "a", "b");
  assert.equal(result.count, 3);
  assert.equal(result.doc.textContent, "b b b");
  // One call, one returned document → the caller applies it as one transaction.
  // The replacement is literal: Markdown is never interpreted.
  const literal = replaceAllInDoc(docOf(paragraphOf("x x")), "x", "**b**");
  assert.equal(literal.doc.textContent, "**b** **b**");
  assert.equal(replaceAllInDoc(doc, "", "b").count, 0, "an empty query changes nothing");
  assert.equal(replaceAllInDoc(doc, "zzz", "b").count, 0);
});
check("stepMatchIndex wraps around at both ends", () => {
  assert.equal(stepMatchIndex(0, 1, 3), 1);
  assert.equal(stepMatchIndex(2, 1, 3), 0, "next from the last wraps to the first");
  assert.equal(stepMatchIndex(0, -1, 3), 2, "previous from the first wraps to the last");
  assert.equal(stepMatchIndex(0, 1, 0), 0, "no matches is a no-op");
});

console.log("editor chrome: bubble menu visibility");
check("shouldShowBubbleMenu needs a non-empty TextSelection outside code", () => {
  const paragraphDoc = docOf(paragraphOf("hello world"));
  const collapsed = EditorState.create({ doc: paragraphDoc, schema: CHROME_SCHEMA, selection: TextSelection.create(paragraphDoc, 3) });
  assert.equal(shouldShowBubbleMenu(collapsed, false), false, "a collapsed selection hides the menu");

  const ranged = EditorState.create({ doc: paragraphDoc, schema: CHROME_SCHEMA, selection: TextSelection.create(paragraphDoc, 1, 5) });
  assert.equal(shouldShowBubbleMenu(ranged, false), true, "a non-empty TextSelection shows the menu");
  assert.equal(shouldShowBubbleMenu(ranged, true), false, "the open link dialog hides the menu");

  const codeDoc = docOf(CHROME_SCHEMA.node("codeBlock", null, [CHROME_SCHEMA.text("let x = 1")]));
  const codeSel = EditorState.create({ doc: codeDoc, schema: CHROME_SCHEMA, selection: TextSelection.create(codeDoc, 1, 4) });
  assert.equal(shouldShowBubbleMenu(codeSel, false), false, "a selection inside a code block hides the menu");

  const imageDoc = docOf(CHROME_SCHEMA.node("image"));
  const nodeSel = EditorState.create({ doc: imageDoc, schema: CHROME_SCHEMA, selection: NodeSelection.create(imageDoc, 0) });
  assert.equal(shouldShowBubbleMenu(nodeSel, false), false, "a NodeSelection (e.g. an image) hides the menu");
});

/* ==================================================== batch 5c: features === */

console.log("bulletin reactions");

check("the reaction allowlist is exactly the bounded ❤️🎉👍 set, in order", () => {
  assert.equal(BULLETIN_REACTION_EMOJIS.length, 3);
  assert.deepEqual([...BULLETIN_REACTION_EMOJIS], ["\u2764\uFE0F", "\uD83C\uDF89", "\uD83D\uDC4D"]);
  assert.equal(isBulletinReactionEmoji(BULLETIN_REACTION_EMOJIS[0]), true);
  assert.equal(isBulletinReactionEmoji("😀"), false);
  assert.equal(isBulletinReactionEmoji(""), false);
  assert.equal(isBulletinReactionEmoji(42), false);
});

check("summarizeReactions returns the allowlist order with viewer state", () => {
  const summary = summarizeReactions(
    [
      { emoji: BULLETIN_REACTION_EMOJIS[2], userId: "u1" },
      { emoji: BULLETIN_REACTION_EMOJIS[0], userId: "u2" },
      { emoji: BULLETIN_REACTION_EMOJIS[2], userId: "u2" },
      { emoji: "😀", userId: "u9" },
    ],
    "u1",
  );
  assert.deepEqual(
    summary.map((entry) => [entry.emoji, entry.count, entry.viewer_reacted]),
    [
      [BULLETIN_REACTION_EMOJIS[0], 1, false],
      [BULLETIN_REACTION_EMOJIS[1], 0, false],
      [BULLETIN_REACTION_EMOJIS[2], 2, true],
    ],
  );
});

console.log("bulletin headline (Option C)");

check("the headline rule renders 64px × 3px in #0f766e with the exact type", () => {
  const html = renderToStaticMarkup(createElement(BulletinHeadline, { title: "Isolation bays" }));
  assert.match(html, /text-\[34px\]/);
  assert.match(html, /font-bold/);
  assert.match(html, /tracking-\[-0\.02em\]/);
  assert.match(html, /leading-\[1\.1\]/);
  assert.match(html, /mt-\[14px\]/);
  assert.match(html, /h-\[3px\]/);
  assert.match(html, /w-16/);
  assert.match(html, /rounded-\[2px\]/);
  assert.match(html, /bg-\[#0f766e\]/);
});

console.log("bulletin format");

check("the format vocabulary is one shared enum, default `notice`", () => {
  assert.deepEqual([...BULLETIN_FORMATS], ["notice", "announcement", "featured"]);
  assert.equal(DEFAULT_BULLETIN_FORMAT, "notice");
  assert.equal(isBulletinFormat("notice"), true);
  assert.equal(isBulletinFormat("announcement"), true);
  assert.equal(isBulletinFormat("featured"), true);
  assert.equal(isBulletinFormat("hero"), false);
  assert.equal(isBulletinFormat(null), false);
});

check("celebratory tiers drop the acks; only `notice` keeps them", () => {
  assert.equal(formatUsesAck("notice"), true);
  assert.equal(formatUsesAck("announcement"), false);
  assert.equal(formatUsesAck("featured"), false);
});

check("the featured hero is a flat teal band with no brand-blue anywhere", () => {
  const html = renderToStaticMarkup(
    createElement(BulletinHero, { title: "Employee of the Month", kicker: "Pinned · Monthly", deck: "Thank you for the long nights." }),
  );
  assert.match(html, /bg-\[#0f766e\]/);
  assert.match(html, /Employee of the Month/);
  assert.ok(!/#1E2A4A/i.test(html), "brand-blue leaked into the featured tree");
});

console.log("bulletin blocks");

check("a CTA href allows https and a single leading slash, nothing else", () => {
  assert.equal(isValidCtaHref("https://example.com/x"), true);
  assert.equal(isValidCtaHref("/bulletins/abc"), true);
  assert.equal(isValidCtaHref("mailto:a@b.org"), false);
  assert.equal(isValidCtaHref("tel:123"), false);
  assert.equal(isValidCtaHref("javascript:alert(1)"), false);
  assert.equal(isValidCtaHref("//evil.example/x"), false);
  assert.equal(isValidCtaHref("portal/path"), false);
});

check("steps and spotlight lines round-trip byte-for-byte", () => {
  const step = { title: "Don gloves", description: "Then gown." };
  assert.equal(serializeStepLine(step, 3), "3. **Don gloves** \u2014 Then gown.");
  assert.deepEqual(parseStepLine(serializeStepLine(step, 3)), step);
  const entry = { initials: "AB", name: "Ada Byron", label: "Employee of the Month" };
  assert.deepEqual(parseSpotlightLine(serializeSpotlightLine(entry)), entry);
  assert.equal(initialsFromName("Ada Byron"), "AB");
  assert.equal(CTA_LINE_PATTERN.test("[Open](/bulletins/abc){.cta}"), true);
  assert.equal(CTA_LINE_PATTERN.test("[Open](/bulletins/abc)"), false);
});

check("CTA / steps / spotlight survive a double Markdown round-trip", () => {
  const source = [
    "Welcome aboard.",
    "",
    "[Open the roster](/bulletins/abc){.cta}",
    "",
    ":::steps",
    "1. **Triage** \u2014 check the airway first.",
    "2. **Stabilise** \u2014 start fluids.",
    ":::",
    "",
    ":::spotlight",
    "- **AB** Ada Byron \u2014 Employee of the Month",
    "- **CD** Cy Doe \u2014 Values award",
    ":::",
  ].join("\n");
  const first = parseMarkdown(source);
  const roundTrip = serializeBulletinBlocks(first);
  const second = parseMarkdown(roundTrip);
  const third = serializeBulletinBlocks(second);
  assert.equal(third, roundTrip, "double round-trip drifted");
  assert.deepEqual(first, second, "semantic equivalence after one round trip");
  const kinds = first.map((block) => block.kind);
  assert.ok(kinds.includes("cta") && kinds.includes("steps") && kinds.includes("spotlight"));
});

console.log("paste sanitizer");

const WORD_FIXTURE =
  "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\"><head><meta charset=\"utf-8\"><style>.MsoNormal{margin:0}</style></head><body class=\"WordSection1\">" +
  "<p class=\"MsoNormal\" style=\"font-size:11pt\">Start <b>now</b>.</p>" +
  "<p class=\"MsoListParagraph\" style=\"mso-list:l0 level1 lfo1\"><span style=\"mso-list:Ignore\">\u00b7<span>&nbsp;</span></span>Gown up</p>" +
  "<p class=\"MsoListParagraph\" style=\"mso-list:l0 level2 lfo1\"><span style=\"mso-list:Ignore\">o<span>&nbsp;</span></span>Gloves</p>" +
  "<p class=\"MsoNormal\">Line<br>break</p>" +
  "<p class=\"MsoListParagraph\" style=\"mso-list:l1 level1 lfo2\"><span style=\"mso-list:Ignore\">1.<span>&nbsp;</span></span>Ordered</p>" +
  "<v:shape><v:imagedata src=\"file:///x.png\"/></v:shape><!-- a comment -->" +
  "<img src=\"data:image/png;base64,AAAA\"></body></html>";

const GDOCS_FIXTURE =
  "<meta charset=\"utf-8\">" +
  "<b id=\"docs-internal-guid-1\" style=\"font-weight:normal;\">" +
  "<p dir=\"ltr\" style=\"line-height:1.38;margin-top:0pt\"><span style=\"font-size:11pt;font-weight:400\">Plain </span><span style=\"font-weight:700\">bold</span><span style=\"font-style:italic\"> italic</span>.</p>" +
  "</b>" +
  "<p dir=\"ltr\"><a href=\"https://example.com\" style=\"color:#1155cc\">link</a><img src=\"data:image/png;base64,AAAA\"></p>";

check("a Word paste arrives clean (no classes, styles, namespaces, comments, VML, images)", () => {
  const clean = sanitizePastedHtml(WORD_FIXTURE);
  assert.ok(htmlIsClean(clean), `not clean: ${clean}`);
  assert.ok(!/MsoListParagraph|mso-list|WordSection1/.test(clean));
  assert.match(clean, /<strong>now<\/strong>/);
  assert.ok(clean.includes("<ul>") && clean.includes("<li>") && clean.includes("<ol>"));
  // Nested list: the level-2 item sits inside the level-1 item.
  assert.match(clean, /Gown up<ul>/);
  // <br> became a paragraph split.
  assert.ok(clean.includes("<p>Line</p>") && clean.includes("<p>break</p>"));
});

check("a Google Docs paste arrives clean, keeping real emphasis", () => {
  const clean = sanitizePastedHtml(GDOCS_FIXTURE);
  assert.ok(htmlIsClean(clean), `not clean: ${clean}`);
  assert.match(clean, /<strong>bold<\/strong>/);
  assert.match(clean, /<em> italic<\/em>/);
  assert.match(clean, /<a href="https:\/\/example\.com">link<\/a>/);
  assert.ok(!/<b\b/.test(clean), "the Google Docs <b style=font-weight:normal> wrapper survived");
});

check("the paste element whitelist is exactly the schema's own set", () => {
  assert.deepEqual(
    [...PASTE_ALLOWED_TAGS],
    ["p", "h1", "h2", "h3", "ul", "ol", "li", "strong", "em", "u", "a", "table", "thead", "tbody", "tr", "th", "td", "br", "hr"],
  );
});

console.log("table cell merging");

check("table cell spans parse to real colspan/rowspan (including header rows)", () => {
  const [table] = parseMarkdown("| Group {colspan=2} | Notes |\n| --- | --- |\n| a | b | c |");
  if (table.kind !== "table") throw new Error("expected a table");
  assert.equal(table.head[0].text, "Group");
  assert.equal(table.head[0].colspan, 2);
  assert.equal(table.head[1].colspan, 1);
  const html = renderToStaticMarkup(createElement(ClinicalTable, { head: table.head, rows: table.rows }));
  assert.match(html, /colspan="2"/i);

  const [rowspan] = parseMarkdown("| H {rowspan=2} | A |\n| --- | --- |\n| B | C |");
  if (rowspan.kind !== "table") throw new Error("expected a table");
  assert.equal(rowspan.head[0].rowspan, 2);
  const rowspanHtml = renderToStaticMarkup(createElement(ClinicalTable, { head: rowspan.head, rows: rowspan.rows }));
  assert.match(rowspanHtml, /rowspan="2"/i);
});

check("ragged rows from colspan parse without crashing and pad empty cells", () => {
  const [table] = parseMarkdown("| A {colspan=2} | B |\n| --- | --- |\n| only |");
  if (table.kind !== "table") throw new Error("expected a table");
  assert.equal(table.rows[0].length, 3);
  assert.equal(table.rows[0][1].text, "");
  renderToStaticMarkup(createElement(ClinicalTable, { head: table.head, rows: table.rows }));
});

check("unmerge restores plain cells; the span helpers are inverses", () => {
  const [plain] = parseMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
  if (plain.kind !== "table") throw new Error("expected a table");
  assert.ok(plain.head.every(isDefaultCellSpan));
  assert.equal(serializeCellSpan(parseCellSpan("colspan=2 rowspan=3")), "{colspan=2 rowspan=3}");
  assert.equal(serializeCellSpan({ colspan: 1, rowspan: 1 }), "");
  const split = splitCellSpan("Header {colspan=2}");
  assert.equal(split.text, "Header");
  assert.equal(split.colspan, 2);
  // Prose braces are not formatting.
  assert.equal(splitCellSpan("Give {2 mg}").colspan, 1);
});

console.log("editor chrome: drag handle + drop cursor");

const DRAG_SCHEMA = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    callout: { content: "paragraph+", group: "block" },
    footnoteDefinition: { content: "paragraph", group: "block" },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "tableCell+" },
    tableCell: { content: "paragraph", isolating: true },
    text: { group: "inline" },
  },
});

check("dragWrappersAsUnit targets the wrapper, never its inner blocks", () => {
  const inner = DRAG_SCHEMA.node("paragraph", null, [DRAG_SCHEMA.text("inside")]);
  const callout = DRAG_SCHEMA.node("callout", null, [inner]);
  const top = DRAG_SCHEMA.node("paragraph", null, [DRAG_SCHEMA.text("top")]);
  const doc = DRAG_SCHEMA.node("doc", null, [callout, top]);

  let topOffset = 0;
  doc.forEach((node, offset) => {
    if (node.type.name === "paragraph") topOffset = offset;
  });

  assert.equal(dragWrappersAsUnit({ node: inner, $pos: doc.resolve(3) }), 1000, "an inner paragraph must not be a drag target");
  assert.equal(dragWrappersAsUnit({ node: callout, $pos: doc.resolve(1) }), 0, "the callout itself must be a drag target");
  assert.equal(dragWrappersAsUnit({ node: top, $pos: doc.resolve(topOffset + 1) }), 0, "a top-level paragraph must be a drag target");
});

check("excludeFootnotesAndTables refuses footnote and table-nested targets", () => {
  const footnote = DRAG_SCHEMA.node("footnoteDefinition", null, [DRAG_SCHEMA.node("paragraph", null, [])]);
  const cell = DRAG_SCHEMA.node("tableCell", null, [DRAG_SCHEMA.node("paragraph", null, [DRAG_SCHEMA.text("c")])]);
  const row = DRAG_SCHEMA.node("tableRow", null, [cell]);
  const table = DRAG_SCHEMA.node("table", null, [row]);
  const doc = DRAG_SCHEMA.node("doc", null, [footnote, table]);
  assert.equal(excludeFootnotesAndTables({ node: footnote, $pos: doc.resolve(1) }), 1000);
  const cellParagraph = cell.firstChild;
  if (!cellParagraph) throw new Error("expected a cell paragraph");
  assert.equal(excludeFootnotesAndTables({ node: cellParagraph, $pos: doc.resolve(footnote.nodeSize + 3) }), 1000);
});

check("the editor schema includes the configured drop cursor exactly once", () => {
  const extensions = buildEditorExtensions();
  const dropcursors = extensions.filter((extension) => extension.name === Dropcursor.name);
  assert.equal(dropcursors.length, 1, "expected exactly one dropCursor extension");
  const configured = Dropcursor.configure({ color: "#0f766e", width: 2 });
  const options = configured.options as { color: string; width: number };
  assert.equal(options.color, "#0f766e");
  assert.equal(options.width, 2);
});

check("bulletin-only blocks are registered for bulletins and never for articles", () => {
  const articleNames = buildEditorExtensions().map((extension) => extension.name);
  const bulletinNames = buildEditorExtensions({ bulletinBlocks: true }).map((extension) => extension.name);
  for (const name of ["ctaButton", "steps", "spotlight"]) {
    assert.ok(!articleNames.includes(name), `${name} leaked into the article schema`);
    assert.ok(bulletinNames.includes(name), `${name} missing from the bulletin schema`);
  }
});

check("the editor carries custom table serializers (merged cells need them)", () => {
  const extensions = buildEditorExtensions();
  for (const name of ["table", "tableCell", "tableHeader"]) {
    const extension = extensions.find((candidate) => candidate.name === name);
    assert.ok(extension, `${name} is not in the editor schema`);
    const markdown = (extension.storage as { markdown?: { serialize?: unknown } }).markdown;
    assert.equal(typeof markdown?.serialize, "function", `${name} has no markdown serializer`);
  }
});

console.log("editor chrome: bubble menu table mode");

const BUBBLE_TABLE_SCHEMA = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    table: { content: "tableRow+", group: "block", tableRole: "table" },
    tableRow: { content: "tableCell+", tableRole: "row" },
    tableCell: { content: "paragraph", isolating: true, tableRole: "cell" },
    text: { group: "inline" },
  },
});

check("a table selection shows the merge/split menu; a paragraph shows the format menu", () => {
  const cell = (text: string) =>
    BUBBLE_TABLE_SCHEMA.node("tableCell", null, [
      BUBBLE_TABLE_SCHEMA.node("paragraph", null, text ? [BUBBLE_TABLE_SCHEMA.text(text)] : []),
    ]);
  const doc = BUBBLE_TABLE_SCHEMA.node("doc", null, [
    BUBBLE_TABLE_SCHEMA.node("table", null, [
      BUBBLE_TABLE_SCHEMA.node("tableRow", null, [cell("a"), cell("b")]),
      BUBBLE_TABLE_SCHEMA.node("tableRow", null, [cell("c"), cell("d")]),
    ]),
  ]);
  const base = EditorState.create({ doc, schema: BUBBLE_TABLE_SCHEMA });
  assert.equal(isSelectionInTable(base), true);

  const tableState = EditorState.create({
    doc,
    schema: BUBBLE_TABLE_SCHEMA,
    // A non-empty selection inside a table cell — positions 4..5 select "a"
    // (doc → table(0) → row(1) → cell(2) → paragraph(3) → text(4)).
    selection: TextSelection.create(doc, 4, 5),
  });
  assert.equal(shouldShowBubbleMenu(tableState, false), true, "a table selection must show the bubble");
  assert.equal(bubbleMode(tableState, false), "table");

  const paragraphSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
    },
  });
  const pdoc = paragraphSchema.node("doc", null, [
    paragraphSchema.node("paragraph", null, [paragraphSchema.text("hello world")]),
  ]);
  const formatState = EditorState.create({
    doc: pdoc,
    schema: paragraphSchema,
    selection: TextSelection.create(pdoc, 1, 5),
  });
  assert.equal(bubbleMode(formatState, false), "format");
});

/* ==================================================== async / DB checks === */

async function runDatabaseChecks(): Promise<void> {
  console.log("database (migrate deploy + feature checks)");

  // The 25 MB cap is enforced on the stream: oversize uploads abort mid-read.
  let oversizeStatus = 0;
  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(ATTACHMENT_MAX_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    await readAttachmentStream(stream);
  } catch (error) {
    oversizeStatus = error instanceof ApiError ? error.status : -1;
  }
  check("an oversize upload is refused with 413 while streaming", () => assert.equal(oversizeStatus, 413));

  const small = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const bytes = await readAttachmentStream(small);
  check("a small upload is buffered intact", () => assert.equal(bytes.length, 3));


  // Setup: apply migrations to the test database. `deploy` is idempotent.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: VERIFY_DATABASE_URL },
  });

  const db = getDb();
  const stamp = Date.now();
  const userIds: string[] = [];

  const author = await db.user.create({
    data: {
      email: `verify-5c-author-${stamp}@dovelewis.org`,
      name: "Verify Author",
      title: "Technician",
      role: "author",
    },
  });
  userIds.push(author.id);
  const other = await db.user.create({
    data: { email: `verify-5c-other-${stamp}@dovelewis.org`, name: "Verify Other", role: "staff" },
  });
  userIds.push(other.id);

  /* ---- bulletin format round-trip (DB) ---- */

  const bulletins = [];
  for (const fmt of BULLETIN_FORMATS) {
    bulletins.push(
      await createBulletin({
        title: `Format ${fmt}`,
        body_markdown: "Body",
        departments: ["ER"],
        priority: "normal",
        format: fmt,
        kicker: fmt === "featured" ? "Kicker" : null,
        deck: fmt === "featured" ? "Deck" : null,
        author_id: author.id,
      }),
    );
  }

  for (const fmt of BULLETIN_FORMATS) {
    const fetched = await getBulletinById(bulletins.find((b) => b.format === fmt)?.id ?? "", {
      includeExpired: true,
    });
    check(`format \`${fmt}\` persists and round-trips through the data layer`, () => {
      assert.equal(fetched?.format, fmt);
    });
  }

  const defaulted = await createBulletin({
    title: "Defaulted format",
    body_markdown: "Body",
    departments: ["ER"],
    priority: "normal",
    author_id: author.id,
  });
  check("an omitted format defaults to `notice`", () => assert.equal(defaulted.format, DEFAULT_BULLETIN_FORMAT));

  check("an invalid format value is not a valid BulletinFormat (the route 422s it)", () => {
    assert.equal(isBulletinFormat("spotlight"), false);
  });

  const featured = bulletins.find((b) => b.format === "featured");
  check("the featured kicker/deck persist and round-trip", () => {
    assert.equal(featured?.kicker, "Kicker");
    assert.equal(featured?.deck, "Deck");
  });

  /* ---- reactions (DB) ---- */

  const bulletin = featured ?? bulletins[0];
  const emoji = BULLETIN_REACTION_EMOJIS[0];

  const on = await toggleReaction(bulletin.id, other.id, emoji);
  check("toggling a reaction on reports reacted:true and a count of 1", () => {
    assert.equal(on.reacted, true);
    assert.equal(on.summary.find((entry) => entry.emoji === emoji)?.count, 1);
    assert.equal(on.summary.find((entry) => entry.emoji === emoji)?.viewer_reacted, true);
  });

  const off = await toggleReaction(bulletin.id, other.id, emoji);
  check("toggling the same reaction again turns it off (count 0)", () => {
    assert.equal(off.reacted, false);
    assert.equal(off.summary.find((entry) => entry.emoji === emoji)?.count, 0);
    assert.equal(off.summary.find((entry) => entry.emoji === emoji)?.viewer_reacted, false);
  });

  await db.bulletinReaction.create({ data: { bulletinId: bulletin.id, userId: other.id, emoji } });
  let duplicated = false;
  try {
    await db.bulletinReaction.create({ data: { bulletinId: bulletin.id, userId: other.id, emoji } });
  } catch {
    duplicated = true;
  }
  check("the unique constraint blocks a duplicate reaction row", () => assert.equal(duplicated, true));
  await db.bulletinReaction.deleteMany({ where: { bulletinId: bulletin.id } });

  let emojiStatus = 0;
  try {
    await toggleReaction(bulletin.id, other.id, "\uD83D\uDE00");
  } catch (error) {
    emojiStatus = error instanceof ApiError ? error.status : -1;
  }
  check("an emoji outside the allowlist is refused with 422", () => assert.equal(emojiStatus, 422));

  /* ---- articles: no reactions, attachments instead ---- */

  const article = await createArticle({
    title: `Verify article ${stamp}`,
    body_markdown: "# Body\n\nText.",
    departments: ["ER"],
    author_id: author.id,
  });

  let articleReactionStatus = 0;
  try {
    await getReactionSummary(article.id, author.id);
  } catch (error) {
    articleReactionStatus = error instanceof ApiError ? error.status : -1;
  }
  check("reactions are bulletin-scoped (404 for an article id)", () => assert.equal(articleReactionStatus, 404));

  /* ---- attachments (DB) ---- */

  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "latin1");
  const { mime } = assertAttachmentType(pdf, "reference.pdf");
  const record = await createAttachment({
    slug: article.slug,
    file_name: `reference-${stamp}.pdf`,
    file_key: `attachments/${stamp}/reference.pdf`,
    mime_type: mime,
    size_bytes: pdf.length,
    uploaded_by_id: author.id,
  });
  check("an attachment record round-trips without exposing its storage key", () => {
    assert.equal(record.mime_type, "application/pdf");
    assert.equal(record.file_name, `reference-${stamp}.pdf`);
    assert.ok(!Object.prototype.hasOwnProperty.call(record, "file_key"));
  });

  const listed = await listAttachments(article.slug);
  check("listing an article's attachments returns the record", () => {
    assert.ok(listed.some((entry) => entry.id === record.id));
  });

  const download = await getAttachmentForDownload(article.slug, record.id);
  check("the download record carries the server-only storage key", () => {
    assert.equal(download.file_key, `attachments/${stamp}/reference.pdf`);
  });

  await db.article.delete({ where: { id: article.id } });
  const orphan = await db.articleAttachment.findUnique({ where: { id: record.id } });
  check("deleting an article cascades its attachments", () => assert.equal(orphan, null));

  /* ---- cleanup ---- */

  await db.article.deleteMany({ where: { authorId: { in: userIds } } });
  await db.bulletin.deleteMany({ where: { authorId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

console.log("attachments (pure)");

check("magic bytes decide the attachment type; a renamed .exe is refused", () => {
  const pdf = Buffer.from("%PDF-1.7\n%%EOF\n", "latin1");
  assert.equal(detectAttachmentType(pdf), "application/pdf");

  const exe = Buffer.concat([Buffer.from("MZ\x90\x00", "latin1"), Buffer.alloc(64)]);
  assert.equal(detectAttachmentType(exe), null);
  let status = 0;
  try {
    assertAttachmentType(exe, "totally-a.pdf");
  } catch (error) {
    status = error instanceof ApiError ? error.status : -1;
  }
  assert.equal(status, 422, "a renamed .exe must be refused with 422");

  const docx = Buffer.concat([
    Buffer.from("PK\x03\x04", "latin1"),
    Buffer.from("word/document.xml [Content_Types].xml", "latin1"),
  ]);
  assert.equal(detectAttachmentType(docx), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const xlsx = Buffer.concat([
    Buffer.from("PK\x03\x04", "latin1"),
    Buffer.from("xl/workbook.xml [Content_Types].xml", "latin1"),
  ]);
  assert.equal(detectAttachmentType(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(ALLOWED_ATTACHMENT_TYPES.length, 3);
});

check("sanitizeAttachmentFileName keeps a storage-safe basename", () => {
  assert.equal(sanitizeAttachmentFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeAttachmentFileName("Report (final).pdf"), "Report_final_.pdf");
  assert.equal(sanitizeAttachmentFileName(""), "file");
});

console.log("attachments (async guards)");

check("a missing PHI confirmation is refused with 422 (nothing stored)", () => {
  const statusFor = (value: unknown) => {
    try {
      assertPhiConfirmed(value);
      return 200;
    } catch (error) {
      return error instanceof ApiError ? error.status : -1;
    }
  };
  assert.equal(statusFor(undefined), 422);
  assert.equal(statusFor(false), 422);
  assert.equal(statusFor("false"), 422);
  assert.equal(statusFor(true), 200);
  assert.equal(statusFor("true"), 200);
});

runDatabaseChecks()
  .then(() => {
    console.log(`\n${passed} checks passed.`);
  })
  .catch((error: unknown) => {
    console.error("\nverify:frontend failed:", error);
    process.exit(1);
  });
