import { redirect } from "next/navigation";

/**
 * `/procedures/<slug>` is the address internal markdown links point at
 * (`[Isolation policy](/procedures/canine-parvovirus-isolation-protocol)`).
 * The portal is a single master/detail surface, so this route simply hands the
 * slug to it. A `#section` fragment survives the redirect and scrolls to the
 * heading once the procedure renders.
 *
 * The portal now lives at `/portal`; `proxy.ts` requires a session for this
 * path, so a signed-out visit is bounced to the landing with this URL as the
 * `callbackUrl` and resolves correctly once the visitor signs in.
 */
export default async function ProcedureRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/portal?article=${encodeURIComponent(slug)}`);
}
