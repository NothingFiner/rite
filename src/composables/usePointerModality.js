import { onMounted, onUnmounted } from 'vue'

// Toggles the body class the focus-ring rules in src/style.css read. A
// pointerdown adds it before the browser can focus a target, so a click
// never leaves a ring. A keydown clears it before focus can move, so a
// Tab-shaped focus always shows the ring again.
export function usePointerModality() {
  const markPointer = () => { document.body.classList.add('pointer-last') }
  const markKeyboard = () => { document.body.classList.remove('pointer-last') }
  onMounted(() => {
    document.addEventListener('pointerdown', markPointer, true)
    document.addEventListener('keydown', markKeyboard, true)
  })
  onUnmounted(() => {
    document.removeEventListener('pointerdown', markPointer, true)
    document.removeEventListener('keydown', markKeyboard, true)
  })
}
