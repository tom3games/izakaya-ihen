// fps の目安（ヘッドレス GPU）。node fps.mjs
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { muteContext } from './mute.mjs'
const server = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname, env: { ...process.env, PORT: '5535' } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch({ args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } }); await muteContext(ctx)
  const p = await ctx.newPage(); await p.goto('http://localhost:5535/'); await p.waitForFunction(() => window.__ihReady && IH.charsReady, null, { timeout: 15000 })
  const blank = await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2) }; requestAnimationFrame(f) }))
  await p.click('#bStart'); await p.evaluate(() => { IH.S.tut = -1; IH.dbg.only([{ id: 'xmas', v: 1 }, { id: 'stare' }, { id: 'unicycle' }]); IH.S.inF = 1 })
  const fps = await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else r(n / 4) }; requestAnimationFrame(f) }))
  console.log(`${w}x${h} title ${blank}fps / play ${fps}fps renderer ${await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?' })}`)
  await ctx.close()
}
await b.close(); server.kill()
