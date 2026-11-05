// 深夜の居酒屋 異変探し / IZAKAYA ANOMALY
// 閉店後の居酒屋を奥のお手洗いまで見回り、カウンターへ戻って店長に報告する。7晩で夜明け。
// 居酒屋に「無いはずの物・場違いな状態」があればタップで通報。何も無い所はお手つき。
// 時間は固定60Hz（performance.now で数える）
import * as THREE from 'three'
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js'
import { clone as skClone } from './vendor/jsm/utils/SkeletonUtils.js'
import { setupLook, addBlobShadow, surfaceTex, createFx, look } from './look.js'
import { drawPayslip, totals } from './payslip.js'

const D = window.IH_DATA
const $ = s => document.querySelector(s)
const STEP = 1 / 60
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, k) => a + (b - a) * k
const ease = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k) }
const isTouch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0)
function mulberry(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const store = { get(k) { try { return localStorage.getItem('ih.' + k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem('ih.' + k, v) } catch (e) {} } }
const AK = Object.fromEntries(D.ANOM.map(a => [a.id, a]))

// ---------- 寸法（世界の単位）。通路は x 方向に奥へ。卓は通路の左右（z の負と正）に互い違い
const NT = 8, TX = i => 5.6 + i * 3.4, SIDE = i => (i % 2 ? 1 : -1)
const ZA_Y = 0.32, ZA_Z = 2.2, AISLE = 1.15, WALL_Z = 3.8
const W0 = -3.2, W1 = TX(NT - 1) + 4.2           // 手前の壁（カウンターの後ろ）・奥の壁（お手洗い）
const XMIN = 2.2, XMAX = W1 - 1.0, FAR_X = W1 - 2.4, HOME_X = 3.0, START_X = 3.6
const CH = 1.5
const WALK = 2.7, BACKV = 1.3, ACC = 9
const CUST_TABLES = [1, 2, 5]
const MAXD = 13

// ---------- 状態
const S = {
  lang: store.get('lang') || ((navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'),
  mode: 'title', time: 0, dbgPause: false, seed: 1,
  x: 1.4, v: 0, dir: 1, face: Math.PI / 2, yaw: 0, pitch: 0, lookIdle: 0,
  inF: 0, inB: 0, keyF: 0, keyB: 0, lookL: 0, lookR: 0, keyL: 0, keyR: 0,
  night: 0, phase: 'walk', phT: 0, visited: false, leftHome: false, saidFar: false,
  plan: [], act: [], found: new Set(), wrongIds: new Set(), log: [], tot: { found: 0, miss: 0, wrong: 0, total: 0 }, weird: 0,
  tut: store.get('tut') === '1' ? -1 : 0, tutStep: 0, looked: 0, result: null, photo: null, stepD: 0, near: 0,
}
const TT = () => D.T[S.lang]

// 音は sfx.js（再生エンジン）と sound.js（割り当て）。window の Snd を使う

// ---------- 描画の土台
const canvas = $('#gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
const lowRes = () => clamp(640 / innerHeight, 0.5, 1) * Math.min(devicePixelRatio || 1, 1.5)   // 安いホラー風: 少し荒い画面
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x07060a)
scene.fog = new THREE.Fog(0x07060a, 8, 26)
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80)
const lk = setupLook(renderer, scene, { env: true, envIntensity: 0.16, exposure: 1.0, sun: 0.22, sunPos: [3, 9, 6], hemi: 0.34, sky: 0x9aa6c8, ground: 0x2a2018, sunColor: 0xb8c8ff, fill: 0.1, fillColor: 0x8aa0a0 })
const fx = createFx(scene, camera, renderer)
const MC = {}
const w2 = 'white2'
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...o })
const mt = (k, color, o) => MC[k] || (MC[k] = std(color, o))
function mesh(geo, mat, x = 0, y = 0, z = 0, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (parent) parent.add(m); return m }
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
const cyl = (a, b, h, n = 14) => new THREE.CylinderGeometry(a, b, h, n)
const sph = (r, a = 12, b = 8) => new THREE.SphereGeometry(r, a, b)
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t }
const FONT = '"Zen Maru Gothic","Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif'
const glow = (color, k = 0.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.5 })

// ---------- 店
const world = new THREE.Group(); scene.add(world)
const lanterns = { list: [], side: { '-1': [], '1': [] } }, lights = [], menus = []
const FIX = {}        // 場所が決まっている物（カウンターの上・冷蔵ケース・品書き・一輪車など）
const menuItems = ['生ビール', '枝豆', '刺身盛り', '焼き鳥', 'だし巻き', '冷奴', 'もつ煮', 'ハイボール', 'レモンサワー', 'お茶漬け', '唐揚げ', 'たこわさ']
function menuTex(seed, odd) {
  return canvasTex(1024, 256, (x, w, h) => {
    const n = 6, sw = w / n
    for (let i = 0; i < n; i++) {
      const name = odd && i === 3 ? 'カップ麺' : menuItems[(seed * 5 + i * 7) % menuItems.length]
      const price = odd && i === 3 ? '1200' : ['380', '300', '880', '150', '420', '300', '450', '420', '400', '500', '480', '380'][(seed * 5 + i * 7) % 12]
      x.fillStyle = odd && i === 3 ? '#f6e27a' : i % 2 ? '#d8cba4' : '#cbbd94'; x.fillRect(i * sw + 6, 0, sw - 12, h)
      if (!(odd && i === 3)) { x.fillStyle = 'rgba(90,70,30,.28)'; x.fillRect(i * sw + 6, h * 0.6, sw - 12, h * 0.4) }
      x.fillStyle = '#2a1a10'; x.font = `900 ${sw * 0.46}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'top'
      const fz = Math.min(sw * 0.46, (h - sw * 0.5) / Math.max(4, name.length)); x.font = `900 ${fz}px ${FONT}`
      for (let k = 0; k < name.length; k++) x.fillText(name[k], i * sw + sw / 2, 8 + k * fz * 1.02)
      x.fillStyle = '#b5281c'; x.font = `900 ${sw * 0.28}px ${FONT}`; x.fillText(price, i * sw + sw / 2, h - sw * 0.36)
    }
  })
}
{
  const WL = W1 - W0, WC = (W0 + W1) / 2, WD = WALL_Z * 2
  const ft = surfaceTex({ w: 512, h: 512, base: '#43301f', noise: 0.1, grime: 0.35, seed: 5, repeat: [WL / 4, WD / 4], draw: (x, w, h) => { x.strokeStyle = 'rgba(30,16,8,.6)'; x.lineWidth = 3; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke() } } })
  const floor = mesh(new THREE.PlaneGeometry(WL, WD), std(0xffffff, { map: ft, roughness: 0.5 }), WC, 0, 0, world); floor.rotation.x = -Math.PI / 2; floor.userData.tid = 'floor'
  const tt = surfaceTex({ w: 256, h: 256, base: '#6f6a40', noise: 0.1, grime: 0.32, seed: 9, repeat: [WL / 1.8, 2], draw: (x, w, h) => { x.strokeStyle = 'rgba(70,70,30,.25)'; for (let i = 0; i < w; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke() } x.fillStyle = '#2d3a26'; x.fillRect(0, 0, w, 10); x.fillRect(0, h - 10, w, 10) } })
  const wt = surfaceTex({ w: 512, h: 256, base: '#8f8670', noise: 0.08, grime: 0.4, edge: 0.4, repeat: [WL / 6, 1], seed: 3, draw: (x, w, h, rnd) => { for (let i = 0; i < 9; i++) { const cx = rnd() * w, cy = rnd() * h * 0.6, r = 12 + rnd() * 40; const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(60,45,20,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); x.fillStyle = 'rgba(50,38,18,.35)'; x.fillRect(cx, cy, 2 + rnd() * 3, r + rnd() * h * 0.5) } } })
  const wood = mt('wood', 0x4a2e1a, { roughness: 0.55 }), woodD = mt('woodD', 0x2e1c10, { roughness: 0.5 })
  const za0 = 3.6, zaL = W1 - za0, zaC = (za0 + W1) / 2, zaD = WALL_Z - AISLE
  for (const s of [-1, 1]) {
    const face = s < 0 ? 0 : Math.PI
    const za = mesh(box(zaL, ZA_Y, zaD), [mt('zs', 0x5a3a22), mt('zs', 0x5a3a22), std(0xffffff, { map: tt, roughness: 0.8 }), mt('zs', 0x5a3a22), mt('ze', 0x6b4428), mt('ze', 0x6b4428)], zaC, ZA_Y / 2, s * (AISLE + zaD / 2), world); za.userData.tid = 'tatami' + s
    mesh(box(zaL, 0.08, 0.14), mt('edge', 0x2a1a10, { roughness: 0.35 }), zaC, ZA_Y + 0.02, s * (AISLE - 0.02), world)
    const wall = mesh(new THREE.PlaneGeometry(WL, 4.2), std(0xffffff, { map: wt }), WC, 2.1, s * WALL_Z, world); wall.rotation.y = face; wall.userData.tid = 'wall' + s
    mesh(box(WL, 1.0, 0.06), wood, WC, 0.82, s * (WALL_Z - 0.04), world)
    mesh(box(WL, 0.12, 0.1), woodD, WC, 3.3, s * (WALL_Z - 0.06), world)
    // 品書き（各壁2枚）
    for (const x0 of s < 0 ? [9, 22] : [14, 27]) {
      const k = menus.length, mm = new THREE.MeshStandardMaterial({ map: menuTex(k, false), roughness: 0.9 })
      const m = mesh(new THREE.PlaneGeometry(4.6, 1.15), mm, x0, 2.0, s * (WALL_Z - 0.05), world); m.rotation.y = face; m.rotation.z = (k % 2 ? 1 : -1) * 0.012; m.userData.tid = 'menu' + k
      menus.push({ m, mat: mm, k, normal: mm.map, x: x0, s })
    }
    // 柱と衝立
    for (let x = 3.9; x < W1 - 1; x += 6.8) { mesh(box(0.22, 4.2, 0.22), woodD, x, 2.1, s * (WALL_Z - 0.12), world) }
    // 提灯（通路の両脇の上）
    for (let x0 = 4 + (s > 0 ? 2.2 : 0); x0 < W1 - 2; x0 += 4.6) {
      const g = new THREE.Group(); g.position.set(x0, 3.3, s * 0.8); world.add(g); g.userData.tid = 'lantern' + lanterns.list.length
      const k = lanterns.list.length, mode = k % 4 === 2 ? 'off' : k % 5 === 1 ? 'flick' : 'on'
      const base = lanterns.mat || (lanterns.mat = (() => { const tx = canvasTex(256, 128, (x, w, h) => { x.fillStyle = '#d8382a'; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(80,10,5,.45)'; x.lineWidth = 3; for (let i = 0; i < h; i += 10) { x.beginPath(); x.moveTo(0, i); x.lineTo(w, i); x.stroke() } x.fillStyle = '#1a0a05'; x.font = `900 70px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('酒', w * 0.25, h / 2); x.fillText('酒', w * 0.75, h / 2) }); return new THREE.MeshStandardMaterial({ color: 0xb02a20, emissive: 0xff4a2a, emissiveIntensity: 0.5, roughness: 0.6, map: tx, emissiveMap: tx }) })())
      const mat = mode === 'on' ? base : mode === 'off' ? (lanterns.off || (lanterns.off = new THREE.MeshStandardMaterial({ color: 0x4a1612, map: base.map, roughness: 0.8 }))) : base.clone()
      const b = mesh(sph(0.28, 12, 8), mat, 0, 0, 0, g); b.scale.y = 1.35; if (mode === 'flick') g.userData.flick = mat
      mesh(cyl(0.17, 0.17, 0.07), mt('cap', 0x1a1008), 0, 0.38, 0, g); mesh(cyl(0.17, 0.17, 0.07), mt('cap', 0x1a1008), 0, -0.38, 0, g)
      mesh(cyl(0.012, 0.012, 0.6, 4), mt('cap', 0x1a1008), 0, 0.68, 0, g)
      lanterns.list.push(g); lanterns.side[s].push(g)
    }
  }
  // 天井と梁
  const ceil = mesh(new THREE.PlaneGeometry(WL, WD), mt('ceil', 0x221610, { roughness: 0.8 }), WC, 4.2, 0, world); ceil.rotation.x = Math.PI / 2; ceil.userData.tid = 'ceil'
  for (let x = 0; x < W1; x += 3.4) mesh(box(0.2, 0.22, WD), woodD, x, 4.08, 0, world)
  // 奥の壁とお手洗い
  const back = mesh(new THREE.PlaneGeometry(WD, 4.2), std(0xffffff, { map: wt }), W1, 2.1, 0, world); back.rotation.y = -Math.PI / 2; back.userData.tid = 'backwall'
  mesh(new THREE.PlaneGeometry(WD, 4.2), std(0xffffff, { map: wt }), W0, 2.1, 0, world).rotation.y = Math.PI / 2
  const door = mesh(box(0.1, 2.2, 1.2), mt('door', 0x3a2414, { roughness: 0.5 }), W1 - 0.05, 1.1, 0, world); door.userData.tid = 'door'
  mesh(sph(0.05), mt('knob', 0xc0b080, { metalness: 0.6, roughness: 0.3 }), W1 - 0.13, 1.05, 0.42, world)
  const wc = canvasTex(256, 128, (x, w, h) => { x.fillStyle = '#1f2f55'; x.fillRect(0, 0, w, h); x.fillStyle = '#f4ecd8'; x.font = `900 60px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('お手洗い', w / 2, h / 2 + 4) })
  const sign = mesh(new THREE.PlaneGeometry(1.4, 0.7), new THREE.MeshStandardMaterial({ map: wc, emissive: 0xffffff, emissiveMap: wc, emissiveIntensity: 0.35, roughness: 0.9 }), W1 - 0.12, 2.6, 0, world); sign.rotation.y = -Math.PI / 2; sign.userData.tid = 'sign'
  FIX.sign = { g: sign, normal: wc, odd: null }
  // 天井の蛍光灯（1本はちらつく）
  const tubeOn = new THREE.MeshStandardMaterial({ color: 0xe8f4e0, emissive: 0xd8ffe0, emissiveIntensity: 1.1 })
  for (let x0 = 4, n = 0; x0 < W1; x0 += 10, n++) {
    const pl = new THREE.PointLight(n % 2 ? 0xffa060 : 0xc8e0c0, 6, 13, 1.5); pl.position.set(x0, 3.6, 0); world.add(pl)
    const tm = n === 1 ? tubeOn.clone() : tubeOn; mesh(box(1.4, 0.07, 0.12), tm, x0, 3.98, 0, world)
    lights.push({ pl, tm, base: n === 2 ? 3.2 : 6, bad: n === 1, ph: n * 1.7 })
  }
  // カウンター（手前の端。通路をふさぐ向き）
  const cg = new THREE.Group(); world.add(cg); cg.userData.tid = 'counter'
  mesh(box(1.1, 0.12, 6.6), mt('ctop', 0x8a5e36, { roughness: 0.35 }), -0.45, 1.1, 0, cg)
  mesh(box(0.1, 1.06, 6.6), wood, 0.1, 0.53, 0, cg)
  const bc = [0x2f5d3a, 0x6b3a1a, 0x1f3550, 0x8a7a3a, 0x4a1a1a]
  mesh(box(0.5, 0.08, 4.2), wood, -2.9, 2.5, -0.9, cg); mesh(box(0.5, 0.08, 4.2), wood, -2.9, 3.3, -0.9, cg)
  for (let i = 0; i < 18; i++) { const r = 0.09 + (i % 3) * 0.02; mesh(cyl(r, r, 0.55, 10), mt('bot' + i % 5, bc[i % 5], { roughness: 0.2, metalness: 0.1 }), -2.85, 2.85 + Math.floor(i / 9) * 0.8, -2.7 + (i % 9) * 0.45, cg) }
  // ビールサーバー（ラベルが入れ替わる）
  const srv = new THREE.Group(); srv.position.set(-0.45, 1.16, 0.45); srv.scale.setScalar(1.45); cg.add(srv); srv.userData.tid = 'server'
  mesh(box(0.42, 0.5, 0.42), mt('steel', 0xb8bec4, { roughness: 0.25, metalness: 0.8 }), 0, 0.25, 0, srv)
  mesh(cyl(0.03, 0.03, 0.22, 8), mt('steel', 0xb8bec4), 0.2, 0.58, 0, srv)
  mesh(box(0.05, 0.22, 0.05), mt('tapH', 0x1a1a1a), 0.2, 0.76, 0, srv)
  const labN = canvasTex(128, 160, (x, w, h) => { x.fillStyle = '#1f2f55'; x.fillRect(0, 0, w, h); x.strokeStyle = '#e9b44c'; x.lineWidth = 8; x.strokeRect(6, 6, w - 12, h - 12); x.fillStyle = '#f4ecd8'; x.font = `900 84px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('生', w / 2, h / 2 + 4) })
  const labJ = canvasTex(128, 160, (x, w, h) => { x.fillStyle = '#ff9a1a'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffd64a'; x.beginPath(); x.arc(w / 2, h * 0.42, 40, 0, 7); x.fill(); x.strokeStyle = '#e06a00'; x.lineWidth = 5; for (let k = 0; k < 8; k++) { x.beginPath(); x.moveTo(w / 2, h * 0.42); x.lineTo(w / 2 + Math.cos(k * 0.785) * 38, h * 0.42 + Math.sin(k * 0.785) * 38); x.stroke() } x.fillStyle = '#3a8a2a'; x.beginPath(); x.ellipse(w / 2 + 20, h * 0.12, 18, 9, -0.5, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = `900 34px ${FONT}`; x.textAlign = 'center'; x.fillText('100%', w / 2, h * 0.88) })
  const lab = mesh(new THREE.PlaneGeometry(0.3, 0.38), new THREE.MeshStandardMaterial({ map: labN, roughness: 0.7, emissive: 0xffffff, emissiveMap: labN, emissiveIntensity: 0.15 }), 0.215, 0.25, 0, srv); lab.rotation.y = Math.PI / 2
  FIX.server = { g: srv, lab, labN, labJ }
  // グラスの並んだ盆（いつもの物）
  for (let k = 0; k < 6; k++) mesh(cyl(0.05, 0.045, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.08, transparent: true, opacity: 0.4 }), -0.4 + (k % 2) * 0.14, 1.23, -0.9 + Math.floor(k / 2) * 0.14, cg)
  // 冷蔵ケース（入口の左の壁際。瓶ビールが並ぶ）
  const fr = new THREE.Group(); fr.position.set(1.1, 0, 2.75); fr.rotation.y = Math.PI / 2; world.add(fr); fr.userData.tid = 'fridge'
  { const fm = mt('frame', 0x2b2f33, { roughness: 0.4, metalness: 0.5 }); mesh(box(1.3, 0.1, 0.6), fm, 0, 0.05, 0, fr); mesh(box(1.3, 0.12, 0.6), fm, 0, 1.94, 0, fr); mesh(box(0.08, 2.0, 0.6), fm, -0.61, 1.0, 0, fr); mesh(box(0.08, 2.0, 0.6), fm, 0.61, 1.0, 0, fr); mesh(box(1.3, 2.0, 0.04), fm, 0, 1.0, -0.29, fr); mesh(box(1.3, 0.2, 0.05), glow(0x3a6aa0, 0.5), 0, 1.84, 0.3, fr) }
  mesh(box(1.14, 1.7, 0.02), glow(0xd8f0ff, 0.9), 0, 1.05, -0.26, fr); const frl = new THREE.PointLight(0xd8f0ff, 1.6, 2.2, 1.5); frl.position.set(0, 1.1, 0.1); fr.add(frl)
  mesh(box(1.18, 1.76, 0.02), new THREE.MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.05, transparent: true, opacity: 0.18, depthWrite: false }), 0, 1.05, 0.31, fr)
  const beerB = new THREE.Group(), teaB = new THREE.Group(); fr.add(beerB); fr.add(teaB); teaB.visible = false
  for (let r = 0; r < 3; r++) {
    mesh(box(1.14, 0.03, 0.5), mt('shelf', 0x9aa0a6, { metalness: 0.6, roughness: 0.3 }), 0, 0.42 + r * 0.55, 0, fr)
    for (let k = 0; k < 6; k++) {
      const bx = -0.45 + k * 0.18, by = 0.44 + r * 0.55
      mesh(cyl(0.05, 0.05, 0.26, 10), mt('bbot', 0x5a2c0a, { roughness: 0.15, metalness: 0.1 }), bx, by + 0.13, 0.1, beerB); mesh(cyl(0.018, 0.04, 0.1, 8), mt('bbot', 0x5a2c0a), bx, by + 0.31, 0.1, beerB)
      mesh(box(0.08, 0.08, 0.005), mt('blab', 0xe8d9a0), bx, by + 0.12, 0.151, beerB)
      mesh(cyl(0.05, 0.05, 0.27, 10), new THREE.MeshStandardMaterial({ color: 0xbfe0a8, roughness: 0.05, transparent: true, opacity: 0.75 }), bx, by + 0.135, 0.1, teaB); mesh(cyl(0.02, 0.02, 0.04, 8), mt('wcap', 0xf2f2f2), bx, by + 0.29, 0.1, teaB)
      mesh(cyl(0.052, 0.052, 0.09, 10), mt('tlab', 0x2f8a3a), bx, by + 0.15, 0.1, teaB)
    }
  }
  FIX.fridge = { g: fr, beerB, teaB }
  // のれん（奥座敷へ）
  const nt2 = canvasTex(512, 256, (x, w, h) => { x.fillStyle = '#5a1e18'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 3; i++) x.fillRect(i * w / 3 - 3, 0, 6, h); x.fillStyle = '#e8dcc0'; x.font = `900 110px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('奥', w / 6, h * 0.45); x.fillText('座', w / 2, h * 0.45); x.fillText('敷', w * 5 / 6, h * 0.45) })
  const nx = TX(3) + 1.7, ng = new THREE.Group(); ng.position.set(nx, 4.05, 0); world.add(ng); ng.userData.tid = 'noren'
  for (let k = 0; k < 3; k++) { const p = mesh(new THREE.PlaneGeometry(0.76, 0.7), new THREE.MeshStandardMaterial({ map: nt2, side: THREE.DoubleSide, roughness: 0.9 }), 0, -0.36, (k - 1) * 0.79, ng); p.rotation.y = Math.PI / 2; const uv = p.geometry.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setX(j, (uv.getX(j) + k) / 3) }
  // 一輪車（シリーズの小ネタ。いつもは通路の脇に立てかけてある）
  const uni = new THREE.Group(), ux = TX(4) - 1.5; uni.position.set(ux, 0, -(AISLE - 0.18)); world.add(uni); uni.userData.tid = 'unicycle'
  const wh = new THREE.Group(); wh.position.y = 0.36; uni.add(wh)
  mesh(new THREE.TorusGeometry(0.31, 0.06, 8, 22), mt('tire', 0x1a1a1a, { roughness: 0.8 }), 0, 0, 0, wh)
  for (let k = 0; k < 6; k++) { const sp = mesh(cyl(0.01, 0.01, 0.6, 4), mt('rim', 0xd8dde2, { metalness: 0.8, roughness: 0.25 }), 0, 0, 0, wh); sp.rotation.z = k * Math.PI / 6 }
  mesh(cyl(0.04, 0.04, 0.75, 8), mt('uframe', 0xd23b2a, { roughness: 0.35, metalness: 0.3 }), 0, 0.76, 0, uni)
  mesh(box(0.38, 0.07, 0.18), mt('useat', 0x222222), 0, 1.15, 0, uni)
  uni.rotation.x = -0.28
  FIX.uni = { g: uni, wh, x0: ux, z0: -(AISLE - 0.18) }
}

// ---------- 卓と、卓の上の物（異変はここを入れ替える）
const TABLES = []
const tblMat = mt('tbl', 0x5c3a20, { roughness: 0.35 })
function slotG(parent, tid, x, z, a) { const g = new THREE.Group(); g.position.set(x, 0, z * a); parent.add(g); g.userData.tid = tid; const n = new THREE.Group(); g.add(n); return { g, n, alt: null } }
function buildTable(i) {
  const x = TX(i), s = SIDE(i), a = -s
  const g = new THREE.Group(); g.position.set(x, ZA_Y, s * ZA_Z); world.add(g)
  const body = new THREE.Group(); g.add(body); body.userData.tid = 't' + i + ':body'
  mesh(box(2.0, 0.09, 1.15), tblMat, 0, 0.42, 0, body)
  for (const [px, pz] of [[-0.9, -0.48], [0.9, -0.48], [-0.9, 0.48], [0.9, 0.48]]) mesh(box(0.08, 0.38, 0.08), tblMat, px, 0.19, pz, body)
  const P = new THREE.Group(); P.position.y = 0.465; P.scale.setScalar(1.4); g.add(P)
  const T = { i, x, s, a, g, body, P, sl: {}, cush: [], cust: [] }
  const w = 'white'
  // お通し（小鉢）
  { const o = T.sl.otoshi = slotG(P, `t${i}:otoshi`, -0.45, 0.22, a); mesh(cyl(0.085, 0.06, 0.06), mt('bowl', 0x26324a, { roughness: 0.3 }), 0, 0.03, 0, o.g); mesh(sph(0.055, 10, 6), mt('nimono', 0x7a4a1e), 0, 0.06, 0, o.n).scale.y = 0.55; mesh(box(0.03, 0.01, 0.05), mt('green', 0x4a8a2a), 0.02, 0.085, 0, o.n) }
  // 枝豆
  { const o = T.sl.edamame = slotG(P, `t${i}:edamame`, -0.1, 0.22, a); mesh(cyl(0.14, 0.12, 0.02, 18), mt(w, 0xf2efe6, { roughness: 0.3 }), 0, 0.01, 0, o.g)
    for (let k = 0; k < 7; k++) { const p = mesh(new THREE.CapsuleGeometry(0.018, 0.075, 3, 6), mt('eda', 0x4f8a24, { roughness: 0.6 }), Math.cos(k * 2.4) * 0.06, 0.035, Math.sin(k * 2.4) * 0.05, o.n); p.rotation.set(Math.PI / 2, 0, k * 0.9) } }
  // 刺身（板の上に赤身と白身）
  { const o = T.sl.sashimi = slotG(P, `t${i}:sashimi`, 0.36, 0.14, a); mesh(box(0.42, 0.03, 0.24), mt('board', 0xc8a070, { roughness: 0.6 }), 0, 0.015, 0, o.g)
    for (let k = 0; k < 4; k++) { const sl = mesh(box(0.07, 0.025, 0.12), mt(k % 2 ? 'tuna' : 'salmon', k % 2 ? 0xb8202a : 0xf08a5a, { roughness: 0.35 }), -0.08 + k * 0.06, 0.045, 0, o.n); sl.rotation.z = 0.4 }
    mesh(sph(0.05, 8, 6), mt('daikon', 0xf4f4ee), 0.15, 0.05, 0, o.n).scale.y = 0.6; mesh(box(0.08, 0.005, 0.08), mt('shiso', 0x3a7a2a), 0.15, 0.035, -0.06, o.n) }
  // ジョッキ
  { const o = T.sl.jokki = slotG(P, `t${i}:jokki`, 0.52, -0.2, a)
    mesh(cyl(0.065, 0.06, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.08, transparent: true, opacity: 0.32, depthWrite: false }), 0, 0.09, 0, o.g)
    mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), mt('glassH', 0xd8e8f0, { roughness: 0.1 }), 0.075, 0.1, 0, o.g).rotation.z = -Math.PI / 2
    mesh(cyl(0.058, 0.055, 0.14, 14), mt('beer', 0xf2a91a, { roughness: 0.15, emissive: 0x4a2a00, emissiveIntensity: 0.4 }), 0, 0.075, 0, o.n); mesh(cyl(0.062, 0.06, 0.035, 14), mt('foam', 0xfffaf0, { roughness: 0.9 }), 0, 0.16, 0, o.n) }
  // 焼き鳥（皿に串3本）
  { const o = T.sl.yakitori = slotG(P, `t${i}:yakitori`, -0.3, -0.18, a); mesh(box(0.32, 0.015, 0.12), mt(w, 0xf2efe6), 0, 0.008, 0, o.g)
    for (let k = 0; k < 3; k++) { const st = mesh(cyl(0.004, 0.004, 0.27, 4), mt('kushi', 0xd8c090), 0.02, 0.03, -0.035 + k * 0.035, o.g); st.rotation.z = Math.PI / 2; for (let j = 0; j < 4; j++) mesh(sph(0.02, 8, 6), mt('tori', 0x7a3e16, { roughness: 0.5 }), -0.07 + j * 0.04, 0.032, -0.035 + k * 0.035, o.n) } }
  // 醤油差し
  { const o = T.sl.shoyu = slotG(P, `t${i}:shoyu`, 0.12, -0.27, a); mesh(cyl(0.028, 0.034, 0.09, 12), mt('shoyuB', 0x2a1408, { roughness: 0.1 }), 0, 0.045, 0, o.n); mesh(cyl(0.02, 0.024, 0.035, 10), mt('shoyuC', 0xb8241c), 0, 0.105, 0, o.n) }
  // 箸立て
  { const o = T.sl.hashi = slotG(P, `t${i}:hashi`, -0.6, -0.26, a); mesh(cyl(0.04, 0.036, 0.1, 12), mt('hcup', 0x6a4a2a), 0, 0.05, 0, o.g)
    for (let k = 0; k < 7; k++) { const h = mesh(box(0.008, 0.22, 0.008), mt('hashi', 0xc8a878), Math.cos(k) * 0.018, 0.14, Math.sin(k) * 0.018, o.n); h.rotation.set(Math.sin(k) * 0.1, 0, Math.cos(k) * 0.1) } }
  // 何も置いていない真ん中（ポテチ・マイクの置き場）
  T.sl.center = slotG(P, `t${i}:center`, 0.08, 0.0, a)
  // 座布団（両端と奥）
  const seats = [[-1.25, 0], [1.25, 0], [0, s * 0.95]]
  seats.forEach(([px, pz], k) => { const c = new THREE.Group(); c.position.set(px, 0, pz); g.add(c); c.userData.tid = `t${i}:cush${k}`; mesh(box(0.64, 0.07, 0.64), mt('zabu', 0x7a2a3a, { roughness: 0.9 }), 0, 0.035, 0, c); T.cush.push(c) })
  TABLES.push(T)
}
for (let i = 0; i < NT; i++) buildTable(i)
// 卓番の札（遠くからでも位置が分かる）
for (const T of TABLES) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#e8dcc0'; c.beginPath(); c.roundRect(10, 10, w - 20, h - 20, 20); c.fill(); c.strokeStyle = '#2a1a10'; c.lineWidth = 8; c.stroke(); c.fillStyle = '#2a1a10'; c.font = `900 72px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(T.i + 1), w / 2, h / 2 + 5) }), fog: true }))
  sp.position.set(T.x, 2.3, T.s * (ZA_Z + 0.4)); sp.scale.setScalar(0.38); world.add(sp)
}

// 止まる場所（光る床）。奥のお手洗い前・カウンター前
const zoneTex = col => canvasTex(256, 256, (x, w, h) => { x.fillStyle = col + '33'; x.fillRect(0, 0, w, h); x.strokeStyle = col; x.lineWidth = 18; x.setLineDash([34, 20]); x.strokeRect(12, 12, w - 24, h - 24) })
const zMat = c => new THREE.MeshBasicMaterial({ map: zoneTex(c), transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3 })
const ZM = { far: zMat('#ffc83d'), in: zMat('#5dff7a') }
const zoneFar = mesh(new THREE.PlaneGeometry(W1 - FAR_X, AISLE * 1.8), ZM.far, (FAR_X + W1) / 2, 0.012, 0, world); zoneFar.rotation.x = -Math.PI / 2
const zoneHome = mesh(new THREE.PlaneGeometry(HOME_X - XMIN + 0.6, AISLE * 1.8), ZM.far, (XMIN + HOME_X) / 2 - 0.1, 0.012, 0, world); zoneHome.rotation.x = -Math.PI / 2
zoneFar.userData.noHit = zoneHome.userData.noHit = true

// ---------- 人（Kenney Mini Characters, CC0）
const MODELS = {}
let charsReady = false
const loader = new GLTFLoader()
const CHAR_FILES = ['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f']
function loadChars() { return Promise.all(CHAR_FILES.map(n => new Promise(res => loader.load(`chars/character-${n}.glb`, g => { MODELS[n] = g; res() }, undefined, () => res())))).then(() => { charsReady = true }) }
function makeChar(name, o = {}) {
  const src = MODELS[name]; if (!src) return null
  const root = skClone(src.scene), g = new THREE.Group(); g.add(root)
  root.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.roughness = 0.75; m.frustumCulled = false } })
  const bx = new THREE.Box3().setFromObject(root), hgt = bx.max.y - bx.min.y
  g.scale.setScalar((o.h ?? CH) / hgt)
  const mixer = new THREE.AnimationMixer(root), acts = {}
  for (const c of src.animations) acts[c.name] = mixer.clipAction(c)
  const c = { g, root, mixer, acts, cur: null, head: root.getObjectByName('head'), torso: root.getObjectByName('torso'), armR: root.getObjectByName('arm-right'), name, bub: null }
  play(c, o.anim ?? 'idle')
  return c
}
function play(c, name, fade = 0.2) {
  const a = c.acts[name]; if (!a || c.cur === name) return
  const prev = c.cur ? c.acts[c.cur] : null
  a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); if (prev) a.crossFadeFrom(prev, fade, false)
  c.cur = name
}
const _hp = new THREE.Vector3(), _q = new THREE.Vector3(), _w = new THREE.Vector3(), _v = new THREE.Vector3()
function headPos(c, out) { if (c.head) c.head.getWorldPosition(out); else out.copy(c.g.position).setY(CH); return out.add(_q.set(0, 0.62, 0)) }
const people = new THREE.Group(); scene.add(people)

// 主人公（懐中電灯を持った最後のバイト）
const P = { g: new THREE.Group(), c: null }
scene.add(P.g)
const flash = new THREE.SpotLight(0xfff0d0, 46, 17, 0.6, 0.55, 1.15); scene.add(flash); scene.add(flash.target)
const lamp = new THREE.PointLight(0xffe6c0, 2.2, 6, 1.4); scene.add(lamp)
function setupPlayer() {
  const c = makeChar('male-e', { h: CH * 0.95, anim: 'idle' }); if (!c) return
  P.g.add(c.g); P.c = c
  if (c.armR) { const s = 1 / c.g.scale.x, fl = new THREE.Group(); mesh(cyl(0.035, 0.03, 0.22, 8), mt('flb', 0x222428, { metalness: 0.5, roughness: 0.4 }), 0, 0, 0, fl); mesh(cyl(0.05, 0.04, 0.05, 10), glow(0xfff6d8, 1.4), 0, -0.13, 0, fl); fl.scale.setScalar(s); fl.position.set(0, -0.3 * s, 0.08 * s); fl.rotation.x = 0.3; c.armR.add(fl) }
  addBlobShadow(P.g, 0.9, { floorY: 0, opacity: 0.45, parent: scene })
}
// 常連（閉店後も居座っている）
const CUST = []
function setupCustomers() {
  const rnd = mulberry(11), pool = CHAR_FILES.filter(n => n !== 'male-e' && n !== 'male-d')
  for (const ti of CUST_TABLES) {
    const T = TABLES[ti]
    // 奥の座布団に並んで座り、通路の側を向く（卓の上を隠さない）
    for (const k of [0, 1]) {
      const c = makeChar(pool[Math.floor(rnd() * pool.length)], { anim: 'sit' }); if (!c) continue
      const [px, pz] = [T.x + (k ? 0.42 : -0.42), T.s * (ZA_Z + 0.95)]
      const ry = T.s < 0 ? 0 : Math.PI
      c.g.position.set(px, ZA_Y, pz); c.g.rotation.y = ry; c.home = ry; c.mixer.update(rnd() * 2); c.g.userData.tid = `cust${CUST.length}`
      people.add(c.g); CUST.push(c); T.cust.push(c)
      addBlobShadow(c.g, 0.7, { floorY: ZA_Y, opacity: 0.35, parent: scene })
    }
  }
}
// 店長（カウンターの中）
const BOSS = { c: null, apron: null, aN: null, aC: null }
function setupBoss() {
  const c = BOSS.c = makeChar('male-d', { anim: 'idle', h: CH * 1.08 }); if (!c) return
  c.g.position.set(1.15, 0, -1.45); c.g.rotation.y = Math.PI / 2; c.g.userData.tid = 'boss'; people.add(c.g)
  if (c.torso) {
    const s = 1 / c.g.scale.x
    BOSS.aN = new THREE.MeshStandardMaterial({ color: 0x1f2f55, roughness: 0.9, side: THREE.DoubleSide })
    const ct = canvasTex(64, 64, (x, w, h) => { x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, w, h); x.fillStyle = '#2a7ae0'; x.fillRect(0, 6, w, 16); x.fillStyle = '#3ab04a'; x.fillRect(0, 28, w, 8); x.fillStyle = '#2a7ae0'; x.fillRect(0, 44, w, 8) })
    BOSS.aC = new THREE.MeshStandardMaterial({ map: ct, roughness: 0.8, side: THREE.DoubleSide })
    const ap = mesh(new THREE.PlaneGeometry(0.56, 0.56), BOSS.aN, 0, -0.04 * s, 0.185 * s); ap.scale.setScalar(s); c.torso.add(ap); BOSS.apron = ap
    const vest = BOSS.vest = mesh(box(0.62, 0.5, 0.4), BOSS.aC, 0, -0.03 * s, 0); vest.scale.setScalar(s); vest.visible = false; c.torso.add(vest)
  }
}

// ---------- 異変（作る・戻す）。alt は slot.g に足す。normal は slot.n を隠す
function setAlt(slot, build) { unsetAlt(slot); const g = new THREE.Group(); build(g); slot.g.add(g); slot.alt = g; slot.n.visible = false; return g }
function unsetAlt(slot) { if (slot.alt) { slot.alt.removeFromParent(); slot.alt = null } slot.n.visible = true }
const chipsTex = () => MC.chipsTex || (MC.chipsTex = canvasTex(128, 160, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffd23a'); g.addColorStop(1, '#f2a91a'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#d8302a'; x.fillRect(0, 18, w, 34); x.fillStyle = '#fff3c0'; for (let k = 0; k < 5; k++) { x.beginPath(); x.ellipse(30 + (k % 3) * 34, 90 + Math.floor(k / 3) * 34, 18, 13, k, 0, 7); x.fill() } x.strokeStyle = '#c88a20'; x.lineWidth = 4; for (let k = 0; k < 5; k++) { x.beginPath(); x.ellipse(30 + (k % 3) * 34, 90 + Math.floor(k / 3) * 34, 18, 13, k, 0, 7); x.stroke() } x.fillStyle = '#fff'; x.beginPath(); x.arc(64, 35, 9, 0, 7); x.fill() }))
const BUILD = {
  chips: (T) => { setAlt(T.sl.center, g => { const b = mesh(box(0.24, 0.32, 0.06), [mt('chS', 0xf2a91a), mt('chS', 0xf2a91a), mt('chS', 0xf2a91a), mt('chS', 0xf2a91a), new THREE.MeshStandardMaterial({ map: chipsTex(), roughness: 0.4 }), new THREE.MeshStandardMaterial({ map: chipsTex(), roughness: 0.4 })], 0, 0.15, 0, g); b.rotation.set(-0.35 * 1, T.a < 0 ? Math.PI : 0, 0.15); for (const y of [0.31, -0.01]) mesh(box(0.25, 0.025, 0.065), mt('chE', 0xe8c040, { roughness: 0.3 }), 0, y + 0.0, 0, b) }); return T.sl.center },
  mic: (T) => { setAlt(T.sl.center, g => { const m = new THREE.Group(); m.position.y = 0.025; m.rotation.y = 0.5; g.add(m); m.position.y = 0.035; mesh(cyl(0.032, 0.024, 0.3, 10), mt('micH', 0xf4f4f8, { roughness: 0.3 }), 0, 0, 0, m).rotation.z = Math.PI / 2; mesh(cyl(0.035, 0.035, 0.03, 10), mt('micR', 0xff3a9a, { roughness: 0.3 }), 0.12, 0, 0, m).rotation.z = Math.PI / 2; mesh(sph(0.055, 12, 10), mt('micG', 0xd8dce2, { metalness: 0.6, roughness: 0.35 }), 0.18, 0, 0, m); mesh(new THREE.TorusGeometry(0.06, 0.006, 4, 16), mt('cord', 0x101010), -0.17, -0.02, 0.04, m).rotation.x = Math.PI / 2 }); return T.sl.center },
  cake: (T) => setAlt(T.sl.sashimi, g => { mesh(box(0.15, 0.1, 0.12), mt('sponge', 0xfff6e8, { roughness: 0.7 }), 0, 0.08, 0, g); mesh(box(0.152, 0.012, 0.122), mt('pinkL', 0xf6a8b8), 0, 0.08, 0, g); mesh(box(0.155, 0.02, 0.125), mt('cream', 0xffffff, { roughness: 0.6 }), 0, 0.135, 0, g); mesh(sph(0.03, 10, 8), mt('ichigo', 0xe02030, { roughness: 0.3 }), 0, 0.165, 0, g) }) && T.sl.sashimi,
  tapioca: (T) => setAlt(T.sl.jokki, g => { mesh(cyl(0.058, 0.055, 0.14, 14), mt('milk', 0xd8b088, { roughness: 0.4 }), 0, 0.075, 0, g); for (let k = 0; k < 10; k++) mesh(sph(0.017, 8, 6), mt('tapi', 0x150c08, { roughness: 0.15 }), Math.cos(k * 1.3) * 0.03, 0.02 + (k % 3) * 0.012, Math.sin(k * 1.3) * 0.03, g); const st = mesh(cyl(0.014, 0.014, 0.3, 8), mt('straw', 0xff5aa0, { roughness: 0.4 }), 0.02, 0.2, 0, g); st.rotation.z = -0.25 }) && T.sl.jokki,
  wataame: (T) => setAlt(T.sl.yakitori, g => { for (let k = 0; k < 3; k++) { const z = -0.035 + k * 0.035; mesh(sph(0.055, 10, 8), mt('wata', 0xffb8e0, { roughness: 1, emissive: 0x401030, emissiveIntensity: 0.3 }), -0.06 + (k % 2) * 0.03, 0.06, z, g).scale.set(1.2, 0.9, 0.7) } }) && T.sl.yakitori,
  fork: (T) => setAlt(T.sl.hashi, g => { for (let k = 0; k < 3; k++) { const f = new THREE.Group(); f.position.set(Math.cos(k * 2) * 0.015, 0.1, Math.sin(k * 2) * 0.015); f.rotation.z = (k - 1) * 0.15; g.add(f); mesh(box(0.014, 0.2, 0.006), mt('silver', 0xe8ecf0, { metalness: 0.6, roughness: 0.25 }), 0, 0.05, 0, f); mesh(box(0.045, 0.07, 0.006), mt('silver', 0xe8ecf0), 0, 0.18, 0, f) } for (let k = 0; k < 2; k++) { const s = mesh(cyl(0.012, 0.012, 0.3, 6), mt(k ? 'strawB' : 'straw', k ? 0x4aa0ff : 0xff5aa0), (k - 0.5) * 0.035, 0.17, 0.01, g); s.rotation.x = (k - 0.5) * 0.3 } }) && T.sl.hashi,
  dagashi: (T) => setAlt(T.sl.otoshi, g => { const cols = [0xffd23a, 0xff5aa0, 0x3a9aff, 0x6ad04a]; for (let k = 0; k < 4; k++) { const b = mesh(box(0.05, 0.012, 0.035), mt('dg' + k, cols[k], { roughness: 0.4 }), Math.cos(k * 1.6) * 0.025, 0.07 + k * 0.008, Math.sin(k * 1.6) * 0.02, g); b.rotation.y = k } const st = mesh(cyl(0.005, 0.005, 0.14, 4), mt(w2, 0xffffff), 0.02, 0.12, 0, g); st.rotation.z = 0.3; mesh(sph(0.032, 10, 8), mt('lolly', 0xff3a5a, { roughness: 0.2 }), 0.045, 0.19, 0, g); for (const [cx, col] of [[-0.03, 0xffd23a], [0.0, 0x9a4ae0]]) mesh(cyl(0.02, 0.02, 0.15, 8), mt('ub' + col, col, { roughness: 0.3 }), cx, 0.1, -0.02, g).rotation.x = 0.25 }) && T.sl.otoshi,
  peas: (T) => setAlt(T.sl.edamame, g => { for (let k = 0; k < 26; k++) { const r = 0.01 + (k % 4) * 0.03, a = k * 2.4; mesh(sph(0.022, 8, 6), mt('pea', 0xb8f060, { roughness: 0.3, emissive: 0x203a00, emissiveIntensity: 0.4 }), Math.cos(a) * r, 0.035 + (3 - k % 4) * 0.012, Math.sin(a) * r * 0.9, g) } }) && T.sl.edamame,
  ketchup: (T) => setAlt(T.sl.shoyu, g => { mesh(cyl(0.042, 0.046, 0.15, 12), mt('ketB', 0xe0201a, { roughness: 0.3 }), 0, 0.075, 0, g); mesh(new THREE.ConeGeometry(0.03, 0.05, 10), mt(w2, 0xffffff), 0, 0.175, 0, g) }) && T.sl.shoyu,
  // ジョッキの中で金魚が泳いでいる
  goldfish: (T) => setAlt(T.sl.jokki, g => { mesh(cyl(0.058, 0.055, 0.14, 14), new THREE.MeshStandardMaterial({ color: 0xbfe8f0, roughness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }), 0, 0.075, 0, g); const f = new THREE.Group(); f.position.set(0, 0.2, 0); f.rotation.set(0, 0.5, 1.15); g.add(f); const or = mt('kingyo', 0xff5a1a, { roughness: 0.35, emissive: 0x602000, emissiveIntensity: 0.5 }); mesh(sph(0.03, 10, 8), or, 0, 0, 0, f).scale.set(1.7, 1, 0.8); const tl = mesh(new THREE.ConeGeometry(0.032, 0.05, 8), or, -0.065, 0, 0, f); tl.rotation.z = -Math.PI / 2; tl.scale.z = 0.3; for (const z of [-0.022, 0.022]) mesh(sph(0.007, 6, 4), mt('kEye', 0x0a0a0a), 0.034, 0.008, z, f); f.scale.setScalar(1.5) }) && T.sl.jokki,
  // 箸立てに孫の手。箸は2本だけ残っている
  magonote: (T) => setAlt(T.sl.hashi, g => { for (let k = 0; k < 2; k++) { const h = mesh(box(0.008, 0.22, 0.008), mt('hashi', 0xc8a878), (k - 0.5) * 0.03, 0.14, 0.012, g); h.rotation.z = (k - 0.5) * 0.2 } const m = new THREE.Group(); m.position.set(0, 0.04, -0.008); m.rotation.z = -0.16; g.add(m); const bb = mt('take', 0xe0c468, { roughness: 0.45 }); mesh(box(0.024, 0.48, 0.008), bb, 0, 0.24, 0, m); const hand = new THREE.Group(); hand.position.set(0, 0.49, 0.008); hand.rotation.x = 0.35; m.add(hand); mesh(box(0.056, 0.05, 0.012), bb, 0, 0, 0, hand); for (let k = 0; k < 4; k++) { const fi = mesh(box(0.011, 0.04, 0.012), bb, -0.021 + k * 0.014, 0.038, 0.006, hand); fi.rotation.x = 0.5 } }) && T.sl.hashi,
  // 焼き鳥の串がぜんぶ三色だんご
  dango: (T) => setAlt(T.sl.yakitori, g => { const cols = [['dgP', 0xf4a2bc], ['dgW', 0xfaf4e4], ['dgG', 0x8cc25a]]; for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) mesh(sph(0.0235, 10, 8), mt(cols[j][0], cols[j][1], { roughness: 0.55 }), -0.05 + j * 0.05, 0.034, -0.035 + k * 0.035, g) }) && T.sl.yakitori,
  ball: (T) => { const c = T.cush[1]; c.children[0].visible = false; const b = mesh(sph(0.33, 20, 14), mt('ball', 0xa890e8, { roughness: 0.35 }), 0, 0.33, 0, c); b.userData.alt = true; return { g: c, undo() { c.children[0].visible = true; b.removeFromParent() } } },
  kotatsu: (T) => {
    T.body.visible = false
    const k = new THREE.Group(); T.g.add(k)
    const qt = MC.quilt || (MC.quilt = canvasTex(128, 128, (x, w, h) => { x.fillStyle = '#d8582a'; x.fillRect(0, 0, w, h); x.fillStyle = '#a03018'; for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) x.fillRect(i * 16, j * 16, 16, 16); x.fillStyle = 'rgba(255,220,120,.5)'; for (let i = 0; i < 8; i++) x.fillRect(i * 16 + 6, 0, 3, h) }))
    const q = mesh(box(2.3, 0.36, 1.45), new THREE.MeshStandardMaterial({ map: qt, roughness: 0.95 }), 0, 0.2, 0, k); q.scale.set(1, 1, 1)
    mesh(box(2.0, 0.05, 1.15), mt('kboard', 0xb8864e, { roughness: 0.4 }), 0, 0.42, 0, k)
    for (let j = 0; j < 3; j++) mesh(sph(0.05, 10, 8), mt('mikan', 0xff8a1a, { roughness: 0.6 }), 0.0 + j * 0.08, 0.5, -T.a * 0.35, k)
    return { g: k, undo() { T.body.visible = true; k.removeFromParent() } }
  },
}
const FIXB = {
  rice: () => { const g = new THREE.Group(); g.position.set(-0.45, 1.16, 1.55); world.add(g); mesh(cyl(0.2, 0.2, 0.26, 18), mt('rcB', 0xf4f2ee, { roughness: 0.3 }), 0, 0.13, 0, g); const l = mesh(new THREE.SphereGeometry(0.2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), mt('rcL', 0xb8bcc2, { roughness: 0.3, metalness: 0.3 }), 0, 0.26, 0, g); l.scale.y = 0.45; mesh(box(0.08, 0.06, 0.02), glow(0x3aff6a, 1.2), 0.2, 0.15, 0, g).rotation.y = Math.PI / 2; mesh(box(0.06, 0.06, 0.12), mt('rcH', 0x9aa0a6), 0, 0.34, 0, g); g.scale.setScalar(1.3); return { g, undo() { g.removeFromParent() } } },
  takoyaki: () => { const g = new THREE.Group(); g.position.set(-0.45, 1.16, -1.9); world.add(g); mesh(box(0.46, 0.07, 0.34), mt('tkB', 0xff8ab8, { roughness: 0.4 }), 0, 0.035, 0, g); mesh(box(0.38, 0.04, 0.27), mt('tkP', 0x1a1a1c, { roughness: 0.5 }), 0, 0.09, 0, g); for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) mesh(new THREE.SphereGeometry(0.032, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mt('tako', 0xb8742a, { roughness: 0.6 }), -0.13 + i * 0.087, 0.11, -0.08 + j * 0.08, g); mesh(cyl(0.008, 0.008, 0.5, 4), mt('cord', 0x101010), 0.2, 0.02, 0.2, g).rotation.x = Math.PI / 2; g.scale.setScalar(1.25); return { g, undo() { g.removeFromParent() } } },
  juice: () => { const s = FIX.server; s.lab.material.map = s.labJ; s.lab.material.emissiveMap = s.labJ; s.lab.material.needsUpdate = true; return { g: s.g, undo() { s.lab.material.map = s.labN; s.lab.material.emissiveMap = s.labN; s.lab.material.needsUpdate = true } } },
  petcase: () => { const f = FIX.fridge; f.beerB.visible = false; f.teaB.visible = true; return { g: f.g, undo() { f.beerB.visible = true; f.teaB.visible = false } } },
  conbini: () => { if (BOSS.apron) { BOSS.apron.material = BOSS.aC; BOSS.vest.visible = true } return { g: BOSS.c ? BOSS.c.g : world, undo() { if (BOSS.apron) { BOSS.apron.material = BOSS.aN; BOSS.vest.visible = false } } } },
  cupmen: (v) => { const m = menus[v % menus.length]; if (!m.odd) m.odd = menuTex(m.k, true); m.mat.map = m.odd; m.mat.needsUpdate = true; return { g: m.m, undo() { m.mat.map = m.normal; m.mat.needsUpdate = true } } },
  xmas: (v) => {
    const s = v % 2 ? 1 : -1, g = new THREE.Group(); world.add(g)
    for (const L of lanterns.side[s]) L.visible = false
    const x0 = 3.6, x1 = W1 - 2, n = 46, cols = [0xff3030, 0x30ff60, 0xffd030, 0x3a8aff, 0xff60e0]
    const wire = []; for (let k = 0; k <= n; k++) { const x = lerp(x0, x1, k / n); wire.push(new THREE.Vector3(x, 3.45 - Math.abs(Math.sin(k / n * Math.PI * 7)) * 0.45, s * 0.8)) }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wire), 120, 0.008, 4), mt('wire', 0x103a10), 0, 0, 0, g)
    g.userData.bulbs = []
    for (let k = 0; k < n; k++) { const p = wire[k], m = new THREE.MeshStandardMaterial({ color: cols[k % 5], emissive: cols[k % 5], emissiveIntensity: 1.4 }); mesh(sph(0.05, 8, 6), m, p.x, p.y - 0.05, p.z, g); g.userData.bulbs.push(m) }
    FIX.xmasG = g
    return { g, undo() { for (const L of lanterns.side[s]) L.visible = true; g.removeFromParent(); FIX.xmasG = null } }
  },
  unicycle: () => { FIX.uni.run = true; return { g: FIX.uni.g, moving: true, undo() { FIX.uni.run = false; const u = FIX.uni; u.g.position.set(u.x0, 0, u.z0); u.g.rotation.set(-0.28, 0, 0) } } },
  // 座敷の奥にモアイ。ねじりはちまきを締めて店員のふりをしている
  moai: () => {
    const g = new THREE.Group(); g.position.set(TX(3), ZA_Y, -2.55); g.rotation.y = -0.55; world.add(g); g.userData.tid = 'moaiA'
    const st = mt('moaiS', 0x857f70, { roughness: 0.95, emissive: 0x1a1812, emissiveIntensity: 0.4 })
    mesh(box(1.05, 0.95, 0.72), st, 0, 0.48, 0, g); mesh(box(0.92, 1.25, 0.7), st, 0, 1.55, 0, g); mesh(box(0.96, 0.18, 0.78), st, 0, 1.92, 0.03, g)
    const ns = mesh(box(0.22, 0.62, 0.24), st, 0, 1.56, 0.42, g); ns.rotation.x = -0.1; mesh(box(0.72, 0.1, 0.1), mt('moaiD', 0x3a362e, { roughness: 1 }), 0, 1.13, 0.36, g); mesh(box(0.74, 0.22, 0.72), st, 0, 2.28, 0, g)
    for (const x of [-0.26, 0.26]) mesh(box(0.24, 0.1, 0.06), mt('moaiD', 0x3a362e), x, 1.76, 0.37, g)
    mesh(box(1.0, 0.13, 0.78), mt('hachi', 0xf2efe6, { roughness: 0.9 }), 0, 2.13, 0, g); const kn = mesh(box(0.2, 0.08, 0.1), mt('hachi', 0xf2efe6), 0.4, 2.2, 0.36, g); kn.rotation.z = 0.5
    return { g, undo() { g.removeFromParent() } }
  },
  // お掃除ロボが通路を往復している。背中に招き猫が乗っている
  roomba: () => {
    const g = new THREE.Group(); world.add(g); g.scale.setScalar(1.35); FIX.robo = { g, spin: 0 }; g.userData.tid = 'roboA'
    mesh(cyl(0.27, 0.29, 0.1, 22), mt('roboB', 0x1c1e22, { roughness: 0.3, metalness: 0.3 }), 0, 0.06, 0, g); mesh(cyl(0.21, 0.21, 0.012, 20), mt('roboT', 0x4a4e56, { roughness: 0.25, metalness: 0.6 }), 0, 0.116, 0, g); mesh(new THREE.TorusGeometry(0.1, 0.009, 6, 18), glow(0x3affb0, 1.5), 0, 0.126, 0, g).rotation.x = Math.PI / 2
    const n = new THREE.Group(); n.position.y = 0.13; g.add(n); const wt = mt('nekoW', 0xf6f2e8, { roughness: 0.4 })
    mesh(sph(0.075, 12, 10), wt, 0, 0.07, 0, n).scale.y = 1.15; mesh(sph(0.065, 12, 10), wt, 0, 0.18, 0, n); for (const x of [-0.04, 0.04]) { const e = mesh(new THREE.ConeGeometry(0.022, 0.04, 6), wt, x, 0.245, 0, n); e.rotation.z = -x * 4 } mesh(cyl(0.05, 0.055, 0.016, 12), mt('nekoR', 0xd8201c), 0, 0.125, 0, n); const pw = mesh(sph(0.024, 8, 6), wt, 0.08, 0.17, 0.02, n); pw.scale.y = 1.3; FIX.robo.paw = pw
    FIX.robo.tick = () => { const t = S.time * 0.22, x = lerp(5, W1 - 3.5, (Math.sin(t) + 1) / 2), dir = Math.cos(t) > 0 ? 1 : -1; g.position.set(x, 0, 0.7 + Math.sin(S.time * 0.9) * 0.1); g.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2; pw.position.y = 0.17 + Math.sin(S.time * 6) * 0.018 }
    FIX.robo.tick()
    return { g, moving: true, undo() { g.removeFromParent(); FIX.robo = null } }
  },
  // お手洗いの札が占いになっている
  uranai: () => {
    const f = FIX.sign, m = f.g.material
    if (!f.odd) f.odd = canvasTex(256, 128, (x, w, h) => { x.fillStyle = '#4a1648'; x.fillRect(0, 0, w, h); x.strokeStyle = '#e9b44c'; x.lineWidth = 6; x.strokeRect(5, 5, w - 10, h - 10); x.fillStyle = '#f7e6a8'; x.font = `900 58px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('占い', w * 0.34, h * 0.42); x.font = `900 26px ${FONT}`; x.fillText('3000円', w * 0.34, h * 0.8); const c = x.createRadialGradient(w * 0.78, h * 0.42, 4, w * 0.78, h * 0.45, 34); c.addColorStop(0, '#fff'); c.addColorStop(0.5, '#9fd4ff'); c.addColorStop(1, '#2a4a90'); x.fillStyle = c; x.beginPath(); x.arc(w * 0.78, h * 0.45, 32, 0, 7); x.fill(); x.fillStyle = '#e9b44c'; x.fillRect(w * 0.78 - 26, h * 0.72, 52, 14) })
    m.map = f.odd; m.emissiveMap = f.odd; m.needsUpdate = true
    return { g: f.g, undo() { m.map = f.normal; m.emissiveMap = f.normal; m.needsUpdate = true } }
  },
  stare: () => { S.stare = true; return { g: null, multi: CUST.map(c => c.g), undo() { S.stare = false; for (const c of CUST) c.g.rotation.y = c.home } } },
}
// 当たり判定の箱（見えない）。物の周りを少し大きめに囲む
const proxies = new THREE.Group(); scene.add(proxies)
const proxMat = new THREE.MeshBasicMaterial({ visible: false })
const _bb = new THREE.Box3(), _bc = new THREE.Vector3(), _bs = new THREE.Vector3()
function addProxy(an, obj, pad = 0.12) {
  obj.updateWorldMatrix(true, true)
  _bb.makeEmpty(); obj.traverse(m => { if (m.isMesh && m.visible !== false && !m.userData.noHit && m.material && m.material.visible !== false) { let vis = true; for (let p = m; p; p = p.parent) if (p.visible === false) { vis = false; break } if (vis) _bb.expandByObject(m) } })
  if (_bb.isEmpty()) _bb.setFromObject(obj)
  _bb.getCenter(_bc); _bb.getSize(_bs)
  const sz = [Math.max(0.32, _bs.x + pad * 2), Math.max(0.32, _bs.y + pad * 2), Math.max(0.32, _bs.z + pad * 2)]
  const m = mesh(box(...sz), proxMat, _bc.x, _bc.y, _bc.z, proxies)
  m.userData.anom = an; m.userData.obj = obj; m.userData.off = _bc.clone().sub(obj.getWorldPosition(_v)); m.userData.half = Math.max(...sz) / 2
  an.prox.push(m)
}
// 異変を出す・戻す
function applyAnom(a) {
  const def = AK[a.id]
  let h
  if (def.where === 'table') { const T = TABLES[a.t]; const r = BUILD[a.id](T); h = r && r.undo ? r : { g: r.g, undo: () => unsetAlt(r) } }
  else h = FIXB[a.id](a.v || 0)
  a.h = h; a.prox = []
  scene.updateMatrixWorld(true)
  const objs = h.multi || [h.g]
  for (const o of objs) if (o) addProxy(a, o)
}
function revertAnom(a) { if (a.h) a.h.undo(); for (const m of a.prox || []) m.removeFromParent(); a.prox = []; if (a.tag) { a.tag.removeFromParent(); a.tag = null } }
// 毎晩の異変を seed から決める（同じ seed なら同じ異変・同じ卓）
function makePlan(seed) {
  const r = mulberry(seed * 7919 + 13), pick = a => a.splice(Math.floor(r() * a.length) % a.length, 1)[0]
  const rest = [...D.REST]; const counts = [...D.FIRST]
  while (rest.length) counts.push(pick(rest))
  const pool = { 1: D.ANOM.filter(a => a.lv === 1).map(a => a.id), 2: D.ANOM.filter(a => a.lv === 2).map(a => a.id), 3: D.ANOM.filter(a => a.lv === 3).map(a => a.id) }
  const want = n => n < 3 ? [1, 1, 2] : n < 5 ? [2, 1, 2] : [3, 2, 3]       // 後半ほど小さくズレた物
  return counts.map((cnt, n) => {
    const out = [], usedT = new Set()
    for (let k = 0; k < cnt; k++) {
      let id = null
      for (const lv of [want(n)[k % 3], ...want(n), 1, 2, 3]) { if (pool[lv].length) { id = pick(pool[lv]); break } }
      if (!id) break
      const a = { id, t: -1, v: Math.floor(r() * 4) }
      if (AK[id].where === 'table') { const free = [...Array(NT).keys()].filter(i => !usedT.has(i) && true); a.t = free[Math.floor(r() * free.length) % free.length]; usedT.add(a.t) }
      out.push(a)
    }
    return out
  })
}

// ---------- 吹き出し・演出文字（DOM）
const FX = []
function toScreen(p) { _w.copy(p).project(camera); return { x: (_w.x + 1) / 2 * innerWidth, y: (1 - _w.y) / 2 * innerHeight, z: _w.z } }
function ono(text, pos, cls = '', o = {}) {
  for (const f of FX) if (f.kind === 'ono') f.t = Math.max(f.t, f.life - 0.05)     // 同時に出す文字を増やさない
  const el = document.createElement('div'); el.className = 'ono ' + cls; el.textContent = text
  el.style.fontSize = (o.size ?? 30) + 'px'; $('#fx').appendChild(el)
  FX.push({ el, pos: pos.clone(), t: 0, life: o.life ?? 1.2, rise: o.rise ?? 0.6, kind: 'ono', rot: (Math.random() - 0.5) * 14 })
  S.onoT = o.life ?? 1.2
}
function bubble(c, text, cls = '', life = 1.6) {
  if (!c) return
  if (c.bub) { c.bub.remove(); const i = FX.findIndex(f => f.el === c.bub); if (i >= 0) FX.splice(i, 1) }
  const el = document.createElement('div'); el.className = 'sb ' + cls; el.textContent = text; $('#fx').appendChild(el)
  c.bub = el; FX.push({ el, c, t: 0, life, kind: 'sb' }); return el
}
function clearFx() { for (const f of FX) f.el.remove(); FX.length = 0; if (BOSS.c) BOSS.c.bub = null; S.onoT = 0 }
function updateFx(dt) {
  const top = 52, bot = innerHeight - 12
  for (let i = FX.length - 1; i >= 0; i--) {
    const f = FX[i]; f.t += dt
    if (f.t >= f.life) { f.el.remove(); FX.splice(i, 1); if (f.c && f.c.bub === f.el) f.c.bub = null; continue }
    const k = f.t / f.life
    if (f.kind === 'ono') {
      const s = toScreen(_w.copy(f.pos).add(_q.set(0, f.rise * ease(k * 2), 0)))
      if (s.z > 1) { f.el.style.opacity = 0; continue }
      const sc = k < 0.12 ? 0.4 + k / 0.12 * 0.8 : 1.2 - Math.min(0.2, (k - 0.12) * 2)
      const w = f.el.offsetWidth, x = clamp(s.x, w / 2 + 8, innerWidth - w / 2 - 8), y = clamp(s.y - 20, top, bot - 60)
      f.el.style.transform = `translate(${x - w / 2}px,${y}px) rotate(${f.rot}deg) scale(${sc})`; f.el.style.opacity = k > 0.75 ? (1 - k) / 0.25 : 1
    } else {
      const s = toScreen(headPos(f.c, _hp)), w = f.el.offsetWidth, h = f.el.offsetHeight
      let x = clamp(s.x - w / 2, 8, innerWidth - w - 8), y = clamp(s.y - h - 10, top, bot - h - 120)
      if (s.z > 1 || s.y < 0) { x = (innerWidth - w) / 2; y = innerHeight < 561 && innerWidth > innerHeight ? top : top + 100 }
      const sc = f.t < 0.12 ? 0.5 + f.t / 0.12 * 0.5 : 1
      f.el.style.transform = `translate(${x}px,${y}px) scale(${sc})`; f.el.style.opacity = k > 0.88 ? (1 - k) / 0.12 : 1
    }
  }
}
function bossSay(text, life = 1.8) {
  if (!BOSS.c) return
  const odd = S.weird >= 7
  bubble(BOSS.c, text, 'boss' + (odd ? ' odd' : ''), life); Snd.sfx(odd ? 'bossOdd' : 'boss')
}

// ---------- 通報の札（文字ではなく赤い札の印）
const tagMat = new THREE.SpriteMaterial({ map: canvasTex(128, 160, (x, w, h) => { x.fillStyle = '#c8372d'; x.beginPath(); x.moveTo(20, 30); x.lineTo(64, 6); x.lineTo(108, 30); x.lineTo(108, 150); x.lineTo(20, 150); x.closePath(); x.fill(); x.strokeStyle = '#16131a'; x.lineWidth = 8; x.stroke(); x.fillStyle = '#16131a'; x.beginPath(); x.arc(64, 34, 9, 0, 7); x.fill(); x.fillStyle = '#fff'; x.fillRect(56, 60, 16, 52); x.beginPath(); x.arc(64, 130, 9, 0, 7); x.fill() }), depthTest: false, toneMapped: false, fog: false })
function placeTag(a, p) { const sp = new THREE.Sprite(tagMat); sp.scale.set(0.32, 0.4, 1); sp.renderOrder = 9; sp.position.copy(p); scene.add(sp); a.tag = sp; fx.burst(p, { color: 0xff5a4e, count: 24, speed: 1.4, life: 0.5, size: 0.1 }) }

// ---------- 見回りの進行
function nightAnoms() { return S.act }
function proxyCenter(m, out) { const o = m.userData.obj; o.getWorldPosition(out); return out.add(m.userData.off) }
function startNight(n) {
  for (const a of S.act) revertAnom(a)
  S.night = n; S.act = (S.plan[n] || []).map(a => ({ ...a })); S.found = new Set(); S.wrongIds = new Set(); S.wrongN = 0
  for (const a of S.act) applyAnom(a)
  Object.assign(S, { x: START_X, v: 0, dir: 1, face: Math.PI / 2, yaw: 0, pitch: 0, phase: 'walk', phT: 0, visited: false, leftHome: false, saidFar: false, stepD: 0, judged: false, fading: false, switched: false })
  camInit = false; clearFx(); $('#card').hidden = true; updateTags()
  const T = TT(), w = S.weird, line = T.nightStart[w >= 7 ? 3 : w >= 4 ? 2 : n === 0 ? 0 : 1]
  setTimeout(() => { if (S.mode === 'play' && S.night === n) bossSay(line, 2.0) }, 500)
  setClock()
}
function setClock() { $('#hClock').textContent = TT().clock.replace('{H}', String((D.HOUR0 + S.night) % 24).padStart(2, '0')) }
function updateTags() { const n = S.found.size; $('#hTags').hidden = !n; $('#hTagN').textContent = n }
// 画面上の点から通報する
const ray = new THREE.Raycaster(), _nd = new THREE.Vector2()
ray.camera = camera
function hitRoots() { return [world, people, proxies] }
function tapAt(px, py) {
  if (S.mode !== 'play' || S.phase !== 'walk') return null
  Snd.init(); scene.updateMatrixWorld()
  _nd.set(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1)
  ray.setFromCamera(_nd, camera); ray.far = 40
  const hits = ray.intersectObjects(hitRoots(), true).filter(h => !h.object.isSprite && !h.object.userData.noHit && isVisible(h.object))
  const env = hits.find(h => !h.object.userData.anom), dEnv = env ? env.distance : Infinity
  // 霧の奥（13m より先）は見えていないので数えない
  let cand = hits.filter(h => h.object.userData.anom && h.distance <= dEnv + 0.05 && h.distance < MAXD).map(h => h.object)
  if (!cand.length) {
    // 小さい物は指の太さぶん甘く取る（画面上で32px以内・手前に壁がない）
    for (const a of S.act) for (const m of a.prox) {
      const c = proxyCenter(m, _v.set(0, 0, 0)), s = toScreen(c); if (s.z > 1) continue
      const d = Math.hypot(s.x - px, s.y - py); if (d > 32) continue
      const dist = camera.position.distanceTo(c); if ((dist > dEnv + m.userData.half + 0.2 && env) || dist > MAXD) continue
      cand.push(m)
    }
  }
  const pos = env ? env.point.clone() : ray.ray.at(6, new THREE.Vector3())
  if (cand.length) {
    const fresh = cand.find(m => !S.found.has(m.userData.anom.id))
    if (!fresh) { ono(TT().again, pos, 'yel', { size: 22, life: 0.9 }); Snd.sfx('again'); return { kind: 'again' } }
    const a = fresh.userData.anom; S.found.add(a.id)
    const c = proxyCenter(fresh, new THREE.Vector3()); placeTag(a, c.clone().add(_q.set(0, fresh.userData.half * 0.6 + 0.15, 0)))
    ono(TT().found, c, 'red', { size: 34 }); Snd.sfx('found'); fx.shake(0.02, 0.2)
    if (!S.photo) S.doCap = true
    updateTags(); S.tutTapDone = true
    return { kind: 'found', id: a.id }
  }
  // お手つき。同じ物を何度押しても1回だけ数える
  let tid = 'void'
  if (env) { for (let o = env.object; o; o = o.parent) if (o.userData.tid) { tid = o.userData.tid; break } if (tid === 'void') tid = env.object.uuid }
  if (S.wrongIds.has(tid)) { ono('…', pos, '', { size: 24, life: 0.7 }); return { kind: 'dup', tid } }
  S.wrongIds.add(tid); S.wrongN++
  ono(TT().wrong, pos, '', { size: 28 }); Snd.sfx('wrong'); fx.shake(0.012, 0.15)
  return { kind: 'wrong', tid }
}
function isVisible(o) { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true }

function updateWalk(dt) {
  const fwd = S.inF || S.keyF, bk = S.inB || S.keyB
  const tv = fwd ? WALK : bk ? -BACKV : 0
  S.v += clamp(tv - S.v, -ACC * dt, ACC * dt)
  const nx = clamp(S.x + S.v * S.dir * dt, XMIN, XMAX); if (nx === S.x && S.v !== 0 && (nx === XMIN || nx === XMAX)) S.v = 0
  S.stepD += Math.abs(nx - S.x); if (S.stepD > 0.72) { S.stepD = 0; Snd.sfx('step') }
  S.x = nx
  // 見回す（ボタン・キー）
  const lv = (S.lookR || S.keyR ? 1 : 0) - (S.lookL || S.keyL ? 1 : 0)
  if (lv) { S.yaw = clamp(S.yaw + lv * 1.7 * dt, -1.45, 1.45); S.lookIdle = 0; S.looked = 1 }
  else { S.lookIdle += dt; if (Math.abs(S.v) > 0.5 && S.lookIdle > 2.5 && !drag.on) { S.yaw *= 1 - dt * 0.8; S.pitch *= 1 - dt * 0.8 } }
  if (!S.leftHome && S.x > HOME_X + 2) S.leftHome = true
  if (!S.visited && S.x > FAR_X) { S.visited = true; Snd.sfx('arrive') }
  if (S.x < HOME_X) {
    if (S.visited) { S.phase = 'report'; S.phT = 0; S.v = 0; S.inF = S.inB = S.keyF = S.keyB = 0; bossSay(TT().askReport, 1.0) }
    else if (S.leftHome && !S.saidFar) { S.saidFar = true; bossSay(TT().goFar, 2.2) }
  }
  // 異変の近さ（音のずれ）
  let near = 0
  for (const a of S.act) { if (S.found.has(a.id)) continue; for (const m of a.prox) { const c = proxyCenter(m, _v.set(0, 0, 0)); const d = Math.hypot(c.x - S.x, c.z); near = Math.max(near, clamp(1 - (d - 1.5) / 4.5, 0, 1)) } }
  S.near = near; Snd.setNear(near)
}
function judgeNight() {
  const T = TT(), total = S.act.length, found = S.act.filter(a => S.found.has(a.id)).length, miss = total - found, wrong = S.wrongN
  const missed = S.act.filter(a => !S.found.has(a.id))
  S.tot.found += found; S.tot.miss += miss; S.tot.wrong += wrong; S.tot.total += total
  S.weird += miss + wrong
  S.log.push({ night: S.night, total, found, miss, wrong, ids: S.act.map(a => a.id), missed: missed.map(a => a.id) })
  const ok = !miss && !wrong
  const judge = ok ? T.ok : miss ? T.missT : T.wrongT
  const line = ok ? (total ? T.foundN.replace('{F}', found).replace('{N}', total) : T.okNone) : miss ? T.missOne.replace('{A}', AK[missed[0].id][S.lang]) + (miss > 1 ? (S.lang === 'ja' ? ` ほか${miss - 1}` : ` +${miss - 1}`) : '') : T.wrongN.replace('{W}', wrong)
  $('#cJudge').textContent = judge; $('#cJudge').className = 'judge ' + (ok ? 'ok' : 'bad'); $('#cLine').textContent = line
  $('#card').hidden = false; clearFx(); Snd.sfx(ok ? 'ok' : 'bad')
  // 見逃した物に札の代わりに光を当てて見せる
  for (const a of missed) for (const m of a.prox) fx.burst(proxyCenter(m, new THREE.Vector3()), { color: 0xffe080, count: 16, speed: 0.8, life: 0.8 })
  return { ok, total, found, miss, wrong }
}
function updateReport(dt) {
  S.phT += dt
  if (S.phT > 1.0 && $('#card').hidden && !S.judged) { S.judged = true; judgeNight() }
  if (S.phT > 3.8 && !S.fading) {
    S.fading = true; const last = S.night >= D.NIGHTS - 1, T = TT()
    $('#fBig').textContent = last ? T.dawn : T.clock.replace('{H}', String((D.HOUR0 + S.night + 1) % 24).padStart(2, '0'))
    $('#fSub').textContent = last ? T.dawnSub : ''; $('#fade').classList.add('on'); $('#card').hidden = true; Snd.sfx(last ? 'dawn' : 'night')
  }
  if (S.phT > 5.2 && !S.switched) {
    S.switched = true
    if (S.night >= D.NIGHTS - 1) { toResult(); return }
    startNight(S.night + 1)
    setTimeout(() => $('#fade').classList.remove('on'), 120)
  }
}
function updateGame(dt) {
  if (S.mode !== 'play') return
  if (S.phase === 'walk') updateWalk(dt)
  else if (S.phase === 'report') { S.v = 0; updateReport(dt) }
}

// ---------- チュートリアル（最初の1回だけ）
function updateTutorial() {
  const h = $('#hint'), fg = $('#finger')
  let txt = null, el = null, pt = null
  if (S.mode === 'play' && S.phase === 'walk' && S.tut >= 0 && !(S.onoT > 0)) {
    const T = TT()
    if (S.night === 0) {
      if (S.x < 4.5 && !S.visited) { txt = isTouch ? T.tutGo : T.tutGoPC; el = '#bFwd' }
      else if (!S.looked && !S.visited && S.x < 14) txt = isTouch ? T.tutLook : T.tutLookPC
      else if (!S.visited && S.x < FAR_X - 4) txt = T.tutNormal
      else if (S.visited && S.dir > 0) { txt = isTouch ? T.tutTurn : T.tutTurnPC; el = '#bTurn' }
      else if (S.visited) txt = T.tutBack
    } else if (S.night === 1 && !S.tutTapDone) {
      const v = visibleAnom(); if (v) { txt = isTouch ? T.tutTap : T.tutTapPC; pt = v }
    }
  }
  if (S.mode === 'play' && S.night >= 2 && S.tut >= 0) { S.tut = -1; store.set('tut', '1') }
  h.hidden = !txt || !$('#card').hidden; if (txt && h.textContent !== txt) h.textContent = txt
  if (pt) { fg.hidden = false; fg.style.transform = `translate(${pt.x - 14}px,${pt.y - 4}px)` }
  else if (el && isTouch) { const r = $(el).getBoundingClientRect(); fg.hidden = false; fg.style.transform = `translate(${r.left + r.width / 2 - 14}px,${r.top - 46}px)` } else fg.hidden = true
}
// 画面に映っていて、手前に壁がない異変（チュートリアルと自動プレイで使う）
function visibleAnom(maxD = 10) {
  scene.updateMatrixWorld()
  for (const a of S.act) {
    if (S.found.has(a.id)) continue
    for (const m of a.prox) {
      const c = proxyCenter(m, new THREE.Vector3()), s = toScreen(c)
      if (s.z > 1 || s.x < 20 || s.x > innerWidth - 20 || s.y < 60 || s.y > innerHeight - 120) continue
      const d = camera.position.distanceTo(c); if (d > maxD) continue
      ray.set(camera.position, c.clone().sub(camera.position).normalize()); ray.far = d
      const hit = ray.intersectObjects([world, people], true).find(h => !h.object.isSprite && !h.object.userData.noHit && isVisible(h.object))
      if (hit && hit.distance < d - m.userData.half - 0.05) continue
      return { x: s.x, y: s.y, id: a.id, d }
    }
  }
  return null
}

// ---------- 場面
const _cp = new THREE.Vector3(), _cl = new THREE.Vector3(), camP = new THREE.Vector3(), camL = new THREE.Vector3()
let camFace = Math.PI / 2, camInit = false
const BASE_PITCH = -0.24
function camBase(face) {
  const portrait = innerWidth / innerHeight < 1
  const fx_ = Math.sin(face), fz_ = Math.cos(face), rx = -fz_, rz = fx_
  // 横を向くほど主人公の肩ごしに寄って覗き込む（卓の上の小さな物が見える）
  const k = ease(clamp((Math.abs(S.yaw) - 0.35) / 0.65, 0, 1))
  const dist = lerp(portrait ? 3.1 : 2.9, 1.0, k), h = lerp(portrait ? 2.85 : 2.4, 2.0, k), side = lerp(portrait ? 0.6 : 0.7, Math.sign(S.yaw) * 0.55, k)
  return { pos: new THREE.Vector3(S.x - fx_ * dist + rx * side, h, -fz_ * dist + rz * side), f: [fx_, fz_], r: [rx, rz] }
}
function lookDir(face, yaw, pitch) { const a = face + yaw * -1, p = BASE_PITCH + pitch; return new THREE.Vector3(Math.sin(a + 0) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)) }
function frameCamera(dt = 1) {
  const a = innerWidth / innerHeight, portrait = a < 1
  camera.aspect = a; camera.fov = portrait ? 74 : a > 1.9 ? 52 : 58
  const snap = dt >= 1 || !camInit; camInit = true
  if (S.mode === 'title') {
    _cp.set(-0.6, 2.6, portrait ? 0.3 : 0.8); _cl.set(9, 0.9, 0)
  } else {
    let d = S.face - camFace; d = Math.atan2(Math.sin(d), Math.cos(d))
    camFace = snap ? S.face : camFace + d * clamp(dt * 6, 0, 1)
    const b = camBase(camFace)
    _cp.copy(b.pos); _cl.copy(_cp).addScaledVector(lookDir(camFace, S.yaw, S.pitch), 8)
  }
  _cp.x = clamp(_cp.x, W0 + 0.4, W1 - 0.4); _cp.z = clamp(_cp.z, -WALL_Z + 0.4, WALL_Z - 0.4)
  if (snap) { camP.copy(_cp); camL.copy(_cl) } else { const k = clamp(dt * 10, 0, 1); camP.lerp(_cp, k); camL.lerp(_cl, k) }
  camera.position.copy(camP); camera.lookAt(camL); camera.updateProjectionMatrix(); camera.updateMatrixWorld()
}
// 目標の点に視線を向ける（自動プレイ・検証用）
function aimAt(p) {
  for (let it = 0; it < 4; it++) {
    const b = camBase(S.face), v = p.clone().sub(b.pos)
    const fwd = v.x * b.f[0] + v.z * b.f[1], rgt = v.x * b.r[0] + v.z * b.r[1]
    S.yaw = clamp(Math.atan2(rgt, fwd), -1.45, 1.45)
    S.pitch = clamp(Math.atan2(v.y, Math.hypot(fwd, rgt)) - BASE_PITCH, -0.6, 0.5)
  }
  camFace = S.face; camInit = false
}
function updateScene(dt) {
  S.time += dt; if (S.onoT > 0) S.onoT -= dt
  S.face = lerp(S.face, S.dir > 0 ? Math.PI / 2 : -Math.PI / 2, clamp(dt * 9, 0, 1))
  P.g.position.set(S.x, 0, 0); P.g.rotation.y = S.face
  const adt = S.noFlicker ? 0 : dt
  if (P.c) { const mv = Math.abs(S.v) > 0.15; play(P.c, mv ? 'walk' : 'idle'); if (P.c.acts.walk) P.c.acts.walk.timeScale = mv ? Math.sign(S.v) * Math.max(0.6, Math.abs(S.v) / 2) : 1; P.c.mixer.update(adt) }
  for (const c of CUST) {
    c.mixer.update(adt)
    if (S.stare) { const ty = Math.atan2(S.x - c.g.position.x, -c.g.position.z); let d = ty - c.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); c.g.rotation.y += d * clamp(dt * 3, 0, 1) }
  }
  if (BOSS.c) {
    BOSS.c.mixer.update(adt); BOSS.c.g.rotation.y = lerp(BOSS.c.g.rotation.y, Math.atan2(S.x - BOSS.c.g.position.x, -BOSS.c.g.position.z), 0.05)
    // 見逃し・お手つきが増えるほど店長がおかしくなる（背が伸び、首が傾く）
    const w = Math.min(S.weird, 12); BOSS.c.g.scale.y = BOSS.c.g.scale.x * (1 + w * 0.035); if (BOSS.c.head) BOSS.c.head.rotation.z = Math.sin(S.time * (w > 6 ? 9 : 0.8)) * 0.02 * w + w * 0.04
  }
  // 一輪車が勝手に走る
  const U = FIX.uni
  if (U.run) { const t = S.time * 0.7; U.g.position.set(U.x0 + Math.sin(t) * 1.7, 0, 0.35); U.g.rotation.set(0, Math.cos(t) > 0 ? Math.PI / 2 : -Math.PI / 2, Math.sin(S.time * 5) * 0.06); U.wh.rotation.z = -Math.sin(t) * 1.7 / 0.36 }
  if (FIX.robo) FIX.robo.tick()
  // 動く異変は当たり判定の箱も一緒に動かす（止まったままだと何も無い所で「異変あり」になる）
  for (const a of S.act) if (a.h && a.h.moving) for (const m of a.prox) proxyCenter(m, m.position)
  if (FIX.xmasG) FIX.xmasG.userData.bulbs.forEach((m, k) => { m.emissiveIntensity = (Math.floor(S.time * 3) + k) % 3 ? 1.6 : 0.2 })
  for (const g of lanterns.list) { g.rotation.z = Math.sin(S.time * 1.3 + g.position.x) * 0.04; if (g.userData.flick) g.userData.flick.emissiveIntensity = (Math.sin(S.time * 23 + g.position.x) > 0.6 || Math.sin(S.time * 1.7) > 0.3) ? 0.5 : 0.03 }
  for (const L of lights) {
    const t = (S.noFlicker ? 0 : S.time) + L.ph, buzz = L.bad ? (Math.sin(t * 31) > 0.2 && Math.sin(t * 2.3) > -0.5 ? 1 : 0.06) : (Math.sin(t * 47) > 0.97 ? 0.4 : 1)
    L.pl.intensity = L.base * buzz; if (L.bad) L.tm.emissiveIntensity = 1.1 * buzz
  }
  // 当たり判定の箱は物について動く
  for (const a of S.act) for (const m of a.prox) proxyCenter(m, m.position)
  frameCamera(dt)
  // 懐中電灯は見ている方へ
  const ld = lookDir(camFace, S.yaw, S.pitch + 0.05)
  flash.position.set(S.x, 1.35, 0).addScaledVector(_q.set(Math.sin(S.face), 0, Math.cos(S.face)), 0.25)
  flash.target.position.copy(flash.position).addScaledVector(ld, 7); flash.target.updateMatrixWorld()
  lamp.position.set(S.x + Math.sin(S.face) * 1.2, 1.6, 0)
  zoneFar.visible = !!(S.mode === 'play' && !S.visited); zoneHome.visible = !!(S.mode === 'play' && S.visited)
  zoneFar.material = S.x > FAR_X ? ZM.in : ZM.far; zoneHome.material = S.x < HOME_X ? ZM.in : ZM.far
}

// ---------- 画面の切り替え
const views = ['vTitle', 'vHow', 'vPlay', 'vResult']
function show(id) { for (const v of views) $('#' + v).hidden = v !== id; $('#moreBox').hidden = true }
function applyLang() {
  const T = TT()
  document.documentElement.lang = S.lang
  for (const el of document.querySelectorAll('[data-t]')) el.innerHTML = T[el.dataset.t]
  $('#langTxt').textContent = S.lang === 'ja' ? 'EN' : 'JA'
  $('#bMoreX').setAttribute('aria-label', T.close)
  if (S.mode === 'play') setClock()
  if (S.mode === 'result') drawSlip(S.stamped ? 1 : 0)
  if (!$('#moreBox').hidden) fillMore()
}
function resetRun(seed) {
  S.seed = seed ?? (Math.floor(Math.random() * 1e9) + 1)
  for (const a of S.act) revertAnom(a); S.act = []
  S.plan = makePlan(S.seed)
  Object.assign(S, { tot: { found: 0, miss: 0, wrong: 0, total: 0 }, weird: 0, log: [], result: null, photo: null, tutTapDone: false, judged: false, fading: false, switched: false })
  $('#fade').classList.remove('on'); $('#card').hidden = true
}
function startRun(seed) {
  Snd.init(); Snd.sfx('tap')
  resetRun(seed)
  S.mode = 'play'; show('vPlay'); Snd.setTrack('play'); Snd.ambient(true)
  startNight(0)
}
function toTitle() { Snd.sfx('tap'); resetRun(); S.mode = 'title'; S.x = 2.6; S.dir = 1; S.yaw = S.pitch = 0; show('vTitle'); Snd.setTrack('title'); Snd.ambient(false); clearFx(); camInit = false }

// ---------- 結果（給料明細）
function calcResult() {
  const T = TT(), Y = D.PAY, t = S.tot
  const slip = {
    lang: S.lang, no: 1, job: T.job, date: (d => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`)(new Date()), wage: Y.wage, hours: Y.hours,
    series: T.series, name: T.who,
    pay: [{ label: T.pFound, note: T.pFoundN.replace('{N}', t.found), yen: t.found * Y.found }],
    ded: [{ label: T.dMiss, note: T.dMissN.replace('{N}', t.miss), yen: t.miss * Y.miss }, { label: T.dWrong, note: T.dWrongN.replace('{N}', t.wrong), yen: t.wrong * Y.wrong }],
    boss: T.bossName, footer: T.footer,
  }
  const net = totals(slip).net
  const rank = t.found === 0 ? D.RANKS[0] : [...D.RANKS].reverse().find(r => net >= r.min)
  slip.comment = rank.cmt[S.lang]; slip.stamp = rank.st[S.lang]
  return { slip, net, rank, tot: { ...t } }
}
const slipTheme = { main: '#3a1f3a', dark: '#16131a', accent: '#c8372d', bg: '#0b0a0d' }
function drawSlip(k = 1) { const r = S.result; if (!r) return; const fresh = calcResult(); r.slip = fresh.slip; drawPayslip($('#slip'), { ...r.slip, photo: S.photo, stampK: k }, slipTheme) }
async function toResult() {
  S.mode = 'resultWait'; S.result = calcResult(); S.resT = 0; S.stamped = false
  for (const a of S.act) revertAnom(a); S.act = []
  for (const id of ['#rBtns1', '#rBtns2', '#bMore']) $(id).classList.remove('on')
  try { await document.fonts.ready } catch (e) {}
  S.mode = 'result'; drawSlip(0); show('vResult'); clearFx(); fitSlip(); Snd.setTrack('end'); Snd.ambient(false)
  setTimeout(() => $('#fade').classList.remove('on'), 150)
}
function fitSlip() {
  const c = $('#slip'); if ($('#vResult').hidden) return
  c.style.width = c.style.height = '0px'
  const bx = c.parentElement.getBoundingClientRect(), side = $('.resSide').getBoundingClientRect()
  const row = getComputedStyle(c.parentElement).flexDirection === 'row'
  const aw = row ? bx.width - side.width - 14 : bx.width, ah = row ? bx.height : bx.height - side.height - 8
  const k = Math.max(0.05, Math.min(aw / 1080, ah / 1350))
  c.style.width = Math.floor(1080 * k) + 'px'; c.style.height = Math.floor(1350 * k) + 'px'
}
function updateReveal(dt) {
  if (S.mode !== 'result') return
  S.resT += dt
  if (S.resT > 0.6 && S.resT < 1.0) drawSlip(clamp((S.resT - 0.6) / 0.35, 0, 1))
  if (S.resT >= 1.0 && !S.stamped) { S.stamped = true; drawSlip(1); Snd.sfx('stamp') }
  if (S.resT > 1.3) for (const id of ['#rBtns1', '#rBtns2', '#bMore']) $(id).classList.add('on')
}
function finishReveal() { if (S.mode === 'result' && S.resT < 1.3) { S.resT = 1.29; updateReveal(0.02) } }
async function saveCard() {
  Snd.sfx('tap'); finishReveal()
  try { await document.fonts.ready } catch (e) {}
  const a = document.createElement('a'); a.href = $('#slip').toDataURL('image/png'); a.download = `izakaya-ihen-${S.tot.found}.png`; document.body.appendChild(a); a.click(); a.remove()
}
function shareText() { const r = S.result, T = TT(); return T.share.replace('{F}', r.tot.found).replace('{S}', r.rank.st[S.lang].replace('\n', '')) }
function xPost() { const text = shareText(); return { text, url: D.PUBLIC_URL, href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(D.PUBLIC_URL)}` } }
function openX() { if (!S.result) return; Snd.sfx('tap'); window.open(xPost().href, '_blank', 'noopener') }
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
function fillMore() { const L = S.lang; $('#moreL').innerHTML = D.others.map(g => `<a href="${esc(g.url)}" target="_blank" rel="noopener"><img src="${esc(g.url)}og.png" alt="" width="1200" height="630" decoding="async" onerror="this.style.visibility='hidden'"><b>${esc(g[L])}</b><span>${esc(L === 'ja' ? g.dj : g.de)}</span></a>`).join('') }
function openMore() { Snd.init(); Snd.sfx('tap'); fillMore(); $('#moreBox').hidden = false }
function closeMore() { if ($('#moreBox').hidden) return; $('#moreBox').hidden = true; Snd.sfx('tap') }
// 写真（明細に貼る。最初に見つけた異変の瞬間）
const photoC = document.createElement('canvas'); photoC.width = photoC.height = 300
function capturePhoto() { try { const W = canvas.width, H = canvas.height, s = Math.min(W, H) * 0.8; photoC.getContext('2d').drawImage(canvas, (W - s) / 2, (H - s) / 2 - H * 0.05, s, s, 0, 0, 300, 300); S.photo = photoC } catch (e) {} }

// ---------- 入力
function holdBtn(id, key) {
  const b = $(id)
  const on = e => { e.preventDefault(); Snd.init(); S[key] = 1; b.classList.add('on'); try { b.setPointerCapture(e.pointerId) } catch (er) {} }
  const off = () => { S[key] = 0; b.classList.remove('on') }
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off)
}
// 歩くのは押している間だけ
holdBtn('#bFwd', 'inF'); holdBtn('#bBack', 'inB'); holdBtn('#bLookL', 'lookL'); holdBtn('#bLookR', 'lookR')
function turnAround() { if (S.mode !== 'play' || S.phase !== 'walk') return; S.dir *= -1; S.yaw = 0; S.pitch = 0; S.v = 0; Snd.sfx('turn') }
$('#bTurn').addEventListener('pointerdown', e => { e.preventDefault(); Snd.init(); turnAround() })
// 画面: なぞると見回す / 軽く触ると通報（12px・0.4秒で分ける）
const drag = { on: false, id: null, x0: 0, y0: 0, x: 0, y: 0, t0: 0, moved: false }
canvas.addEventListener('pointerdown', e => {
  if (S.mode !== 'play') return; e.preventDefault(); Snd.init()
  if (drag.on) return
  Object.assign(drag, { on: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false })
  try { canvas.setPointerCapture(e.pointerId) } catch (er) {}
})
canvas.addEventListener('pointermove', e => {
  if (!drag.on || e.pointerId !== drag.id) return
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 12) drag.moved = true
  if (drag.moved && S.phase === 'walk') { const k = 2.6 / Math.max(320, Math.min(innerWidth, innerHeight)); S.yaw = clamp(S.yaw + dx * k, -1.45, 1.45); S.pitch = clamp(S.pitch - dy * k * 0.7, -0.45, 0.4); S.lookIdle = 0; S.looked = 1 }
  drag.x = e.clientX; drag.y = e.clientY
})
const endDrag = e => {
  if (!drag.on || e.pointerId !== drag.id) return
  const quick = performance.now() - drag.t0 < 400
  if (!drag.moved && quick && e.type === 'pointerup') tapAt(drag.x0, drag.y0)
  drag.on = false
}
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag)
addEventListener('keydown', e => {
  if (S.mode !== 'play') { if ((e.key === 'Enter' || e.key === ' ') && S.mode === 'title' && document.activeElement === document.body) { e.preventDefault(); startRun() } return }
  const k = e.key
  if (k === 'ArrowUp' || k === 'w' || k === 'W') { S.keyF = 1; e.preventDefault() }
  else if (k === 'ArrowDown' || k === 's' || k === 'S') { S.keyB = 1; e.preventDefault() }
  else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { S.keyL = 1; e.preventDefault() }
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') { S.keyR = 1; e.preventDefault() }
  else if ((k === ' ' || k === 'r' || k === 'R') && !e.repeat) { turnAround(); e.preventDefault() }
})
addEventListener('keyup', e => { const k = e.key; if (k === 'ArrowUp' || k === 'w' || k === 'W') S.keyF = 0; if (k === 'ArrowDown' || k === 's' || k === 'S') S.keyB = 0; if (k === 'ArrowLeft' || k === 'a' || k === 'A') S.keyL = 0; if (k === 'ArrowRight' || k === 'd' || k === 'D') S.keyR = 0 })
const releaseAll = () => { S.keyF = S.keyB = S.inF = S.inB = S.keyL = S.keyR = S.lookL = S.lookR = 0; drag.on = false }
addEventListener('blur', releaseAll)

// ---------- ループ（固定60Hz）
function render() { look.update(); fx.applyCamera(); renderer.render(scene, camera); if (S.doCap) { S.doCap = false; capturePhoto() } }
let acc = 0, lastT = performance.now()
function step() {
  const vdt = fx.update(STEP)
  if (vdt > 0) updateGame(STEP)
  if (S.mode === 'title') { S.x = 2.6 + Math.sin(S.time * 0.3) * 0.2; S.v = 0; S.yaw = Math.sin(S.time * 0.4) * 0.3 }
  updateScene(STEP); updateFx(STEP); updateReveal(STEP); updateTutorial()
}
function loop() {
  requestAnimationFrame(loop)
  const now = performance.now(); const dt = (now - lastT) / 1000; lastT = now
  if (S.dbgPause) { Snd.tick(); render(); return }
  acc += Math.min(dt, 0.25)
  let n = 0; while (acc >= STEP && n < 8) { step(); acc -= STEP; n++ }
  if (n === 8) acc = 0
  Snd.tick(); render()
}
function syncMute() { $('#icOn').hidden = Snd.muted; $('#icOff').hidden = !Snd.muted }
function resize() { renderer.setPixelRatio(lowRes()); renderer.setSize(innerWidth, innerHeight, false); frameCamera(); fitSlip() }

// ---------- 起動
applyLang(); syncMute(); resize(); S.x = 2.6
addEventListener('resize', resize)
$('#bStart').onclick = () => startRun()
$('#bHow').onclick = () => { Snd.init(); Snd.sfx('tap'); show('vHow') }
$('#bHowBack').onclick = () => { Snd.sfx('tap'); show('vTitle') }
$('#bAgain').onclick = () => startRun()
$('#bTitle').onclick = () => toTitle()
$('#bSave').onclick = saveCard
$('#bX').onclick = openX
$('#bMore').onclick = openMore; $('#bMoreT').onclick = openMore; $('#bMoreX').onclick = closeMore
$('#moreBox').addEventListener('click', e => { if (e.target === e.currentTarget) closeMore() })
addEventListener('keydown', e => { if (e.key === 'Escape') closeMore() })
$('#vResult').addEventListener('pointerdown', e => { if (!e.target.closest('button')) finishReveal() })
$('#bLang').onclick = () => { Snd.init(); S.lang = S.lang === 'ja' ? 'en' : 'ja'; store.set('lang', S.lang); applyLang(); Snd.sfx('tap') }
$('#bMute').onclick = () => { Snd.init(); Snd.setMute(!Snd.muted); syncMute() }
document.addEventListener('visibilitychange', () => { if (Snd.ctx) { if (document.hidden) Snd.ctx.suspend(); else Snd.ctx.resume() } releaseAll() })
show('vTitle'); Snd.setTrack('title')
requestAnimationFrame(loop)
loadChars().then(() => { $('#loading').hidden = true; setupPlayer(); setupCustomers(); setupBoss() })

// ---------- 検証用の窓口
window.IH = {
  S, Snd, D, camera, toScreen, xPost, calcResult, makePlan, TABLES, CUST, FIX,
  get charsReady() { return charsReady && !!P.c },
  dbg: {
    pause(b = true) { S.dbgPause = b },
    step(n = 1) { for (let i = 0; i < n; i++) step(); render() },
    tick(n = 1) { for (let i = 0; i < n; i++) step() },
    start(seed) { S.dbgPause = false; startRun(seed) },
    set(o) { Object.assign(S, o); if ('dir' in o) S.face = S.dir > 0 ? Math.PI / 2 : -Math.PI / 2; camInit = false },
    tap(x, y) { return tapAt(x, y) },
    // 異変を直接出す（撮影・判定の検証用）。list = [{id, t, v}]
    only(list) { for (const a of S.act) revertAnom(a); S.act = list.map(a => ({ t: -1, v: 0, ...a })); S.found = new Set(); S.wrongIds = new Set(); S.wrongN = 0; for (const a of S.act) applyAnom(a); updateTags() },
    plan() { return S.plan.map(n => n.map(a => a.id + (a.t >= 0 ? '@' + a.t : '') + ':' + a.v)) },
    // 異変が見える位置に立って視線を向ける
    view(id, back = 3.2) {
      const a = S.act.find(a => a.id === id); if (!a) return null
      const c = proxyCenter(a.prox[0], new THREE.Vector3())
      const fromFront = c.x > 3.4
      S.dir = fromFront ? 1 : -1; S.face = S.dir > 0 ? Math.PI / 2 : -Math.PI / 2
      S.x = clamp(fromFront ? c.x - back : Math.max(c.x + back + 1.5, 4.5), XMIN, XMAX); aimAt(c); updateScene(0); frameCamera(1); updateScene(0)
      return this.screen(id)
    },
    aim(id) { const a = S.act.find(a => a.id === id); if (!a) return null; aimAt(proxyCenter(a.prox[0], new THREE.Vector3())); updateScene(0); frameCamera(1); return this.screen(id) },
    screen(id) { const a = S.act.find(a => a.id === id); if (!a) return null; const c = proxyCenter(a.prox[0], new THREE.Vector3()); const s = toScreen(c); return { x: s.x, y: s.y, z: s.z, d: camera.position.distanceTo(c) } },
    visible() { return visibleAnom() },
    snap() { camInit = false; updateScene(0); frameCamera(1); updateScene(0) },
    render() { render() },
    // 描画を2Dキャンバスに写して返す（preserveDrawingBuffer なしでも同じタスクで読む）
    grab(w = 240) { render(); const h = Math.round(w * canvas.height / canvas.width), c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(canvas, 0, 0, w, h); return c },
    finishNight() { S.visited = true; S.x = HOME_X - 0.1; },
    toResult() { toResult() },
    reveal() { finishReveal() },
    photo() { return !!S.photo },
  },
  state() {
    return {
      mode: S.mode, phase: S.phase, night: S.night, x: +S.x.toFixed(2), v: +S.v.toFixed(2), dir: S.dir, yaw: +S.yaw.toFixed(2), visited: S.visited,
      act: S.act.map(a => a.id), found: [...S.found], wrong: S.wrongN, tot: { ...S.tot }, weird: S.weird, log: S.log,
      result: S.result ? { net: S.result.net, stamp: S.result.rank.st.ja, found: S.result.tot.found } : null,
    }
  },
}
window.__ihReady = true
