// The full set of editor/manuscript color palettes. This is the single source
// of truth: useTheme.js exposes these to the UI (theme picker, status bar), and
// editorDisplay.vue reads the bg/text pair to style the editor sheet. Adding or
// reordering a theme here updates every consumer — there is no second copy.
export const THEMES = [
  { bg: '#D8D3D6', text: '#515359', accent: '#B5651D', accentBg: 'rgba(181, 101, 29, 0.25)', accentHover: '#8B4A15' },
  { bg: '#EDD1B0', text: '#664B47', accent: '#3D7A7A', accentBg: 'rgba(61, 122, 122, 0.25)', accentHover: '#2F6060' },
  { bg: '#475841', text: '#FFE2D6', accent: '#C9A96E', accentBg: 'rgba(201, 169, 110, 0.25)', accentHover: '#A68A3C' },
  { bg: '#DBE1F1', text: '#61177C', accent: '#A68A3C', accentBg: 'rgba(166, 138, 60, 0.25)', accentHover: '#8A732F' },
  { bg: '#FFFFE3', text: '#667A72', accent: '#8B6B6B', accentBg: 'rgba(139, 107, 107, 0.25)', accentHover: '#7A5A5A' },
  { bg: '#030027', text: '#9CB184', accent: '#C4A87C', accentBg: 'rgba(196, 168, 124, 0.25)', accentHover: '#A68B5E' },
  { bg: '#322E18', text: '#B5CC9A', accent: '#D4A76A', accentBg: 'rgba(212, 167, 106, 0.25)', accentHover: '#B58A4E' },
  { bg: '#353535', text: '#D0E37F', accent: '#E88C5A', accentBg: 'rgba(232, 140, 90, 0.25)', accentHover: '#C4703E' },
  { bg: '#B3DABE', text: '#69120A', accent: '#8B4513', accentBg: 'rgba(139, 69, 19, 0.25)', accentHover: '#6B3510' },
  { bg: '#D3BBCF', text: '#171717', accent: '#6B4C7A', accentBg: 'rgba(107, 76, 122, 0.25)', accentHover: '#523A5D' },
]