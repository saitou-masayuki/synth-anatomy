// シンセ解剖図 — オーディオエンジン（Web Audio層）。
// テスト済みの純粋ロジック（content-params / wavetables / mod-engine）の薄いラッパー。
// 音の実体と可視化ミラーが同じ数式を使うよう、エンベロープの現在値や
// LFO位相はすべて mod-engine.js の関数で計算する。
//
// 信号グラフ（Phase 1・モノフォニック）:
//   oscLo ┐（WTモーフ: 隣接2フレームの等パワークロスフェード）
//   oscHi ┴→ oscMix →[TAP osc]→ BiquadFilter →[TAP filter]→ ampGain(ENV1)
//        →[TAP amp]→ masterGain →[TAP out]→ ソフトクリッパー → コンプレッサー → 出力
//   LFO1（OscillatorNode ±1 / S&HはConstantSource）→ depthGain → 対象AudioParam

var SynthEngine = (() => {
  let ctx = null;
  let nodes = null;        // 音声ノード一式（初期化後に有効）
  let pwCache = [];        // フレーム番号 → PeriodicWave のキャッシュ
  let curLo = -1, curHi = -1; // 現在オシレーターに載っているフレーム番号
  let modNodes = [];       // アクティブな変調用depthGain（配線し直しで破棄）
  let controlRoutes = [];  // control-rate（wtPos等）のルート
  let patch = defaultPatch();
  let noteStack = [];
  let currentNote = null;
  let noteOnAt = null;     // ノートオン時刻（リトリガー時は連続性のため過去に補正される）
  let noteOffAt = null;    // ノートオフ時刻（押下中はnull）
  // LFO位相アキュムレーター: レート変更してもOscillatorNodeの位相連続性と一致させる
  let lfoPhase = { phase0: 0, tRef: 0 };

  const LFO_OSC_TYPE = { sine: 'sine', tri: 'triangle', saw: 'sawtooth', square: 'square' };

  function ensureAudio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC({ latencyHint: 'interactive' });
      buildGraph();
    }
    // 'suspended'（自動再生制限）だけでなく、iOSの 'interrupted'（電話・Siri等による
    // 中断）からも復帰させる。running 以外はすべて復帰を試みる（chord-lab実績パターン）
    if (ctx.state !== 'running') {
      try { ctx.resume(); } catch {}
    }
    return true;
  }

  function makeAnalyser() {
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    a.smoothingTimeConstant = 0.6;
    return a;
  }

  function getPW(frameIdx) {
    if (!pwCache[frameIdx]) {
      const f = WAVETABLES['wt.basic'].frames[frameIdx];
      pwCache[frameIdx] = ctx.createPeriodicWave(Float32Array.from(f.real), Float32Array.from(f.imag));
    }
    return pwCache[frameIdx];
  }

  function buildGraph() {
    const t = ctx.currentTime;
    const n = {};
    n.oscLo = ctx.createOscillator();
    n.oscHi = ctx.createOscillator();
    n.gLo = ctx.createGain();
    n.gHi = ctx.createGain();
    n.oscMix = ctx.createGain();
    n.tapOsc = makeAnalyser();
    n.filter = ctx.createBiquadFilter();
    n.tapFilter = makeAnalyser();
    n.ampGain = ctx.createGain();
    n.tapAmp = makeAnalyser();
    n.masterGain = ctx.createGain();
    n.tapOut = makeAnalyser();
    n.clip = ctx.createWaveShaper();
    n.comp = ctx.createDynamicsCompressor();

    // 聴覚保護のソフトクリッパー（tanh）。レゾナンス自励発振などの突発ピークを丸める
    const N = 1024;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = Math.tanh(1.8 * x) / Math.tanh(1.8);
    }
    n.clip.curve = curve;
    n.clip.oversample = '2x';
    n.comp.threshold.value = -10;
    n.comp.knee.value = 10;
    n.comp.ratio.value = 4;
    n.comp.attack.value = 0.003;
    n.comp.release.value = 0.25;

    n.oscLo.connect(n.gLo).connect(n.oscMix);
    n.oscHi.connect(n.gHi).connect(n.oscMix);
    n.oscMix.connect(n.tapOsc);
    n.oscMix.connect(n.filter);
    n.filter.connect(n.tapFilter);
    n.filter.connect(n.ampGain);
    n.ampGain.connect(n.tapAmp);
    n.ampGain.connect(n.masterGain);
    n.masterGain.connect(n.tapOut);
    n.masterGain.connect(n.clip);
    n.clip.connect(n.comp);
    n.comp.connect(ctx.destination);

    n.ampGain.gain.value = 0;
    n.oscMix.gain.value = patch['oscA.level'];
    n.masterGain.gain.value = patch['master.gain'];

    // LFO1: 通常波形はOscillatorNode（±1のオーディオレート）、S&HはConstantSourceを
    // controlTick()（60Hzミラー）で更新する
    n.lfoOsc = ctx.createOscillator();
    n.lfoOsc.frequency.value = patch['lfo1.rateHz'];
    n.shSrc = ctx.createConstantSource();
    n.shSrc.offset.value = 0;

    n.oscLo.start(t);
    n.oscHi.start(t);
    n.lfoOsc.start(t);
    n.shSrc.start(t);
    lfoPhase = { phase0: 0, tRef: t };

    nodes = n;
    applyWave(patch['oscA.wave'], true);
    applyFilter();
    applyModRouting();
  }

  // ---- パラメーター適用 ----

  function smoothSet(param, v, smoothing) {
    param.setTargetAtTime(v, ctx.currentTime, smoothing || 0.01);
  }

  function applyWave(v, immediate) {
    const table = WAVETABLES['wt.basic'];
    if (v === 'wt.basic') {
      applyWtPos(patch['oscA.wtPos'], immediate);
      return;
    }
    // クラシック波形 = 教材テーブルの単一フレーム（音・波形・スペクトルの出所を統一）
    const idx = table.frameNames.indexOf(v);
    const pw = getPW(idx >= 0 ? idx : 2);
    nodes.oscLo.setPeriodicWave(pw);
    curLo = idx; curHi = -1;
    if (immediate) {
      nodes.gLo.gain.value = 1;
      nodes.gHi.gain.value = 0;
    } else {
      smoothSet(nodes.gLo.gain, 1, 0.015);
      smoothSet(nodes.gHi.gain, 0, 0.015);
    }
  }

  function applyWtPos(pos, immediate) {
    const table = WAVETABLES['wt.basic'];
    const { lo, hi, mix } = wtFrameMix(pos, table.frames.length);
    if (lo !== curLo) { nodes.oscLo.setPeriodicWave(getPW(lo)); curLo = lo; }
    if (hi !== curHi) { nodes.oscHi.setPeriodicWave(getPW(hi)); curHi = hi; }
    // 等パワークロスフェード（中間位置で音量が凹まない）
    const gLo = Math.cos(mix * Math.PI / 2);
    const gHi = Math.sin(mix * Math.PI / 2);
    if (immediate) {
      nodes.gLo.gain.value = gLo;
      nodes.gHi.gain.value = gHi;
    } else {
      smoothSet(nodes.gLo.gain, gLo, 0.015);
      smoothSet(nodes.gHi.gain, gHi, 0.015);
    }
  }

  function filterQFromReso(type, reso) {
    // BiquadFilterのQはLP/HPではdB解釈、BPでは無次元。教育上の安全のため上限は控えめ
    if (type === 'bp12') return 0.5 + reso * 9.5;
    return reso * 22;
  }

  function applyFilter() {
    const map = { lp12: 'lowpass', hp12: 'highpass', bp12: 'bandpass' };
    nodes.filter.type = map[patch['filter.type']] || 'lowpass';
    smoothSet(nodes.filter.frequency, patch['filter.cutoff'], 0.01);
    smoothSet(nodes.filter.Q, filterQFromReso(patch['filter.type'], patch['filter.reso']), 0.01);
  }

  function lfoSourceNode() {
    return patch['lfo1.shape'] === 'sh' ? nodes.shSrc : nodes.lfoOsc;
  }

  // モジュレーション配線の全再構築（スロット変更・LFO波形変更時）
  function applyModRouting() {
    for (const g of modNodes) { try { g.disconnect(); } catch {} }
    modNodes = [];
    controlRoutes = [];
    const src = lfoSourceNode();
    for (const route of resolveModRoutes(patch)) {
      if (route.kind === 'control') {
        controlRoutes.push(route);
        continue;
      }
      const dg = ctx.createGain();
      dg.gain.value = route.amt * route.range;
      src.connect(dg);
      if (route.dst === 'filter.cutoff') {
        dg.connect(nodes.filter.detune); // セント単位 = 音楽的（対数）スケールの変調
      } else if (route.dst === 'oscA.pitch') {
        dg.connect(nodes.oscLo.detune);
        dg.connect(nodes.oscHi.detune);
      } else if (route.dst === 'oscA.level') {
        dg.connect(nodes.oscMix.gain);
      }
      modNodes.push(dg);
    }
  }

  function currentAdsr() {
    return {
      attack: patch['ampEnv.attack'],
      decay: patch['ampEnv.decay'],
      sustain: patch['ampEnv.sustain'],
      release: patch['ampEnv.release'],
    };
  }

  // エンベロープの現在値（音とミラーで同一の式 = mod-engine.envValue）
  function currentEnvValue(t) {
    if (noteOnAt === null) return 0;
    return envValue(currentAdsr(), t - noteOnAt, noteOffAt === null ? null : t - noteOffAt);
  }

  function setPitch(note) {
    const freq = midiToFreq(note + patch['oscA.octave'] * 12 + patch['oscA.semi']);
    smoothSet(nodes.oscLo.frequency, freq, 0.005);
    smoothSet(nodes.oscHi.frequency, freq, 0.005);
    currentNote = note;
  }

  // ---- 公開API ----

  function noteOn(note) {
    if (!ensureAudio()) return;
    noteStack = noteStackPush(noteStack, note);
    setPitch(note);
    const t = ctx.currentTime;
    const adsr = currentAdsr();
    const cur = currentEnvValue(t);
    // リトリガー: 現在値からアタックを再開する。ミラー（envValue）と一致させるため、
    // ノートオン時刻を「現在値ぶんアタックが進んだ過去」に補正する
    noteOnAt = t - cur * adsr.attack;
    noteOffAt = null;
    const g = nodes.ampGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    const tPeak = t + adsr.attack * (1 - cur);
    g.linearRampToValueAtTime(1, tPeak);
    // ディケイ/リリースは指数収束。時定数=時間/3（envValueと同じ形）
    g.setTargetAtTime(adsr.sustain, tPeak, adsr.decay / 3);
  }

  function noteOff(note) {
    if (!ctx) return;
    noteStack = noteStackRemove(noteStack, note);
    if (noteStack.length > 0) {
      // 後着優先: 残っている一番新しい鍵にレガートで戻る（エンベロープは継続）
      if (note === currentNote) setPitch(noteStack[noteStack.length - 1]);
      return;
    }
    const t = ctx.currentTime;
    const cur = currentEnvValue(t);
    const g = nodes.ampGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.setTargetAtTime(0, t, currentAdsr().release / 3);
    noteOffAt = t;
  }

  function applyParam(id, value) {
    const def = paramById(id);
    if (!def) return;
    value = def.type === 'float' || def.type === 'int' ? clampParam(id, value) : value;
    patch[id] = value;
    if (!nodes) return; // 初期化前はパッチにだけ反映（初期化時にまとめて適用される）
    switch (id) {
      case 'oscA.wave': applyWave(value); break;
      case 'oscA.wtPos':
        if (patch['oscA.wave'] === 'wt.basic' && controlRoutes.length === 0) applyWtPos(value);
        break; // 変調中はcontrolTickが実効値で更新する
      case 'oscA.octave':
      case 'oscA.semi':
        if (currentNote !== null) setPitch(currentNote);
        break;
      case 'oscA.fine': smoothSet(nodes.oscLo.detune, value, 0.01); smoothSet(nodes.oscHi.detune, value, 0.01); break;
      case 'oscA.level': smoothSet(nodes.oscMix.gain, value, 0.01); break;
      case 'filter.type':
      case 'filter.cutoff':
      case 'filter.reso': applyFilter(); break;
      case 'lfo1.shape': {
        if (value !== 'sh') nodes.lfoOsc.type = LFO_OSC_TYPE[value];
        applyModRouting(); // S&H⇔通常波形で変調元ノードが替わる
        break;
      }
      case 'lfo1.rateHz': {
        // 位相アキュムレーターを現在位相で切り直してから周波数を変える
        // （OscillatorNodeの位相連続性とミラー計算を一致させる）
        const t = ctx.currentTime;
        lfoPhase.phase0 = mirrorLfoPhase(t);
        lfoPhase.tRef = t;
        smoothSet(nodes.lfoOsc.frequency, value, 0.02);
        break;
      }
      case 'mod1.src':
      case 'mod1.dst':
      case 'mod1.amt': applyModRouting(); break;
      case 'master.gain': smoothSet(nodes.masterGain.gain, value, 0.02); break;
      // ampEnv.* は次のノートイベントから効く（保持値のみ更新）
    }
  }

  function applyPatch(dict) {
    for (const [id, v] of Object.entries(dict)) applyParam(id, v);
  }

  function getPatch() {
    return Object.assign({}, patch);
  }

  // LFOの未ラップ位相（S&Hの周期番号にも使うため 0..1 に折り返さない）
  function mirrorLfoPhase(t) {
    return lfoPhase.phase0 + (t - lfoPhase.tRef) * patch['lfo1.rateHz'];
  }

  // 実際に「聴こえている」時刻。可視化はこの時刻でミラー計算する
  // （iOS/Bluetoothでは出力遅延が100ms超あり、補正しないと線の脈動と音がズレる）
  function audibleTime() {
    if (!ctx) return 0;
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  // 制御レートtick（viz.jsの単一rAFループから毎フレーム呼ばれる）。
  // S&Hの音源更新・wtPos変調の適用を行い、可視化用のミラー値を返す
  function controlTick() {
    if (!ctx) return null;
    const tAud = audibleTime();
    const lfoVal = lfoValue(patch['lfo1.shape'], mirrorLfoPhase(tAud), 1);
    if (patch['lfo1.shape'] === 'sh') {
      // 音の実体側も同じミラー値で駆動する（ctx.currentTime基準で先行入力）
      const nowVal = lfoValue('sh', mirrorLfoPhase(ctx.currentTime), 1);
      nodes.shSrc.offset.setTargetAtTime(nowVal, ctx.currentTime, 0.002);
    }
    let wtPosEffective = patch['oscA.wtPos'];
    for (const route of controlRoutes) {
      if (route.dst === 'oscA.wtPos') {
        wtPosEffective = Math.min(1, Math.max(0, patch['oscA.wtPos'] + modContribution(route, lfoVal)));
        if (patch['oscA.wave'] === 'wt.basic') applyWtPos(wtPosEffective);
      }
    }
    const envVal = noteOnAt === null ? 0
      : envValue(currentAdsr(), tAud - noteOnAt, noteOffAt === null ? null : tAud - noteOffAt);
    return { lfoVal, envVal, wtPosEffective, routes: resolveModRoutes(patch) };
  }

  return {
    ensureAudio,
    noteOn,
    noteOff,
    applyParam,
    applyPatch,
    getPatch,
    controlTick,
    audibleTime,
    get taps() { return nodes ? { osc: nodes.tapOsc, filter: nodes.tapFilter, amp: nodes.tapAmp, out: nodes.tapOut } : null; },
    get ready() { return !!nodes; },
    get playing() { return noteOnAt !== null && noteOffAt === null; },
    get audioCtx() { return ctx; },
  };
})();
