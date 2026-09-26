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
    // ⚠️ 挂载时先立即重算一次。个别 WebView / 厂商浏览器首屏拿到的 innerWidth 不可靠
    // （或被嵌入 iframe、容器时初值不对），若只等 resize 事件，手机上可能被误判为桌面端
    // 而渲染出侧边栏（而不是底部 tab 栏），窄屏布局直接崩坏。
    width.value = window.innerWidth
    height.value = window.innerHeight
    isMobile.value = width.value < 768
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
