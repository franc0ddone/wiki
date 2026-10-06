"use client";

import { useMemo, useState } from "react";
import { fieldClass, Modal, primaryButton, secondaryButton } from "@/components/editor/Modal";
import type { LinkRegistry } from "@/lib/links";
import { cx } from "@/lib/utils";

/**
 * Link dialog. Three kinds of target, because a broken internal link is a
 * patient-safety problem and picking beats typing:
 *
 *  - another procedure (and optionally one of its sections) → `/procedures/<slug>[#id]`
 *  - a section of this procedure → `#id`
 *  - a web / mail / phone address
 *
 * The result is plain markdown, validated again at save time by `validateLinks`.
 */

type Kind = "procedure" | "section" | "web";

function detectKind(href: string): Kind {
  if (href.startsWith("/procedures/")) return "procedure";
  if (href.startsWith("#")) return "section";
  return "web";
}

export function LinkDialog({
  initialHref,
  hasSelection,
  articleOptions,
  registry,
  ownHeadingIds,
  onApply,
  onRemove,
  onClose,
}: {
  initialHref: string;
  hasSelection: boolean;
  articleOptions: ReadonlyArray<{ slug: string; title: string }>;
  registry: LinkRegistry;
  ownHeadingIds: readonly string[];
  onApply: (link: { href: string; text: string }) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>(initialHref ? detectKind(initialHref) : "procedure");
  const [slug, setSlug] = useState(() =>
    initialHref.startsWith("/procedures/") ? (initialHref.slice("/procedures/".length).split("#")[0] ?? "") : "",
  );
  const [anchor, setAnchor] = useState(() =>
    initialHref.startsWith("/procedures/") ? (initialHref.split("#")[1] ?? "") : "",
  );
  const [section, setSection] = useState(initialHref.startsWith("#") ? initialHref.slice(1) : "");
  const [web, setWeb] = useState(detectKind(initialHref) === "web" ? initialHref : "");
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);

  const sectionsOfTarget = useMemo(() => registry.anchors[slug] ?? [], [registry, slug]);

  const href = (() => {
    if (kind === "procedure") return slug ? `/procedures/${slug}${anchor ? `#${anchor}` : ""}` : "";
    if (kind === "section") return section ? `#${section}` : "";
    const value = web.trim();
    if (!value) return "";
    if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(value)) return `https://${value}`;
    return "";
  })();

  const error = !href
    ? kind === "procedure"
      ? "Choose a procedure."
      : kind === "section"
        ? "Choose a section."
        : "Enter a web address (https://…), an email (mailto:…), or a phone number (tel:…)."
    : !hasSelection && !text.trim()
      ? "Add the text the link should show."
      : null;

  const kinds: Array<{ id: Kind; label: string }> = [
    { id: "procedure", label: "Procedure" },
    { id: "section", label: "Section of this page" },
    { id: "web", label: "Web address" },
  ];

  return (
    <Modal title={initialHref ? "Edit link" : "Add link"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!error) onApply({ href, text: text.trim() });
        }}
      >
        <div role="tablist" aria-label="Link target" className="flex gap-1 rounded-lg bg-zinc-100 p-1">
          {kinds.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={kind === option.id}
              onClick={() => setKind(option.id)}
              className={cx(
                "h-8 flex-1 rounded-md px-2 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
                kind === option.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {kind === "procedure" ? (
          <div className="space-y-3">
            <div>
              <label htmlFor="link-procedure" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
                Procedure
              </label>
              <select
                id="link-procedure"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                  setAnchor("");
                }}
                className={fieldClass}
              >
                <option value="">Choose a procedure…</option>
                {articleOptions.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.title}
                  </option>
                ))}
              </select>
            </div>
            {slug && sectionsOfTarget.length > 0 ? (
              <div>
                <label htmlFor="link-section-of" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
                  Section <span className="font-normal text-zinc-500">(optional)</span>
                </label>
                <select id="link-section-of" value={anchor} onChange={(event) => setAnchor(event.target.value)} className={fieldClass}>
                  <option value="">Whole procedure</option>
                  {sectionsOfTarget.map((id) => (
                    <option key={id} value={id}>
                      #{id}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        ) : null}

        {kind === "section" ? (
          <div>
            <label htmlFor="link-section" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              Section
            </label>
            <select id="link-section" value={section} onChange={(event) => setSection(event.target.value)} className={fieldClass}>
              <option value="">Choose a section…</option>
              {ownHeadingIds.map((id) => (
                <option key={id} value={id}>
                  #{id}
                </option>
              ))}
            </select>
            {ownHeadingIds.length === 0 ? (
              <p className="mt-1.5 text-xs text-zinc-500">This procedure has no headings yet.</p>
            ) : null}
          </div>
        ) : null}

        {kind === "web" ? (
          <div>
            <label htmlFor="link-web" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              Address
            </label>
            <input
              id="link-web"
              value={web}
              onChange={(event) => setWeb(event.target.value)}
              placeholder="https://example.org/reference"
              className={fieldClass}
              inputMode="url"
              autoComplete="off"
            />
          </div>
        ) : null}

        {!hasSelection ? (
          <div>
            <label htmlFor="link-text" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              Link text
            </label>
            <input id="link-text" value={text} onChange={(event) => setText(event.target.value)} className={fieldClass} />
          </div>
        ) : null}

        {touched && error ? (
          <p role="alert" className="text-[12.5px] text-red-700">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <div>
            {initialHref ? (
              <button type="button" className={secondaryButton} onClick={onRemove}>
                Remove link
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" className={secondaryButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryButton}>
              Apply
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
