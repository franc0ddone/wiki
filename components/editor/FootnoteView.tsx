"use client";

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

/**
 * Footnote definition block view: a non-editable label chip followed by the
 * definition's editable text. The label is fixed at insert time (a numeric
 * marker); the body is ordinary prose.
 */
export function FootnoteDefinitionView({ node }: NodeViewProps) {
  const label = String(node.attrs.label ?? "");
  return (
    <NodeViewWrapper className="dw-footnote-def" data-type="footnote-definition">
      <div contentEditable={false} className="dw-footnote-def-label">
        <span aria-hidden="true">{`[^${label}]`}</span>
      </div>
      <NodeViewContent className="dw-footnote-def-body" />
    </NodeViewWrapper>
  );
}

export default FootnoteDefinitionView;
