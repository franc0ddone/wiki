"use client";

import {
  File,
  FileSpreadsheet,
  FileText,
  FileType,
  Presentation,
  Table2,
  type LucideIcon,
} from "lucide-react";

/**
 * The one place a file type becomes an icon and a label.
 *
 * Bulletin attachments and article attachments share the same six types, so the
 * mapping lives here rather than being repeated in each list. The label is the
 * uppercased extension family (`PDF`, `DOCX`, …) — it is what tells two
 * identically named rows apart at a glance.
 */

const ICON_BY_MIME: Record<string, LucideIcon> = {
  "application/pdf": FileText,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileType,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": FileSpreadsheet,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": Presentation,
  "text/csv": Table2,
  "text/plain": File,
};

const LABEL_BY_MIME: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "text/csv": "CSV",
  "text/plain": "TXT",
};

/** Fall back to the file's own extension, then to a generic file icon. */
function labelFromName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toUpperCase().slice(0, 5) : "FILE";
}

export function attachmentTypeLabel(mimeType: string, fileName: string): string {
  return LABEL_BY_MIME[mimeType] ?? labelFromName(fileName);
}

export function AttachmentTypeIcon({
  mimeType,
  size = 14,
  className,
}: {
  mimeType: string;
  size?: number;
  className?: string;
}) {
  const Icon = ICON_BY_MIME[mimeType] ?? File;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" className={className} />;
}

export default AttachmentTypeIcon;
