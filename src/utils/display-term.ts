/** Sentence-style display only: preserve stored spelling and every later character. */
export function displayTerm(term: string, locale?: string): string {
  const trimmed = term.trim();
  if (!trimmed) return '';
  const first = Array.from(trimmed)[0];
  // Unicode code points avoid splitting surrogate pairs. Do not lowercase the
  // remainder (proper names/acronyms can carry meaning), or expand one character
  // into several (for example ß -> SS). Leave punctuation/uncased scripts alone.
  let upper: string;
  try {
    upper = first.toLocaleUpperCase(locale);
  } catch {
    upper = first.toUpperCase();
  }
  return (Array.from(upper).length === 1 ? upper : first) + trimmed.slice(first.length);
}
