// シンセ解剖図 — モジュレーションの数式層（純粋ロジック。DOM/AudioContext非依存）。
//
// 二層方式の「共有される数式」がここに集まる:
//   音の実体   = synth-engine.js がこの式に従って AudioParam をスケジュールする
//   見た目     = viz.js が同じ式を毎フレーム再計算して線の脈動・モッドリングを描く
// 同じ式から音と映像を導くことで「線が光る＝音が揺れる」のズレをなくす。

// LFOの瞬時値（-1..+1）。t=経過秒、rateHz=速さ。
// S&Hは周期番号から決定的に疑似乱数を引く（再計算しても同じ値＝映像と音が一致する）。
function lfoValue(shape, t, rateHz) {
  const phase = ((t * rateHz) % 1 + 1) % 1;
  switch (shape) {
    case 'sine':
      return Math.sin(2 * Math.PI * phase);
    case 'tri':
      if (phase < 0.25) return 4 * phase;
      if (phase < 0.75) return 2 - 4 * phase;
      return 4 * phase - 4;
    case 'saw':
      // Web Audio仕様の sawtooth = 2*(φ - floor(φ + 0.5)) と同位相
      // （音の実体OscillatorNodeと可視化ミラーを一致させる）
      return 2 * (phase - Math.floor(phase + 0.5));
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'sh': {
      const cycle = Math.floor(t * rateHz);
      const x = Math.sin(cycle * 127.1 + 311.7) * 43758.5453;
      return (x - Math.floor(x)) * 2 - 1;
    }
    default:
      return 0;
  }
}

// ADSRエンベロープの瞬時値（0..1）。
// tOn=ノートオンからの経過秒、tOff=ノートオフからの経過秒（押下中はnull）。
// アタックは直線、ディケイ/リリースは指数収束（synth-engineのsetTargetAtTimeと同じ形）。
// 時定数はディケイ/リリース時間の1/3（指定時間でおよそ95%到達）。
function envHeldValue(adsr, tOn) {
  if (tOn <= 0) return 0;
  if (tOn < adsr.attack) return tOn / adsr.attack;
  const s = adsr.sustain;
  return s + (1 - s) * Math.exp(-3 * (tOn - adsr.attack) / adsr.decay);
}

function envValue(adsr, tOn, tOff) {
  if (tOff === null || tOff === undefined) return envHeldValue(adsr, tOn);
  // リリースは「離した瞬間の値」から減衰する（音の実体の setTargetAtTime(0) と同じ軌道）。
  // tOn は進み続けるため、離鍵時点 tOn - tOff で held 値を凍結して評価する
  const heldAtRelease = envHeldValue(adsr, tOn - tOff);
  return heldAtRelease * Math.exp(-3 * tOff / adsr.release);
}

// パッチ（平坦な辞書）からアクティブなモジュレーションルートを解決する。
// スロットは mod1..mod4 の固定4本（Phase 1で定義済みなのは mod1 のみ）。
// src/dst が none、または深さ0のスロットは配線なしとして無視する。
function resolveModRoutes(patch) {
  const routes = [];
  for (const slot of ['mod1', 'mod2', 'mod3', 'mod4']) {
    const src = patch[slot + '.src'];
    const dst = patch[slot + '.dst'];
    const amt = patch[slot + '.amt'];
    if (!src || src === 'none' || !dst || dst === 'none' || !amt) continue;
    const dest = MOD_DESTS.find((d) => d.id === dst);
    if (!dest) continue;
    routes.push({ slot, src, dst, amt, kind: dest.kind, range: dest.range });
  }
  return routes;
}

// ルート1本の寄与量 = 変調元の瞬時値 × 深さ × 変調先の実振幅。
// cutoff/pitchはセント単位（detune経由）、wtPos/levelはそのままの単位。
function modContribution(route, srcValue) {
  return srcValue * route.amt * route.range;
}

// モノフォニックの後着優先ノートスタック。
// 押している鍵を古い順に保持し、末尾（最後に押した鍵）が発音対象。
// 途中の鍵を離すと1つ前の鍵に戻る（レガート演奏の定番挙動）。
function noteStackPush(stack, note) {
  return stack.filter((n) => n !== note).concat(note);
}

function noteStackRemove(stack, note) {
  return stack.filter((n) => n !== note);
}

// MIDIノート番号 → 周波数（A4=69=440Hz）
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
