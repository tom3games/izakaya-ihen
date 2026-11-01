// 自動プレイ。IHBot.run(kind, seed) → 7晩通して結果を返す
// kind: oracle（見えた異変だけを見つけてタップ）/ none（歩くだけ）/ spam（あちこちタップ）/ half（見える異変を半分だけ）
window.IHBot = {
  run(kind, seed) {
    const S = IH.S, d = IH.dbg
    d.pause(true); d.start(seed); d.pause(true); S.tut = -1
    const turn = () => document.querySelector('#bTurn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    let rnd = seed * 9301 + 49297; const R = () => (rnd = (rnd * 9301 + 49297) % 233280) / 233280
    let f = 0, taps = { found: 0, wrong: 0, again: 0, dup: 0 }, skipped = 0
    while (S.mode === 'play' && f < 60 * 900) {
      f++
      if (S.phase === 'walk') {
        if (S.visited && S.dir > 0) { S.inF = 0; turn() }
        S.inF = 1
        if (kind === 'oracle' || kind === 'half') {
          if (f % 8 === 0) {
            for (const a of S.act) {
              if (S.found.has(a.id)) continue
              const sc = d.screen(a.id)
              if (!sc || sc.d > 9) continue
              const keepYaw = S.yaw, keepP = S.pitch
              d.aim(a.id)
              const v = d.visible()
              if (v && v.id === a.id) {
                if (kind === 'half' && (a.id.length % 2)) { skipped++; S.yaw = keepYaw; S.pitch = keepP; continue }
                const r = d.tap(v.x, v.y); if (r) taps[r.kind]++
              }
              S.yaw = keepYaw; S.pitch = keepP
            }
          }
        } else if (kind === 'spam' && f % 10 === 0) {
          S.yaw = (R() - 0.5) * 2.4
          d.tick(1)
          for (let k = 0; k < 6; k++) { const r = d.tap(30 + R() * (innerWidth - 60), 80 + R() * (innerHeight - 220)); if (r) taps[r.kind]++ }
        }
      } else S.inF = 0
      d.tick(1)
    }
    return { kind, seed, mode: S.mode, frames: f, taps, tot: { ...S.tot }, net: S.result && S.result.net, stamp: S.result && S.result.rank.st.ja.replace('\n', ''), skipped }
  },
}
