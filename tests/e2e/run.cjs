#!/usr/bin/env node
// Hermes 移动端 Webapp 验收测试：浏览器操作真实 Webapp，并用官方 REST 与模型桩日志做服务端核对。
// 用法见 tests/README.md。结果写入 $HERMES_E2E_OUT（默认 tests/e2e/results/）。
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const L = require('./lib.cjs')
const { CFG, nonce, sleep } = L

const STUB = Boolean(CFG.stubLog)
const LOCAL = process.env.HERMES_E2E_LOCAL === '1' // 测试与 Hermes 在同一台机器（可调用 CLI、重启网关）
const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
const KIND = STUB ? '真实 Hermes + 脚本化模型桩' : '真实 Hermes + 真实模型'
const W = CFG.workdir
const SHOTS = path.join(CFG.out, 'screens')
fs.mkdirSync(SHOTS, { recursive: true })
fs.mkdirSync(W, { recursive: true })

const results = []
function save() {
  fs.writeFileSync(path.join(CFG.out, 'results.json'), JSON.stringify({ kind: KIND, base: CFG.base, at: new Date().toISOString(), results }, null, 2))
  const lines = [`# 验收结果（${KIND}）`, '', `入口：${CFG.base}　时间：${new Date().toISOString()}`, '']
  for (const r of results) {
    lines.push(`## ${r.id} ${r.title} — ${r.status === 'pass' ? '通过' : r.status === 'skip' ? '跳过' : '未通过'}（${r.seconds}s）`)
    for (const c of r.checks) lines.push(`- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail !== undefined ? `：${typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}` : ''}`)
    for (const n of r.notes) lines.push(`- 说明：${n}`)
    if (r.error) lines.push('', '```', r.error, '```')
    lines.push('')
  }
  fs.writeFileSync(path.join(CFG.out, 'results.md'), lines.join('\n'))
}

async function scenario(id, title, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {} }
  if (CFG.only.length && !CFG.only.includes(id)) return
  const rec = { id, title, kind: KIND, status: 'pass', checks: [], notes: [] }
  const t0 = Date.now()
  const skip = (opts.needsReal && STUB) ? '仅在接真实模型时运行' : (opts.needsStub && !STUB) ? '需要模型桩（HERMES_E2E_STUB_LOG）' : (opts.needsLocal && !LOCAL) ? '需要在 Hermes 主机本机运行（HERMES_E2E_LOCAL=1）' : ''
  if (skip) { rec.status = 'skip'; rec.notes.push(skip) } else {
    const check = (name, ok, detail) => { rec.checks.push({ name, ok: Boolean(ok), detail }); if (!ok) rec.status = 'fail'; return Boolean(ok) }
    const note = s => rec.notes.push(s)
    try { await fn({ check, note }) } catch (e) { rec.status = 'fail'; rec.error = String(e && e.stack || e).slice(0, 2000) }
  }
  rec.seconds = Math.round((Date.now() - t0) / 1000)
  results.push(rec)
  console.log(`[${rec.status.toUpperCase()}] ${id} ${title} (${rec.seconds}s)`)
  for (const c of rec.checks) if (!c.ok) console.log(`    ✗ ${c.name} ${JSON.stringify(c.detail ?? '')}`)
  if (rec.error) console.log('    ' + rec.error.split('\n').slice(0, 3).join('\n    '))
  save()
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const iw = window.innerWidth
    const clippedByScroller = el => {
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e)
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && e.getBoundingClientRect().right <= iw + 1) return true
      }
      return false
    }
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.right <= iw + 1) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      if (!clippedByScroller(el)) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`)
      if (offenders.length > 5) break
    }
    const scrollsX = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1) return true } return false }
    const pre = [...document.querySelectorAll('pre')].pop()
    const table = [...document.querySelectorAll('table')].pop()
    const box = document.querySelector('[role=textbox][aria-label="消息"]').getBoundingClientRect()
    return {
      innerWidth: iw, innerHeight: window.innerHeight, docScrollWidth: document.documentElement.scrollWidth,
      offenders,
      // 宽内容若超出所在容器，必须在局部滚动；未超出（宽屏放得下）也算正确
      preScrollsInside: pre ? (scrollsX(pre) || pre.getBoundingClientRect().right <= iw) : null,
      tableScrollsInside: table ? (scrollsX(table) || table.getBoundingClientRect().right <= iw) : null,
      composerTop: Math.round(box.top), composerBottom: Math.round(box.bottom), composerFont: getComputedStyle(document.querySelector('[role=textbox][aria-label="消息"]')).fontSize,
    }
  })
}

;(async () => {
  const browser = await L.launch()
  const loginAs = async (device, extra) => { const ctx = await L.newContext(browser, device, extra); return { ctx, page: await L.login(ctx) } }

  // ------------------------------------------------------------------ S01
  await scenario('S01', '手机/平板/电脑尺寸适配与长内容渲染', { needsStub: true }, async ({ check, note }) => {
    for (const device of ['phone360', 'phone390', 'phone430', 'tablet', 'desktop']) {
      const { ctx, page } = await loginAs(device)
      const n = nonce()
      await L.send(page, `[markdown] 尺寸-${device}-${n}`)
      await L.waitText(page, '长内容渲染测试', 30000)
      await sleep(1500)
      const m = await layoutMetrics(page)
      await page.screenshot({ path: path.join(SHOTS, `S01-${device}.png`) })
      check(`${device} 页面无横向撑破`, m.docScrollWidth <= m.innerWidth && m.offenders.length === 0, { docScrollWidth: m.docScrollWidth, innerWidth: m.innerWidth, offenders: m.offenders })
      check(`${device} 超长代码行在代码块内横向滚动（或宽屏可完整显示）`, m.preScrollsInside === true, m.preScrollsInside)
      check(`${device} 宽表格局部横向滚动（或宽屏可完整显示）`, m.tableScrollsInside === true, m.tableScrollsInside)
      check(`${device} 输入框在可视区域内`, m.composerTop >= 0 && m.composerBottom <= m.innerHeight, { top: m.composerTop, bottom: m.composerBottom, h: m.innerHeight })
      if (device.startsWith('phone')) check(`${device} 输入框字号 ≥16px（iOS 不会自动放大）`, parseFloat(m.composerFont) >= 16, m.composerFont)
      if (device === 'phone390') {
        // 模拟软键盘占去 336px（interactive-widget=resizes-content 下布局视口会缩小）
        await page.setViewportSize({ width: 390, height: 508 })
        await L.composer(page).click()
        await sleep(600)
        const k = await layoutMetrics(page)
        await page.screenshot({ path: path.join(SHOTS, 'S01-phone390-keyboard-sim.png') })
        check('390 宽、模拟键盘弹出后输入框仍可见', k.composerTop >= 0 && k.composerBottom <= 508, { top: k.composerTop, bottom: k.composerBottom })
        await page.setViewportSize({ width: 390, height: 844 })
        // 复制按钮
        const copies = await page.getByRole('button', { name: /复制/ }).count()
        check('消息/代码有“复制”按钮', copies > 0, copies)
        // 向上阅读时不强制拉回底部，并提供“滚动到底部”
        await page.evaluate(() => { const pre = [...document.querySelectorAll('pre')].pop(); for (let e = pre; e; e = e.parentElement) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 10) { e.scrollTop = 0; e.dispatchEvent(new Event('scroll')); break } } })
        await sleep(800)
        const n2 = nonce()
        await L.send(page, `向上阅读时的新消息-${n2}`)
        await sleep(2500)
        const toBottom = await page.getByRole('button', { name: '滚动到底部' }).isVisible().catch(() => false)
        check('向上阅读时出现“滚动到底部”按钮', toBottom, toBottom)
      }
      await ctx.close()
    }
    // 深色模式
    const { ctx, page } = await loginAs('phone390', { colorScheme: 'dark' })
    await sleep(1000)
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.screenshot({ path: path.join(SHOTS, 'S01-phone390-dark.png') })
    const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(bg)
    const rgb = srgb ? srgb.slice(1, 4).map(v => Number(v) * 255) : (bg.match(/\d+/g) || [255, 255, 255]).slice(0, 3).map(Number)
    const lum = rgb.reduce((a, b) => a + b, 0) / 3
    check('系统深色模式下界面为深色', lum < 80, bg)
    await ctx.close()
    note('键盘弹出为“缩小视口”模拟，不等于真机软键盘；真机需人工确认。')
  })

  // ------------------------------------------------------------------ S02
  await scenario('S02', '中文输入法选词时 Enter 不误发送', { needsStub: true }, async ({ check }) => {
    const { ctx, page } = await loginAs('phone390')
    const n = nonce()
    const since = Date.now() / 1000
    await L.composer(page).click()
    await page.keyboard.insertText(`输入法-${n}`)
    const fire = (opts) => L.composer(page).evaluate((el, o) => {
      if (o.start) el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      if (o.end) el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'x' }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: o.keyCode, which: o.keyCode, isComposing: o.composing, bubbles: true, cancelable: true }))
    }, opts)
    await fire({ start: true, composing: true, keyCode: 229 })
    await sleep(1500)
    check('组合输入中（isComposing=true）按 Enter 不发送', L.turnsFor(`输入法-${n}`, since).length === 0)
    await fire({ end: true, composing: false, keyCode: 229 })
    await sleep(1500)
    check('Safari 式“结束组合后紧跟 229 Enter”不发送', L.turnsFor(`输入法-${n}`, since).length === 0)
    await sleep(500)
    await fire({ composing: false, keyCode: 13 })
    await L.waitText(page, `收到：输入法-${n}`, 20000)
    check('普通 Enter 正常发送且只发送一次', L.turnsFor(`输入法-${n}`, since).length === 1, L.turnsFor(`输入法-${n}`, since).length)
    await ctx.close()
  })

  // ------------------------------------------------------------------ S03
  await scenario('S03', '真实 Agent 工具调用（临时目录写文件）', { needsStub: true }, async ({ check }) => {
    const { ctx, page } = await loginAs('phone390')
    const n = nonce()
    const file = `${W}/tool-proof-${n}.txt`
    const since = Date.now() / 1000
    await L.send(page, `[write ${file}] 工具证明-${n}`)
    await L.waitText(page, '工具已执行', 30000)
    const r = await L.readText(ctx, file)
    check('文件由 Hermes 工具真实写入（经官方 REST 读取核对）', r.status === 200 && JSON.stringify(r.body).includes(`工具证明-${n}`), { status: r.status })
    check('该任务只到达模型一次', L.turnsFor(`工具证明-${n}`, since).length === 1)
    await page.screenshot({ path: path.join(SHOTS, 'S03-tool.png') })
    await ctx.close()
  })

  // ------------------------------------------------------------------ S04
  await scenario('S04', '两个客户端同步同一会话（电脑 A ↔ 手机 B）', { needsStub: true }, async ({ check }) => {
    const A = await loginAs('desktop')
    const B = await loginAs('phone390')
    const n = nonce()
    const since = Date.now() / 1000
    await L.send(A.page, `同步-甲-${n}`)
    await L.waitText(A.page, `收到：同步-甲-${n}`)
    const sid = await L.waitSessionId(A.page)
    const list = await L.apiGet(B.ctx, '/api/sessions?limit=20')
    check('B 的会话列表包含 A 新建的会话', (list.body?.sessions || []).some(s => s.id === sid), sid)
    await L.openSession(B.page, sid)
    await L.waitText(B.page, `收到：同步-甲-${n}`, 20000)
    check('B 打开后看到 A 的消息与回复', true)
    await L.send(B.page, `同步-乙-${n}`)
    await L.waitText(A.page, `收到：同步-乙-${n}`, 30000)
    check('A 无需刷新即看到 B 的新消息与回复', true)
    await L.send(B.page, '[recall]')
    await L.waitText(A.page, '本会话之前的用户消息', 30000)
    await sleep(1500)
    const msgs = await L.messages(B.ctx, sid)
    const recall = [...msgs].reverse().find(m => m.role === 'assistant' && String(m.content).includes('本会话之前的用户消息'))
    check('上下文连续（第三轮能看到前两轮）', recall && String(recall.content).includes(`同步-甲-${n}`) && String(recall.content).includes(`同步-乙-${n}`), recall && String(recall.content).slice(0, 160))
    check('甲消息只执行一次', L.turnsFor(`同步-甲-${n}`, since).length === 1, L.turnsFor(`同步-甲-${n}`, since).length)
    const userRows = msgs.filter(m => m.role === 'user')
    check('服务端历史无重复用户消息', userRows.length === 3, userRows.map(m => String(m.content).slice(0, 30)))
    const prof = await L.apiGet(B.ctx, `/api/sessions/${encodeURIComponent(sid)}/messages`)
    check('会话属于当前 profile（default）', prof.body?.profile === 'default' || prof.body?.profile == null, prof.body?.profile)
    // 重命名：带版本号的乐观并发
    const snap = await L.apiGet(A.ctx, `/api/sessions/${encodeURIComponent(sid)}/mutation-snapshot`)
    const rev = snap.body?.runtime_revision
    const title = `同步改名-${n}`
    const ok = await L.apiSend(A.ctx, 'PATCH', `/api/sessions/${encodeURIComponent(sid)}`, { title, expected_revision: rev, expected_generation: snap.body?.runtime_generation ?? undefined, request_id: `rename-${n}` })
    check('带正确版本号重命名成功', ok.status === 200, { status: ok.status, rev, body: JSON.stringify(ok.body).slice(0, 200) })
    const stale = await L.apiSend(A.ctx, 'PATCH', `/api/sessions/${encodeURIComponent(sid)}`, { title: `过期改名-${n}`, expected_revision: rev, expected_generation: snap.body?.runtime_generation ?? undefined, request_id: `rename2-${n}` })
    const retry = await L.apiSend(A.ctx, 'PATCH', `/api/sessions/${encodeURIComponent(sid)}`, { title, expected_revision: rev, expected_generation: snap.body?.runtime_generation ?? undefined, request_id: `rename-${n}` })
    check('同一 request_id 重试返回原回执（幂等，不再次修改）', retry.status === 200, { status: retry.status, body: JSON.stringify(retry.body).slice(0, 160) })
    check('用过期版本号改名被拒绝（冲突提示，而不是静默覆盖）', stale.status === 409 || stale.status === 412 || (stale.body && /conflict|stale|revision/i.test(JSON.stringify(stale.body))), { status: stale.status, body: JSON.stringify(stale.body).slice(0, 200) })
    await L.waitText(B.page, title, 20000).then(() => check('B 实时看到新标题', true)).catch(() => check('B 实时看到新标题', false))
    await A.page.screenshot({ path: path.join(SHOTS, 'S04-A-desktop.png') })
    await B.page.screenshot({ path: path.join(SHOTS, 'S04-B-phone.png') })
    await A.ctx.close(); await B.ctx.close()
  })

  // ------------------------------------------------------------------ S05
  await scenario('S05', '接续电脑端 CLI 会话（双向）', { needsStub: true, needsLocal: true }, async ({ check, note }) => {
    const n = nonce()
    const out1 = execFileSync(HERMES_BIN, ['chat', '--oneshot', '-q', `电脑-丙-${n}`], { cwd: W, encoding: 'utf8', timeout: 120000 })
    const sid = (/--resume\s+(\S+)/.exec(out1) || [])[1]
    check('CLI 新建会话并返回会话 ID', Boolean(sid), sid)
    const B = await loginAs('phone390')
    await L.openSession(B.page, sid)
    await L.waitText(B.page, `电脑-丙-${n}`, 20000)
    check('手机端打开后看到 CLI 会话历史', true)
    await L.send(B.page, `手机-丁-${n}`)
    await L.waitText(B.page, `收到：手机-丁-${n}`, 30000)
    check('手机端可以在 CLI 会话里继续提问（未被拒绝为只读）', true)
    const out2 = execFileSync(HERMES_BIN, ['chat', '--resume', sid, '--oneshot', '-q', '[recall] 电脑端继续'], { cwd: W, encoding: 'utf8', timeout: 120000 })
    check('CLI --resume 后上下文里能看到手机端的消息', out2.includes(`手机-丁-${n}`) && out2.includes(`电脑-丙-${n}`), out2.split('\n').filter(l => l.includes('本会话之前')).join(' ').slice(0, 200))
    await L.waitText(B.page, '[recall] 电脑端继续', 20000).then(() => check('CLI 新消息实时出现在手机端', true)).catch(() => check('CLI 新消息实时出现在手机端', false))
    note('Hermes v0.23.2 中 CLI 与 Webapp 由同一个 Gateway 执行；网关接管之前写下的旧会话需先运行 `hermes sessions adopt`。')
    await B.ctx.close()
  })

  // ------------------------------------------------------------------ S06
  await scenario('S06', '关闭页面后任务继续，重新打开恢复结果', { needsStub: true }, async ({ check }) => {
    const n = nonce()
    const since = Date.now() / 1000
    const B = await loginAs('phone390')
    await L.send(B.page, `[slow 12] 断线-${n}`)
    await L.waitText(B.page, '[进度 2/', 20000)
    const sid = await L.waitSessionId(B.page)
    await B.ctx.close() // 相当于关闭浏览器/锁屏后被系统回收
    await sleep(16000)
    const C = await loginAs('phone390')
    await L.openSession(C.page, sid)
    await L.waitText(C.page, '慢速任务完成', 20000)
    check('重新打开后看到完整结果', true)
    const msgs = await L.messages(C.ctx, sid)
    check('服务端历史中该轮已完成', msgs.some(m => m.role === 'assistant' && String(m.content).includes('慢速任务完成')))
    check('模型只被调用一次（重连没有重复执行）', L.turnsFor(`断线-${n}`, since).length === 1, L.turnsFor(`断线-${n}`, since).length)
    check('模型流没有被中途切断', L.closedStreamsFor(`断线-${n}`, since).length === 0)
    await C.page.screenshot({ path: path.join(SHOTS, 'S06-reopen.png') })
    await C.ctx.close()
  })

  await scenario('S06b', '实时连接中途断开（模拟切网），自动重连补齐输出', { needsStub: true }, async ({ check, note }) => {
    if (!CFG.frontPid) { note('需要 HERMES_E2E_FRONT_PID 指向测试 HTTPS 入口进程'); return }
    const n = nonce()
    const since = Date.now() / 1000
    const B = await loginAs('phone390')
    await L.send(B.page, `[slow 10] 掉线-${n}`)
    await L.waitText(B.page, '[进度 2/', 20000)
    const dropped = await L.dropAllSockets()
    check('测试入口确实断开了实时连接', dropped >= 1, dropped)
    await sleep(1500)
    const midText = await B.page.locator('body').innerText()
    note(`断开后 1.5 秒页面状态片段：${(midText.match(/.{0,10}(重新连接|正在连接|连接中|断开|离线|reconnect).{0,10}/i) || ['（无连接提示）'])[0]}`)
    await L.waitText(B.page, '慢速任务完成', 40000)
    check('同一页面在断线后自动恢复并显示最终结果', true)
    check('只执行一次', L.turnsFor(`掉线-${n}`, since).length === 1, L.turnsFor(`掉线-${n}`, since).length)
    const text = await B.page.locator('body').innerText()
    check('最终输出没有重复段落', (text.match(/慢速任务完成/g) || []).length === 1, (text.match(/慢速任务完成/g) || []).length)
    await B.ctx.close()
  })

  // ------------------------------------------------------------------ S07
  await scenario('S07', '重复点击、响应丢失与离线', { needsStub: true }, async ({ check, note }) => {
    const B = await loginAs('phone390')
    // a) 连按两次 Enter
    let n = nonce(); let since = Date.now() / 1000
    await L.composer(B.page).click()
    await B.page.keyboard.insertText(`重复-${n}`)
    await B.page.keyboard.press('Enter'); await B.page.keyboard.press('Enter')
    await L.waitText(B.page, `收到：重复-${n}`, 20000)
    await sleep(2000)
    check('快速连按两次 Enter 只提交一次', L.turnsFor(`重复-${n}`, since).length === 1, L.turnsFor(`重复-${n}`, since).length)
    // b) 提交瞬间断开实时连接（模拟回执丢失）
    if (CFG.frontPid) {
      n = nonce(); since = Date.now() / 1000
      await L.composer(B.page).click()
      await B.page.keyboard.insertText(`回执丢失-${n}`)
      await B.page.keyboard.press('Enter')
      const dropped = await L.dropAllSockets()
      check('测试入口在提交瞬间断开了实时连接', dropped >= 1, dropped)
      await sleep(15000)
      const turns = L.turnsFor(`回执丢失-${n}`, since).length
      const sid = L.sessionId(B.page)
      const rows = sid ? (await L.messages(B.ctx, sid)).filter(m => m.role === 'user' && String(m.content).includes(`回执丢失-${n}`)).length : 0
      check('回执丢失后没有被自动重复执行（模型调用 ≤ 1）', turns <= 1, { turns })
      check('服务端历史中该消息不重复', rows <= 1, { rows })
      const body = await B.page.locator('body').innerText()
      note(`回执丢失后：模型调用 ${turns} 次，服务端用户消息 ${rows} 条；页面${/待核对|未知|unknown|未确认|重试|失败/.test(body) ? '出现了待核对/失败提示' : '未出现额外提示'}。`)
      await B.page.screenshot({ path: path.join(SHOTS, 'S07-ack-lost.png') })
    }
    // c) 离线：断开已有实时连接 + 入口拒绝新连接 + 浏览器离线（单靠 setOffline 不会关闭已建立的 WebSocket）
    const block = process.env.HERMES_E2E_FRONT_BLOCK
    if (!block || !CFG.frontPid) { note('离线测试需要 HERMES_E2E_FRONT_BLOCK 与 HERMES_E2E_FRONT_PID'); await B.ctx.close(); return }
    n = nonce(); since = Date.now() / 1000
    await L.composer(B.page).click()
    await B.page.keyboard.press('Control+A'); await B.page.keyboard.press('Backspace')
    fs.writeFileSync(block, '1')
    await B.ctx.setOffline(true)
    const droppedOff = await L.dropAllSockets()
    check('离线模拟：已有实时连接被断开', droppedOff >= 1, droppedOff)
    await sleep(8000)
    await B.page.screenshot({ path: path.join(SHOTS, 'S07-offline.png') })
    const statusOff = await B.page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).filter(t => /^后端/.test(t)).join(' | '))
    check('离线时状态栏不再显示“后端 就绪”', !/就绪/.test(statusOff), statusOff)
    const offlineText = await B.page.locator('body').innerText()
    note(`离线 8 秒后状态栏：${statusOff}；页面提示片段：${(offlineText.match(/.{0,12}(离线|断开|重新连接|正在连接|连接中|无法连接|offline|reconnect).{0,12}/i) || ['（无）'])[0]}`)
    await L.composer(B.page).click().catch(() => {})
    await B.page.keyboard.insertText(`离线草稿-${n}`)
    await B.page.keyboard.press('Enter')
    await sleep(4000)
    await B.page.screenshot({ path: path.join(SHOTS, 'S07-offline-send.png') })
    check('离线期间消息没有到达模型', L.turnsFor(`离线草稿-${n}`, since).length === 0)
    const composerText = await L.composer(B.page).evaluate(el => el.textContent).catch(() => '')
    const pageText = await B.page.locator('body').innerText()
    check('离线时输入内容没有丢失（仍在输入框或显示为未送达）', composerText.includes(`离线草稿-${n}`) || pageText.includes(`离线草稿-${n}`))
    note(`离线按发送后：草稿${pageText.includes(`离线草稿-${n}`) ? '仍显示在页面（输入框，见截图 S07-offline-send）' : '不可见'}；页面提示片段：${(pageText.match(/.{0,14}(失败|未发送|未送达|重试|离线|无法|排队|queued).{0,14}/i) || ['（无）'])[0]}`)
    fs.unlinkSync(block)
    await B.ctx.setOffline(false)
    await sleep(25000)
    const after = L.turnsFor(`离线草稿-${n}`, since).length
    await B.page.screenshot({ path: path.join(SHOTS, 'S07-back-online.png') })
    const statusOn = await B.page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).filter(t => /^后端/.test(t)).join(' | '))
    check('恢复网络后自动重连（状态栏回到就绪）', /就绪/.test(statusOn), statusOn)
    check('离线时未送达的消息恢复后不会被重复执行（≤ 1 次）', after <= 1, after)
    note(`恢复网络 25 秒后，离线时按下发送的那条消息到达模型 ${after} 次（0 = 需用户手动重发；1 = 恢复后以同一 submission_id 送达一次）。`)
    await B.ctx.close()
  })

  // ------------------------------------------------------------------ S08
  await scenario('S08', '停止任务：取消请求真正到达后端', { needsStub: true }, async ({ check }) => {
    const n = nonce()
    const since = Date.now() / 1000
    const B = await loginAs('phone390')
    await L.send(B.page, `[slow 30] 取消-${n}`)
    await L.waitText(B.page, '[进度 2/', 20000)
    const stops = B.page.getByRole('button', { name: '停止' })
    await stops.last().click()
    const t0 = Date.now()
    while (Date.now() - t0 < 15000 && L.closedStreamsFor(`取消-${n}`, since).length === 0) await sleep(300)
    check('后端中止了上游模型请求（模型桩记录到流被关闭）', L.closedStreamsFor(`取消-${n}`, since).length >= 1)
    await sleep(3000)
    const stillStop = await stops.count()
    check('停止后“停止”按钮消失、回到可输入状态', stillStop === 0, stillStop)
    const sid = L.sessionId(B.page)
    await sleep(20000)
    const msgs = await L.messages(B.ctx, sid)
    check('被取消的任务没有在后台继续跑完', !msgs.some(m => String(m.content).includes('慢速任务完成')))
    check('取消没有触发重新执行', L.turnsFor(`取消-${n}`, since).length === 1)
    await B.page.screenshot({ path: path.join(SHOTS, 'S08-stopped.png') })
    await B.ctx.close()
  })

  // ------------------------------------------------------------------ S09
  await scenario('S09', '工具批准：两端可见、绑定到具体命令、拒绝/批准均生效', { needsStub: true }, async ({ check, note }) => {
    const n = nonce()
    const dir = `${W}/approve-${n}`
    const B = await loginAs('phone390')
    await L.send(B.page, `[write ${dir}/keep.txt] 保留-${n}`)
    await L.waitText(B.page, '工具已执行', 30000)
    const sid = await L.waitSessionId(B.page)
    const A = await loginAs('desktop')
    await L.openSession(A.page, sid)
    // 第一次：拒绝
    await L.send(B.page, `[sh rm -rf ${dir}]`)
    await L.waitText(B.page, '需要审批', 30000)
    await A.page.getByRole('button', { name: /^运行/ }).first().waitFor({ timeout: 20000 })
    const aHasCmd = await A.page.evaluate(cmd => document.body.textContent.includes(cmd), `rm -rf ${dir}`)
    check('电脑端也看到同一个待批准命令（卡片显示具体命令）', aHasCmd)
    await B.page.screenshot({ path: path.join(SHOTS, 'S09-approval-phone.png') })
    await B.page.getByRole('button', { name: '拒绝' }).first().click()
    await sleep(4000)
    const afterDeny = await L.readText(B.ctx, `${dir}/keep.txt`)
    check('拒绝后命令没有执行（文件仍在）', afterDeny.status === 200, afterDeny.status)
    const aStill = await A.page.getByRole('button', { name: /^运行/ }).count()
    check('拒绝后电脑端的批准卡片失效', aStill === 0, aStill)
    // 第二次：在电脑端批准
    await L.send(B.page, `[sh rm -rf ${dir}]`)
    await A.page.getByRole('button', { name: /^运行/ }).first().waitFor({ timeout: 30000 })
    await A.page.getByRole('button', { name: /^运行/ }).first().click()
    await sleep(5000)
    const afterRun = await L.readText(B.ctx, `${dir}/keep.txt`)
    check('电脑端批准后命令执行（文件已删除）', afterRun.status !== 200, afterRun.status)
    const bStill = await B.page.getByRole('button', { name: /^运行/ }).count()
    check('批准后手机端卡片随之消失，不能重复批准', bStill === 0, bStill)
    note('测试实例使用 approvals.mode=manual 以便确定性复现；部署时保留你现有的批准设置（默认 smart）。')
    await A.ctx.close(); await B.ctx.close()
  })

  // ------------------------------------------------------------------ S10
  await scenario('S10', '文件：手机上传 → Hermes 实际读取 → 另一端下载生成结果', { needsStub: true }, async ({ check, note }) => {
    const n = nonce()
    const B = await loginAs('phone390')
    const src = path.join(CFG.out, `note-${n}.txt`)
    fs.writeFileSync(src, `手机上传的资料\n暗号：青柠-${n}\n`)
    await B.page.getByRole('button', { name: 'Add context' }).click()
    const [chooser] = await Promise.all([B.page.waitForEvent('filechooser'), B.page.getByRole('menuitem', { name: '文件…' }).click()])
    const upload = B.page.waitForResponse(r => r.url().includes('/api/chat/file-upload'), { timeout: 20000 })
    await chooser.setFiles(src)
    const up = await upload
    check('上传接口成功', up.status() === 200, up.status())
    await L.send(B.page, `[readattached] 附件-${n}`)
    await L.waitText(B.page, `青柠-${n}`, 30000)
    const ctxHit = L.stubEntries().some(e => (e.last_user || '').includes(`青柠-${n}`))
    check('附件内容进入了模型上下文', ctxHit)
    const toolHit = L.stubEntries().some(e => e.last_role === 'tool' && (e.last_user || '').includes(`附件-${n}`))
    check('Hermes 用 read_file 工具实际读到了服务器上的附件文件', toolHit)
    const sid = await L.waitSessionId(B.page)
    const msgs = await L.messages(B.ctx, sid)
    const ref = (JSON.stringify(msgs).match(/@file:([^\s"\\]+upload[^\s"\\]*|[^\s"\\]+note-[0-9a-f]+\.txt)/) || [])[1]
    note(`附件保存位置（相对会话工作目录）：${ref}`)
    // 生成文件并由另一端下载
    const out = `${W}/report-${n}.md`
    await L.send(B.page, `[write ${out}] # 报告 ${n}`)
    await L.waitText(B.page, '工具已执行', 30000)
    const A = await loginAs('desktop')
    const dl = await L.apiGet(A.ctx, `/api/fs/download?path=${encodeURIComponent(out)}`)
    check('电脑端（另一登录）可下载 Hermes 生成的文件', dl.status === 200 && String(dl.body).includes(`报告 ${n}`), dl.status)
    check('下载为附件形式（不在页面内执行）', /attachment/i.test(dl.headers['content-disposition'] || ''), dl.headers['content-disposition'])
    // 图片
    const png = path.join(CFG.out, `photo-${n}.png`)
    fs.copyFileSync(path.join(__dirname, '..', '..', 'deploy', 'pwa', 'icon-192.png'), png)
    await B.page.getByRole('button', { name: 'Add context' }).click()
    const [imgChooser] = await Promise.all([B.page.waitForEvent('filechooser'), B.page.getByRole('menuitem', { name: '图片…' }).click()])
    const accept = await imgChooser.element().getAttribute('accept').catch(() => null)
    note(`“图片…”选择器 accept=${accept}（手机上会提供拍照/相册）`)
    const imgUp = B.page.waitForResponse(r => /upload|image/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 })
    await imgChooser.setFiles(png)
    const imgRes = await imgUp
    check('图片上传成功', imgRes.status() === 200, { url: imgRes.url().replace(CFG.base, ''), status: imgRes.status() })
    await B.page.screenshot({ path: path.join(SHOTS, 'S10-files.png') })
    await A.ctx.close(); await B.ctx.close()
  })

  // ------------------------------------------------------------------ R01/R02（真实模型冒烟，可在你自己的主机上运行）
  await scenario('R01', '真实模型：手机端对话并收到回复', { needsReal: true }, async ({ check }) => {
    const { ctx, page } = await loginAs('phone390')
    const n = nonce()
    await L.send(page, `请只回复下面这串字符，不要添加其他内容：pong-${n}`)
    await L.waitText(page, `pong-${n}`, 180000)
    const sid = await L.waitSessionId(page)
    await sleep(3000)
    const msgs = await L.messages(ctx, sid)
    check('服务端历史中有模型给出的回复', msgs.some(m => m.role === 'assistant' && String(m.content).includes(`pong-${n}`)))
    await ctx.close()
  })

  await scenario('R02', '真实模型：调用工具在临时目录写文件并核对', { needsReal: true }, async ({ check }) => {
    const { ctx, page } = await loginAs('phone390')
    const n = nonce()
    const file = `${W}/real-${n}.txt`
    await L.send(page, `请使用文件写入工具，把文本 ok-${n} 写入文件 ${file}（目录不存在就创建），完成后只回复 done。`)
    let r = null
    const t0 = Date.now()
    while (Date.now() - t0 < 240000) { r = await L.readText(ctx, file); if (r.status === 200) break; await sleep(3000) }
    check('文件由 Hermes 工具真实写入（经官方 REST 读取核对）', r && r.status === 200 && JSON.stringify(r.body).includes(`ok-${n}`), r && r.status)
    await page.screenshot({ path: path.join(SHOTS, 'R02-real-tool.png') })
    await ctx.close()
  })

  // ------------------------------------------------------------------ S13
  await scenario('S13', 'PWA：manifest、可安装性、安全区', async ({ check, note }) => {
    const { ctx, page } = await loginAs('phone390')
    const cdp = await ctx.newCDPSession(page)
    await page.waitForFunction(() => document.querySelector('link[rel=manifest]'), null, { timeout: 20000 })
    const man = await cdp.send('Page.getAppManifest')
    check('manifest 可解析且无错误', man.errors.length === 0 && /manifest/.test(man.url), man.errors)
    const inst = await cdp.send('Page.getInstallabilityErrors')
    check('Chrome 认为可安装（无 installability 错误）', inst.installabilityErrors.length === 0, inst.installabilityErrors)
    const anon = await browser.newContext({ ignoreHTTPSErrors: CFG.insecureTls })
    const m = await anon.request.get(`${CFG.base}/pwa/manifest.json`)
    check('manifest 不需要登录也可获取（浏览器拉取 manifest 不带 Cookie），且不含私有数据', m.status() === 200 && !/session|token|password/i.test(await m.text()), m.status())
    await anon.close()
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 34, left: 0, right: 0 } })
    await page.reload(); await L.ready(page)
    await page.evaluate(() => document.activeElement && document.activeElement.blur())
    await sleep(500)
    const pad = await page.evaluate(() => getComputedStyle(document.getElementById('root')).paddingBottom)
    check('模拟底部手势条 34px 时，内容区留出底部安全区', pad === '34px', pad)
    await page.screenshot({ path: path.join(SHOTS, 'S13-safe-area.png') })
    await L.composer(page).click(); await sleep(400)
    const typing = await page.evaluate(() => getComputedStyle(document.getElementById('root')).paddingBottom)
    check('聚焦输入框（键盘弹出）时去掉底部安全区留白', typing === '0px', typing)
    const sw = await page.evaluate(async () => ({ sw: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0, caches: self.caches ? (await caches.keys()).length : 0 }))
    check('没有注册 Service Worker、没有 Cache Storage（不缓存私有数据）', sw.sw === 0 && sw.caches === 0, sw)
    note('安全区为 Chromium 模拟（Emulation.setSafeAreaInsetsOverride），不等于真机；iOS/Android 主屏安装需真机确认。')
    await ctx.close()
  })

  // ------------------------------------------------------------------ S11
  await scenario('S11', '登录、权限与安全', async ({ check, note }) => {
    const anon = await browser.newContext({ ignoreHTTPSErrors: CFG.insecureTls })
    const g = async p => (await anon.request.get(CFG.base + p, { maxRedirects: 0, failOnStatusCode: false })).status()
    check('未登录访问首页被重定向到登录页', [302, 303, 307].includes(await g('/')))
    check('未登录读取会话列表被拒绝', await g('/api/sessions') === 401)
    check('未登录下载文件被拒绝', [401, 403].includes(await g(`/api/fs/download?path=${encodeURIComponent('/etc/hostname')}`)))
    check('未登录读取配置被拒绝', await g('/api/config') === 401)
    const ticket = await anon.request.post(`${CFG.base}/api/webapp/socket-ticket?socket=gateway`, { headers: { Origin: CFG.base }, failOnStatusCode: false })
    check('未登录无法申请实时连接票据', [401, 403].includes(ticket.status()), ticket.status())
    const wsRes = await anon.request.get(`${CFG.base}/api/ws`, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' }, failOnStatusCode: false, maxRedirects: 0 })
    check('未登录 WebSocket 握手不成功', wsRes.status() !== 101, wsRes.status())
    const tryLogin = (username, pw) => anon.request.post(`${CFG.base}/auth/password-login`, { data: { provider: 'basic', username, password: pw }, headers: { Origin: CFG.base }, maxRedirects: 0, failOnStatusCode: false })
    const bad = await tryLogin(CFG.user, 'definitely-wrong')
    const ghost = await tryLogin('no-such-user', 'definitely-wrong')
    check('错误密码被拒绝（401）', bad.status() === 401, bad.status())
    check('不存在的用户与错误密码返回相同结果（不泄露用户名是否存在）', ghost.status() === bad.status() && (await ghost.text()) === (await bad.text()), [bad.status(), ghost.status()])
    await anon.close()

    const { ctx, page } = await loginAs('phone390')
    const st = await L.apiGet(ctx, '/api/status')
    check('状态接口报告 auth_required=true', st.body?.auth_required === true, st.body?.auth_providers)
    const allCookies = await ctx.cookies()
    const cookies = allCookies.filter(c => c.name.startsWith('__Host-hermes_'))
    check('登录 Cookie 均为 __Host- 前缀 + HttpOnly + Secure + SameSite=Lax', cookies.length > 0 && cookies.every(c => c.httpOnly && c.secure && c.sameSite !== 'None'), cookies.map(c => `${c.name.slice(0, 30)} ${c.httpOnly}/${c.secure}/${c.sameSite}`))
    note(`其他 Cookie（非凭证，仅界面偏好）：${allCookies.filter(c => !c.name.startsWith('__Host-hermes_')).map(c => c.name).join(', ') || '无'}`)
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    check('浏览器存储中没有会话 Cookie 值', !cookies.some(c => c.value.length > 16 && storage.includes(c.value)))
    const html = await (await ctx.request.get(CFG.base + '/')).text()
    const envSecrets = (process.env.HERMES_E2E_SECRET_PROBES || '').split(',').filter(Boolean)
    check('页面 HTML 不含服务端密钥', envSecrets.every(s => !html.includes(s)), `${envSecrets.length} 个探针`)
    // 文件越界
    const home = process.env.HERMES_E2E_HERMES_HOME || '/root/.hermes'
    const deny = async (p, label) => { const r = await L.apiGet(ctx, `/api/fs/download?path=${encodeURIComponent(p)}`); check(label, r.status !== 200, r.status) }
    await deny(`${home}/.env`, '拒绝下载 Hermes 的 .env 凭证文件')
    await deny(`${W}/../../..${home}/.env`, '路径穿越到 .env 被拒绝')
    await deny(`${home}/state.db`, '拒绝下载正在使用的会话数据库')
    if (LOCAL) {
      const link = `${W}/env-link-${nonce()}`
      fs.symlinkSync(`${home}/.env`, link)
      await deny(link, '通过符号链接指向 .env 被拒绝')
    }
    // 恶意渲染
    if (STUB) {
      await L.send(page, '[xss]')
      await L.waitText(page, '渲染安全测试', 30000)
      await sleep(1500)
      const flags = await page.evaluate(() => ({ img: window.__xss_img, script: window.__xss_script, iframe: window.__xss_iframe }))
      check('模型输出中的 <img onerror>/<script>/<iframe> 不执行', !flags.img && !flags.script && !flags.iframe, flags)
      const jsLink = await page.locator('a[href^="javascript:"]').count()
      check('javascript: 链接被清除', jsLink === 0, jsLink)
    }
    // 上传 HTML 不会在页面中执行
    const evil = path.join(CFG.out, 'evil.html')
    fs.writeFileSync(evil, '<script>alert(1)</script>')
    await page.getByRole('button', { name: 'Add context' }).click()
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: '文件…' }).click()])
    const upr = page.waitForResponse(r => r.url().includes('/api/chat/file-upload'))
    await ch.setFiles(evil)
    const upBody = await (await upr).json().catch(() => ({}))
    const stored = upBody.path || upBody.file?.path || upBody.abs_path || ''
    if (stored) {
      const r = await L.apiGet(ctx, `/api/fs/download?path=${encodeURIComponent(stored)}`)
      check('上传的 HTML 只以附件（Content-Disposition: attachment）下载，不在站内渲染', /attachment/i.test(r.headers['content-disposition'] || ''), { cd: r.headers['content-disposition'], ct: r.headers['content-type'] })
      note(`下载响应 X-Content-Type-Options=${r.headers['x-content-type-options'] || '（未设置）'}；attachment 已阻止浏览器内联渲染。`)
    } else note(`上传返回中未找到存储路径：${JSON.stringify(upBody).slice(0, 200)}`)
    const csp = (await ctx.request.get(CFG.base + '/')).headers()['content-security-policy'] || ''
    check('页面带 CSP（禁止内联脚本、禁止被嵌入）', /script-src/.test(csp) && /frame-ancestors 'none'/.test(csp) && !/'unsafe-inline'[^;]*;/.test(csp.match(/script-src[^;]*;/)?.[0] || ''), csp.slice(0, 120))
    // 退出登录：先留一份未发送草稿，另开一个标签页保持实时连接，再走界面上的“设置 → 网关 → 退出登录”
    const dn = nonce()
    await L.composer(page).click(); await page.keyboard.insertText(`私密草稿-${dn}`)
    await sleep(2500)
    const draftStored = await page.evaluate(m => Object.keys(localStorage).some(k => (localStorage.getItem(k) || '').includes(m)), `私密草稿-${dn}`)
    check('前置条件：未发送草稿已保存在本机（刷新不丢）', draftStored)
    const tab2 = await ctx.newPage()
    await tab2.goto(`${CFG.base}/#/`); await L.ready(tab2)
    const saved = await ctx.cookies()
    let via = '界面：设置 → 网关 → 退出登录'
    try {
      await page.setViewportSize({ width: 1280, height: 800 }) // 宽屏布局下设置页有左侧目录，便于自动化点击；手机上路径见 README
      await sleep(800)
      await page.getByRole('button', { name: '打开设置' }).click()
      await page.getByText('网关', { exact: true }).locator('visible=true').first().click({ timeout: 8000 })
      await page.getByRole('button', { name: '退出登录' }).locator('visible=true').first().click({ timeout: 8000 })
    } catch (e) {
      via = 'hermesDesktop.oauthLogoutConnectionConfig()'
      await page.evaluate(() => window.hermesDesktop.oauthLogoutConnectionConfig())
    }
    await page.waitForURL(/\/login/, { timeout: 20000 })
    check('退出登录成功并回到登录页', true, via)
    await sleep(1000)
    const afterKeys = await page.evaluate(m => ({ hit: Object.keys(localStorage).filter(k => (localStorage.getItem(k) || '').includes(m)), drafts: Object.keys(localStorage).filter(k => /composer-drafts|pendingSubmissions|composerQueue|outbox|lastSessionId|lastRoute/.test(k)), session: sessionStorage.length }), `私密草稿-${dn}`)
    check('退出后本机不再保留草稿、待确认提交、队列和最近会话等私密状态', afterKeys.hit.length === 0 && afterKeys.drafts.length === 0, afterKeys)
    await sleep(3000)
    const replay = await browser.newContext({ ignoreHTTPSErrors: CFG.insecureTls })
    await replay.addCookies(saved)
    const rs = await replay.request.get(CFG.base + '/api/sessions', { failOnStatusCode: false, maxRedirects: 0 })
    check('退出后旧 Cookie 重放被拒绝（服务端已撤销）', rs.status() === 401, rs.status())
    const rdl = await replay.request.get(`${CFG.base}/api/fs/download?path=${encodeURIComponent(W + '/')}`, { failOnStatusCode: false, maxRedirects: 0 })
    check('退出后下载接口同样失效', [401, 403].includes(rdl.status()), rdl.status())
    await replay.close()
    const ln = nonce(); const lsince = Date.now() / 1000
    await sleep(5000)
    const tab2Status = await tab2.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).filter(t => /^(后端|Backend)/.test(t)).join(' | ')).catch(() => 'closed')
    await L.composer(tab2).click({ timeout: 3000 }).catch(() => {})
    await tab2.keyboard.insertText(`退出后提交-${ln}`).catch(() => {})
    await tab2.keyboard.press('Enter').catch(() => {})
    await sleep(6000)
    if (STUB) check('退出后，另一个标签页已打开的实时连接不能再提交任务', L.turnsFor(`退出后提交-${ln}`, lsince).length === 0, { tab2Status, turns: L.turnsFor(`退出后提交-${ln}`, lsince).length })
    note(`退出 5 秒后另一个标签页状态栏：${tab2Status}；URL：${tab2.url().replace(CFG.base, '')}`)
    await ctx.close()
  })

  // ------------------------------------------------------------------ S12
  await scenario('S12', '网关进程崩溃/重启：历史保留、中断任务不被静默重跑', { needsStub: true, needsLocal: true }, async ({ check, note }) => {
    const restartCmd = process.env.HERMES_E2E_RESTART_CMD
    if (!restartCmd) { note('需要 HERMES_E2E_RESTART_CMD（杀掉并重新拉起网关的命令）'); return }
    const n = nonce()
    const B = await loginAs('phone390')
    await L.send(B.page, `重启前完成-${n}`)
    await L.waitText(B.page, `收到：重启前完成-${n}`)
    await L.send(B.page, `[slow 40] 重启中断-${n}`)
    await L.waitText(B.page, '[进度 2/', 20000)
    const sid = await L.waitSessionId(B.page)
    const killedAt = Date.now() / 1000
    execFileSync('bash', ['-c', restartCmd], { stdio: 'inherit', timeout: 180000 })
    await sleep(5000)
    const C = await loginAs('phone390')
    await L.openSession(C.page, sid)
    await L.waitText(C.page, `收到：重启前完成-${n}`, 30000)
    check('重启后历史消息与已完成结果仍在', true)
    await sleep(45000)
    const msgs = await L.messages(C.ctx, sid)
    const replayed = L.turnsFor(`重启中断-${n}`, killedAt + 1).length
    check('中断的任务没有在重启后被自动重新执行', replayed === 0, replayed)
    check('中断的任务没有被标成“完成”', !msgs.some(m => String(m.content).includes('慢速任务完成')))
    const bodyText = await C.page.locator('body').innerText()
    check('界面把中断的轮次标为“已暂停/已丢失”，等待用户决定（而不是自动重跑）', /已暂停|已丢失|paused|lost/i.test(bodyText), (bodyText.match(/.{0,16}(已暂停|已丢失).{0,16}/) || [''])[0].replace(/\s+/g, ' '))
    await C.page.screenshot({ path: path.join(SHOTS, 'S12-after-restart.png') })
    await B.ctx.close().catch(() => {}); await C.ctx.close()
  })

  // ------------------------------------------------------------------ S14
  await scenario('S14', '登录尝试速率限制', async ({ check, note }) => {
    const anon = await browser.newContext({ ignoreHTTPSErrors: CFG.insecureTls })
    const codes = []
    for (let i = 0; i < 13; i++) {
      const r = await anon.request.post(`${CFG.base}/auth/password-login`, { data: { provider: 'basic', username: 'rate-limit-probe', password: `wrong-${i}` }, headers: { Origin: CFG.base }, failOnStatusCode: false })
      codes.push(r.status())
    }
    check('连续错误登录后触发 429 限流', codes.includes(429), codes.join(','))
    note('限流按客户端 IP、每分钟窗口计算；本场景放在最后执行，避免影响其他场景登录。')
    await anon.close()
  })

  await browser.close()
  const failed = results.filter(r => r.status === 'fail').length
  console.log(`\n通过 ${results.filter(r => r.status === 'pass').length}，未通过 ${failed}，跳过 ${results.filter(r => r.status === 'skip').length}。结果：${path.join(CFG.out, 'results.md')}`)
  process.exitCode = failed ? 1 : 0
})()
