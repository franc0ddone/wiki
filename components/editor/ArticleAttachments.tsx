"use client";

import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import {
  attachmentDownloadUrl,
  formatBytes,
  listAttachments,
  type AttachmentRecord,
} from "@/lib/editor/attachments-api";

/**
 * The reader's list of an article's attachments, as download links. Fetches the
 * records for the current article; the bytes are streamed through the API, so no
 * storage URL is ever exposed. Renders nothing when the article has none.
 */
export function ArticleAttachments({ slug }: { slug: string }) {
  const [items, setItems] = useState<AttachmentRecord[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const records = await listAttachments(slug);
        if (active) setItems(records);
      } catch {
        if (active) setItems([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  if (!items || items.length === 0) return null;

  return (
    <div className="border-t border-zinc-200 pt-6">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Attachments</p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={attachmentDownloadUrl(slug, item.id)}
              className="group flex items-center gap-3 rounded-[10px] border border-zinc-300/60 bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:border-teal-600/40 hover:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-[#0F766E]">
                <FileText size={14} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-zinc-900">{item.file_name}</span>
                <span className="block text-xs text-zinc-500">{formatBytes(item.size_bytes)}</span>
              </span>
              <Download
                size={15}
                strokeWidth={1.75}
                aria-hidden="true"
                className="shrink-0 text-zinc-400 transition-colors group-hover:text-[#0F766E]"
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ArticleAttachments;
