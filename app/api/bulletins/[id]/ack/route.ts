import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { acknowledgeBulletin, getBulletinAcks } from "@/lib/data/bulletins";

/**
 * `POST /api/bulletins/[id]/ack` — record that the signed-in user has seen a
 * notice. Idempotent: acknowledging twice is not an error and does not move the
 * original timestamp. Requires any authenticated staff member (`staff`+).
 *
 * `GET` returns the roster, which is what answers "who has seen this critical
 * alert" — restricted to the same audience as the board itself.
 */

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("staff");
    const { id } = await params;
    return Response.json(await acknowledgeBulletin(id, actor.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("readonly");
    const { id } = await params;
    return Response.json(await getBulletinAcks(id));
  } catch (error) {
    return errorResponse(error);
  }
}
