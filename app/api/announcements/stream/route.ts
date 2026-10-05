import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { toBulletin } from "@/lib/data/mappers";
import { getDb } from "@/lib/db";

/**
 * `GET /api/announcements/stream` — Server-Sent Events carrying newly published
 * bulletins.
 *
 * **How it works, and how often it asks.** This is a deliberately simple
 * push-on-change implementation: the handler records the connection time, then
 * polls the `bulletins` table on an interval — `ANNOUNCEMENTS_POLL_INTERVAL_MS`,
 * default **5000 ms (5 s)** — and emits only rows published since the last tick.
 * There is no LISTEN/NOTIFY or change-data-capture wiring in this phase; the
 * poll is the whole mechanism. Expect up to one interval of latency between a
 * procedure being posted and every open board updating.
 *
 * Events:
 *   `ready`    — once, `{ poll_interval_ms, since }`
 *   `bulletin` — one per new bulletin, the same JSON shape as `GET /api/bulletins`
 *   `: keep-alive` comment lines — every tick with nothing to send, so proxies
 *                  do not consider the connection idle and close it
 *
 * The stream deliberately ends itself after `MAX_STREAM_MS` and the client
 * reconnects (EventSource does that on its own), which bounds the damage from a
 * client that vanishes without closing its socket.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_POLL_MS = 5000;
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 60_000;
const MAX_STREAM_MS = 30 * 60 * 1000;

function pollIntervalMs(): number {
  const configured = Number(process.env.ANNOUNCEMENTS_POLL_INTERVAL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, configured));
}

export async function GET(request: NextRequest) {
  try {
    await requireRole("readonly");
  } catch (error) {
    return errorResponse(error);
  }

  const interval = pollIntervalMs();
  const encoder = new TextEncoder();

  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;

  // Rows published in the same millisecond as the previous tick's last row
  // would be re-sent by an inclusive `gte` comparison, so identity — not time —
  // is what decides whether an event has already gone out.
  const sent = new Set<string>();
  let since = new Date();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        const shutdown = () => {
          if (closed) return;
          closed = true;
          if (timer) clearInterval(timer);
          if (lifetime) clearTimeout(lifetime);
          try {
            controller.close();
          } catch {
            // Already closed by the consumer.
          }
        };

        send(`retry: ${interval}\n\n`);
        send(`event: ready\ndata: ${JSON.stringify({ poll_interval_ms: interval, since: since.toISOString() })}\n\n`);

        const tick = async () => {
          if (closed) return;
          try {
            const rows = await getDb().bulletin.findMany({
              where: { publishedAt: { gte: since } },
              include: { author: { select: { name: true, title: true } } },
              orderBy: { publishedAt: "asc" },
            });

            const fresh = rows.filter((row) => !sent.has(row.id));
            if (fresh.length === 0) {
              send(": keep-alive\n\n");
              return;
            }

            for (const row of fresh) {
              sent.add(row.id);
              since = row.publishedAt;
              send(`event: bulletin\ndata: ${JSON.stringify(toBulletin(row))}\n\n`);
            }
          } catch (error) {
            // A transient database blip must not tear down the stream; the next
            // tick tries again. The error is logged with the connection scope.
            console.error("[announcements] poll failed:", error);
            send(": poll-error\n\n");
          }
        };

        timer = setInterval(() => {
          void tick();
        }, interval);
        lifetime = setTimeout(shutdown, MAX_STREAM_MS);

        request.signal.addEventListener("abort", shutdown);
      },
      cancel() {
        closed = true;
        if (timer) clearInterval(timer);
        if (lifetime) clearTimeout(lifetime);
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Tells nginx not to buffer the stream.
        "X-Accel-Buffering": "no",
      },
    },
  );
}
