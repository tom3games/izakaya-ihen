import { MUTE_LAUNCH, muteContext } from './mute.mjs'
// 深夜の居酒屋 異変探し の検証。node verify.mjs（約3分）。ONLY=see で異変の見え方だけ
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots/see', { recursive: true })
const PORT = 5531
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } })
await new Promise(r => setTimeout(r, 400))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = []
// テストは必ず await する（しないと例外が素通りして全部 pass になる）
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${e.message.split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) }
async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts })
  await muteContext(ctx)
  await ctx.addInitScript(() => { try { localStorage.clear() } catch (e) {} })
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)|tom3games\.github\.io/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0); await p.waitForFunction(() => window.__ihReady && IH.charsReady, null, { timeout: 15000 })
  await p.addScriptTag({ path: ROOT + '/bot.js' })
  return p
}
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('main:not([hidden]) *')) {
    if (el.closest('[hidden]') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
const fit = q => q.evaluate(() => {
  const H = innerHeight, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  for (const el of document.querySelectorAll('main:not([hidden]) button,main:not([hidden]) canvas,main:not([hidden]) .panel')) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  return { H, over: over.slice(0, 6) }
})
// 同時に出ている文字（案内・吹き出し・演出文字・判定）の数
const textCount = q => q.evaluate(() => {
  const vis = el => el && !el.hidden && !el.closest('[hidden]') && getComputedStyle(el).opacity !== '0' && el.getBoundingClientRect().width > 0
  const els = [document.querySelector('#hint'), ...document.querySelectorAll('#fx .sb,#fx .ono'), document.querySelector('#cJudge'), document.querySelector('#cLine')]
  return els.filter(vis).map(e => e.textContent)
})
const SIZES = [[360, 640, 'small'], [390, 844, 'phone'], [844, 390, 'land'], [667, 375, 'land-se'], [768, 1024, 'tab'], [1440, 900, 'pc']]
const ev = (q, f, a) => q.evaluate(f, a)
const ONLY = process.env.ONLY

const browser = await chromium.launch(MUTE_LAUNCH)
const p = await open(browser)

if (!ONLY) {
await t('起動時にエラーが出ない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await t('ブラウザの拡大が起きない（viewport・ピンチ・Ctrl+ホイール・Ctrl+プラス）', async () => {
  const r = await p.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content
    const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
    const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
    const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
    return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect }
  })
  expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none', r); return r
})
await t('OGP 一式と検索の言葉', async () => {
  const r = await p.evaluate(() => ({ og: ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].every(k => !!document.querySelector(`meta[property="${k}"]`)) && !!document.querySelector('meta[name="twitter:card"]'), title: document.title, desc: document.querySelector('meta[name=description]').content, html: document.documentElement.outerHTML }))
  const words = ['異変探し', 'ホラー', '無料', 'ブラウザ', '暇つぶし', 'ダウンロードなし', 'スマホ'].filter(w => !(r.title + r.desc).includes(w))
  expect(r.og && !words.length && !r.html.includes('出口') && !new RegExp(['tmk', '4men'].join(''), 'i').test(r.html), { words, og: r.og }); return r.title
})
await t('タイトル: 文言と店長', async () => { const r = await ev(p, () => ({ logo: document.querySelector('.logo .main').textContent, lead: document.querySelector('[data-t=lead]').textContent })); expect(r.logo.includes('異変探し') && r.lead.includes('居酒屋'), r); return r.logo })
await t('タイトルの3D: 描けている（輝度の散らばり）', async () => { const v = await ev(p, () => { const c = IH.dbg.grab(160), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const y = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += y; s2 += y * y; n++ } return Math.round(s2 / n - (s / n) ** 2) }); expect(v > 150, v); return v })

// ---- 計画（seed）
await t('同じ seed なら同じ異変・同じ卓。seed が違えば変わる', async () => {
  const r = await ev(p, () => { const a = JSON.stringify(IH.makePlan(7)), b = JSON.stringify(IH.makePlan(7)), c = JSON.stringify(IH.makePlan(8)); return { same: a === b, diff: a !== c, ex: IH.makePlan(7).map(n => n.map(x => x.id)) } })
  expect(r.same && r.diff, r); return r.ex
})
await t('1晩目は異変なし、2晩目は1つ、合計9。1回の中で同じ異変は出ない（200 seed）', async () => {
  const r = await ev(p, () => { const bad = []; const lvLate = []; for (let s = 1; s <= 200; s++) { const pl = IH.makePlan(s), ids = pl.flat().map(a => a.id); if (pl.length !== 7 || pl[0].length || pl[1].length !== 1 || ids.length !== 9 || new Set(ids).size !== 9 || pl.some(n => n.length > 3)) bad.push(s); for (const a of pl[5].concat(pl[6])) lvLate.push(IH.D.ANOM.find(x => x.id === a.id).lv); for (const n of pl) { const ts = n.filter(a => a.t >= 0).map(a => a.t); if (new Set(ts).size !== ts.length) bad.push('t' + s) } } const avgLate = lvLate.reduce((a, b) => a + b, 0) / lvLate.length; const early = []; for (let s = 1; s <= 200; s++) for (const a of IH.makePlan(s)[1]) early.push(IH.D.ANOM.find(x => x.id === a.id).lv); return { bad: bad.slice(0, 5), avgLate: +avgLate.toFixed(2), avgEarly: +(early.reduce((a, b) => a + b, 0) / early.length).toFixed(2), kinds: IH.D.ANOM.length } })
  expect(!r.bad.length && r.avgLate > r.avgEarly + 0.8 && r.kinds >= 15, r); return r
})
await t('どの異変も一度は出る（200 seed）', async () => { const r = await ev(p, () => { const seen = new Set(); for (let s = 1; s <= 200; s++) for (const a of IH.makePlan(s).flat()) seen.add(a.id); return IH.D.ANOM.map(a => a.id).filter(id => !seen.has(id)) }); expect(!r.length, r) })

// ---- 操作
await t('見回り開始: 遊ぶ画面・操作ボタン・時計・1晩目は異変なし', async () => { await p.click('#bStart'); await p.waitForTimeout(300); const r = await ev(p, () => ({ mode: IH.S.mode, clock: document.querySelector('#hClock').textContent, act: IH.S.act.length, btn: ['#bFwd', '#bBack', '#bTurn', '#bLookL', '#bLookR'].every(s => document.querySelector(s).getBoundingClientRect().width >= 44) })); expect(r.mode === 'play' && r.clock === '23:00' && r.act === 0 && r.btn, r); return r })
await t('初回のチュートリアル: 歩き方の案内', async () => { await ev(p, () => { IH.dbg.pause(true); IH.dbg.step(30) }); const r = await ev(p, () => ({ hint: document.querySelector('#hint').textContent, hid: document.querySelector('#hint').hidden })); expect(!r.hid && /歩く/.test(r.hint), r); return r })
const down = (q, sel) => q.evaluate(sel => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 3 })), sel)
const up = (q, sel) => q.evaluate(sel => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 3 })), sel)
await t('前へは押している間だけ進み、離すと止まる', async () => {
  await ev(p, () => IH.dbg.set({ x: 2, v: 0, dir: 1 })); await down(p, '#bFwd')
  const a = await ev(p, () => { const x0 = IH.S.x; IH.dbg.step(60); return { x0, x1: IH.S.x, lit: document.querySelector('#bFwd').classList.contains('on') } })
  await up(p, '#bFwd'); const b = await ev(p, () => { const x = IH.S.x; IH.dbg.step(40); return { v: IH.S.v, moved: IH.S.x - x } })
  expect(a.x1 > a.x0 + 2 && a.lit && Math.abs(b.v) < 0.01 && b.moved < 0.4, [a, b]); return [a, b]
})
await t('うしろは押している間ゆっくり下がる', async () => { await down(p, '#bBack'); const r = await ev(p, () => { const x0 = IH.S.x; IH.dbg.step(60); return { d: IH.S.x - x0, v: IH.S.v } }); await up(p, '#bBack'); expect(r.d < -0.8 && r.d > -1.6, r); return r })
await t('ふりかえる: 向きが反対になり視線が戻る', async () => { const r = await ev(p, () => { IH.S.yaw = 0.8; document.querySelector('#bTurn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); IH.dbg.step(30); return { dir: IH.S.dir, yaw: IH.S.yaw } }); await ev(p, () => { document.querySelector('#bTurn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); IH.dbg.step(30) }); expect(r.dir === -1 && r.yaw === 0, r); return r })
await t('見回す: 左右のボタン・ドラッグで視線が動く', async () => {
  await down(p, '#bLookR'); const a = await ev(p, () => { IH.S.yaw = 0; IH.dbg.step(30); return IH.S.yaw }); await up(p, '#bLookR')
  await ev(p, () => { IH.S.yaw = 0 })
  await p.mouse.move(195, 400); await p.mouse.down(); await p.mouse.move(120, 400, { steps: 5 }); await p.mouse.up()
  const b = await ev(p, () => ({ yaw: IH.S.yaw, wrong: IH.S.wrongN }))
  expect(a > 0.4 && b.yaw < -0.2 && b.wrong === 0, { a, b }); return { a, b }
})
await t('奥へ行かずに戻ると店長が「奥まで」と言い、報告にならない', async () => {
  const r = await ev(p, () => { IH.dbg.set({ x: 6, dir: -1, leftHome: true }); IH.S.inF = 1; IH.dbg.step(140); IH.S.inF = 0; return { phase: IH.S.phase, sb: [...document.querySelectorAll('#fx .sb')].map(e => e.textContent) } })
  expect(r.phase === 'walk' && r.sb.some(s => s.includes('奥')), r); return r
})

// ---- 通報の当たり判定（実際のクリック位置で）
await t('異変の上をクリックすると「異変あり」、何も無い床は「お手つき」、同じ物は二重に数えない', async () => {
  const s = await ev(p, () => { IH.dbg.set({ dir: 1 }); IH.dbg.only([{ id: 'chips', t: 4 }]); const s = IH.dbg.view('chips', 1.2); IH.dbg.step(1); return s })
  await p.mouse.click(s.x, s.y); const a = await ev(p, () => ({ found: [...IH.S.found], tag: !!document.querySelector('#fx .ono'), txt: document.querySelector('#fx .ono') && document.querySelector('#fx .ono').textContent }))
  await p.mouse.click(s.x, s.y); const again = await ev(p, () => ({ found: IH.S.found.size, wrong: IH.S.wrongN }))
  // 床（通路のまん中・手前）
  await p.mouse.click(195, 780); const w1 = await ev(p, () => IH.S.wrongN)
  await p.mouse.click(196, 781); const w2 = await ev(p, () => IH.S.wrongN)
  expect(a.found[0] === 'chips' && a.txt === '異変あり' && again.found === 1 && again.wrong === 0 && w1 === 1 && w2 === 1, { a, again, w1, w2 }); return { s, w1 }
})
await t('異変の隣の正常な物（同じ卓の枝豆）はお手つき', async () => {
  const r = await ev(p, () => { IH.dbg.only([{ id: 'cake', t: 4 }]); IH.dbg.view('cake', 1.2); IH.dbg.step(1); const T = IH.TABLES[4]; const v = new IH.camera.position.constructor(); T.sl.hashi.g.getWorldPosition(v); v.y += 0.12; const s = IH.toScreen(v); const c = IH.dbg.screen('cake'); return { s, c } })
  const dist = Math.hypot(r.s.x - r.c.x, r.s.y - r.c.y)
  await p.mouse.click(r.s.x, r.s.y); const a = await ev(p, () => ({ wrong: IH.S.wrongN, found: IH.S.found.size }))
  expect(dist > 40 && a.wrong === 1 && a.found === 0, { dist, a }); return { dist: Math.round(dist), a }
})
await t('霧の奥（13m より先）の異変はタップしても通報にならない', async () => {
  const r = await ev(p, () => { IH.dbg.only([{ id: 'chips', t: 6 }]); IH.dbg.set({ x: 3, dir: 1, yaw: 0, pitch: 0 }); IH.dbg.step(1); const s = IH.dbg.screen('chips'); return { s, res: s.z < 1 ? IH.dbg.tap(s.x, s.y) : null } })
  expect(r.s.d > 13 && r.res && r.res.kind !== 'found', r); return { d: r.s.d, kind: r.res.kind }
})

// ---- 異変ごとに、出た時に見た目で違いが分かるか（正常と並べて撮る）
}
const ids = await ev(p, () => IH.D.ANOM.map(a => a.id))
const seeRows = []
for (const id of ids) {
  await t(`見て分かる: ${id}`, async () => {
    const r = await ev(p, ([id]) => {
      const S = IH.S; IH.dbg.pause(true); if (S.mode !== 'play') IH.dbg.start(1), IH.dbg.pause(true); S.noFlicker = true; S.phase = 'walk'
      const t = IH.D.ANOM.find(a => a.id === id).where === 'table' ? 3 : -1
      const diffOf = (a, b) => { const A = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, B = b.getContext('2d').getImageData(0, 0, b.width, b.height).data; let n = 0; for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 60) n++; return n }
      const out = {}
      for (const [k, back] of [['far', 4.5], ['near', 0.2]]) {
        IH.dbg.only([{ id, t, v: 1 }]); const sc = IH.dbg.view(id, back); IH.dbg.tick(90); IH.dbg.view(id, back)
        const A = IH.dbg.grab(240)
        IH.dbg.only([]); IH.dbg.tick(90); IH.dbg.snap(); const N = IH.dbg.grab(240), N2 = IH.dbg.grab(240)
        out[k] = { px: diffOf(A, N), noise: diffOf(N, N2), d: +sc.d.toFixed(1) }
        if (k === 'near') { const c = document.createElement('canvas'); c.width = 488; c.height = A.height; const x = c.getContext('2d'); x.fillStyle = '#ff0'; x.fillRect(0, 0, 488, A.height); x.drawImage(N, 0, 0); x.drawImage(A, 248, 0); out.png = c.toDataURL('image/png') }
      }
      S.noFlicker = false
      return out
    }, [id])
    writeFileSync(`${ROOT}/shots/see/${id}.png`, Buffer.from(r.png.split(',')[1], 'base64'))
    seeRows.push(`${id}: far ${r.far.px}px near ${r.near.px}px`)
    // 240px 幅で、近くから見ると 60px 以上・ノイズは 0
    expect(r.near.px >= 60 && r.near.noise === 0 && r.far.noise === 0, { far: r.far, near: r.near }); return { far: r.far.px, near: r.near.px, d: r.near.d }
  })
}

if (!ONLY) {
// ---- 1晩の報告
await t('報告: 全部見つけてお手つきなし→「よし」。カードの文字は2つまで', async () => {
  const r = await ev(p, () => { IH.dbg.start(3); IH.dbg.pause(true); IH.S.tut = -1; IH.dbg.only([{ id: 'rice' }]); IH.S.found.add('rice'); IH.dbg.finishNight(); IH.dbg.step(80); return { phase: IH.S.phase, judge: document.querySelector('#cJudge').textContent, line: document.querySelector('#cLine').textContent } })
  const tc = await textCount(p)
  expect(r.phase === 'report' && r.judge === 'よし' && tc.length <= 2, { r, tc }); return { r, tc }
})
await t('報告: 見逃しは名前つきで「見逃し」、次の晩へ進んで時計が進む', async () => {
  const r = await ev(p, () => { IH.dbg.step(260); const a = { night: IH.S.night, clock: document.querySelector('#hClock').textContent, phase: IH.S.phase }; IH.dbg.only([{ id: 'xmas', v: 0 }]); IH.dbg.finishNight(); IH.dbg.step(80); return { a, judge: document.querySelector('#cJudge').textContent, line: document.querySelector('#cLine').textContent, weird: IH.S.weird } })
  expect(r.a.night === 1 && r.a.clock === '00:00' && r.a.phase === 'walk' && r.judge === '見逃し' && r.line.includes('クリスマス') && r.weird === 1, r); return r
})
await t('報告: お手つきだけだと「お手つき」', async () => {
  const r = await ev(p, () => { IH.dbg.step(260); IH.dbg.only([]); IH.S.wrongN = 2; IH.dbg.finishNight(); IH.dbg.step(80); return { judge: document.querySelector('#cJudge').textContent, line: document.querySelector('#cLine').textContent } })
  expect(r.judge === 'お手つき' && r.line.includes('2'), r); return r
})

// ---- 7晩通して明細まで（自動プレイ）と分布
await t('全部見つける人: 7晩通して明細・本採用', async () => { const r = await ev(p, () => IHBot.run('oracle', 11)); await p.waitForTimeout(300); const m = await ev(p, () => IH.S.mode); expect(r.tot.found === 9 && r.tot.wrong === 0 && r.stamp === '本採用' && m === 'result', r); return r })
await t('明細: 描けている・ハンコ・ボタン・Xの文', async () => {
  await ev(p, () => { IH.dbg.pause(false) }); await p.waitForTimeout(1600)
  const r = await ev(p, () => { const c = document.querySelector('#slip'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 13) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ } return { varc: Math.round(s2 / n - (s / n) ** 2), btn: document.querySelector('#rBtns1').classList.contains('on'), x: IH.xPost().href, photo: IH.dbg.photo() } })
  expect(r.varc > 1500 && r.btn && /x\.com\/intent\/post/.test(r.x) && decodeURIComponent(r.x).includes('#異変探し') && decodeURIComponent(r.x).includes('9個') && r.photo, r); return { varc: r.varc, x: decodeURIComponent(r.x).slice(0, 110) }
})
await t('明細を保存（ダウンロードが起きる）', async () => { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }), p.click('#bSave')]); expect(/izakaya-ihen-9\.png/.test(dl.suggestedFilename()), dl.suggestedFilename()); return dl.suggestedFilename() })
await t('何もしない人: 一番低いハンコ（クビ）', async () => { const r = await ev(p, () => { IH.dbg.pause(true); return IHBot.run('none', 11) }); expect(r.tot.found === 0 && r.stamp === 'クビ', r); return r })
await t('全部タップする人（お手つき連打）: 稼げない（全部見つける人より大幅に低い）', async () => { const r = await ev(p, () => IHBot.run('spam', 11)); expect(r.tot.found >= 1 && r.net < 0 && r.stamp === 'クビ', r); return { net: r.net, wrong: r.tot.wrong, found: r.tot.found } })
await t('半分だけ見つける人は、全部見つける人と何もしない人の間', async () => { const r = await ev(p, () => IHBot.run('half', 11)); expect(r.net > 1400 && r.net < 13100, r); return { net: r.net, stamp: r.stamp, found: r.tot.found } })
await t('音: 歩く・異変あり・お手つき・店長・ハンコが鳴る（数で確認）', async () => { const r = await ev(p, () => IH.Snd.played); expect(['step', 'found', 'wrong', 'boss', 'stamp', 'night'].every(k => r[k] > 0), r); return Object.keys(r).length })
await t('英語に切り替えても文言が出る', async () => { await ev(p, () => { IH.S.mode = 'title'; document.querySelector('#bLang').click() }); const r = await ev(p, () => ({ logo: document.querySelector('.logo .main').textContent, lang: document.documentElement.lang })); await ev(p, () => document.querySelector('#bLang').click()); expect(r.lang === 'en' && /ANOMALY/.test(r.logo), r); return r })
await t('ここまでエラーなし', async () => { expect(p.errs.length === 0, p.errs.join('|')) })

// ---- 6サイズ × 全画面
for (const [w, h, name] of SIZES) {
  const q = await open(browser, { viewport: { width: w, height: h } })
  const views = {}
  views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.click('#bHow'); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-how.png` }); await q.click('#bHowBack')
  await q.click('#bMoreT'); views.more = await q.evaluate(() => { const r = document.querySelector('.moreP').getBoundingClientRect(); return { H: innerHeight, over: r.bottom > innerHeight + 1 ? ['moreP'] : [] } }); await q.click('#bMoreX')
  await q.click('#bStart'); await ev(q, () => { IH.dbg.pause(true); IH.dbg.step(40) })
  views.play = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-play.png` })
  const tc0 = await textCount(q)
  await ev(q, () => { IH.dbg.only([{ id: 'chips', t: 4 }]); IH.S.found.add('chips'); IH.dbg.finishNight(); IH.dbg.step(80) })
  views.card = await fit(q); const tc1 = await textCount(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-card.png` })
  await t(`文字は同時に2つまで ${name}`, async () => { expect(tc0.length <= 2 && tc1.length <= 2, { tc0, tc1 }); return { tc0, tc1 } })
  await ev(q, () => { IH.S.tot = { found: 6, miss: 3, wrong: 1, total: 9 }; IH.dbg.toResult() }); await q.waitForTimeout(400); await ev(q, () => { IH.dbg.pause(false) }); await q.waitForTimeout(1500)
  views.result = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-result.png` })
  await t(`明細が画面内に収まり小さすぎない ${name}`, async () => { const r = await q.evaluate(() => { const b = document.querySelector('#slip').getBoundingClientRect(); return { h: Math.round(b.height), top: Math.round(b.top), bottom: Math.round(b.bottom), H: innerHeight } }); expect(r.h >= 220 && r.top >= 0 && r.bottom <= r.H, r); return r })
  for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${name} ${w}x${h} ${v}`, async () => { expect(!r.over.length, r) })
  await t(`${name}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
  await q.close()
}
}
await browser.close()

if (!ONLY) {
// ---- WebKit（iPhone 相当）でタッチの通し
const wb = await webkit.launch(), wp = await open(wb, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await t('WebKit: 2本指の touchmove を止める', async () => { const r = await wp.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented }); expect(r, r) })
await t('WebKit: タッチで異変をタップ→異変あり', async () => {
  await wp.tap('#bStart'); await wp.waitForTimeout(300)
  const s = await ev(wp, () => { IH.dbg.pause(true); IH.S.tut = -1; IH.dbg.only([{ id: 'kotatsu', t: 2 }]); const s = IH.dbg.view('kotatsu', 1.2); IH.dbg.step(1); return s })
  await wp.touchscreen.tap(s.x, s.y); await wp.waitForTimeout(100)
  const r = await ev(wp, () => ({ found: [...IH.S.found], wrong: IH.S.wrongN }))
  await wp.screenshot({ path: `${ROOT}/shots/webkit-tap.png` })
  expect(r.found[0] === 'kotatsu' && r.wrong === 0, r); return r
})
await t('WebKit: 7晩通して明細', async () => { const r = await ev(wp, () => IHBot.run('oracle', 4)); await wp.waitForTimeout(500); const m = await ev(wp, () => IH.S.mode); expect(m === 'result' && r.tot.found === 9, { r, m }); return r.stamp })
await t('WebKit: エラーなし', async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
await wb.close()
}
server.kill()
console.log(results.join('\n'))
if (seeRows.length) console.log('\n' + seeRows.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
