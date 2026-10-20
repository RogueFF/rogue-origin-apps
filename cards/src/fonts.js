// The four faces every card uses, and the Satori font list built from them.
// Each runtime supplies the bytes: Node reads cards/fonts/, Workers import them
// through the Data rule for **/*.ttf.

export const FONT_SPECS = [
  { name: 'Outfit', weight: 500, style: 'normal', file: 'Outfit-Medium.ttf' },
  { name: 'Outfit', weight: 600, style: 'normal', file: 'Outfit-SemiBold.ttf' },
  { name: 'JetBrains Mono', weight: 400, style: 'normal', file: 'JetBrainsMono-Regular.ttf' },
  { name: 'DM Serif Display', weight: 400, style: 'italic', file: 'DMSerifDisplay-Italic.ttf' },
];

/** Satori's `fonts` option, with each face's bytes from `loader(file)`. */
export function fontsFrom(loader) {
  return FONT_SPECS.map((s) => ({ name: s.name, weight: s.weight, style: s.style, data: loader(s.file) }));
}
