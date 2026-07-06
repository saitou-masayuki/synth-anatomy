// シンセ解剖図 — 「今なにが起きた？」説明パネルの文生成（純粋ロジック）。
// content-params.js の PARAMS は純粋データ制約があるため、
// 文脈依存の動的な文生成（関数）はこのファイルに分離している。
// 「全paramIdにdescribeが存在する」ことはテストで強制される。
//
// describeChange() は3要素を返す:
//   action  何をしたか   「カットオフを 8.2kHz → 3.1kHz に下げました」
//   effect  音はどうなる 「高い倍音が削られて音がこもります」
//   watch   どこを見るか 「FILTER出口のスペクトルの右側が沈むのに注目」

// パッチ内に指定の変調配線があるか（文脈分岐用）
function describeHasRoute(patch, src, dst) {
  for (const slot of ['mod1', 'mod2', 'mod3', 'mod4']) {
    if (patch[slot + '.src'] === src && patch[slot + '.dst'] === dst && patch[slot + '.amt']) return true;
  }
  return false;
}

// paramId → (prev, next, patch) => { effect, watch } の関数表
var DESCRIBE = {
  'oscA.wave': (prev, next) => {
    const def = paramById('oscA.wave');
    const opt = def.values.find((o) => o.v === next);
    const base = opt ? opt.short + '。' : '';
    if (next === 'wt.basic') {
      return {
        effect: base + 'WT位置ノブを回すと、フィルターを使わずに波形そのものが連続変化します',
        watch: 'WT位置ノブを回しながらOSC出口の波形を見てみよう',
      };
    }
    return { effect: base + '倍音の構成が変わり、音色の素材が入れ替わります', watch: 'OSC出口のスペクトルの倍音の並びに注目' };
  },
  'oscA.wtPos': () => ({
    effect: 'サイン→三角→ノコギリ→矩形の間を連続移動。「削る」のではなく波形自体が変わるのがウェーブテーブルの本質です',
    watch: 'OSC出口の波形の形がなめらかに変わるのに注目',
  }),
  'oscA.octave': (prev, next) => ({
    effect: next > prev ? '音がオクターブ単位で高くなります' : '音がオクターブ単位で低くなります。-1〜-2はベースの定番',
    watch: 'OSC出口のスペクトル全体が左右に移動するのに注目',
  }),
  'oscA.semi': () => ({
    effect: '音の高さが半音単位で移動します。演奏するキーに合わせる調整にも使います',
    watch: 'スペクトル全体が横に移動するのに注目',
  }),
  'oscA.fine': (prev, next) => ({
    effect: Math.abs(next) > 30
      ? '大きなデチューンはピッチのズレとして聴こえ始めます'
      : 'わずかなピッチのズレ。複数オシレーターで互いにズラすと「うねり」と厚みが生まれます',
    watch: '波形がゆっくり流れるように動くのに注目（位相のズレ）',
  }),
  'oscA.level': (prev, next) => ({
    effect: next > prev ? 'オシレーターの音量が上がります' : 'オシレーターの音量が下がります',
    watch: 'OSC出口の波形の振幅（縦の大きさ）に注目',
  }),

  'filter.type': (prev, next) => {
    const def = paramById('filter.type');
    const opt = def.values.find((o) => o.v === next);
    return {
      effect: (opt ? opt.short + '。' : '') + '削る場所が変わると同じカットオフでも音の性格が一変します',
      watch: 'FILTER出口のスペクトルのどちら側が削られるかに注目',
    };
  },
  'filter.cutoff': (prev, next, patch) => {
    const wah = describeHasRoute(patch, 'lfo1', 'filter.cutoff')
      ? 'LFOがカットオフを揺らしているので、ワウの揺れの中心も一緒に動きます。' : '';
    if (next < prev) {
      return {
        effect: '高い倍音が削られて、音がこもって丸くなります。' + wah,
        watch: 'FILTER出口のスペクトルの右側（高域）が沈むのに注目',
      };
    }
    return {
      effect: '削られていた倍音が戻り、音が明るく開きます。' + wah,
      watch: 'FILTER出口のスペクトルの右側が立ち上がるのに注目',
    };
  },
  'filter.reso': (prev, next, patch) => {
    if (next > prev) {
      const low = patch['filter.cutoff'] < 800
        ? 'カットオフが低いので「ミョン」というクセ・うなりがはっきり出ます。' : '';
      return {
        effect: 'カットオフ付近の倍音が持ち上がり、クセのある鳴りになります。' + low + '上げすぎると自己発振気味の「ピー」が乗るので注意',
        watch: 'FILTER出口のスペクトルでカットオフの位置にできる「山」に注目',
      };
    }
    return { effect: 'カットオフ付近の強調が減り、おとなしい素直な鳴りに戻ります', watch: 'スペクトルの山が平らになるのに注目' };
  },

  'ampEnv.attack': (prev, next) => ({
    effect: next > prev
      ? '立ち上がりがゆっくりになり、ふわっと現れる音に（パッド向き）'
      : '立ち上がりが鋭くなり、弾いた瞬間に鳴る音に（プラック・ベース向き）',
    watch: '鍵盤を押した瞬間、AMP出口の波形が育つ速さに注目',
  }),
  'ampEnv.decay': () => ({
    effect: '最大音量からサステインの音量へ落ち着くまでの時間が変わります',
    watch: '鍵盤を押しっぱなしにして、音量が落ち着くまでの時間に注目',
  }),
  'ampEnv.sustain': (prev, next) => {
    if (next <= 0.05) {
      return {
        effect: 'サステイン0は「押さえ続けても音が残らない」減衰音。これがプラックの土台です',
        watch: '鍵盤を押しっぱなしにしても音が消えていくのを確認',
      };
    }
    return { effect: '鍵盤を押さえている間キープされる音量が変わります', watch: '押しっぱなしにしたときの音量に注目' };
  },
  'ampEnv.release': (prev, next) => ({
    effect: next > prev ? '鍵盤を離したあとの余韻が長くなります' : '鍵盤を離すとすぐ音が止まるようになります',
    watch: '鍵盤を離した後の音の消え方に注目',
  }),

  'lfo1.shape': (prev, next) => {
    const def = paramById('lfo1.shape');
    const opt = def.values.find((o) => o.v === next);
    return {
      effect: (opt ? opt.short + '。' : '') + '揺れの「形」が変わります',
      watch: 'モジュレーション線の脈打ち方と音の揺れ方が同じ形になるのに注目',
    };
  },
  'lfo1.rateHz': (prev, next) => ({
    effect: next > prev ? '揺れが速くなります。20Hz近くまで上げると揺れではなく「音色」に聴こえ始めます' : '揺れがゆっくりになります',
    watch: '線の脈動テンポが音の揺れと一致しているのに注目',
  }),

  'mod1.src': (prev, next) => (next === 'none'
    ? { effect: '変調元を外しました。配線が消え、揺れが止まります', watch: 'モジュレーション線が消えるのを確認' }
    : { effect: '変調元を接続しました。深さを上げると効果が現れます', watch: '変調元から伸びるモジュレーション線に注目' }),
  'mod1.dst': (prev, next) => {
    const dest = MOD_DESTS.find((d) => d.id === next);
    return (next === 'none' || !dest)
      ? { effect: '変調先を外しました', watch: 'モジュレーション線が消えるのを確認' }
      : { effect: dest.name + 'が自動で揺れるようになります。手で回す代わりにLFOが回してくれるイメージ', watch: '割当先ノブの外周リング（モッドリング）に注目' };
  },
  'mod1.amt': (prev, next) => ({
    effect: (Math.abs(next) > Math.abs(prev) ? '揺れ幅が大きくなります。' : '揺れ幅が小さくなります。')
      + (next < 0 ? 'マイナスなので逆方向に揺れます' : ''),
    watch: '割当先ノブのモッドリングの振れ幅が変わるのに注目',
  }),

  'master.gain': (prev, next) => ({
    effect: next > prev ? '全体の音量が上がります。耳に優しい音量で' : '全体の音量が下がります',
    watch: '出口のレベルメーターに注目',
  }),
};

// 変更1件の説明文3要素を生成する（説明パネルの駆動源）
function describeChange(id, prev, next, patch) {
  const p = paramById(id);
  if (!p) return null;
  let action;
  if (p.type === 'enum' || p.type === 'bool') {
    action = p.name + 'を ' + fmtValue(id, prev) + ' から ' + fmtValue(id, next) + ' に変更しました';
  } else {
    const dir = next > prev ? '上げました' : next < prev ? '下げました' : '設定しました';
    action = p.name + 'を ' + fmtValue(id, prev) + ' → ' + fmtValue(id, next) + ' に' + dir;
  }
  const fn = DESCRIBE[id];
  const detail = fn ? fn(prev, next, patch) : { effect: p.short, watch: '音の変化を聴き比べてみよう' };
  return { action, effect: detail.effect, watch: detail.watch };
}
