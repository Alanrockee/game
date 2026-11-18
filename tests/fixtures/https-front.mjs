#!/usr/bin/env node
// 测试夹具：在容器里模拟 “Tailscale Serve” 这一层 —— 本机 HTTPS 终止 + 反向代理到
// 127.0.0.1:9120（Hermes Webapp）+ 把 /pwa/ 映射到静态目录。只用 Node 内置模块。
// 生产部署请使用 Tailscale Serve（见 README），不要把本文件当作生产代理。
//
//   node tests/fixtures/https-front.mjs --cert c.pem --key k.pem --listen 8443 \
//        --upstream 127.0.0.1:9120 --pwa deploy/pwa
//
// 行为与 Tailscale Serve 保持一致的部分：保留原始 Host；补 X-Forwarded-For/Proto/Host；
// WebSocket 原样透传；响应不缓冲（流式输出逐块到达）。
import { createServer } from 'node:https'
import { request } from 'node:http'
import { connect } from 'node:net'
import { readFileSync, statSync, createReadStream, writeFileSync } from 'node:fs'
import { join, normalize, extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values: opt } = parseArgs({ options: {
  cert: { type: 'string' }, key: { type: 'string' }, listen: { type: 'string', default: '8443' },
  host: { type: 'string', default: '127.0.0.1' },
  upstream: { type: 'string', default: '127.0.0.1:9120' }, pwa: { type: 'string', default: '' },
  'drop-ws': { type: 'string', default: '' }, // 测试用：文件存在时拒绝新的 WebSocket（模拟断网）
  'pid-file': { type: 'string', default: '' }, // 测试用：写入本进程 PID，供测试发送 SIGUSR2
} })
const [upHost, upPort] = opt.upstream.split(':')
const pwaRoot = opt.pwa ? resolve(opt.pwa) : ''
const TYPES = { '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }

function forwardedHeaders(req) {
  const h = { ...req.headers }
  const peer = req.socket.remoteAddress
  h['x-forwarded-for'] = h['x-forwarded-for'] ? `${h['x-forwarded-for']}, ${peer}` : peer
  h['x-forwarded-proto'] = 'https'
  h['x-forwarded-host'] = req.headers.host
  return h
}

function servePwa(req, res) {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0].slice('/pwa/'.length)))
  const file = join(pwaRoot, rel)
  if (!pwaRoot || rel.startsWith('..') || !file.startsWith(pwaRoot)) { res.writeHead(404).end(); return }
  try {
    const st = statSync(file)
    if (!st.isFile()) throw new Error('not a file')
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'content-length': st.size,
      'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' })
    createReadStream(file).pipe(res)
  } catch { res.writeHead(404).end() }
}

const server = createServer({ cert: readFileSync(opt.cert), key: readFileSync(opt.key) }, (req, res) => {
  if (req.url.startsWith('/pwa/')) { servePwa(req, res); return }
  const up = request({ host: upHost, port: Number(upPort), method: req.method, path: req.url, headers: forwardedHeaders(req) }, upRes => {
    res.writeHead(upRes.statusCode, upRes.statusMessage, upRes.rawHeaders)
    res.flushHeaders()
    upRes.on('data', chunk => res.write(chunk))
    upRes.on('end', () => res.end())
  })
  up.on('error', err => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end(`upstream error: ${err.code}`) })
  req.pipe(up)
})

server.on('upgrade', (req, socket, head) => {
  if (opt['drop-ws']) { try { statSync(opt['drop-ws']); socket.destroy(); return } catch {} }
  const up = connect(Number(upPort), upHost, () => {
    const headers = forwardedHeaders(req)
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
    for (const [k, v] of Object.entries(headers)) for (const one of [].concat(v)) raw += `${k}: ${one}\r\n`
    up.write(raw + '\r\n')
    if (head?.length) up.write(head)
    up.pipe(socket); socket.pipe(up)
  })
  const close = () => { up.destroy(); socket.destroy() }
  up.on('error', close); socket.on('error', close); up.on('close', close); socket.on('close', close)
})

// 测试用：外部可通过 SIGUSR2 断开当前全部 WebSocket（模拟手机切网 / 锁屏断线）
const sockets = new Set()
server.on('upgrade', (_req, socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
process.on('SIGUSR2', () => { const n = sockets.size; for (const s of sockets) s.destroy(); console.log(`${new Date().toISOString()} dropped ${n} websocket(s)`) })
if (opt['pid-file']) writeFileSync(opt['pid-file'], String(process.pid))

server.listen(Number(opt.listen), opt.host, () => console.log(`https front on https://${opt.host}:${opt.listen} -> http://${opt.upstream}`))
