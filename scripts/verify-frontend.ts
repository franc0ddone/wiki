/**
 * `npm run verify:frontend` — assertions for the pure (DOM-free) frontend
 * modules: the markdown parser, link validation, and the search engine.
 *
 * Browser behaviour (palette, editor, reader interactions) is verified
 * separately; this script covers everything that can be decided without one.
 */
import assert from "node:assert/strict";
import { parseInline, inlinePlain } from "@/lib/markdown/inline";
import { collectHeadings, extractToc, parseMarkdown, splitTableRow } from "@/lib/markdown/parser";
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
  if (table.kind === "table") assert.deepEqual(table.rows[0], ["1 | 2", "3"]);
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

console.log(`\n${passed} checks passed.`);
