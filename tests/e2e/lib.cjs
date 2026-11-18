// 验收测试公共工具。驱动真实 Hermes Webapp（浏览器 UI）+ 官方 REST 接口做服务端核对。
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const CFG = {
  base: (process.env.HERMES_E2E_BASE_URL || 'https://hermes.test:8443').replace(/\/$/, ''),
  // 例：hermes.test=127.0.0.1 —— 仅在本机用自签 HTTPS 入口模拟 Tailscale Serve 时需要
  resolve: process.env.HERMES_E2E_RESOLVE || '',
  user: process.env.HERMES_E2E_USER || 'me',
  passwordFile: process.env.HERMES_E2E_PASSWORD_FILE || '',
  // 设置后表示后端接的是 tests/model-stub/stub_llm.py（脚本化模型），可做精确的“只执行一次”核对
  stubLog: process.env.HERMES_E2E_STUB_LOG || '',
  insecureTls: process.env.HERMES_E2E_INSECURE_TLS === '1',
  workdir: process.env.HERMES_E2E_WORKDIR || '/tmp/hermes-work/e2e',
  out: process.env.HERMES_E2E_OUT || path.join(__dirname, 'results'),
  frontPid: process.env.HERMES_E2E_FRONT_PID || '',
  only: (process.env.HERMES_E2E_ONLY || '').split(',').filter(Boolean),
}

function password() {
  if (process.env.HERMES_E2E_PASSWORD) return process.env.HERMES_E2E_PASSWORD
  if (!CFG.passwordFile) throw new Error('set HERMES_E2E_PASSWORD_FILE (file containing the Webapp password)')
  return fs.readFileSync(CFG.passwordFile, 'utf8').trim()
}

const nonce = () => crypto.randomBytes(3).toString('hex')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function launch() {
  const host = new URL(CFG.base).hostname
  const opts = { args: [] }
  if (CFG.resolve) {
    const [name, ip] = CFG.resolve.split('=')
    opts.args.push(`--host-resolver-rules=MAP ${name} ${ip}`)
  }
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
  if (proxy) opts.proxy = { server: proxy, bypass: `${host},127.0.0.1,localhost` }
  return chromium.launch(opts)
}

const DEVICES = {
  phone360: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
  phone390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  phone430: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
}

async function newContext(browser, device = 'phone390', extra = {}) {
  return browser.newContext({ ...DEVICES[device], ignoreHTTPSErrors: CFG.insecureTls, locale: 'zh-CN', ...extra })
}

/** 走官方登录页登录，返回已在主界面就绪的 page。 */
async function login(ctx, { hash = '' } = {}) {
  const page = await ctx.newPage()
  await page.goto(`${CFG.base}/`)
  await page.waitForURL(/\/login/, { timeout: 30000 })
  await page.fill('input[name=username]', CFG.user)
  await page.fill('input[name=password]', password())
  await Promise.all([
    page.waitForURL(u => !new URL(u).pathname.startsWith('/login'), { timeout: 30000 }),
    page.click('button[type=submit]'),
  ])
  if (hash) await page.goto(`${CFG.base}/#/${hash}`)
  await ready(page)
  return page
}

/** 主界面可交互：输入框出现且“连接中”遮罩消失。把虚拟鼠标移开左缘，避免桌面端 hover 抽屉（真机触屏无此现象）。 */
async function ready(page) {
  const vp = page.viewportSize()
  await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 2))
  await composer(page).waitFor({ timeout: 45000 })
  await page.waitForFunction(() => !document.querySelector('[class*="z-(--z-connecting)"]'), null, { timeout: 45000 })
  const dismiss = page.getByRole('button', { name: '不用了' })
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click().catch(() => {})
}

const composer = page => page.getByRole('textbox', { name: '消息' })

async function send(page, text) {
  const box = composer(page)
  await box.click()
  await page.keyboard.insertText(text)
  await page.keyboard.press('Enter')
}

async function newSession(page) {
  await page.goto(`${CFG.base}/#/`)
  await ready(page)
}

function sessionId(page) {
  const m = /#\/([^/?#]+)/.exec(page.url())
  return m ? decodeURIComponent(m[1]) : ''
}

async function waitSessionId(page, timeout = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const id = sessionId(page)
    if (id) return id
    await sleep(250)
  }
  throw new Error('no session id in URL')
}

async function waitText(page, text, timeout = 30000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout })
}

async function openSession(page, sid) {
  await page.goto(`${CFG.base}/#/${encodeURIComponent(sid)}`)
  await ready(page)
}

// ---- 官方 REST（浏览器同一份 HttpOnly Cookie）----
async function apiGet(ctx, p) {
  const r = await ctx.request.get(CFG.base + p, { failOnStatusCode: false, maxRedirects: 0 })
  let body = null
  try { body = await r.json() } catch { body = await r.text().catch(() => null) }
  return { status: r.status(), body, headers: r.headers() }
}

async function apiSend(ctx, method, p, data) {
  const r = await ctx.request.fetch(CFG.base + p, {
    method, data, failOnStatusCode: false, maxRedirects: 0,
    headers: { Origin: CFG.base, 'Content-Type': 'application/json' },
  })
  let body = null
  try { body = await r.json() } catch { body = await r.text().catch(() => null) }
  return { status: r.status(), body, headers: r.headers() }
}

async function messages(ctx, sid) {
  const r = await apiGet(ctx, `/api/sessions/${encodeURIComponent(sid)}/messages`)
  return r.body?.messages || []
}

async function readText(ctx, file) {
  return apiGet(ctx, `/api/fs/read-text?path=${encodeURIComponent(file)}`)
}

// ---- 模型桩日志：确认同一条消息只到达模型一次 ----
function stubEntries() {
  if (!CFG.stubLog || !fs.existsSync(CFG.stubLog)) return []
  return fs.readFileSync(CFG.stubLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}
/** 以用户消息为起点的模型调用（流式 + 带工具 = 正式 Agent 轮次，不含标题生成等辅助调用） */
function turnsFor(marker, since = 0) {
  return stubEntries().filter(e => e.t >= since && e.stream && e.tools && e.last_role === 'user' && (e.last_user || '').includes(marker))
}
function closedStreamsFor(marker, since = 0) {
  return stubEntries().filter(e => e.t >= since && e.event === 'client_closed_stream' && (e.last_user || '').includes(marker))
}

/** 让测试 HTTPS 入口断开当前所有 WebSocket；返回实际断开的数量（读取入口日志确认，避免“信号发错进程却误判通过”）。 */
async function dropAllSockets() {
  if (!CFG.frontPid) return 0
  const log = process.env.HERMES_E2E_FRONT_LOG
  const before = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').length : 0
  process.kill(Number(fs.readFileSync(CFG.frontPid, 'utf8').trim()), 'SIGUSR2')
  if (!log) return -1
  for (let i = 0; i < 20; i++) {
    await sleep(100)
    const m = /dropped (\d+) websocket/.exec(fs.readFileSync(log, 'utf8').slice(before))
    if (m) return Number(m[1])
  }
  return 0
}

module.exports = {
  CFG, nonce, sleep, launch, newContext, login, ready, composer, send, newSession, sessionId, waitSessionId,
  waitText, openSession, apiGet, apiSend, messages, readText, stubEntries, turnsFor, closedStreamsFor, dropAllSockets,
}
