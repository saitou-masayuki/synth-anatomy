// シンセ解剖図 — 聞き取りテストの宣言的データ。純粋データのみ。
//
// 出題の可聴性は「アルゴリズムではなくデータで保証する」方針:
// 各レベルの basePatches は pool の全パラメーターの変化が聴こえるように人手で設計し、
// その前提（WT位置を出すならWT波形、LFO速さを出すなら配線済み、等）を
// test/content.test.mjs が機械検証する。

var QUIZ_LEVELS = [
  {
    id: 'lv1', name: 'レベル1', desc: '大きな変化を聴き分ける（2択）',
    pool: ['filter.cutoff', 'filter.reso', 'ampEnv.attack', 'ampEnv.release'],
    delta: 0.6, deltaRange: null,
    choices: 2,
    basePatches: ['qz-pad'],
    questionCount: 8, passScore: 6,
  },
  {
    id: 'lv2', name: 'レベル2', desc: '中くらいの変化・音量の形も聴き分ける（4択）',
    pool: ['filter.cutoff', 'filter.reso', 'ampEnv.attack', 'ampEnv.decay', 'ampEnv.sustain', 'oscA.wave'],
    delta: 0.3, deltaRange: null,
    choices: 4,
    basePatches: ['qz-pad', 'qz-pluck'],
    questionCount: 8, passScore: 6,
  },
  {
    id: 'lv3', name: 'レベル3', desc: '小さな変化・WT位置やLFOの速さも（4択）',
    // oscA.waveは出題対象に含めない: ベースがwt.basicのため、waveを別の波形に変えるのと
    // wtPosをその波形に対応する位置へ動かすのが音として区別できない（同じ単一フレームになる）
    pool: ['filter.cutoff', 'filter.reso', 'ampEnv.attack', 'ampEnv.release', 'oscA.wtPos', 'lfo1.rateHz', 'oscA.fine'],
    delta: 0.18, deltaRange: null,
    choices: 4,
    basePatches: ['qz-wt-wobble'],
    questionCount: 8, passScore: 6,
  },
];

var QUIZ_BASE_PATCHES = {
  // 伸びるパッド: フィルター・アタック・リリース・ディケイの変化が素直に聴こえる
  'qz-pad': {
    name: 'のびる音',
    patch: {
      'ampEnv.attack': 0.05, 'ampEnv.decay': 1.2, 'ampEnv.sustain': 0.6, 'ampEnv.release': 0.5,
      'filter.cutoff': 4000,
    },
    audition: { notes: [57], dur: 2.2 },
  },
  // プラック: ディケイ・アタックの変化が際立つ
  'qz-pluck': {
    name: 'はじく音',
    patch: {
      'ampEnv.attack': 0.002, 'ampEnv.decay': 0.45, 'ampEnv.sustain': 0, 'ampEnv.release': 0.45,
      'filter.cutoff': 3500,
    },
    audition: { notes: [60, 60], dur: 1.0 },
  },
  // WT+ワウ: WT位置・LFO速さ・ファインの微妙な変化を聴くための土台
  'qz-wt-wobble': {
    name: 'うねる音',
    patch: {
      'oscA.wave': 'wt.basic', 'oscA.wtPos': 0.4,
      'ampEnv.attack': 0.03, 'ampEnv.sustain': 0.75, 'ampEnv.release': 0.5,
      'filter.cutoff': 5000,
      'mod1.src': 'lfo1', 'mod1.dst': 'filter.cutoff', 'mod1.amt': 0.45,
      'lfo1.rateHz': 2.5,
    },
    audition: { notes: [45], dur: 2.5 },
  },
};
