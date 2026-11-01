import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// 公開URLの確認。node live.mjs（ログインしていないブラウザで見る）。SKIPGH=1 で GitHub ページの確認を省く
import { chromium, webkit } from 'playwright'
const URL0 = 'https://tom3games.github.io/izakaya-ihen/'
const out = []
for (const [name, bt, opts] of [['chromium', chromium, {}], ['webkit', webkit, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const b = await bt.launch(bt === chromium ? MUTE_LAUNCH : {}), ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await muteContext(ctx)
  const p = await ctx.newPage(), errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('requestfailed', r => errs.push('fail ' + r.url()))
  await p.goto(URL0 + '?t=' + Date.now(), { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__ihReady && IH.charsReady, null, { timeout: 20000 })
  await p.addScriptTag({ path: import.meta.dirname + '/bot.js' })
  if (bt === chromium) await p.click('#bStart'); else await p.tap('#bStart')
  await p.waitForTimeout(400)
  const s = await p.evaluate(() => { IH.dbg.pause(true); IH.S.tut = -1; IH.dbg.only([{ id: 'chips', t: 4 }]); const s = IH.dbg.view('chips', 1.2); IH.dbg.step(1); return s })
  if (bt === chromium) await p.mouse.click(s.x, s.y); else await p.touchscreen.tap(s.x, s.y)
  const tap = await p.evaluate(() => [...IH.S.found])
  const run = await p.evaluate(() => IHBot.run('oracle', 2)); await p.waitForTimeout(800)
  await p.evaluate(() => { IH.dbg.pause(false) }); await p.waitForTimeout(1500)
  const res = await p.evaluate(() => ({ mode: IH.S.mode, stamp: IH.S.result && IH.S.result.rank.st.ja }))
  out.push(`${name}: tap=${JSON.stringify(tap)} run=${run.tot.found}/${run.tot.total} result=${JSON.stringify(res)}`)
  await p.screenshot({ path: `shots/live-${name}.png` })
  const og = await p.evaluate(async () => { const r = await fetch(document.querySelector('meta[property="og:image"]').content); return r.status + ' ' + r.headers.get('content-type') })
  out.push(`${name}: og=${og} errors=${errs.length ? errs.join(' | ') : 'none'}`)
  await b.close()
}
if (process.env.SKIPGH) { console.log(out.join('\n')); process.exit(0) }
const b = await chromium.launch(MUTE_LAUNCH), p = await b.newPage()
for (const u of ['https://github.com/tom3games/izakaya-ihen', 'https://github.com/tom3games/izakaya-ihen/commits/main']) {
  const res = await p.goto(u, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500)
  out.push(`${u} status=${res.status()} owner-id=${new RegExp(['tmk', '4men'].join(''), 'i').test(await p.content()) ? 'FOUND' : 'none'}`)
}
await b.close()
console.log(out.join('\n'))
