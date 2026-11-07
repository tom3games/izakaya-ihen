// shots/see の並べ画像をまとめる。node grid.mjs out.png a b c ...
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const [out, ...ids] = process.argv.slice(2)
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 400, height: 400 } })
await p.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(3,auto);gap:6px;width:max-content">${ids.map(id => `<div style="position:relative"><img src="data:image/png;base64,${readFileSync('shots/see/' + id + '.png').toString('base64')}" style="display:block;width:488px"><b style="position:absolute;left:4px;top:4px;background:#000;color:#ff0;font:16px sans-serif">${id}</b></div>`).join('')}</body>`)
await p.waitForTimeout(300); await (await p.$('body')).screenshot({ path: out }); await b.close()
