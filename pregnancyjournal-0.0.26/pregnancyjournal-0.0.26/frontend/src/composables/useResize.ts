import { ref, onMounted, onUnmounted } from 'vue'
import { debounce } from '@/utils/debounce'

export function useResize(callback?: (width: number, height: number) => void, delay: number = 150) {
  const width = ref(typeof window !== 'undefined' ? window.innerWidth : 0)
  const height = ref(typeof window !== 'undefined' ? window.innerHeight : 0)
  const isMobile = ref(width.value < 768)

  const debouncedHandler = debounce(() => {
    width.value = window.innerWidth
    height.value = window.innerHeight
    isMobile.value = width.value < 768
    callback?.(width.value, height.value)
  }, delay)

  onMounted(() => {
    window.addEventListener('resize', debouncedHandler)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', debouncedHandler)
  })

  return {
    width,
    height,
    isMobile,
  }
}
