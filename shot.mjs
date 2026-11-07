// 目視用のスクショ。node shot.mjs [ids...]
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const PORT = 5532
const server = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH)
const errs = []
for (const [w, h] of (process.env.W ? [[+process.env.W, +process.env.H]] : [[390, 844], [844, 390]])) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP' }); await muteContext(ctx)
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  await p.goto(`http://localhost:${PORT}/`); await p.waitForFunction(() => window.__ihReady && IH.charsReady, null, { timeout: 15000 })
  await p.waitForTimeout(500); await p.screenshot({ path: `shots/s-title-${w}.png` })
  await p.evaluate(() => { IH.dbg.start(3); IH.dbg.pause(true); IH.dbg.step(40) })
  await p.screenshot({ path: `shots/s-start-${w}.png` })
  await p.evaluate(() => { IH.dbg.set({ x: 12, dir: 1 }); IH.dbg.step(5) })
  await p.screenshot({ path: `shots/s-mid-${w}.png` })
  await p.evaluate(() => { IH.dbg.set({ x: 20, dir: -1 }); IH.dbg.step(5) })
  await p.screenshot({ path: `shots/s-back-${w}.png` })
  for (const id of (process.argv.slice(2).length ? process.argv.slice(2) : ['chips', 'cake'])) {
    const r = await p.evaluate(id => { IH.dbg.only([{ id, t: 2, v: 1 }]); const s = IH.dbg.view(id); IH.dbg.step(2); return s }, id)
    await p.screenshot({ path: `shots/s-${id}-${w}.png` }); console.log(w, id, JSON.stringify(r))
  }
  await ctx.close()
}
console.log('errs', errs); await b.close(); server.kill()
