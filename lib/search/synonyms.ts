/**
 * Clinical synonym / alias map.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Adding an entry is ONE LINE: `alias: ["what it means", "another form"],`
 * The weekly dead-search review (over the `search_logs` table) feeds this map.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Semantics (this is the contract `expandQuery` implements):
 *
 *  1. **Additive.** The user's own query is always searched. Expansions are
 *     extra variants searched alongside it; nothing is ever replaced.
 *  2. **Phrase-level, whole-word.** A key matches when it appears in the
 *     (lower-cased) query as a complete word or word sequence: `epi` matches
 *     in `epi dose` but not in `epidural`; `code blue` matches the two-word
 *     phrase. The matched phrase is swapped for each alternative to make one
 *     variant (`epi dose` → `epinephrine dose`, `adrenaline dose`). Expansions
 *     are not chained (an expansion is never itself expanded), so results stay
 *     predictable. At most 8 variants are searched.
 *  3. **Bidirectional.** If a document says "epi" and the user types
 *     "epinephrine", that should still land. Each listed alternative is also a
 *     lookup key that maps back to the entry's key — except keys of one or two
 *     letters (`iv`, `er`, `po` …), which would match inside half the corpus.
 *  4. **Ranking.** Matches produced by an expanded variant rank *below* every
 *     match of the user's own words (tier 1 vs tier 0 in `lib/search`), and
 *     among themselves by the usual fuzzy score. Expansions help you find
 *     things; they never outrank what you literally typed.
 *  5. **Suggestions.** When nothing good matches, the alternatives are offered
 *     back as "Try: epinephrine" (see the palette's empty state).
 *
 * Keys are lower-case. Multi-word keys are fine. Keep alternatives to the
 * wording that actually appears in the hospital's SOPs.
 */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  // ── Drugs & fluids ────────────────────────────────────────────────────
  epi: ["epinephrine", "adrenaline"],
  atro: ["atropine"],
  pred: ["prednisolone", "prednisone"],
  metro: ["metronidazole"],
  bup: ["buprenorphine"],
  lido: ["lidocaine"],
  keppra: ["levetiracetam"],
  cri: ["constant rate infusion"],
  iv: ["intravenous"],
  io: ["intraosseous"],
  im: ["intramuscular"],
  sq: ["subcutaneous"],
  po: ["oral", "by mouth"],
  lrs: ["lactated ringer's", "crystalloid"],
  pcv: ["packed cell volume", "hematocrit"],
  // ── Emergencies & procedures ──────────────────────────────────────────
  "code blue": ["cardiac arrest", "resuscitation", "cpr"],
  cpr: ["cardiopulmonary resuscitation", "chest compressions"],
  rosc: ["return of spontaneous circulation"],
  gdv: ["gastric dilatation-volvulus", "bloat"],
  dka: ["diabetic ketoacidosis"],
  aki: ["acute kidney injury"],
  hbc: ["hit by car", "trauma"],
  extrav: ["extravasation"],
  // ── Diseases ──────────────────────────────────────────────────────────
  parvo: ["canine parvovirus", "parvovirus"],
  cpv: ["canine parvovirus"],
  fip: ["feline infectious peritonitis"],
  felv: ["feline leukemia virus"],
  fiv: ["feline immunodeficiency virus"],
  uti: ["urinary tract infection"],
  hcm: ["hypertrophic cardiomyopathy"],
  chf: ["congestive heart failure"],
  // ── Documentation shorthand ───────────────────────────────────────────
  sx: ["surgery"],
  dx: ["diagnosis"],
  tx: ["treatment"],
  rx: ["prescription"],
  hx: ["history"],
  sop: ["standard operating procedure"],
  er: ["emergency room", "triage"],
  ppe: ["personal protective equipment"],
  csr: ["client service representative", "front desk"],
};

/* -------------------------------------------------------------- expansion */

export interface QueryVariant {
  text: string;
  /** `original` is exactly what the user typed (normalised); `synonym` came from the map. */
  kind: "original" | "synonym";
  /** For synonyms: the phrase in the query that triggered this variant. */
  via?: string;
}

export interface ExpandedQuery {
  /** Lower-cased, whitespace-collapsed, punctuation-light form of the input. */
  normalized: string;
  /** Always begins with the original; expansions follow, de-duplicated. */
  variants: QueryVariant[];
  /** Alternative wordings worth showing to a user who found nothing ("Try: epinephrine"). */
  suggestions: string[];
}

/** Keep letters, digits, spaces, and word-internal hyphens/apostrophes. */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Lookup {
  phrase: string;
  alternatives: string[];
}

let lookupCache: Lookup[] | null = null;

/** Forward entries plus the reverse direction, longest phrase first. */
function buildLookup(): Lookup[] {
  const merged = new Map<string, Set<string>>();
  const add = (phrase: string, alternative: string) => {
    if (phrase === alternative) return;
    const bucket = merged.get(phrase) ?? new Set<string>();
    bucket.add(alternative);
    merged.set(phrase, bucket);
  };

  for (const [key, alternatives] of Object.entries(SYNONYMS)) {
    const forward = normalizeQuery(key);
    for (const alternative of alternatives) {
      const normalized = normalizeQuery(alternative);
      add(forward, normalized);
      // Reverse direction, except for one/two-letter keys (see rule 3).
      if (forward.length > 2) add(normalized, forward);
    }
  }

  return [...merged.entries()]
    .map(([phrase, alternatives]) => ({ phrase, alternatives: [...alternatives] }))
    .sort((a, b) => b.phrase.length - a.phrase.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MAX_VARIANTS = 8;

export function expandQuery(query: string): ExpandedQuery {
  const normalized = normalizeQuery(query);
  const variants: QueryVariant[] = [{ text: normalized, kind: "original" }];
  const suggestions: string[] = [];
  if (normalized.length === 0) return { normalized, variants, suggestions };

  lookupCache ??= buildLookup();
  const seen = new Set<string>([normalized]);

  for (const { phrase, alternatives } of lookupCache) {
    if (variants.length >= MAX_VARIANTS) break;
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(phrase)}(?=\\s|$)`);
    if (!pattern.test(normalized)) continue;

    for (const alternative of alternatives) {
      const text = normalized.replace(pattern, (_match, lead: string) => `${lead}${alternative}`);
      if (seen.has(text)) continue;
      seen.add(text);
      variants.push({ text, kind: "synonym", via: phrase });
      if (!suggestions.includes(alternative)) suggestions.push(alternative);
      if (variants.length >= MAX_VARIANTS) break;
    }
  }

  return { normalized, variants, suggestions };
}
