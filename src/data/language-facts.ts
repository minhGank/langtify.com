// Editorial UI copy only. Not vocabulary, a learning-level claim or remote data.
// Sources reviewed 2026-09-26. Keep stable IDs and recheck claims when editing.
export const languageFacts = [
  {
    id: 'spanish-question-marks',
    text: 'Spanish gives questions an opening mark, ¿, as well as a closing one, ?.',
    source:
      'https://www.fundeu.es/recomendacion/interrogacion-y-exclamacion-usos-de-los-signos-ortograficos/',
  },
  {
    id: 'japanese-scripts',
    text: 'Japanese writing combines three scripts: hiragana, katakana and kanji.',
    source: 'https://www.bunka.go.jp/seisaku/kokugo_nihongo/kyoiku/handbook/pdf/en_zensho.pdf',
  },
  {
    id: 'hangul-blocks',
    text: 'Korean Hangul letters fit together in blocks. Each block represents a syllable.',
    source: 'https://www.korean.go.kr/eng_hangeul/principle/001.html',
  },
  {
    id: 'sign-languages',
    text: 'British and American Sign Language are different languages, each with its own grammar.',
    source: 'https://www.nidcd.nih.gov/health/american-sign-language',
  },
  {
    id: 'braille-music',
    text: 'Braille goes beyond words: it also has special codes for music and maths.',
    source: 'https://shop.rnib.org.uk/blogs/news/eight-essential-braille-facts',
  },
  {
    id: 'alphabet-origin',
    text: 'The word “alphabet” comes from alpha and beta, the first two Greek letters.',
    source: 'https://www.merriam-webster.com/dictionary/alphabet',
  },
  {
    id: 'french-capitals',
    text: 'French capital letters keep their accents. É is just as important as é.',
    source: 'https://www.academie-francaise.fr/questions-de-langue',
  },
  {
    id: 'tungsten-origin',
    text: 'The metal tungsten gets its name from Swedish words meaning “heavy stone”.',
    source: 'https://periodic-table.rsc.org/element/74/tungsten',
  },
] as const;
export type LanguageFact = (typeof languageFacts)[number];

// An injected sample makes selection reproducible without changing global RNG.
export function selectLanguageFact(sample: number): LanguageFact {
  const index =
    Number.isFinite(sample) && sample >= 0 && sample < 1
      ? Math.floor(sample * languageFacts.length)
      : 0;
  return languageFacts[index] ?? languageFacts[0];
}
