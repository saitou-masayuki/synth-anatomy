// シンセマスター — 音作りチャレンジ（診断チャレンジ）の宣言的データ。純粋データのみ（テストで強制）。
//
// 構造:
//   init      既定パッチとの差分（挑戦開始時に適用される）
//   target    init との差分（完成形。「お手本を聴く」はこのパッチで試聴し、「答え合わせ」の基準にもなる）
//   audition  試聴フレーズ {notes: MIDIノート番号列, dur: 1音の長さ秒}
//   approach  ヒント段階1。抽象的な「聴きどころ」の一言。ブロック名は明かさない
//   blockHints ヒント段階3。targetに関わる各ブロックの具体的な操作方針（{block: 文言}）。
//              対象はrecipeTargetBlocks(target)で機械的に求まるため、ここには
//              その全ブロックぶんのヒントを過不足なく用意する（test/content.test.mjsが検証）
//   insight   完成後に表示する、その音の核心となる因果関係の一言
//
// ヒント段階2（「まだズレているブロック」の提示）は、recipeJudgeAll()で実行時に
// 動的に求まるため、コンテンツとしては持たない。

var RECIPES = [
  {
    id: 'pluck',
    title: 'プラック',
    goal: 'ポロンと弾いて消える、芯のある短い音',
    difficulty: 1, order: 1,
    audition: { notes: [60, 55, 57, 64], dur: 0.35 },
    init: {},
    target: {
      'ampEnv.sustain': 0, 'ampEnv.decay': 0.4, 'ampEnv.release': 0.4,
      'ampEnv.attack': 0.002, 'filter.cutoff': 2500, 'filter.reso': 0.3,
    },
    approach: '音が鳴っている間、途中で何かが変わっていないか聴いてみましょう',
    blockHints: {
      ampEnv: 'サステインをもっと下げてみて、0に近いくらいまで。アタックも一瞬にすると弾いた感じが出ます',
      filter: 'カットオフをもっと下げてみて、少しこもるくらいまで。レゾナンスも少し上げると輪郭が出ます',
    },
    insight: 'サステインを0にすると、鍵盤を押さえ続けても音が残らなくなります。これがプラックの正体でした。',
  },
  {
    id: 'round-bass',
    title: 'まるいベース',
    goal: '低くて丸い、土台を支えるベース',
    difficulty: 1, order: 2,
    audition: { notes: [36, 36, 43, 41], dur: 0.45 },
    init: {},
    target: {
      'oscA.octave': -1, 'filter.cutoff': 350, 'filter.reso': 0.25,
      'ampEnv.sustain': 0.9, 'ampEnv.release': 0.15,
    },
    approach: '音の高さと、こもり具合を確かめてみましょう',
    blockHints: {
      oscA: 'オクターブをもっと下げてみて',
      filter: 'カットオフを大胆に下げてみて、こもりすぎと思うくらいまで',
      ampEnv: 'サステインを上げて、リリースを短くしてみて',
    },
    insight: 'カットオフを大胆に下げると、こもりが太さに変わります。これがベースの丸さの正体でした。',
  },
  {
    id: 'tremolo',
    title: 'トレモロ',
    goal: '音量が周期的に揺れる、ゆらゆらした音',
    difficulty: 1, order: 3,
    audition: { notes: [64, 60, 57], dur: 1.0 },
    init: {},
    target: {
      'oscA.wave': 'tri', 'ampEnv.sustain': 1, 'ampEnv.release': 0.4,
      'mod1.src': 'lfo1', 'mod1.dst': 'oscA.level',
      'lfo1.rateHz': 5, 'mod1.amt': 0.8, 'filter.cutoff': 6000,
    },
    approach: '音量が細かく揺れ続けていないか、伸ばした音でじっと聴いてみましょう',
    blockHints: {
      oscA: '波形を三角にしてみて。倍音が減って揺れが分かりやすくなります',
      ampEnv: 'サステインを上げて、音を伸ばしてみて。揺れを聴くにはまず音が続いていないと',
      mod: '変調元をLFO1に、変調先をOSC音量につないでみて',
      lfo1: '速さを5Hzくらいにしてみて',
      filter: 'カットオフを少し下げて、耳あたりを整えてみて',
    },
    insight: 'LFOをOSCの音量につなぐと、音量が周期的に揺れます。これがトレモロの正体でした。',
  },
  {
    id: 'wobble',
    title: 'ウォブルベース',
    goal: '「ワウワウ」とうなる、動きのあるベース',
    difficulty: 2, order: 4,
    audition: { notes: [36, 36, 39, 43], dur: 0.55 },
    init: {},
    target: {
      'oscA.octave': -1, 'filter.cutoff': 500, 'filter.reso': 0.4,
      'mod1.src': 'lfo1', 'mod1.dst': 'filter.cutoff',
      'lfo1.rateHz': 3, 'mod1.amt': 0.6, 'ampEnv.sustain': 1,
    },
    approach: 'フィルターが自動で動いているような揺れがないか聴いてみましょう',
    blockHints: {
      oscA: 'オクターブを下げて、ベースの音域にしてみて',
      filter: 'カットオフを大胆に下げて、レゾナンスも上げてみて',
      mod: '変調元をLFO1に、変調先をカットオフにつないでみて',
      lfo1: '速さを3Hzくらいにしてみて',
      ampEnv: 'サステインを上げて、鳴りっぱなしにしてみて',
    },
    insight: 'LFOをカットオフにつなぐと、フィルターが自動で開閉します。これがウォブルの正体でした。',
  },
  {
    id: 'vibrato-lead',
    title: 'ビブラート・リード',
    goal: '歌うように音程が揺れるリード',
    difficulty: 2, order: 5,
    audition: { notes: [67, 69, 71], dur: 0.7 },
    init: {},
    target: {
      'oscA.wave': 'square', 'filter.cutoff': 3000,
      'ampEnv.attack': 0.02, 'ampEnv.sustain': 1, 'ampEnv.release': 0.2,
      'mod1.src': 'lfo1', 'mod1.dst': 'oscA.pitch', 'mod1.amt': 0.04,
      'lfo1.rateHz': 5.5,
    },
    approach: '音程がわずかに揺れていないか、伸ばした音でよく聴いてみましょう',
    blockHints: {
      oscA: '波形を矩形にしてみて',
      filter: 'カットオフを少し下げて、こもらせすぎない程度に',
      ampEnv: 'アタックをほんの少しだけつけて、サステインを上げてみて',
      mod: '変調元をLFO1に、変調先をピッチにつないでみて。深さはごくわずかで十分です',
      lfo1: '速さを歌のビブラートくらい、5〜6Hzにしてみて',
    },
    insight: 'LFOをピッチにごくわずかにつなぐと、歌うような揺れが生まれます。これがビブラートの正体でした。',
  },
  {
    id: 'wt-pad',
    title: 'WTモーション・パッド',
    goal: '音色そのものがゆっくり変わり続けるパッド',
    difficulty: 3, order: 6,
    audition: { notes: [57], dur: 6 },
    init: {},
    target: {
      'oscA.wave': 'wt.basic', 'oscA.wtPos': 0.35,
      'ampEnv.attack': 0.6, 'ampEnv.release': 1.5, 'ampEnv.sustain': 0.9,
      'mod1.src': 'lfo1', 'mod1.dst': 'oscA.wtPos',
      'lfo1.shape': 'tri', 'lfo1.rateHz': 0.15, 'mod1.amt': 0.6,
      'filter.cutoff': 9000,
    },
    approach: '音色そのものが、ゆっくり動き続けていないか聴いてみましょう',
    blockHints: {
      oscA: '波形をWTベーシックにして、WT位置を三角とノコギリの中間くらいにしてみて',
      ampEnv: 'アタックとリリースを長めにして、ふわっと現れて消えるようにしてみて',
      mod: '変調元をLFO1に、変調先をWT位置につないでみて',
      lfo1: '波形を三角に、速さをかなりゆっくり（0.1〜0.2Hzくらい）にしてみて',
      filter: 'カットオフを少しだけ下げて、まぶしさを取ってみて',
    },
    insight: 'LFOでWT位置を揺らすと、音色そのものが動き続けます。これがモーションパッドの正体でした。',
  },
];
