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
  let modNodes = [];       // アクティブな変調 { dg, route }（配線し直しで破棄）
  let driveTimer = null;   // S&H・wtPos変調の音側駆動タイマー（rAF停止中も動く）
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
    n.oscLo.detune.value = patch['oscA.fine'];
    n.oscHi.detune.value = patch['oscA.fine'];
    n.gLo = ctx.createGain();
    n.gHi = ctx.createGain();
    n.oscMix = ctx.createGain();
    n.trem = ctx.createGain(); // レベル変調用（基準1。1+amt×LFOで0〜2に収まり位相反転しない）
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
    n.oscMix.connect(n.trem);
    n.trem.connect(n.tapOsc);
    n.trem.connect(n.filter);
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
    n.trem.gain.value = 1;
    n.masterGain.gain.value = patch['master.gain'];

    // LFO1: 通常波形はOscillatorNode（±1のオーディオレート）、S&HはConstantSourceを
    // audioDriveTick()（タイマー駆動ミラー）で更新する
    n.lfoOsc = ctx.createOscillator();
    n.lfoOsc.frequency.value = patch['lfo1.rateHz'];
    n.lfoOsc.type = LFO_OSC_TYPE[patch['lfo1.shape']] || 'sine';
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
    applyModRouting(); // 末尾のupdateDriveTimer()が必要ならタイマーを起動する
  }

  // S&H・wtPos変調は音そのものを駆動するため、可視化のrAF（非表示タブで停止）とは
  // 独立したタイマーで回す。ただし常時回すと無操作時もAudioParamスケジュールを
  // 積み続けてバッテリーを消費するため、必要な間だけ起動する。
  // 判定はoscA.waveに依存させない（wave切替はapplyModRoutingを通らないため、
  // waveで止めるとwt.basicへ戻したとき再開の機会がない）
  function needsAudioDrive() {
    return patch['lfo1.shape'] === 'sh' || wtPosModRoute() !== null;
  }

  function updateDriveTimer() {
    const need = !!nodes && needsAudioDrive();
    if (need && driveTimer === null) driveTimer = setInterval(audioDriveTick, 33);
    else if (!need && driveTimer !== null) { clearInterval(driveTimer); driveTimer = null; }
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
    // フレームをパリティで振り分ける（偶数フレーム=oscLo、奇数フレーム=oscHi）。
    // 境界をまたぐとき波形を差し替えるのは常にゲイン0側のオシレーターになり、
    // 鳴っている側のsetPeriodicWaveによるクリック・誤った音色遷移が出ない
    const loIsEven = lo % 2 === 0;
    const evenFrame = loIsEven ? lo : hi;
    const oddFrame = loIsEven ? hi : lo;
    // 等パワークロスフェード（中間位置で音量が凹まない）
    const gEven = loIsEven ? Math.cos(mix * Math.PI / 2) : Math.sin(mix * Math.PI / 2);
    const gOdd = loIsEven ? Math.sin(mix * Math.PI / 2) : Math.cos(mix * Math.PI / 2);
    if (evenFrame !== curLo) { nodes.oscLo.setPeriodicWave(getPW(evenFrame)); curLo = evenFrame; }
    if (oddFrame !== curHi) { nodes.oscHi.setPeriodicWave(getPW(oddFrame)); curHi = oddFrame; }
    const smoothing = paramById('oscA.wtPos').smoothing;
    if (immediate) {
      nodes.gLo.gain.value = gEven;
      nodes.gHi.gain.value = gOdd;
    } else {
      smoothSet(nodes.gLo.gain, gEven, smoothing);
      smoothSet(nodes.gHi.gain, gOdd, smoothing);
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
    // depthGainの出力だけでなく、変調元→depthGainの入力側も切断する
    // （出力だけ切ると旧GainNodeが変調元に保持され続けてリークする）
    for (const m of modNodes) { try { m.dg.disconnect(); } catch {} }
    if (nodes) {
      try { nodes.lfoOsc.disconnect(); } catch {}
      try { nodes.shSrc.disconnect(); } catch {}
    }
    modNodes = [];
    const src = lfoSourceNode();
    for (const route of resolveModRoutes(patch)) {
      if (route.kind === 'control') continue; // wtPos等はaudioDriveTickが毎tick解決する
      const dg = ctx.createGain();
      dg.gain.value = route.amt * route.range;
      src.connect(dg);
      if (route.dst === 'filter.cutoff') {
        dg.connect(nodes.filter.detune); // セント単位 = 音楽的（対数）スケールの変調
      } else if (route.dst === 'oscA.pitch') {
        dg.connect(nodes.oscLo.detune);
        dg.connect(nodes.oscHi.detune);
      } else if (route.dst === 'oscA.level') {
        // 基準1のトレモロノードに加算（1+amt×LFO ∈ [0,2]。負ゲイン=位相反転を防ぐ）
        dg.connect(nodes.trem.gain);
      }
      modNodes.push({ dg, route: Object.assign({}, route) });
    }
    updateDriveTimer(); // 配線の増減・S&H⇔通常波形の切替でタイマーの要否が変わる
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

  // glide=true（発音中の音程移動）のときだけ短い平滑化をかける。
  // 無音からの新規ノートまで平滑化すると立ち上がりにピッチスイープ（チャープ）が乗るため
  function setPitch(note, glide) {
    const freq = midiToFreq(note + patch['oscA.octave'] * 12 + patch['oscA.semi']);
    const t = ctx.currentTime;
    for (const o of [nodes.oscLo, nodes.oscHi]) {
      if (glide) {
        o.frequency.setTargetAtTime(freq, t, 0.005);
      } else {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(freq, t);
      }
    }
    currentNote = note;
  }

  // ---- 公開API ----

  function noteOn(note) {
    if (!ensureAudio()) return;
    noteStack = noteStackPush(noteStack, note);
    const t = ctx.currentTime;
    const adsr = currentAdsr();
    const cur = currentEnvValue(t);
    setPitch(note, cur > 0.01);
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
      if (note === currentNote) setPitch(noteStack[noteStack.length - 1], true);
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
    const prev = patch[id];
    patch[id] = value;
    if (!nodes) return; // 初期化前はパッチにだけ反映（buildGraphがまとめて適用する）
    switch (id) {
      case 'oscA.wave': applyWave(value); break;
      case 'oscA.wtPos':
        // 変調中はaudioDriveTickが実効値で更新するため、手動値の直接適用はしない
        if (patch['oscA.wave'] === 'wt.basic' && !wtPosModRoute()) applyWtPos(value);
        break;
      case 'oscA.octave':
      case 'oscA.semi':
        if (currentNote !== null) setPitch(currentNote, true);
        break;
      case 'oscA.fine': smoothSet(nodes.oscLo.detune, value, def.smoothing); smoothSet(nodes.oscHi.detune, value, def.smoothing); break;
      case 'oscA.level': smoothSet(nodes.oscMix.gain, value, def.smoothing); break;
      case 'filter.type':
      case 'filter.cutoff':
      case 'filter.reso': applyFilter(); break;
      case 'lfo1.shape': {
        if (value !== 'sh') nodes.lfoOsc.type = LFO_OSC_TYPE[value];
        applyModRouting(); // S&H⇔通常波形で変調元ノードが替わる
        break;
      }
      case 'lfo1.rateHz': {
        // 「旧レート」で現在位相を確定してからアンカーを切り直す（patchは既に新値のため
        // mirrorLfoPhase()は使えない）。周波数は即時切替にして、OscillatorNodeの位相
        // 連続性とミラー計算を厳密に一致させる（平滑化すると収束期間ぶんの位相差が残留する）
        const t = ctx.currentTime;
        lfoPhase.phase0 = lfoPhase.phase0 + (t - lfoPhase.tRef) * prev;
        lfoPhase.tRef = t;
        nodes.lfoOsc.frequency.cancelScheduledValues(t);
        nodes.lfoOsc.frequency.setValueAtTime(value, t);
        break;
      }
      case 'mod1.amt': {
        // 配線構造が変わらない深さ変更は、既存depthGainを平滑更新する
        // （全再構築＋直代入では定義済みsmoothingが効かずジッパーノイズが出る）
        const m = modNodes.find((x) => x.route.slot === 'mod1');
        if (m) {
          m.route.amt = value;
          smoothSet(m.dg.gain, value * m.route.range, def.smoothing);
          // このパスに来るのはaudio系ルートのみ（control系=wtPosはmodNodesに載らず
          // else側のapplyModRoutingを通る）で要否は変わらないが、防御的に再評価する
          updateDriveTimer();
        } else {
          applyModRouting();
        }
        break;
      }
      case 'mod1.src':
      case 'mod1.dst': applyModRouting(); break;
      case 'master.gain': smoothSet(nodes.masterGain.gain, value, def.smoothing); break;
      case 'ampEnv.attack':
      case 'ampEnv.decay':
      case 'ampEnv.sustain':
      case 'ampEnv.release':
        // 発音中に変えた場合は現在値から新ADSRで組み直す。旧スケジュールを放置すると
        // ミラー（新ADSRで即計算）と実音が乖離し、離鍵時のsetValueAtTimeで音量が跳ぶ
        rescheduleEnvelope(id.split('.')[1], prev);
        break;
    }
  }

  // 発音中のADSR変更を、実音とミラーの連続性を保ったまま反映する。
  // 実音は「現在値から新ADSRの目標へ」再スケジュールし、ミラー側は noteOnAt/noteOffAt を
  // 逆算し直して同じ軌道を描かせる（envValueの式を現在値について解く）
  function rescheduleEnvelope(field, prevValue) {
    if (noteOnAt === null) return;
    const t = ctx.currentTime;
    const adsr = currentAdsr();
    const oldAdsr = Object.assign({}, adsr, { [field]: prevValue });
    const g = nodes.ampGain.gain;
    if (noteOffAt === null) {
      // 押鍵中: 旧ADSRでの現在値から、新しいサステインへ新ディケイで収束させる
      const cur = envValue(oldAdsr, t - noteOnAt, null);
      g.cancelScheduledValues(t);
      g.setValueAtTime(cur, t);
      g.setTargetAtTime(adsr.sustain, t, adsr.decay / 3);
      if (cur > adsr.sustain && adsr.sustain < 1) {
        // ディケイ相の式 held = S + (1-S)·exp(-3(tOn-A)/D) を cur について解いて tOn を逆算
        const tOn = adsr.attack - (adsr.decay / 3) * Math.log((cur - adsr.sustain) / (1 - adsr.sustain));
        noteOnAt = t - tOn;
      } else {
        // 現在値がサステイン以下（サステインを引き上げた等）。実音はなだらかに上がるが、
        // ミラーの押鍵中の式は下降しか表せないため「収束済み」とみなす（短い過渡期のみ僅かに乖離）
        noteOnAt = t - adsr.attack - adsr.decay * 10;
      }
    } else if (field === 'release') {
      // リリース中のリリース変更: 現在値を保ったまま新しい時定数で減衰し直す。
      // heldAtRelease を固定し、tOff を新時定数で逆算して noteOnAt/noteOffAt を平行移動する
      const tOn = t - noteOnAt, tOff = t - noteOffAt;
      const held = envHeldValue(adsr, tOn - tOff);
      const cur = envValue(Object.assign({}, adsr, { release: prevValue }), tOn, tOff);
      if (held <= 0 || cur <= 0) return;
      g.cancelScheduledValues(t);
      g.setValueAtTime(cur, t);
      g.setTargetAtTime(0, t, adsr.release / 3);
      const tOffNew = (adsr.release / 3) * Math.log(held / cur);
      const shift = tOffNew - tOff;
      noteOffAt = t - tOffNew;
      noteOnAt = noteOnAt - shift;
    }
  }

  // wtPos宛のアクティブな変調ルート（control-rate）を返す
  function wtPosModRoute() {
    return resolveModRoutes(patch).find((r) => r.kind === 'control' && r.dst === 'oscA.wtPos') || null;
  }

  // ---- 試聴フレーズ再生（レシピの目標音・クイズのA/B聴き比べ用） ----

  let phraseTimers = [];
  let phraseNotes = new Set();
  let restorePatch = null; // 一時差し替え前のパッチ。中断時に必ず復元するため、タイマーとは別に保持する

  // 再生中の一時パッチ差し替えが有効かどうか（UIロックの判定に使う）
  function auditioning() {
    return restorePatch !== null;
  }

  function stopPhrase() {
    for (const t of phraseTimers) clearTimeout(t);
    phraseTimers = [];
    for (const n of phraseNotes) noteOff(n);
    phraseNotes.clear();
    // 保留中の一時パッチがあれば、途中で打ち切られても必ずここで復元する。
    // タイマーだけに任せると、再生中に別の操作で中断されたとき復元処理ごと消えてしまい、
    // 作業中の音がお手本パッチのまま固定されてしまう
    if (restorePatch) {
      applyPatch(restorePatch);
      restorePatch = null;
    }
  }

  // audition: { notes: MIDIノート番号列, dur: 1音の長さ秒 }
  // opts.patch: 一時的に差し替えるパッチ（再生後に元へ戻す）。opts.onDone: 完了コールバック。
  // opts.onNoteOn(i, note): 各ノートの発音タイミングで呼ぶ（お手本ゴーストの撮影予約などに使う）
  function playPhrase(audition, opts) {
    if (!ensureAudio()) return;
    stopPhrase();
    const o = opts || {};
    if (o.patch) {
      restorePatch = getPatch();
      applyPatch(o.patch);
    }
    const dur = audition.dur;
    const gap = 0.08;
    audition.notes.forEach((note, i) => {
      phraseTimers.push(setTimeout(() => {
        phraseNotes.add(note);
        noteOn(note);
        if (o.onNoteOn) o.onNoteOn(i, note);
      }, i * (dur + gap) * 1000));
      phraseTimers.push(setTimeout(() => { phraseNotes.delete(note); noteOff(note); }, (i * (dur + gap) + dur) * 1000));
    });
    // リリースの尾が鳴り終わってからパッチを戻す（戻しが早いと余韻の音色が変わってしまう）
    const tail = Math.min(2, (o.patch || patch)['ampEnv.release'] || 0.3);
    const total = (audition.notes.length * (dur + gap) + tail) * 1000 + 60;
    phraseTimers.push(setTimeout(() => {
      if (restorePatch) { applyPatch(restorePatch); restorePatch = null; }
      if (o.onDone) o.onDone();
    }, total));
    return total;
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

  // 音側の変調駆動（buildGraph後は独立タイマーで常時動く。rAF停止中も凍結しない）。
  // S&HのConstantSource更新とwtPos変調適用を ctx.currentTime 基準（=これから鳴る音）で行う
  function audioDriveTick() {
    if (!nodes) return;
    const tNow = ctx.currentTime;
    const lfoValNow = lfoValue(patch['lfo1.shape'], mirrorLfoPhase(tNow), 1);
    if (patch['lfo1.shape'] === 'sh') {
      nodes.shSrc.offset.setTargetAtTime(lfoValNow, tNow, 0.002);
    }
    const route = wtPosModRoute();
    if (route && patch['oscA.wave'] === 'wt.basic') {
      const eff = Math.min(1, Math.max(0, patch['oscA.wtPos'] + modContribution(route, lfoValNow)));
      applyWtPos(eff);
    }
  }

  // 可視化用ミラー（viz.jsの単一rAFループから毎フレーム呼ばれる。副作用なし）。
  // 「聴こえている時刻」（出力遅延を引いた過去）で評価するため、線の脈動と音が一致する
  function controlTick() {
    if (!ctx) return null;
    const tAud = audibleTime();
    const lfoPhaseNow = mirrorLfoPhase(tAud);
    const lfoVal = lfoValue(patch['lfo1.shape'], lfoPhaseNow, 1);
    let wtPosEffective = patch['oscA.wtPos'];
    const route = wtPosModRoute();
    if (route) {
      wtPosEffective = Math.min(1, Math.max(0, patch['oscA.wtPos'] + modContribution(route, lfoVal)));
    }
    const envT = noteOnAt === null ? null : tAud - noteOnAt;
    // 離鍵直後は「聴こえている時刻」がまだ離鍵前のため envOffT が負になる。
    // その間は押下中として扱う（負のまま渡すと exp が1を超えて表示が音より先に跳ねる）
    const envOffT = noteOffAt === null || tAud <= noteOffAt ? null : tAud - noteOffAt;
    const envVal = envT === null ? 0 : Math.min(1, Math.max(0, envValue(currentAdsr(), envT, envOffT)));
    return { lfoVal, lfoPhase: lfoPhaseNow, envVal, envT, envOffT, wtPosEffective, routes: resolveModRoutes(patch) };
  }

  return {
    ensureAudio,
    noteOn,
    noteOff,
    playPhrase,
    stopPhrase,
    get auditioning() { return auditioning(); },
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
