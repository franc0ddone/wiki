"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { AttachmentTypeIcon, attachmentTypeLabel } from "@/components/bulletin/AttachmentTypeIcon";
import {
  bulletinAttachmentDownloadUrl,
  formatBytes,
  listBulletinAttachments,
  type BulletinAttachmentRecord,
} from "@/lib/bulletin/api";

/**
 * The reader's list of a bulletin's attachments, as download links — the
 * bulletin twin of `components/editor/ArticleAttachments.tsx`, and deliberately
 * the same visual language: one bordered row per file, a file-type tile, the
 * name over `TYPE · size`, and a download affordance.
 *
 * Fetches the records for the bulletin on mount; the bytes are streamed through
 * the API, so no storage URL is ever exposed and a click downloads the original
 * file rather than rendering it inline. Renders nothing when there are none.
 */
export function BulletinAttachments({ bulletinId }: { bulletinId: string }) {
  const [items, setItems] = useState<BulletinAttachmentRecord[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const records = await listBulletinAttachments(bulletinId);
        if (active) setItems(records);
      } catch {
        if (active) setItems([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [bulletinId]);

  if (!items || items.length === 0) return null;

  return (
    <div className="border-t border-zinc-200 pt-6">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Attachments</p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={bulletinAttachmentDownloadUrl(bulletinId, item.id)}
              className="group flex items-center gap-3 rounded-[10px] border border-zinc-300/60 bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:border-[#5F6E00]/40 hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#5F6E00]/20 bg-[#AFBE23]/20 text-[#5F6E00]">
                <AttachmentTypeIcon mimeType={item.mime_type} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-zinc-900">{item.file_name}</span>
                <span className="block text-xs text-zinc-500">
                  {attachmentTypeLabel(item.mime_type, item.file_name)} · {formatBytes(item.size_bytes)}
                </span>
              </span>
              <Download
                size={15}
                strokeWidth={1.75}
                aria-hidden="true"
                className="shrink-0 text-zinc-400 transition-colors group-hover:text-[#5F6E00]"
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default BulletinAttachments;
