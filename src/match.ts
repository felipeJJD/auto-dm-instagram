export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: string): string {
  return normalize(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function matchesTrigger(
  a: { trigger_mode: 'any' | 'keywords'; keywords: string[] },
  text: string,
): boolean {
  if (a.trigger_mode === 'any') return true;
  const haystack = ` ${words(text ?? '')} `;
  return a.keywords.some((k) => {
    const w = words(k);
    return w.length > 0 && haystack.includes(` ${w} `);
  });
}
