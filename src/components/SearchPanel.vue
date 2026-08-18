<template>
  <transition name="search-slide">
    <div v-if="visible" class="search-panel glass">
    <div class="search-row">
      <input
        ref="queryRef"
        class="search-input"
        v-model="localQuery"
        placeholder="Find..."
        @keydown.enter.prevent="findNext"
        @keydown.shift.enter.prevent="findPrev"
      />
      <span class="match-count">{{ matchText }}</span>
      <button class="search-btn" @click="findPrev" title="Previous">&#8593;</button>
      <button class="search-btn" @click="findNext" title="Next">&#8595;</button>
      <button
        class="search-btn toggle"
        :class="{ active: showReplace }"
        @click="toggleReplace"
        title="Toggle Replace"
      >
        &#8644;
      </button>
      <button class="search-btn close" @click="close" title="Close">&times;</button>
    </div>
    <div v-if="showReplace" class="replace-row">
      <input
        class="search-input"
        v-model="localReplace"
        placeholder="Replace..."
        @keydown.enter.prevent="replace"
      />
      <button class="search-btn primary" @click="replace">Replace</button>
      <button class="search-btn primary" @click="replaceAll">Replace All</button>
    </div>
  </div>
  </transition>
</template>

<script setup>
import { ref, watch, nextTick, computed } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  query: { type: String, default: '' },
  replaceText: { type: String, default: '' },
  showReplace: { type: Boolean, default: false },
  matchCount: { type: Number, default: 0 },
  currentIndex: { type: Number, default: -1 },
})

const emit = defineEmits([
  'update:query',
  'update:replaceText',
  'update:showReplace',
  'findNext',
  'findPrev',
  'replace',
  'replaceAll',
  'close',
])

const queryRef = ref(null)
const localQuery = ref(props.query)
const localReplace = ref(props.replaceText)

watch(() => props.query, (v) => { localQuery.value = v })
watch(() => props.replaceText, (v) => { localReplace.value = v })
watch(localQuery, (v) => emit('update:query', v))
watch(localReplace, (v) => emit('update:replaceText', v))

watch(() => props.visible, (v) => {
  if (v) nextTick(() => queryRef.value?.focus())
})

const matchText = computed(() => {
  if (!props.query) return ''
  if (props.matchCount === 0) return '0/0'
  return `${props.currentIndex + 1}/${props.matchCount}`
})

function findNext() { emit('findNext') }
function findPrev() { emit('findPrev') }
function replace() { emit('replace') }
function replaceAll() { emit('replaceAll') }
function close() { emit('close') }
function toggleReplace() { emit('update:showReplace', !props.showReplace) }
</script>

<style scoped>
.search-panel {
  position: fixed;
  top: 0;
  left: 50%;
  z-index: 15;
  padding: 60px 12px 8px;
  border-radius: 0 0 10px 10px;
  border: 1px solid var(--bg-glass-border);
  border-top: none;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 420px;
}

.search-slide-enter-active,
.search-slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease;
}

.search-slide-enter-from,
.search-slide-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

.search-slide-enter-to,
.search-slide-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.search-row,
.replace-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input {
  flex: 1;
  background: var(--input-bg);
  border: 1px solid var(--bg-glass-border);
  border-radius: 6px;
  padding: 5px 8px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  min-width: 160px;
}

.search-input:focus {
  border-color: var(--accent);
}

.match-count {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 36px;
  text-align: center;
  user-select: none;
}

.search-btn {
  background: transparent;
  border: 1px solid var(--bg-glass-border);
  border-radius: 5px;
  color: var(--text-primary);
  font-size: 13px;
  padding: 4px 8px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}

.search-btn:hover {
  background: var(--hover-bg);
}

.search-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.search-btn.primary:hover {
  background: var(--accent-hover);
}

.search-btn.toggle.active {
  background: var(--accent-bg);
  border-color: var(--accent);
}

.search-btn.close {
  font-size: 16px;
  line-height: 1;
  padding: 3px 7px;
}
</style>
