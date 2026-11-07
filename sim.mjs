// 自動プレイで7晩通して、明細の分布を見る。node sim.mjs（SEEDS=1,2,3 で種を指定）
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const PORT = 5533
const server = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' }); await muteContext(ctx)
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__ihReady && IH.charsReady, null, { timeout: 15000 })
await p.addScriptTag({ path: 'bot.js' })
const seeds = (process.env.SEEDS || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number)
const out = {}
for (const kind of (process.env.KINDS || 'oracle,half,none,spam').split(',')) {
  out[kind] = []
  for (const seed of seeds) {
    const r = await p.evaluate(([k, s]) => IHBot.run(k, s), [kind, seed])
    out[kind].push(r)
    if (process.env.V) console.log(JSON.stringify(r))
  }
  const nets = out[kind].map(r => r.net), st = {}
  for (const r of out[kind]) st[r.stamp] = (st[r.stamp] || 0) + 1
  const sum = k => out[kind].reduce((a, r) => a + r.tot[k], 0)
  console.log(`${kind.padEnd(6)} net min ${Math.min(...nets)} avg ${Math.round(nets.reduce((a, b) => a + b, 0) / nets.length)} max ${Math.max(...nets)}  stamps ${JSON.stringify(st)}  found ${sum('found')}/${sum('total')} wrong ${sum('wrong')}  modes ${[...new Set(out[kind].map(r => r.mode))]}`)
}
console.log('errors', errs.length ? errs : 'none')
await b.close(); server.kill()
