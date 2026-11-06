/** Normalises names for comparison: lowercase, no diacritics, no punctuation, collapsed whitespace. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/ß/g, 'ss')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const STOP = new Set(['der', 'die', 'das', 'und', 'mit', 'fur', 'fuer', 'the', 'a', 'an', 'of', 'for', 'app', 'tool']);
export function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t)));
}

/** Similarity 0..1 combining edit distance on the normalised string and token overlap. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a).replace(/ /g, '');
  const nb = normalizeName(b).replace(/ /g, '');
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const edit = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  const ta = tokens(a);
  const tb = tokens(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  const jaccard = union ? inter / union : 0;
  const contains = na.includes(nb) || nb.includes(na) ? 0.85 : 0;
  return Math.max(edit, jaccard, contains);
}

/** Order-independent fingerprint of the significant words in a title (idea dedup). */
export function fingerprint(s: string): string {
  return [...tokens(s)].sort().join(' ');
}
