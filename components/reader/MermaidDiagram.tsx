"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Mermaid flowchart renderer. Loaded only when a ```mermaid fence exists
 * (`next/dynamic`, `ssr: false` in MarkdownReader) and imports the `mermaid`
 * package itself lazily on first render.
 *
 * Hardening:
 *  - `securityLevel: "strict"` — mermaid sanitizes labels and disables click
 *    handlers.
 *  - `htmlLabels: false` — labels are SVG <text>, so no <foreignObject> (an
 *    HTML island inside the SVG) is ever needed.
 *  - The returned SVG is not assigned with innerHTML / dangerouslySetInnerHTML.
 *    It is parsed with DOMParser, walked against an element/attribute
 *    allowlist (no scripts, no event handlers, no external references), and
 *    only the surviving nodes are imported into the page.
 *
 * A diagram that fails to parse or render degrades to its source as a code
 * block with a note — never an empty box.
 */

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "defs", "marker", "style", "title", "desc", "clippath",
  "lineargradient", "radialgradient", "stop", "pattern", "symbol",
]);

const UNSAFE_CSS = /(@import|expression\s*\(|javascript:|url\(\s*['"]?(?!#))/i;

function sanitizeNode(element: Element): void {
  for (const child of Array.from(element.children)) {
    const name = child.localName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name)) {
      child.remove();
      continue;
    }

    for (const attribute of Array.from(child.attributes)) {
      const attrName = attribute.name.toLowerCase();
      if (attrName.startsWith("on")) {
        child.removeAttribute(attribute.name);
      } else if (attrName === "href" || attrName === "xlink:href") {
        if (!attribute.value.trim().startsWith("#")) child.removeAttribute(attribute.name);
      } else if (attrName === "style" && UNSAFE_CSS.test(attribute.value)) {
        child.removeAttribute(attribute.name);
      }
    }

    if (name === "style" && child.textContent && UNSAFE_CSS.test(child.textContent)) {
      child.textContent = child.textContent
        .replace(/@import[^;]*;?/gi, "")
        .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none");
    }

    sanitizeNode(child);
  }
}

function toSafeSvgElement(markup: string): SVGElement {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) {
    throw new Error("Mermaid returned something that is not an SVG document.");
  }
  sanitizeNode(root);
  for (const attribute of Array.from(root.attributes)) {
    if (attribute.name.toLowerCase().startsWith("on")) root.removeAttribute(attribute.name);
  }
  const imported = document.importNode(root, true) as unknown as SVGElement;
  imported.setAttribute("role", "img");
  return imported;
}

export default function MermaidDiagram({ source }: { source: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const renderId = `mmd${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          flowchart: { htmlLabels: false, useMaxWidth: true },
          suppressErrorRendering: true,
          theme: "neutral",
          fontFamily: "inherit",
        });
        await mermaid.parse(source);
        const { svg } = await mermaid.render(renderId, source);
        if (cancelled) return;
        hostRef.current?.replaceChildren(toSafeSvgElement(svg));
        setStatus("ready");
      } catch {
        // mermaid can leave a scratch element behind when a render throws.
        document.getElementById(`d${renderId}`)?.remove();
        document.getElementById(renderId)?.remove();
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, renderId]);

  if (status === "error") {
    return (
      <figure className="space-y-2">
        <pre className="overflow-x-auto rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3.5 font-mono text-[12.5px] leading-6 text-zinc-800">
          <code>{source}</code>
        </pre>
        <figcaption className="text-xs text-amber-800">
          This diagram could not be rendered; its source is shown instead.
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="rounded-xl border border-zinc-200 bg-white p-4 print:border-0 print:p-0">
      {status === "loading" ? (
        <p className="text-[12.5px] text-zinc-500" role="status">
          Rendering diagram…
        </p>
      ) : null}
      <div ref={hostRef} className="mermaid-host flex justify-center overflow-x-auto [&>svg]:h-auto [&>svg]:max-w-full" />
    </figure>
  );
}
