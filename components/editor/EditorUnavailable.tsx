import Link from "next/link";

/** Plain notice for someone who opened an editor URL they cannot use. No editor, no tease. */
export function EditorUnavailable({
  title,
  message,
  backHref = "/",
  backLabel = "Back to the portal",
}: {
  title: string;
  message: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F4F4F5] p-6">
      <div className="max-w-md rounded-xl border border-zinc-300/70 bg-white p-8 text-center shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
        <h1 className="text-[1.15rem] font-semibold text-zinc-900">{title}</h1>
        <p className="mt-2 text-[13.5px] leading-6 text-zinc-600">{message}</p>
        <Link
          href={backHref}
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-[#0F766E] px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-[#0c635c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 focus-visible:ring-offset-1"
        >
          {backLabel}
        </Link>
      </div>
    </main>
  );
}
