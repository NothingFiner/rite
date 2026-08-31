// Manuscript page geometry, in CSS px. Single source of truth shared by
// manuscriptDisplay.vue (lays out the visible manuscript pages) and
// usePagination.js (measures paragraph heights to decide where pages break).
// The editor view reuses these same page breaks as visual markers.
export const PAGE_WIDTH = 720
export const PAGE_HEIGHT = 960
export const MARGIN = 96
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
export const CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN * 2