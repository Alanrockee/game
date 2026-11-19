// Google 登录链路检查：自动跳转登录 → 对话 → 等 ID Token 过期 → 不刷新继续对话（静默续期）→ 刷新仍登录。
const L = require('./lib.cjs')
const fs = require('fs')
// 需要：网关已启用 dashboard-auth-google 插件，issuer 指向 tests/fixtures/mock_oidc.py（--ttl 60），并用模型桩
const STUB_LOG = process.env.HERMES_E2E_STUB_LOG
const turns = m => fs.readFileSync(STUB_LOG, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(e => e.stream && e.tools && e.last_role === 'user' && (e.last_user || '').includes(m)).length
;(async () => {
  const browser = await L.launch()
  const ctx = await L.newContext(browser, 'phone390')
  const page = await ctx.newPage()
  const t0 = Date.now()
  await page.goto(L.CFG.base + '/')
  await L.ready(page)
  console.log('1) 打开首页自动完成 Google 登录，用时', ((Date.now() - t0) / 1000).toFixed(1), 's')
  const me = await (await ctx.request.get(L.CFG.base + '/api/auth/me')).json(); console.log('   身份', me.provider, me.email)
  console.log('   cookie', (await ctx.cookies()).filter(c => c.name.startsWith('__Host')).map(c => c.name.replace(/_[0-9a-f]+$/, '').replace('__Host-hermes_', '') + (c.expires > 0 ? '=' + Math.round((c.expires - Date.now() / 1000) / 60) + 'min' : '')).join(' '))
  const n = L.nonce()
  await L.send(page, `谷歌登录-${n}-1`); await L.waitText(page, `收到：谷歌登录-${n}-1`)
  console.log('2) 等待 75 秒，超过 60 秒的 ID Token 有效期…')
  await L.sleep(75000)
  await L.send(page, `谷歌登录-${n}-2-过期后`)
  const ok = await L.waitText(page, `收到：谷歌登录-${n}-2-过期后`, 30000).then(() => true).catch(() => false)
  console.log('3) 不刷新页面继续对话：', ok ? '成功' : '失败', '；模型收到', turns(`谷歌登录-${n}-2`), '次；URL', page.url().replace(L.CFG.base, '').slice(0, 30))
  const me2 = await ctx.request.get(L.CFG.base + '/api/auth/me', { failOnStatusCode: false }); console.log('   /api/auth/me →', me2.status())
  await L.sleep(70000)
  await page.reload(); await L.ready(page).catch(() => {})
  console.log('4) 再过 70 秒后刷新页面：URL', page.url().replace(L.CFG.base, '').slice(0, 40), '；仍登录：', (await ctx.request.get(L.CFG.base + '/api/auth/me', { failOnStatusCode: false })).status() === 200)
  await browser.close()
})().catch(e => { console.error('ERR', e.message.split('\n')[0]); process.exit(1) })
