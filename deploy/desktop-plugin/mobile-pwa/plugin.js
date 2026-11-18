// Hermes Desktop 插件：mobile-pwa
// 作用：只在“浏览器里的 Webapp”中生效，补齐官方 Webapp 缺少的移动端安装与安全区适配。
//   1. <link rel="manifest">，指向由 HTTPS 入口（Tailscale Serve）在 /pwa/ 下提供的静态清单
//   2. iOS / Android 的“添加到主屏幕”元信息与不透明背景图标
//   3. viewport-fit=cover + env(safe-area-inset-*) 内边距，避免底部手势条 / 刘海遮挡输入框
//      （软键盘弹出、焦点在输入区时去掉底部内边距，避免键盘上方留白）
//   4. 退出登录成功后清除本机 localStorage/sessionStorage 中的草稿、待确认提交、队列等私密状态
//      （只保留主题/布局等纯界面偏好）
// 不修改 Hermes 源码，不发起任何额外网络请求，不读取会话内容；禁用插件即恢复原状。
// 安装位置：~/.hermes/desktop-plugins/mobile-pwa/plugin.js（目录名必须等于 id）

// 退出登录时保留的“纯界面偏好”（白名单）；其余 localStorage / sessionStorage 一律清除，
// 包括未发送草稿、待确认提交记录、发送队列、最近会话/路由、未读计数等可能含私密内容的键。
const KEEP_ON_LOGOUT = [
  /^hermes-boot-/,
  /^hermes-desktop-onboarded-v1$/,
  /^hermes:ui-preferences:provisional$/,
  /^hermes\.desktop\.(layoutTree|layoutModeScopes|paneStates|collapsedTreeSides|keybinds|backdrop|hapticsMuted|completionSoundVariantId|profileColors|hideThreadTimeline|intro-splash|tutorials|alwaysExternalLinks|showAllProfiles|autoSpeakReplies|keepAwakeMode|pet-overlay-active|terminalTakeover)(\.|$)/,
  /^hermes\.desktop\.(toolView|toolDisclosure|reasoning\.collapsedByDefault)/,
]

function clearPrivateState() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (!KEEP_ON_LOGOUT.some(re => re.test(key))) window.localStorage.removeItem(key)
    }
  } catch { /* storage unavailable */ }
  try { window.sessionStorage.clear() } catch { /* storage unavailable */ }
}

const MANIFEST_HREF = '/pwa/manifest.webmanifest'
const ICON_HREF = '/pwa/icon-180.png'
const STYLE_ID = 'mobile-pwa-safe-area'

const SAFE_AREA_CSS = `
@supports (padding: env(safe-area-inset-bottom)) {
  html[data-hermes-desktop-host='browser'][data-mobile-pwa-safe] #root {
    padding-top: env(safe-area-inset-top, 0px);
    padding-right: env(safe-area-inset-right, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left: env(safe-area-inset-left, 0px);
  }
  html[data-hermes-desktop-host='browser'][data-mobile-pwa-safe][data-mobile-pwa-typing] #root {
    padding-bottom: 0px;
  }
}
`

function isEditable(el) {
  if (!el || el === document.body) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type)
  return false
}

export default {
  id: 'mobile-pwa',
  name: 'Mobile PWA',
  register(ctx) {
    const root = document.documentElement
    if (root.dataset.hermesDesktopHost !== 'browser') return // 原生 Desktop 不需要

    const undo = []
    const addHead = (tag, attrs) => {
      const el = document.createElement(tag)
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
      el.setAttribute('data-mobile-pwa', '')
      document.head.appendChild(el)
      undo.push(() => el.remove())
      return el
    }

    if (!document.querySelector('link[rel="manifest"]')) addHead('link', { rel: 'manifest', href: MANIFEST_HREF })
    const metas = {
      'apple-mobile-web-app-capable': 'yes',
      'mobile-web-app-capable': 'yes',
      'apple-mobile-web-app-title': 'Hermes',
      'apple-mobile-web-app-status-bar-style': 'default',
    }
    for (const [name, content] of Object.entries(metas)) {
      if (!document.querySelector(`meta[name="${name}"]`)) addHead('meta', { name, content })
    }

    // 官方图标背景透明，iOS 主屏会把透明区域渲染成黑色；换成不透明版本，禁用时还原。
    for (const link of document.querySelectorAll('link[rel="apple-touch-icon"]')) {
      const prev = link.getAttribute('href')
      link.setAttribute('href', ICON_HREF)
      undo.push(() => link.setAttribute('href', prev))
    }

    // 安全区：只在触控设备上开启 viewport-fit=cover，否则桌面浏览器保持原样。
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const viewport = document.querySelector('meta[name="viewport"]')
    if (coarse && viewport) {
      const prev = viewport.getAttribute('content') || ''
      if (!/viewport-fit\s*=/.test(prev)) {
        viewport.setAttribute('content', `${prev}, viewport-fit=cover`)
        undo.push(() => viewport.setAttribute('content', prev))
      }
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = SAFE_AREA_CSS
      document.head.appendChild(style)
      undo.push(() => style.remove())
      root.setAttribute('data-mobile-pwa-safe', '')
      undo.push(() => root.removeAttribute('data-mobile-pwa-safe'))

      const sync = () => {
        if (isEditable(document.activeElement)) root.setAttribute('data-mobile-pwa-typing', '')
        else root.removeAttribute('data-mobile-pwa-typing')
      }
      ctx.addEventListener(document, 'focusin', sync)
      ctx.addEventListener(document, 'focusout', () => ctx.setTimeout(sync, 0))
      undo.push(() => root.removeAttribute('data-mobile-pwa-typing'))
      sync()
    }

    // 退出登录：官方 Webapp 用页面内 fetch('POST /auth/logout') 退出，随后跳转登录页。
    // 在请求成功后清除本机私密状态；页面卸载时应用会把内存中的草稿写回 localStorage，
    // 因此在退出后再挂一个最后执行的 pagehide/beforeunload 监听，确保写回的内容也被清掉。
    // 同一设备上其他标签页也各自持有草稿副本，会在自己卸载时写回；用 BroadcastChannel 通知它们一起清除。
    let loggedOut = false
    const onLoggedOut = () => {
      if (loggedOut) { clearPrivateState(); return }
      loggedOut = true
      clearPrivateState()
      for (const type of ['pagehide', 'beforeunload']) window.addEventListener(type, clearPrivateState)
      document.addEventListener('visibilitychange', clearPrivateState)
      window.addEventListener('storage', clearPrivateState) // 其他标签页把草稿同步回来时再清一次
    }
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('hermes-mobile-pwa') : null
    if (channel) {
      channel.onmessage = event => { if (event.data === 'logout') onLoggedOut() }
      undo.push(() => channel.close())
    }
    const originalFetch = window.fetch
    const wrappedFetch = async function (input, init) {
      const response = await originalFetch.apply(this, arguments)
      try {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href)
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
        if (method === 'POST' && url.origin === window.location.origin && /\/auth\/logout$/.test(url.pathname) && response.ok) {
          onLoggedOut()
          if (channel) channel.postMessage('logout')
        }
      } catch { /* never break the app's own fetch */ }
      return response
    }
    window.fetch = wrappedFetch
    undo.push(() => { if (window.fetch === wrappedFetch) window.fetch = originalFetch })

    ctx.onDispose(() => { for (const fn of undo.reverse()) fn() })
  },
}
