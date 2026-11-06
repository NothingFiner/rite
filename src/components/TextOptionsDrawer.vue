<template>
  <div class="drawer left" :class="{ open }">
    <div class="drawer-content">
      <div class="text-options">
        <h3 class="drawer-heading">Text Options</h3>
        <div class="drawer-label">Margins</div>
        <div class="zoom-row">
          <button
            class="zoom-btn"
            :class="{ active: theme.editorMargin === 'compact' }"
            @click="theme.setMargin('compact')"
          >
            Compact
          </button>
          <button
            class="zoom-btn"
            :class="{ active: theme.editorMargin === 'manuscript' }"
            @click="theme.setMargin('manuscript')"
          >
            Manuscript
          </button>
        </div>
        <div class="drawer-label">Zoom</div>
        <div class="zoom-row">
          <button
            v-for="z in [12, 16, 20]"
            :key="z"
            class="zoom-btn"
            :class="{ active: theme.editorZoom === z }"
            @click="theme.setZoom(z)"
          >
            {{ z }}pt
          </button>
        </div>
        <div class="drawer-label">Font</div>
        <select
          class="drawer-input font-select"
          :value="format.editorFont"
          @change="e => format.setFont(e.target.value)"
        >
          <option v-for="opt in format.fontOptions" :key="opt.label" :value="opt.family">{{ opt.label }}</option>
        </select>
        <!-- Manuscript page format (Standard / Shunn / A4). This drives BOTH the
             rendered manuscript pages and pagination's measure (usePagination),
             which share one useManuscriptFormat instance — so picking here
             re-flows every page live and re-measures page breaks. A full-width
             select rather than zoom-row buttons: the preset names are long. -->
        <div class="drawer-label">Manuscript Format</div>
        <select
          class="drawer-input font-select"
          :value="manuscriptFormat.formatId"
          @change="e => manuscriptFormat.selectFormat(e.target.value)"
        >
          <option v-for="f in manuscriptFormat.formats" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
        <!-- Color applies on the click itself, like the zoom and margin
             controls beside it, so no confirm step exists. Each row keeps
             out the colors the other two rows hold. :disabled marks them,
             and applyColor re-checks isHeldElsewhere, because a dispatched
             click still fires a disabled button's listener. The setters
             refuse such a hex as well (useTheme.js). -->
        <template v-for="def in swatchRows" :key="def.row">
          <div class="drawer-label">{{ def.label }}</div>
          <div class="swatch-row" :data-row="def.row">
            <button
              v-for="color in palette"
              :key="color.hex"
              type="button"
              class="color-swatch"
              :data-color="color.hex"
              :aria-label="def.label + ' ' + color.theme + ' ' + color.role"
              :aria-current="def.current(theme) === color.hex ? 'true' : undefined"
              :disabled="isHeldElsewhere(theme, def, color)"
              :style="{ background: color.hex }"
              @click="applyColor(theme, def, color)"
            ></button>
          </div>
        </template>
        <div class="drawer-label">Presets</div>
        <div class="preset-row">
          <button
            v-for="(entry, index) in THEMES"
            :key="entry.name"
            type="button"
            class="theme-preset"
            :class="{ active: theme.matchedPreset === index }"
            @click="theme.selectTheme(index)"
          >
            {{ entry.name }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { THEMES } from '../constants/themes.js'

// Receives the theme, format, and manuscriptFormat composables as props and
// drives them directly (setMargin / setZoom / setFont / selectFormat). See
// GeneralOptionsDrawer for the rationale. manuscriptFormat is a reactive proxy
// (see App.vue) so `manuscriptFormat.formatId` / `.formats` / `.selectFormat`
// are the unwrapped values/functions, not refs.
defineProps({
  open: { type: Boolean, default: false },
  theme: { type: Object, required: true },
  format: { type: Object, required: true },
  manuscriptFormat: { type: Object, required: true },
})

// Row order is fixed by the drawer layout, so each row's label and setter
// travel in one definition instead of three hand-written pairs. The
// accessors read the theme prop, so the marks track the live colors like
// the preset's active match.
const swatchRows = [
  {
    row: 'background',
    label: 'Background',
    setter: 'selectBackground',
    current: (theme) => theme.editorBg,
    others: (theme) => [theme.editorText, theme.editorAccent],
  },
  {
    row: 'text',
    label: 'Text',
    setter: 'selectText',
    current: (theme) => theme.editorText,
    others: (theme) => [theme.editorBg, theme.editorAccent],
  },
  {
    row: 'accent',
    label: 'Accent',
    setter: 'selectAccent',
    current: (theme) => theme.editorAccent,
    others: (theme) => [theme.editorBg, theme.editorText],
  },
]

// True when a row other than def already holds the color's hex. One
// definition feeds :disabled and applyColor, so the two guards cannot
// drift apart.
const isHeldElsewhere = (theme, def, color) => def.others(theme).includes(color.hex)

const applyColor = (theme, def, color) => {
  if (isHeldElsewhere(theme, def, color)) return
  theme[def.setter](color.hex)
}

// Palette for the swatch rows: the distinct colors of the theme table, in
// first-appearance order (theme order, then bg, text, accent inside a theme).
// Repeating a hex would offer the same color twice in one row, so first
// occurrence is kept. Each entry carries the contributing theme's name and
// role, the two parts that follow the row label in a swatch's aria-label
// (SPEC.md 5.13).
const palette = []
{
  const knownHexes = new Set()
  for (const entry of THEMES) {
    for (const [role, hex] of [
      ['background', entry.bg],
      ['text', entry.text],
      ['accent', entry.accent],
    ]) {
      if (knownHexes.has(hex)) continue
      knownHexes.add(hex)
      palette.push({ hex, theme: entry.name, role })
    }
  }
}
</script>

<style scoped>
/* Base drawer shell — duplicated per drawer component by convention (see
   NavigationDrawer.vue); scoped styles only reach this component's template. */
.drawer {
  position: fixed;
  top: 38px;
  bottom: 36px;
  width: 260px;
  /* S-018: a closed drawer keeps its slide animation but leaves the tab
     order — visibility flips to hidden 0.25s AFTER the close starts (the
     slide stays on screen) and back to visible instantly on open. Keep the
     values identical to App.vue's .drawer base rule (its scoped rule also
     reaches this component's root element). */
  visibility: hidden;
  transition: transform 0.25s ease, visibility 0s linear 0.25s;
  z-index: 25;
}

.drawer.left {
  left: 48px;
  transform: translateX(-100%);
}

.drawer.left.open {
  transform: translateX(0);
  /* S-018: open state — visible immediately, no visibility delay. */
  visibility: visible;
  transition: transform 0.25s ease, visibility 0s;
}

.drawer-content {
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border-right: 1px solid var(--bg-glass-border);
}

.drawer-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.drawer-label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  margin-top: 10px;
}

.drawer-input {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.drawer-input:focus {
  border-color: var(--accent);
}

.text-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.zoom-row {
  display: flex;
  gap: 6px;
}

.zoom-btn {
  flex: 1;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--bg-glass-border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.zoom-btn:hover {
  background: var(--hover-bg-strong);
  color: var(--text-primary);
}

.zoom-btn.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.font-select {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 24px;
}

/* The swatch and preset rows wrap: a full palette overflows a fixed-width
   drawer. */
.swatch-row,
.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.color-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--bg-glass-border);
  /* UA button padding would dwarf a 16px tint box. */
  padding: 0;
  appearance: none;
}

.theme-preset {
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--bg-glass-border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}

/* The current preset marks itself with the zoom control's active grammar, so
   both marks read as one pattern inside the drawer. */
.theme-preset.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
</style>