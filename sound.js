// 音の割り当て（全部録音素材。出所は CREDITS.md）。game.js はここの sfx / setTrack / ambient / setNear / tick を呼ぶ
(() => {
  const KEY = 'ih.mute'
  try { Snd.muted = localStorage.getItem(KEY) === '1' } catch (e) {}
  const setM = Snd.setMute
  Snd.setMute = function (m) { setM.call(this, m); try { localStorage.setItem(KEY, m ? '1' : '0') } catch (e) {} }
  Snd.def({
    step: ['snd/step1.mp3', 'snd/step2.mp3', 'snd/step3.mp3', 'snd/step4.mp3'], tap: 'snd/tap.mp3', turn: ['snd/turn1.mp3', 'snd/turn2.mp3'],
    bell: 'snd/found1.mp3', paper: 'snd/tagpaper.mp3', wrong: ['snd/wrong1.mp3', 'snd/wrong2.mp3'], again: 'snd/again.mp3', clock: 'snd/clock.mp3',
    grunt: ['snd/grunt_01.mp3', 'snd/grunt_02.mp3', 'snd/grunt_03.mp3', 'snd/grunt_04.mp3'], ok: 'snd/ok.mp3', bad: 'snd/bad.mp3',
    door: 'snd/night1.mp3', latch: 'snd/night2.mp3', crow: 'snd/dawn.mp3', thwack: 'snd/stamp1.mp3', place: 'snd/stamp2.mp3', arrive: 'snd/arrive.mp3', near: 'snd/near.mp3',
  })
  // 最初のタップまでに頼まれていた環境音を、音が使えるようになった時点で鳴らし始める
  const init0 = Snd.init
  Snd.init = function () { const first = !this.ctx; init0.call(this); if (first && this.ctx) for (const k in this.loops) { const l = this.loops[k]; if (l && l.url && !l.node) this.loop(k, l.url, l.vol) } }
  const HUM = 'snd/hum.mp3', STREET = 'snd/street.mp3'
  const CUE = {
    tap: [['tap', { vol: 0.6, jitter: 0 }]], step: [['step', { vol: 0.5, room: 0.25 }]], turn: [['turn', { vol: 0.7 }]],
    found: [['paper', { vol: 0.8 }], ['bell', { vol: 0.5, delay: 0.04, rate: 1.1 }]], wrong: [['wrong', { vol: 0.75 }]], again: [['again', { vol: 0.5 }]],
    boss: [['grunt', { vol: 0.8, rate: 0.82, room: 0.3 }]], bossOdd: [['grunt', { vol: 0.9, rate: 0.55, room: 0.8 }], ['grunt', { vol: 0.4, rate: 1.25, delay: 0.1, room: 0.8 }]],
    ok: [['ok', { vol: 0.6 }]], bad: [['bad', { vol: 0.6 }]],
    night: [['door', { vol: 0.9, rate: 0.75, room: 0.6 }], ['latch', { vol: 0.6, delay: 0.42 }]], dawn: [['crow', { vol: 0.8, room: 0.6 }], ['crow', { vol: 0.5, delay: 0.75, rate: 0.92, room: 0.6 }]],
    stamp: [['thwack', { vol: 1 }], ['place', { vol: 0.7, delay: 0.01 }]], arrive: [['arrive', { vol: 0.6, room: 0.4 }]],
  }
  Snd.track = null; Snd.amb = false; Snd.nearK = 0; Snd.nextTick = 0; Snd.nextWh = 0
  Snd.sfx = function (n) {
    if (!this.ctx) return
    for (const [k, o] of CUE[n] || []) this.play(k, o)
    this.played[n] = (this.played[n] || 0) + 1
  }
  // 曲は入れない（録音の曲で合う物が無い。安いホラーは環境音だけの方が怖い）。夜の通りを遠くに敷く
  Snd.setTrack = function (t) {
    this.track = t; if (t) this.played['bed:' + t] = (this.played['bed:' + t] || 0) + 1
    this.loop('bed', STREET, t === 'play' ? 0.05 : 0.14, 1.2)
  }
  // 冷蔵庫のうなり。ambient(true) の間だけ
  Snd.ambient = function (on) { this.amb = on; this.loop('amb', on ? HUM : null, 0.22, 0.8) }
  // 異変の近くでは、うなりの音程がずれてささやきが混じる
  Snd.setNear = function (k) {
    this.nearK = k; if (!this.ctx) return; const l = this.loops.amb
    if (l && l.node) l.node.playbackRate.setTargetAtTime(1 - k * 0.12, this.ctx.currentTime, 0.3)
  }
  Snd.tick = function () {
    if (!this.ctx || !this.amb) return; const now = this.ctx.currentTime
    if (now > this.nextTick) { this.nextTick = now + 1; this.play('clock', { vol: 0.09, jitter: 0, room: 0.5 }) }
    if (this.nearK > 0.3 && now > this.nextWh) { this.nextWh = now + 2.8 + Math.random() * 1.5; this.play('near', { vol: 0.16 * this.nearK, rate: 0.7, dest: 'muf' }) }
  }
})()
