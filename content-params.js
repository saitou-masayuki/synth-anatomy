// シンセ解剖図 — 統一パラメーター定義。
// エンジン・UI・解説・レシピ・クイズ・実機対応表の全機能がこの定義を参照する。
// PARAMS / MOD_DESTS は純粋データ（関数を含まない。テストで強制）。
// 動的な説明文の生成は describe-engine.js に分離している。
//
// フィールドの意味:
//   id        ドット区切りの安定ID（全コンテンツの共通語彙）
//   block     解剖図上の所属ブロック（oscA / filter / ampEnv / lfo1 / mod / master）
//   type      float | int | enum | bool（データ型）
//   ui        knob | select | toggle（画面部品）
//   curve     lin | log | exp2（ノブ0..1と実値の写像。正規化空間は全機能で共通）
//   smoothing setTargetAtTime の時定数（エンジン用。ジッパーノイズ防止）
//   modTarget / modRate / modRange  変調可否・方式（audio=AudioParam接続 / control=60Hz更新）・振幅
//   short     ツールチップ・ノブ下に出す一言説明
//   phase     実装フェーズ区分

var PARAMS = [
  // ---- OSC A ----
  {
    id: 'oscA.wave', block: 'oscA', name: '波形', nameEn: 'Wave',
    type: 'enum', ui: 'select', default: 'saw', phase: 1,
    values: [
      { v: 'sine', name: 'サイン', short: '倍音なし。丸くて純粋な音' },
      { v: 'tri', name: '三角', short: '奇数倍音が少しだけ。柔らかい音' },
      { v: 'saw', name: 'ノコギリ', short: '全ての倍音を含む。減算合成の出発点' },
      { v: 'square', name: '矩形', short: '奇数倍音のみ。芯のある中空な音' },
      { v: 'wt.basic', name: 'WTベーシック', short: 'ウェーブテーブル。位置ノブで波形が連続変化' },
    ],
    short: '音色の素材。倍音の並び方が決まる',
  },
  {
    id: 'oscA.wtPos', block: 'oscA', name: 'WT位置', nameEn: 'WT Pos',
    type: 'float', ui: 'knob', min: 0, max: 1, default: 0, curve: 'lin',
    unit: '', fmt: 'pct', smoothing: 0.02,
    modTarget: true, modRate: 'control', modRange: 0.5, phase: 1,
    short: 'ウェーブテーブルの読み出し位置。回すと波形そのものが変わる',
  },
  {
    id: 'oscA.octave', block: 'oscA', name: 'オクターブ', nameEn: 'Octave',
    type: 'int', ui: 'knob', min: -3, max: 3, default: 0, curve: 'lin',
    unit: 'oct', fmt: 'oct', phase: 1,
    short: '音の高さを1オクターブ単位で移動',
  },
  {
    id: 'oscA.semi', block: 'oscA', name: '半音', nameEn: 'Semi',
    type: 'int', ui: 'knob', min: -12, max: 12, default: 0, curve: 'lin',
    unit: 'st', fmt: 'st', phase: 1,
    short: '音の高さを半音単位で移動',
  },
  {
    id: 'oscA.fine', block: 'oscA', name: 'ファイン', nameEn: 'Fine',
    type: 'float', ui: 'knob', min: -100, max: 100, default: 0, curve: 'lin',
    unit: 'cent', fmt: 'cent', smoothing: 0.01, phase: 1,
    short: '半音の1/100単位の微調整。2つの音をわずかにズラすと厚みが出る',
  },
  {
    id: 'oscA.level', block: 'oscA', name: 'レベル', nameEn: 'Level',
    type: 'float', ui: 'knob', min: 0, max: 1, default: 0.8, curve: 'lin',
    unit: '', fmt: 'pct', smoothing: 0.01,
    modTarget: true, modRate: 'audio', modRange: 1, phase: 1,
    short: 'オシレーターの音量',
  },

  // ---- FILTER ----
  {
    id: 'filter.type', block: 'filter', name: 'タイプ', nameEn: 'Type',
    type: 'enum', ui: 'select', default: 'lp12', phase: 1,
    values: [
      { v: 'lp12', name: 'ローパス', short: 'カットオフより上の倍音を削る。一番よく使う' },
      { v: 'hp12', name: 'ハイパス', short: 'カットオフより下を削る。低域の整理に' },
      { v: 'bp12', name: 'バンドパス', short: 'カットオフ付近だけ残す。細い音に' },
    ],
    short: 'どの帯域を削るかの方式',
  },
  {
    id: 'filter.cutoff', block: 'filter', name: 'カットオフ', nameEn: 'Cutoff',
    type: 'float', ui: 'knob', min: 20, max: 18000, default: 18000, curve: 'log',
    unit: 'Hz', fmt: 'hz', smoothing: 0.01,
    modTarget: true, modRate: 'audio', modRange: 4800, phase: 1,
    short: '削り始める高さ。下げるほど音がこもる',
  },
  {
    id: 'filter.reso', block: 'filter', name: 'レゾナンス', nameEn: 'Reso',
    type: 'float', ui: 'knob', min: 0, max: 1, default: 0.1, curve: 'lin',
    unit: '', fmt: 'pct', smoothing: 0.01, phase: 1,
    short: 'カットオフ付近を強調してクセを出す。上げすぎると自己発振気味に',
  },

  // ---- ENV1（アンプ直結・固定。Serum/Vitalと同じ構成） ----
  {
    id: 'ampEnv.attack', block: 'ampEnv', name: 'アタック', nameEn: 'Attack',
    type: 'float', ui: 'knob', min: 0.001, max: 4, default: 0.005, curve: 'exp2',
    unit: 's', fmt: 's', phase: 1,
    short: '鍵盤を押してから最大音量になるまでの時間',
  },
  {
    id: 'ampEnv.decay', block: 'ampEnv', name: 'ディケイ', nameEn: 'Decay',
    type: 'float', ui: 'knob', min: 0.01, max: 4, default: 0.3, curve: 'exp2',
    unit: 's', fmt: 's', phase: 1,
    short: '最大音量からサステインまで下がる時間',
  },
  {
    id: 'ampEnv.sustain', block: 'ampEnv', name: 'サステイン', nameEn: 'Sustain',
    type: 'float', ui: 'knob', min: 0, max: 1, default: 0.8, curve: 'lin',
    unit: '', fmt: 'pct', phase: 1,
    short: '押さえている間キープされる音量。0にすると減衰音（プラック）になる',
  },
  {
    id: 'ampEnv.release', block: 'ampEnv', name: 'リリース', nameEn: 'Release',
    type: 'float', ui: 'knob', min: 0.01, max: 6, default: 0.3, curve: 'exp2',
    unit: 's', fmt: 's', phase: 1,
    short: '鍵盤を離してから音が消えるまでの時間',
  },

  // ---- LFO1 ----
  {
    id: 'lfo1.shape', block: 'lfo1', name: '波形', nameEn: 'Shape',
    type: 'enum', ui: 'select', default: 'sine', phase: 1,
    values: [
      { v: 'sine', name: 'サイン', short: 'なめらかな揺れ。ビブラート・ワウに' },
      { v: 'tri', name: '三角', short: '直線的な往復。サインより機械的' },
      { v: 'saw', name: 'ノコギリ', short: '徐々に上がって一気に戻る。ライザー的な揺れ' },
      { v: 'square', name: '矩形', short: '2つの値を行き来。トリル・オンオフ的な揺れ' },
      { v: 'sh', name: 'S&H', short: '周期ごとにランダム値。ロボット的な揺れ' },
    ],
    short: '揺れの形',
  },
  {
    id: 'lfo1.rateHz', block: 'lfo1', name: '速さ', nameEn: 'Rate',
    type: 'float', ui: 'knob', min: 0.05, max: 20, default: 2, curve: 'log',
    unit: 'Hz', fmt: 'hz', smoothing: 0.02, phase: 1,
    short: '1秒あたりの揺れの回数',
  },

  // ---- モジュレーションスロット1（src×dst×amt。SerumのMATRIXの1行に相当） ----
  {
    id: 'mod1.src', block: 'mod', name: '変調元', nameEn: 'Source',
    type: 'enum', ui: 'select', default: 'none', phase: 1,
    values: [
      { v: 'none', name: 'なし', short: '未接続' },
      { v: 'lfo1', name: 'LFO 1', short: '周期的な揺れで動かす' },
    ],
    short: '何で動かすか',
  },
  {
    id: 'mod1.dst', block: 'mod', name: '変調先', nameEn: 'Dest',
    type: 'enum', ui: 'select', default: 'none', phase: 1,
    values: [
      { v: 'none', name: 'なし', short: '未接続' },
      { v: 'filter.cutoff', name: 'カットオフ', short: 'ワウ・ウォブルの定番' },
      { v: 'oscA.pitch', name: 'ピッチ', short: 'ビブラート・サイレン' },
      { v: 'oscA.wtPos', name: 'WT位置', short: '音色が勝手に動き続ける' },
      { v: 'oscA.level', name: 'OSC音量', short: 'トレモロ' },
    ],
    short: 'どのノブを動かすか',
  },
  {
    id: 'mod1.amt', block: 'mod', name: '深さ', nameEn: 'Amount',
    type: 'float', ui: 'knob', min: -1, max: 1, default: 0, curve: 'lin',
    unit: '', fmt: 'pct', smoothing: 0.01, phase: 1,
    short: 'どれだけ大きく動かすか。マイナスで逆方向',
  },

  // ---- MASTER ----
  {
    id: 'master.gain', block: 'master', name: '音量', nameEn: 'Volume',
    type: 'float', ui: 'knob', min: 0, max: 1, default: 0.35, curve: 'lin',
    unit: '', fmt: 'pct', smoothing: 0.02, phase: 1,
    short: '全体の音量。耳を守るため控えめが既定値',
  },
];

// モジュレーション先の定義。mod*.dst の enum 値（none以外）と1対1で対応する。
// kind: audio = AudioParamへ直接接続（サンプル精度） / control = 60HzのJS更新
// range: 深さ100%のときの実振幅（cutoff/pitchはセント単位 = detune経由の対数変調）
var MOD_DESTS = [
  { id: 'filter.cutoff', kind: 'audio', range: 4800, name: 'カットオフ' },
  { id: 'oscA.pitch', kind: 'audio', range: 1200, name: 'ピッチ' },
  { id: 'oscA.wtPos', kind: 'control', range: 0.5, name: 'WT位置' },
  { id: 'oscA.level', kind: 'audio', range: 1, name: 'OSC音量' },
];

// ---- 以下、純粋関数（PARAMSへの参照系ヘルパー） ----

var PARAM_INDEX = {};
for (const p of PARAMS) PARAM_INDEX[p.id] = p;

function paramById(id) {
  return PARAM_INDEX[id] || null;
}

// 実値を範囲内に丸める（enum/boolはそのまま返す）
function clampParam(id, v) {
  const p = PARAM_INDEX[id];
  if (!p || (p.type !== 'float' && p.type !== 'int')) return v;
  return Math.min(p.max, Math.max(p.min, v));
}

// 実値 → 正規化0..1。クイズの変化量・レシピの許容誤差も全てこの空間で扱う
function normParam(id, v) {
  const p = PARAM_INDEX[id];
  const x = clampParam(id, v);
  if (p.curve === 'log') return Math.log(x / p.min) / Math.log(p.max / p.min);
  if (p.curve === 'exp2') return Math.sqrt((x - p.min) / (p.max - p.min));
  return (x - p.min) / (p.max - p.min);
}

// 正規化0..1 → 実値（intは整数に丸める）
function denormParam(id, n) {
  const p = PARAM_INDEX[id];
  const t = Math.min(1, Math.max(0, n));
  let v;
  if (p.curve === 'log') v = p.min * Math.pow(p.max / p.min, t);
  else if (p.curve === 'exp2') v = p.min + (p.max - p.min) * t * t;
  else v = p.min + (p.max - p.min) * t;
  return p.type === 'int' ? Math.round(v) : v;
}

// 人間向けの値表記（「8.2kHz」「5ms」「+7st」など）
function fmtValue(id, v) {
  const p = PARAM_INDEX[id];
  if (!p) return String(v);
  if (p.type === 'enum') {
    const o = p.values.find((x) => x.v === v);
    return o ? o.name : String(v);
  }
  if (p.type === 'bool') return v ? 'ON' : 'OFF';
  switch (p.fmt) {
    case 'hz':
      if (v >= 1000) return parseFloat((v / 1000).toFixed(1)) + 'kHz';
      if (v >= 100) return Math.round(v) + 'Hz';
      return parseFloat(v.toFixed(2)) + 'Hz';
    case 'pct':
      return Math.round(v * 100) + '%';
    case 's':
      if (v < 1) return Math.round(v * 1000) + 'ms';
      return v.toFixed(2) + 's';
    case 'st':
      return (v > 0 ? '+' : '') + v + 'st';
    case 'oct':
      return (v > 0 ? '+' : '') + v + 'oct';
    case 'cent':
      return (v > 0 ? '+' : '') + Math.round(v) + 'c';
    default:
      return String(parseFloat(Number(v).toFixed(2)));
  }
}

// 全Phase 1パラメーターの既定値パッチ（{paramId: value} の平坦な辞書）
function defaultPatch() {
  const patch = {};
  for (const p of PARAMS) {
    if (p.phase === 1) patch[p.id] = p.default;
  }
  return patch;
}
