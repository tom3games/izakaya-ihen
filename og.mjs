// SNS用サムネ og.jpg（1200x630・300KB以下）。node og.mjs
// 暗い居酒屋の卓に、なぜかポテチの袋とショートケーキ。通報の赤い札。右にタイトルと一言
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { MUTE_LAUNCH, muteContext } from './mute.mjs'
const ROOT = import.meta.dirname
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '5534' } })
await new Promise(r => setTimeout(r, 400))
const b = await chromium.launch(MUTE_LAUNCH), ctx = await b.newContext({ viewport: { width: 1200, height: 630 }, locale: 'ja-JP' }); await muteContext(ctx)
const p = await ctx.newPage()
await p.goto('http://localhost:5534/'); await p.waitForFunction(() => window.__ihReady && IH.charsReady, null, { timeout: 15000 })
await p.evaluate(() => document.fonts.ready)
const s = await p.evaluate(() => {
  IH.dbg.start(5); IH.dbg.pause(true); IH.S.tut = -1
  IH.dbg.only([{ id: 'chips', t: 2 }, { id: 'cake', t: 2 }, { id: 'xmas', v: 0 }, { id: 'moai' }])
  IH.dbg.view('chips', 0.6); IH.S.yaw += 0.42; IH.S.pitch += 0.02; IH.dbg.snap(); IH.dbg.step(1)
  const c = IH.dbg.screen('chips'); IH.dbg.tap(c.x, c.y); IH.dbg.step(3)
  document.querySelectorAll('#fx > *').forEach(e => e.remove())
  return c
})
await p.addStyleTag({ content: `#corner,.hudTop,.hint,#finger,#loading,.ctl,#card,#fx{display:none!important}
  body::after{content:'';position:fixed;inset:0 0 0 50%;background:linear-gradient(90deg,rgba(11,10,13,0),rgba(11,10,13,.94) 26%);z-index:30}` })
await p.evaluate(() => {
  const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:28px;top:0;bottom:0;width:520px;z-index:31;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:20px;color:#fff;text-align:center'
  d.innerHTML = `<div style="font-family:'Zen Maru Gothic';font-weight:900;font-size:26px;letter-spacing:.08em;color:#16131a;background:#e9b44c;padding:6px 16px 5px;border:4px solid #16131a;transform:rotate(-3deg);box-shadow:4px 4px 0 #16131a">閉店後の見回りバイト</div>
  <div style="font-family:'Zen Maru Gothic';font-weight:900;font-size:64px;line-height:1.1;white-space:nowrap;-webkit-text-stroke:4px #16131a;paint-order:stroke fill;text-shadow:0 6px 0 #16131a">深夜の居酒屋<br><span style="font-family:'Dela Gothic One';font-weight:400;color:#ff5a4e;font-size:96px">異変探し</span></div>
  <div style="font-weight:900;font-size:30px;line-height:1.55;font-family:'Zen Maru Gothic'">居酒屋なのに、<span style="color:#ffd23a">ポテチ</span>。<br>おかしい物をタップで通報。</div>`
  document.body.appendChild(d)
  const tag = document.createElement('div'); tag.textContent = '異変あり'; tag.style.cssText = `position:fixed;left:${Math.max(20, IH.dbg.screen('chips').x - 150)}px;top:${IH.dbg.screen('chips').y - 190}px;z-index:20;font-family:'Dela Gothic One';font-size:58px;color:#ff5a4e;-webkit-text-stroke:4px #16131a;paint-order:stroke fill;text-shadow:0 6px 0 #16131a;transform:rotate(-8deg)`; document.body.appendChild(tag)
  IH.dbg.render()
})
await p.waitForTimeout(400)
await p.screenshot({ path: ROOT + '/og.jpg', type: 'jpeg', quality: 82 })
await b.close(); server.kill()
console.log('ok', JSON.stringify(s))
