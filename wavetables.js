// シンセ解剖図 — 教材ウェーブテーブル定義。
// 各フレームを倍音スペクトル（real=コサイン成分 / imag=サイン成分）で持ち、
// エンジンは createPeriodicWave() に渡して音を作る。
// スペクトル定義なので PeriodicWave の自動帯域制限が効き、エイリアシングが出ない。
// 波形描画・スペクトル表示・音が同じデータから導ける（教材として一貫）。

var WT_HARMONICS = 128; // 配列長。インデックス1..127が倍音次数に対応（0はDC、常に0）

function wtBlankFrame() {
  return { real: new Array(WT_HARMONICS).fill(0), imag: new Array(WT_HARMONICS).fill(0) };
}

function wtSineFrame() {
  const f = wtBlankFrame();
  f.imag[1] = 1;
  return f;
}

function wtTriFrame() {
  const f = wtBlankFrame();
  // 奇数倍音のみ、振幅は 1/n²。符号は交互（フーリエ級数の定義通り）
  for (let n = 1; n < WT_HARMONICS; n += 2) {
    f.imag[n] = (8 / (Math.PI * Math.PI)) * (((n - 1) / 2) % 2 === 0 ? 1 : -1) / (n * n);
  }
  return f;
}

function wtSawFrame() {
  const f = wtBlankFrame();
  // 全倍音、振幅は 1/n
  for (let n = 1; n < WT_HARMONICS; n++) {
    f.imag[n] = (2 / Math.PI) * (n % 2 === 1 ? 1 : -1) / n;
  }
  return f;
}

function wtSquareFrame() {
  const f = wtBlankFrame();
  // 奇数倍音のみ、振幅は 1/n
  for (let n = 1; n < WT_HARMONICS; n += 2) {
    f.imag[n] = (4 / Math.PI) / n;
  }
  return f;
}

// 教材テーブル一覧。キーは oscA.wave の enum 値と一致させる
var WAVETABLES = {
  'wt.basic': {
    name: 'ベーシック',
    frameNames: ['sine', 'tri', 'saw', 'square'],
    frames: [wtSineFrame(), wtTriFrame(), wtSawFrame(), wtSquareFrame()],
  },
};

// WT位置（0..1）→ クロスフェードする隣接2フレームと混合比。
// エンジン（Gain2本のクロスフェード）と可視化が同じ計算を使う。
function wtFrameMix(pos, frameCount) {
  const t = Math.min(1, Math.max(0, pos));
  const x = t * (frameCount - 1);
  const lo = Math.min(Math.floor(x), frameCount - 2);
  return { lo, hi: lo + 1, mix: x - lo };
}
