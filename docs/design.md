# シンセ解剖図（synth-anatomy）— ソフトシンセ学習ツール 実装プラン

## Context（背景と目的）

ソフトウェア・シンセサイザー（Serum / Vital などウェーブテーブル系）は、パラメーター間の繋がりが複雑で、「ここをいじると、ここがこう変化する」という関係性が初学者には見えにくい。本プロジェクトは、ユーザー自身の学習用として、**信号の流れ図そのものがUIになったブラウザ内蔵シンセ**を作り、音を鳴らしながら触ることでパラメーターの関係性を直感的に理解できるようにする。

ブレインストーミングでの決定事項:

- **対象**: 自分自身の学習用。GitHub Pagesで公開（PWA、iPhone等からもアクセス可）
- **形態**: ブラウザアプリ。Web Audio APIによる内蔵シンセ（実機のSerum/Vitalへの理解転移を狙う）
- **アプローチ**: 案A「シンセ解剖図」— OSC → FILTER → AMP → FX の信号フロー図が画面の主役。各ブロックの出口で波形・スペクトルをリアルタイム表示。LFO/ENVからのモジュレーション線が実際の変調と同期して脈打つ
- **コアループ（段階導入）**: ①可視化サンドボックス → ②サウンドレシピ再現クエスト → ③耳トレクイズ → ④Serum/Vital実機対応表
- **技術**: [chord-lab](/Users/masayukisaito/develop/chord-lab) の実績構成を踏襲（ビルド不要バニラJS、`<script>`直列読み込み、`node --test`+`vm`テスト、PWA、GitHub Pages）
- **演奏入力（Phase 1）**: 画面SVG鍵盤＋PCキーボード。MIDI対応は後続Phase
- **新規プロジェクト**: `/Users/masayukisaito/develop/synth-anatomy/`（表示名「シンセ解剖図」。名称は実装時に変更可）

設計は3視点（音声エンジン / 可視化UI / 学習コンテンツ）の並列設計＋統合レビューで検証済み。以下は矛盾解決後の統合版。

---

## 設計の背骨: 統一パラメーター定義

**全機能（エンジン・UI・解説・レシピ・クイズ・実機対応表）が `content-params.js` の1つの定義を参照する。** これが本プロジェクトの最重要アーキテクチャ決定。

```js
// content-params.js — 純粋データ（関数を含まない。テストで強制）
const PARAMS = [{
  id: 'filter.cutoff',        // ドット区切りの安定ID（全コンテンツの語彙）
  block: 'filter',            // 解剖図上の所属ブロック
  name: 'カットオフ', nameEn: 'Cutoff',
  type: 'float',              // float | int | enum | bool
  ui: 'knob',                 // knob | select | toggle
  min: 20, max: 18000, default: 2000,
  curve: 'log',               // lin | log | exp2（正規化・クイズdelta・レシピtolは全てこの空間で扱う）
  unit: 'Hz', fmt: 'hz',
  smoothing: 0.01,            // setTargetAtTime時定数（エンジン用）
  modTarget: true, modRate: 'audio', modRange: 4800,  // 変調可否・方式・振幅（エンジン用）
  short: '削り始める高さ。下げるほど音がこもる',   // ツールチップ・ノブ下の一言
  long: ['…'], hear: '…',     // 詳しい解説・聴きどころ
  quiz: { pool: 1, minDelta: 0.12 },  // クイズ初登場Lv・知覚可能な最小変化量
  unitIntro: 'u2',            // 学習マップのどのUnitで解禁か
  phase: 1,                   // 実装Phase区分
}, /* ... */];
```

**モジュレーションは固定4スロットのパラメーター**（`mod1..mod4` の `.src` / `.dst` / `.amt`）。これにより配線を含む全状態が平坦な辞書 `{paramId: value}` ＝パッチで表現でき、プリセット・レシピ目標音・クイズ出題が全て同じ形式になる。Serumの「MATRIXの1行」、Vitalのドラッグ割当への転移説明もスロット単位で自然に接続する。

文脈依存の動的説明文（「今なにが起きた？」パネル）は純データ制約と両立させるため **`describe-engine.js` に関数表として分離**し、「全paramIdにdescribe関数が存在する」ことを整合性テストで強制する。

### パラメーターID体系（主要なもの）

```
oscA.wave(sine|tri|saw|square|wt.basic) / .wtPos(0..1) / .octave / .semi / .fine / .level
oscA.uniVoices(1..7) / .uniDetune / .uniWidth        ← Phase 1.5
oscB.*（クラシック波形のみ） / noise.on/.color/.level  ← Phase 1.5
filter.type(lp12|hp12|bp12 → Phase 2で lp24) / .cutoff / .reso / .drive(Ph2) / .keyTrack(Ph2)
ampEnv.attack/.decay/.sustain/.release   （ENV1表示。アンプ直結固定 = Serum/Vitalと同じ）
modEnv.attack/...                        （ENV2表示。自由割当）← Phase 1.5
lfo1.shape/.rateMode(hz|sync)/.rateHz/.rateSync/.fade（sync・fadeはPhase 2）
mod1..mod4.src(none|lfo1|lfo2|modEnv|velocity|wheel) / .dst / .amt(-1..+1)
fx.dist.* / fx.chorus.*(Ph2) / fx.delay.* / fx.reverb.*   ← Phase 1.5〜2
master.gain / .mode(poly|mono) / .glide(Ph2) / .bpm(Ph2: rateSync等の基準クロック)
```

---

## アーキテクチャ

### Web Audioノードグラフ

```
【ボイス層（Voiceクラス、Phase 1はmaxVoices=1）】
 OSC A（PeriodicWave 2本クロスフェード=WTモーフ）─┐
 OSC B / NOISE（Phase 1.5）───────────────────┤→ mixer →[TAP1] → BiquadFilter →[TAP2] → ampGain(ENV1)
【マスター層】voiceSum → Dist → (Chorus Ph2) → Delay → Reverb →[TAP3: AMP後/FX前は voiceSum側=TAP3, FX後=TAP4]
  … 正確には TAP×4: ①OSC出口 ②FILTER出口 ③AMP出口(voiceSum) ④FX出口(masterGain)
 → masterGain → tanhソフトクリッパー(WaveShaper) → DynamicsCompressor → destination
【モジュレーション層（二層方式）】
 音: LFO=OscillatorNode(±1)/ENV=ConstantSourceNode → depthGain → 対象AudioParam（サンプル精度）
 見た目: 同じ数式をJSで再計算（60Hz rAF）→ 線の発光・モッドリング・WTポジション等の control-rate 対象
```

主要な技術判断（設計エージェント検証済み）:

- **WTモーフはPeriodicWaveクロスフェードで実装**（AudioWorklet不要）。フレームを倍音スペクトル（real/imag）で宣言的に定義 → 自動帯域制限でエイリアシングなし、波形描画・スペクトル・音が同一データから導ける。WTポジションは `modRate:'control'`（60Hz更新）
- **フィルター/ピッチの変調は `detune`（セント）経由**。Hz線形加算の「低域で効きすぎ問題」を回避し、音楽的な対数スケール変調をノード接続だけで実現
- **可視化と音の位相ズレ対策**: JSミラー計算の基準時刻を `currentTime - (ctx.outputLatency ?? ctx.baseLatency ?? 0)` で補正（iOS/Bluetoothで100〜300msズレるため必須）
- **聴覚保護**: 最終段に tanhソフトクリッパー＋DynamicsCompressor の二段構え（レゾナンス自励発振＋Dist対策）。初回起動時のマスター音量は低めに
- **Biquad破綻対策**: resoの実効上限を控えめに設定し、cutoffへの高速LFO変調幅をクランプ（ウォブル系で係数急変ブローアップが起き得るため。Phase 1で耳検証）
- エンジンの公開契約は `applyParam(id, value)` / `applyPatch(dict)` / `getPatch()` / `playPhrase(audition)` の4つのみ

### 画面レイアウト（4バンド構成、デスクトップ1画面）

```
ヘッダー（シンプル|フル切替 / プリセット / 音量 / テーマ）
────────────────────────────────────────
信号ラック:  [OSC]═▶[FILTER]═▶[AMP]═▶[FX枠]═▶🔊   ← 各ブロック出口にCanvasミニスコープ
             （波形＋スペクトル。ゼロクロストリガーで静止表示。CSS Grid配置）
モジュレーターラック: [ENV1→AMP固定] [ENV2(Ph1.5)] [LFO1 波形/速さ/深さ/割当]
             ↑SVGオーバーレイ1枚でモジュレーション線を描画。JSミラー値で脈動
────────────────────────────────────────
説明パネル（全幅帯）: 「今なにが起きた？」— 何をしたか/音はどうなるか/どこを見るか の3要素
SVG鍵盤 C3〜C5（25鍵）＋PCキーボード演奏（A,W,S,E,D... Z/Xオクターブ）
```

- 描画は3層: DOM+SVGノブ（ブロック・ノブ） / SVGオーバーレイ（結線・変調線） / Canvas（スコープ）
- rAFループは全画面で1本。スペクトルは30fps間引き、`document.hidden`で停止、型付き配列使い回し
- SVG `path.getPointAtLength()` はSafariで遅いため線の点列を事前サンプリングしてキャッシュ
- ノブ: 縦ドラッグ（`setPointerCapture`＋**`touch-action: none`必須**）/ Shift微調整 / ホイール / ダブルクリックでデフォルト復帰 / ドラッグ中は「8.2kHz → 3.1kHz」形式の値バブル
- 「変化の見える化」のコア演出は**ゴースト波形（変更前を破線で2秒重ねる）＋値バブル**の2つに絞る（差分塗り・下流ハイライト等はPhase 1.5+）
- モジュレーション割当はPhase 1では**クリック選択式**（割当ボタン→割当可能ノブが光る→クリックで確定）。Vital風ドラッグ&ドロップはPhase 2で併設
- シンプル/フル2モード。シンプルでもブロック枠は全部見せて中身だけ隠す（解剖図の全体形を崩さない）

### ファイル構成

```
synth-anatomy/
├── index.html / styles.css / sw.js / manifest.webmanifest / icon-*.png
├── content-params.js   # ★統一パラメーター定義＋解説（純粋データ。最初に書く）
├── wavetables.js       # ★教材テーブルのスペクトル定義（純粋）
├── mod-engine.js       # ★LFO/ADSR数式・modスロット解決・ボイス割当（純粋）
├── describe-engine.js  # ★「今なにが起きた？」文生成の関数表（純粋ロジック）
├── synth-engine.js     # Web Audioグラフ構築・Voice管理・applyPatch/getPatch/playPhrase
├── viz.js              # Canvasスコープ・SVGオーバーレイ・モジュレーション線
├── app.js              # UI結線・ノブ・鍵盤・iOS解錠・localStorage
├── content-units.js    # 学習マップUnit 0〜9（Phase 1.5〜）
├── content-recipes.js / recipe-engine.js   # Phase 2
├── content-quiz.js / quiz-engine.js        # Phase 3
├── content-map.js      # Serum/Serum2/Vital対応表（Phase 4）
└── test/*.test.mjs     # node --test + vm（chord-lab方式）
```

依存方向: `app.js → synth-engine.js → (content-params.js, wavetables.js, mod-engine.js)`、`viz.js → mod-engine.js`（同じ数式を参照）。純粋ファイル群はDOM/AudioContextを一切触らない。

### chord-labから流用する実績パターン

| パターン | 流用元 |
|---|---|
| AudioContext遅延生成・`interrupted`込みresume・無音WAVループによるiOSマナーモード解錠 | [app.js:390-510](/Users/masayukisaito/develop/chord-lab/app.js) |
| SVG鍵盤・ポインターMap・グリッサンド・PCキー演奏 | app.js:148-205, 2834-2935 |
| リリース時の cancelScheduledValues→setValueAtTime→ランプ | app.js:457-463 |
| `node --test`+`vm.createContext` の純粋ロジックテスト | [test/chord-engine.test.mjs](/Users/masayukisaito/develop/chord-lab/test/chord-engine.test.mjs) |
| レベル定義const配列・rng注入・弱点重み付き抽選 `trainerWeightedPick` | [trainer-engine.js](/Users/masayukisaito/develop/chord-lab/trainer-engine.js)（Phase 3で） |
| テーマCSS変数・`.lab-readout`（説明パネル）・localStorageバージョン管理 | styles.css / app.js:37-110 |
| ネットワーク優先SW・PWAメタ・`python3 -m http.server` のlaunch.json | sw.js / index.html / .claude/launch.json |

---

## 実装ロードマップ

### Phase 1: 可視化サンドボックス（最初に作る・単独で価値が出る）

統合レビューの結論に従い**UIコア基準でスコープを確定**（音が出てもUIから触れない機能は作らない）:

1. プロジェクト初期化: ディレクトリ作成、git init、chord-labから足回りコピー（SW/manifest/launch.json/テーマCSS）、本プランを`docs/`に設計書として保存
2. `content-params.js`（Phase 1セット）＋ `wavetables.js`（教材テーブル「ベーシック」1本: sine→tri→saw→square）＋テスト
3. `mod-engine.js`（LFO波形数式・ADSR評価・modスロット解決）＋テスト
4. `synth-engine.js`: モノボイス、**OSC A**（クラシック4波形＋WTモーフ＋ピッチ）→ **FILTER**（LP12/HP12/BP12、cutoff/reso）→ **ENV1**（アンプ固定）、**LFO1**＋mod1スロット（割当先: cutoff/ピッチ/WT位置/OSCレベル）、TAP×4、ソフトクリッパー＋コンプ、iOS解錠流用
5. UI: 4バンドレイアウト、ノブコンポーネント、Canvasスコープ（ゼロクロストリガー、単一rAF）、SVGオーバーレイ（音声パイプ＋ENV1固定線＋LFO脈動線＋モッドリング）、クリック選択式割当
6. 説明パネル（`describe-engine.js`）＋ゴースト波形演出
7. SVG鍵盤＋PCキーボード（chord-lab移植）、プリセット保存/読込（localStorage、スキーマバージョン付き）
8. GitHub Pages公開

### Phase 1.5: 音作りの幅を広げる

OSC B・NOISE・ユニゾン（1-7声/デチューン/ブレンド）・ENV2（自由割当）・FX（Dist/Delay/Reverb）・コーチマーク・スペクトル差分塗り・下流ハイライト。**iOS実機でのノード数上限・fps計測タスクをユニゾン導入前に実施**（iPhoneでの実用性判断）。学習マップ（`content-units.js`、ブロック段階公開）もここから。

Codexレビュー（2026-07-06）からの持ち越しバックログ:
- ノブのキーボード操作とアクセシビリティ（`role="slider"`・`aria-value*`・矢印キー操作）
- WT位置のLFO変調は音側が約30Hz駆動＋平滑化のため、LFO 20Hz付近では表示（解析式）と実音がなまり分ズレる既知の制約。対策候補: control-rate宛のLFO実効上限を下げる、または音側の実効値を表示にも使う

マルチエージェントレビュー（音作りテスト/聞き取りテスト実装、2026-07-06）からの持ち越しバックログ:
- `phraseNotes`（エンジン内）と`noteRefs`（app.js、画面鍵盤/PCキー用の参照カウント）が別管理なため、試聴フレーズと同じMIDIノートをユーザーが同時に押さえていると片方のnoteOffがもう一方の発音を止める。低頻度・低影響のため未対応
- ~~ビブラート・リードのmod1.amt(目標0.04)は既定tolだとamt=0でも数式上は許容範囲内になる~~ → **修正済み（2026-07-10）**。src/dst配線後に深さノブをダブルクリック（初期値0にリセット）すると「揺れゼロのビブラート」が合格に到達できたため、recipeParamDistanceで揺れの有無の不一致（amt=0⇔amt≠0）を距離1として扱うようにした
- Lv2のampEnv.decayは「増加」方向の変化がqz-pad（sustain 0.6）の試聴時間内でわずかしか聴き取れない場合がある。ベースパッチのsustainを下げる・試聴を延ばす等の調整余地あり

### 動線改善（2026-07-06 ユーザーフィードバック対応）

「3モードが独立してバラバラに感じる」「触った結果が実感しにくい」への対応:

- **A. モード説明ストリップ**: ヘッダー直下に現在のモードの一言説明を常時表示
- **B. タブ進捗**: 「つくる 2/6」「きく 1/3」のようにタブへ進捗を表示（updateNavProgress）
- **C. 相互リンク**: レシピ完成画面に「次のテストへ/さわるで続ける/きくで耳を試す」、クイズ結果画面に「次のレベルへ/つくるで音作りを試す」。初回のみ「さわる」に「つくる」への案内バナー（settings.introSeenで一度きり）
- **D. 操作フィードバック**: ノブのドラッグ中は対応スコープの枠を強調（Viz.setScopeActive）、説明パネル更新時に短いフラッシュ

### 「つくる」抜本再設計（2026-07-07・診断チャレンジ方式へ移行）

ユーザーからのフィードバック: 「さわる/つくる/きく」の3区分がバラバラに感じる、「きく」の抽象的な
パラメーター当てクイズは不要（音作りを学びたいのであってパラメーター当てゲームがしたいわけではない）、
「聞いた音をどう再現するか＝どういうアプローチをすればいいか」を問う動線に絞ってほしい、との指摘を受け、
以下の旧計画（Phase 2〜3として設計していたレシピ10本＋耳トレクイズLv1〜5）を破棄し、
「つくる」1本に統合した「診断チャレンジ」方式に作り直した。

- 24系統のWebリサーチ（CodeGym/LeetCode/Exercismの課題提示・ヒント段階構造、Ableton Learning Synths、
  Syntorial、耳トレアプリ等）＋6名の独立設計者による判事パネル方式で設計を合成（Workflowツール使用）
- モードは2つ（さわる／つくる）に削減。「きく」の当てクイズ（quiz-engine.js/content-quiz.js）は削除し、
  弱点重み付き抽選の発想だけ将来の一覧並び替えに転用可能な形で温存（現状は未使用）
- 「つくる」は目標を伏せた発見型: 手順を最初から見せず、「お手本を聴く/いまの音を聴く」で聴き比べ、
  「答え合わせ」（ブロック単位のズレ件数のみ、パラメーター名や数値は明かさない）、「ヒントを見る」
  （3段階: 抽象的な聴きどころ→注目ブロック名→ブロックごとの具体的操作。一度開いたら閉じない）で
  自力で近づけていく。全ブロック一致で「完成の一撃」（信号ラックを光が走る演出）
- 技術: `recipe-engine.js`にrecipeTargetBlocks/recipeJudgeAll/recipeBlockCloseness
  （近さは平均でなく**最悪の1パラメーター**で決める。平均だと大きなズレが他の近い項目に薄められる
  ことが実装後の手動テストで判明したため修正）を追加。`content-recipes.js`はsteps[]配列を廃止し、
  approach（抽象ヒント）/blockHints（ブロック別の具体的ヒント）/insight（完成後の一言）に置き換え。
  既存の6レシピのgoal/target/audition/文言はほぼそのまま再利用
- 未着手の関連バックログ: Serum/Serum 2/Vital実機対応表（`content-map.js`、paramIdごとの場所・名称、
  `match: exact|similar|concept|none`の4値、ノブ長押しポップアップで表示）

---

## 検証方法

- **自動テスト**: `node --test test/*.test.mjs`（chord-lab方式）。パラメーター定義の範囲・カーブ往復・describe網羅、wavetableスペクトル整合性、LFO/ADSR数式、modスロット解決、診断チャレンジの答え合わせ・近さ判定・blockHints網羅性
- **動作確認**: `.claude/launch.json`（python3 http.server）でローカル起動し、Claude Previewブラウザで確認 — 鍵盤で音が鳴る / カットオフを回すとFILTER出口のスペクトルが削れて見える / LFO割当で線が脈動しモッドリングが実際の変調位置で動く / 波形が静止して読める、を目視・聴覚確認
- **音と表示の同期**: LFOをcutoffに割り当て、「音がワウと開く瞬間に線が山になる」ことを確認（outputLatency補正の検証）
- **実機**: デスクトップChrome/Safari、iPhone Safari（マナーモード解錠・touch-action・fps）
- **公開後**: GitHub Pages URLでPWAインストールとオフライン動作を確認
