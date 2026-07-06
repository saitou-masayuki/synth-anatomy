// シンセ解剖図 — 音作りテスト（レシピ）の宣言的データ。純粋データのみ（テストで強制）。
//
// 構造:
//   init     既定パッチとの差分（レシピ開始時に適用される）
//   target   init との差分（完成形。「目標を聴く」はこのパッチで試聴する）
//   steps    順番に進める手順。params は {paramId: 目標値}。
//            auto: true のステップは配線などの離散操作で、ボタン一つで適用される。
//            それ以外はユーザーが自分でノブを回して範囲内（tol、正規化空間）に入れる
//   audition 試聴フレーズ {notes: MIDIノート番号列, dur: 1音の長さ秒}
//
// 不変条件「init + 全stepsのparams ≡ init + target」は test/content.test.mjs が検証する。

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
    steps: [
      {
        title: '減衰する音にする',
        text: 'サステインを0にすると、鍵盤を押さえ続けても音が残らなくなります。これがプラックの土台です。ディケイとリリースは0.4秒くらいに。',
        params: { 'ampEnv.sustain': 0, 'ampEnv.decay': 0.4, 'ampEnv.release': 0.4 }, tol: 0.06,
        listen: '鍵盤を押しっぱなしにしても音が消えていくのを確認',
      },
      {
        title: 'アタックを一瞬にする',
        text: 'アタックを最短近くまで下げると、弾いた瞬間に音が立ち上がります。',
        params: { 'ampEnv.attack': 0.002 }, tol: 0.05,
        listen: '音の頭が「ポッ」と鋭くなるのを確認',
      },
      {
        title: '少しこもらせて丸くする',
        text: 'カットオフを2.5kHzあたりまで下げて、耳に刺さる高域を削ります。',
        params: { 'filter.cutoff': 2500 }, tol: 0.08,
        listen: 'FILTER出口のスペクトルの右側が沈むのを見る',
      },
      {
        title: '輪郭を立てる',
        text: 'レゾナンスを30%くらいに上げると、カットオフ付近が強調されて音の輪郭がはっきりします。',
        params: { 'filter.reso': 0.3 }, tol: 0.08,
        listen: 'スペクトルのカットオフ位置に小さな山ができるのを見る',
      },
    ],
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
    steps: [
      {
        title: '低い音域へ',
        text: 'オクターブを-1にします。ベースの音作りはまず音域から。',
        params: { 'oscA.octave': -1 }, tol: 0.05,
        listen: 'スペクトル全体が左（低い方）へ寄るのを見る',
      },
      {
        title: '大胆にこもらせる',
        text: 'カットオフを350Hzまで下げます。「こもりすぎ？」と思うくらいでちょうどいいのがベースです。',
        params: { 'filter.cutoff': 350 }, tol: 0.06,
        listen: '明るさが消えて「太さ」だけが残るのを確認',
      },
      {
        title: '輪郭を少し足す',
        text: 'レゾナンスを25%ほど。こもった音に「境目」ができて聴き取りやすくなります。',
        params: { 'filter.reso': 0.25 }, tol: 0.08,
        listen: 'モワッとした音に芯が通るのを確認',
      },
      {
        title: '歯切れを整える',
        text: 'サステイン90%・リリース150msに。鍵盤を離した瞬間スッと止まる、歯切れのよいベースになります。',
        params: { 'ampEnv.sustain': 0.9, 'ampEnv.release': 0.15 }, tol: 0.06,
        listen: '離鍵後に音が残らないのを確認',
      },
    ],
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
    steps: [
      {
        title: 'やわらかい素材にする',
        text: '波形を三角にします。倍音が少なく、揺れがよく分かる素直な音です。',
        params: { 'oscA.wave': 'tri' },
        listen: 'OSC出口のスペクトルから倍音がほぼ消えるのを見る',
      },
      {
        title: '伸びる音にする',
        text: 'サステイン100%・リリース0.4秒。揺れを聴くにはまず音が伸びていないと始まりません。',
        params: { 'ampEnv.sustain': 1, 'ampEnv.release': 0.4 }, tol: 0.06,
        listen: '押さえている間ずっと同じ音量で鳴るのを確認',
      },
      {
        title: 'LFOを音量につなぐ',
        text: 'LFO1をOSC音量に配線します。配線しただけではまだ何も起きません。深さがゼロだからです。',
        params: { 'mod1.src': 'lfo1', 'mod1.dst': 'oscA.level' }, auto: true,
        listen: 'LFO1からOSCへ線が伸びるのを見る',
      },
      {
        title: '揺れの速さと深さを決める',
        text: '速さ5Hz・深さ80%に。音量が「ワワワワ」と揺れ始めます。これがトレモロです。',
        params: { 'lfo1.rateHz': 5, 'mod1.amt': 0.8 }, tol: 0.06,
        listen: '線の脈動と音の揺れが同じテンポなのを確認',
      },
      {
        title: '耳あたりを整える',
        text: 'カットオフを6kHzに。少しだけ丸めて完成です。',
        params: { 'filter.cutoff': 6000 }, tol: 0.1,
        listen: '揺れはそのままに、音がわずかに柔らかくなるのを確認',
      },
    ],
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
    steps: [
      {
        title: '低い音域へ',
        text: 'オクターブを-1に。ウォブルはベースの音域でこそ映えます。',
        params: { 'oscA.octave': -1 }, tol: 0.05,
        listen: '音が1オクターブ下がるのを確認',
      },
      {
        title: 'フィルターを構える',
        text: 'カットオフ500Hz・レゾナンス40%。この「こもった状態」がウォブルの出発点になります。',
        params: { 'filter.cutoff': 500, 'filter.reso': 0.4 }, tol: 0.07,
        listen: 'こもって、かつ輪郭のある音になるのを確認',
      },
      {
        title: 'LFOをカットオフにつなぐ',
        text: 'LFO1をカットオフに配線します。フィルターを自動で開け閉めする準備です。',
        params: { 'mod1.src': 'lfo1', 'mod1.dst': 'filter.cutoff' }, auto: true,
        listen: 'LFO1からカットオフへ線が伸びるのを見る',
      },
      {
        title: 'ワウを起こす',
        text: '速さ3Hz・深さ60%。カットオフが勝手に上下して「ワウワウ」が生まれます。ウォブル誕生の瞬間です。',
        params: { 'lfo1.rateHz': 3, 'mod1.amt': 0.6 }, tol: 0.06,
        listen: 'カットオフノブの外周リングで点が揺れているのを見る',
      },
      {
        title: '鳴りっぱなしにする',
        text: 'サステイン100%に。押さえている間ずっとうなり続けるベースの完成です。',
        params: { 'ampEnv.sustain': 1 }, tol: 0.05,
        listen: '長押しでワウが続くのを確認',
      },
    ],
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
    steps: [
      {
        title: '芯のある素材にする',
        text: '波形を矩形にします。奇数倍音だけの、笛のような芯のある音です。',
        params: { 'oscA.wave': 'square' },
        listen: 'スペクトルで倍音が1本おきに並ぶのを見る',
      },
      {
        title: '明るさを整える',
        text: 'カットオフを3kHzに。リードは主役なので、こもらせすぎないのがコツです。',
        params: { 'filter.cutoff': 3000 }, tol: 0.08,
        listen: '芯を残したまま角が取れるのを確認',
      },
      {
        title: '歌う音量カーブにする',
        text: 'アタック20ms・サステイン100%・リリース0.2秒。息で吹くようなわずかな立ち上がりを付けます。',
        params: { 'ampEnv.attack': 0.02, 'ampEnv.sustain': 1, 'ampEnv.release': 0.2 }, tol: 0.06,
        listen: '音の頭が少しだけ柔らかくなるのを確認',
      },
      {
        title: 'LFOをピッチにつなぐ',
        text: 'LFO1をピッチに浅く（4%）配線します。深すぎると音痴になるので、ここはボタンで正確に。',
        params: { 'mod1.src': 'lfo1', 'mod1.dst': 'oscA.pitch', 'mod1.amt': 0.04 }, auto: true,
        listen: 'ファインノブの外周リングがごくわずかに動くのを見る',
      },
      {
        title: 'ビブラートの速さを決める',
        text: '5.5Hzは歌のビブラートに近い速さです。音程が揺れて「歌って」聴こえます。',
        params: { 'lfo1.rateHz': 5.5 }, tol: 0.05,
        listen: '揺れの速さが歌手のビブラートっぽく感じられるかを聴く',
      },
    ],
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
    steps: [
      {
        title: 'ウェーブテーブルにする',
        text: '波形をWTベーシックに。ここからは「削る」のではなく「波形そのものを変える」世界です。',
        params: { 'oscA.wave': 'wt.basic' },
        listen: 'WT位置ノブを回してOSC出口の波形が連続変化するのを見る',
      },
      {
        title: '出発点の音色を選ぶ',
        text: 'WT位置を35%あたりに。三角とノコギリの間の、少しザラッとした音色です。',
        params: { 'oscA.wtPos': 0.35 }, tol: 0.07,
        listen: '波形の形がサインでもノコギリでもない中間になるのを見る',
      },
      {
        title: 'ふわっと現れて消える音量にする',
        text: 'アタック0.6秒・リリース1.5秒・サステイン90%。パッドの音量カーブです。',
        params: { 'ampEnv.attack': 0.6, 'ampEnv.release': 1.5, 'ampEnv.sustain': 0.9 }, tol: 0.07,
        listen: '弾いた瞬間ではなく、少し遅れて音が満ちてくるのを確認',
      },
      {
        title: 'LFOをWT位置につなぐ',
        text: 'LFO1をWT位置に配線します。音色が勝手に動き続ける仕掛けです。',
        params: { 'mod1.src': 'lfo1', 'mod1.dst': 'oscA.wtPos' }, auto: true,
        listen: 'LFO1からWT位置ノブへ線が伸びるのを見る',
      },
      {
        title: 'ゆっくり波打たせる',
        text: '三角波・0.15Hz・深さ60%。約7秒かけて音色が行って帰ってくる、呼吸のような動きです。',
        params: { 'lfo1.shape': 'tri', 'lfo1.rateHz': 0.15, 'mod1.amt': 0.6 }, tol: 0.05,
        listen: '長押しして、音色が波のように変わり続けるのを聴く',
      },
      {
        title: '空気感を残して完成',
        text: 'カットオフ9kHz。高域を少しだけ丸めて、まぶしさを取ります。',
        params: { 'filter.cutoff': 9000 }, tol: 0.1,
        listen: '音色の動きはそのまま、全体が一枚柔らかくなるのを確認',
      },
    ],
  },
];
