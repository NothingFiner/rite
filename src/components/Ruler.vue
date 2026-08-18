<template>
  <div class="ruler" ref="rulerRef" @click="onTrackClick">
    <div class="ruler-track">
      <div
        v-for="(tick, i) in ticks"
        :key="i"
        class="tick"
        :class="tick.type"
        :style="{ left: tick.pos + 'px' }"
      >
        <span v-if="tick.label !== null" class="tick-label">{{ tick.label }}</span>
      </div>
    </div>

    <!-- Left indent marker -->
    <div
      class="marker left-indent"
      :style="{ left: leftPos + 'px' }"
      @mousedown.stop.prevent="startDrag('left', $event)"
      title="Left indent"
    >
      <div class="marker-shape down"></div>
    </div>

    <!-- First-line indent marker -->
    <div
      class="marker first-line"
      :style="{ left: firstLinePos + 'px' }"
      @mousedown.stop.prevent="startDrag('firstLine', $event)"
      title="First-line indent"
    >
      <div class="marker-shape flat"></div>
    </div>

    <!-- Right indent marker -->
    <div
      class="marker right-indent"
      :style="{ left: rightPos + 'px' }"
      @mousedown.stop.prevent="startDrag('right', $event)"
      title="Right indent"
    >
      <div class="marker-shape down"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'

const props = defineProps({
  pageWidth: { type: Number, default: 720 },
  leftIndent: { type: Number, default: 0 },
  rightIndent: { type: Number, default: 0 },
  firstLineIndent: { type: Number, default: 0 },
})

const emit = defineEmits(['setLeft', 'setRight', 'setFirstLine'])

const rulerRef = ref(null)
const dragging = ref(null)
const startX = ref(0)
const startValue = ref(0)

const PPI = 96
const MARGIN = 1 // inch

const totalInches = computed(() => props.pageWidth / PPI)
const marginPx = computed(() => MARGIN * PPI)

const leftPos = computed(() => marginPx.value + props.leftIndent * PPI)
const rightPos = computed(() => (props.pageWidth - marginPx.value) - props.rightIndent * PPI)
const firstLinePos = computed(() => leftPos.value + props.firstLineIndent * PPI)

const ticks = computed(() => {
  const t = []
  const quarters = Math.floor(totalInches.value * 4)
  for (let i = 0; i <= quarters; i++) {
    const inch = i / 4
    const pos = inch * PPI
    let type = 'minor'
    if (i % 4 === 0) type = 'major'
    else if (i % 2 === 0) type = 'medium'
    t.push({
      pos,
      type,
      label: i % 4 === 0 ? Math.floor(inch) : null,
    })
  }
  return t
})

function onTrackClick(e) {
  if (e.target.closest('.marker') || dragging.value) return
  const rect = rulerRef.value.getBoundingClientRect()
  const px = e.clientX - rect.left
  const newVal = Math.round((px - marginPx.value) / PPI * 10) / 10
  emit('setLeft', newVal)
}

function startDrag(type, e) {
  dragging.value = type
  startX.value = e.clientX
  startValue.value =
    type === 'left' ? props.leftIndent : type === 'right' ? props.rightIndent : props.firstLineIndent
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

function onDrag(e) {
  if (!dragging.value || !rulerRef.value) return
  const deltaPx = e.clientX - startX.value
  const deltaInch = deltaPx / PPI

  if (dragging.value === 'left') {
    const newVal = Math.max(-MARGIN, startValue.value + deltaInch)
    emit('setLeft', Math.round(newVal * 10) / 10)
  } else if (dragging.value === 'right') {
    const newVal = Math.max(-MARGIN, startValue.value + deltaInch)
    emit('setRight', Math.round(newVal * 10) / 10)
  } else {
    const newVal = startValue.value + deltaInch
    emit('setFirstLine', Math.round(newVal * 10) / 10)
  }
}

function stopDrag() {
  dragging.value = null
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
})
</script>

<style scoped>
.ruler {
  position: relative;
  width: 720px;
  height: 36px;
  user-select: none;
  cursor: pointer;
  flex-shrink: 0;
}

.ruler-track {
  position: absolute;
  top: 28px;
  left: 0;
  right: 0;
  height: 2px;
  background: rgba(255, 255, 255, 0.2);
}

.tick {
  position: absolute;
  bottom: 0;
  width: 1px;
  transform: translateX(-50%);
}

.tick.minor {
  height: 5px;
  background: rgba(255, 255, 255, 0.25);
}

.tick.medium {
  height: 8px;
  background: rgba(255, 255, 255, 0.35);
}

.tick.major {
  height: 12px;
  background: rgba(255, 255, 255, 0.5);
}

.tick-label {
  position: absolute;
  top: -16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 500;
  line-height: 1;
}

.marker {
  position: absolute;
  width: 20px;
  height: 20px;
  transform: translateX(-50%);
  cursor: grab;
  z-index: 5;
  pointer-events: auto;
}

.marker:active {
  cursor: grabbing;
}

.marker-shape {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.marker-shape.down {
  bottom: 0;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid var(--accent);
}

.marker-shape.flat {
  bottom: 4px;
  width: 14px;
  height: 5px;
  background: var(--accent);
  border-radius: 1px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.left-indent {
  bottom: 8px;
}

.right-indent {
  bottom: 8px;
}

.first-line {
  bottom: 16px;
}
</style>
