// 画像を並べて1枚に（目視用）。node montage.mjs out.png cols cropY cropH a.png b.png ...
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const [out, cols, cy, ch, ...files] = process.argv.slice(2)
const imgs = files.map(f => 'data:image/png;base64,' + readFileSync(f).toString('base64'))
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 400, height: 400 } })
const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},auto);gap:4px;width:max-content">${imgs.map((s, i) => `<div style="position:relative;overflow:hidden;width:390px;height:${ch}px"><img src="${s}" style="position:absolute;top:-${cy}px;left:0;width:390px"><b style="position:absolute;left:4px;top:4px;background:#000;color:#ff0;font:14px sans-serif;padding:2px">${files[i].split('/').pop()}</b></div>`).join('')}</body>`
await p.setContent(html); await p.waitForTimeout(300)
const el = await p.$('body'); await el.screenshot({ path: out }); await b.close()
