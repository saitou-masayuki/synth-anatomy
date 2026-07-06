// シンセ解剖図 — 可視化エンジン。
// 単一のrequestAnimationFrameループで全スコープ・モジュレーション線・モッドリングを更新する。
// LFO/ENVの脈動は synth-engine.controlTick()（= mod-engine の数式ミラー）から受け取るため、
// 音の揺れと表示が同じ式・同じ「聴こえている時刻」（outputLatency補正済み）で動く。

var Viz = (() => {
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const canvases = {};   // name → { el, g }（2Dコンテキストとサイズ）
  const waveBufs = {};   // タップ名 → Float32Array（使い回し。GC圧回避）
  const specBufs = {};
  const ghosts = {};     // スコープ名 → { wave, spec, holdUntil }
  let ghostHold = false;
  let ghostUntil = 0;
  let frameCount = 0;
  let rafId = null;
  let onMirror = null;   // app.js が登録する毎フレームコールバック（モッドリング更新用）

  // ---- キャンバス管理 ----

  function setupCanvas(name, id) {
    const el = document.getElementById(id);
    if (!el) return;
    canvases[name] = { el, g: el.getContext('2d'), w: 0, h: 0 };
    resizeCanvas(name);
  }

  function resizeCanvas(name) {
    const c = canvases[name];
    if (!c) return;
    const w = c.el.clientWidth, h = c.el.clientHeight;
    if (!w || !h) return;
    c.el.width = Math.round(w * DPR);
    c.el.height = Math.round(h * DPR);
    c.w = w; c.h = h;
    c.g.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---- 波形描画（ゼロクロストリガーで静止させる。流れる波形は読めない） ----

  function drawWave(name, analyser) {
    const c = canvases[name];
    if (!c) return;
    if (!waveBufs[name]) waveBufs[name] = new Float32Array(analyser.fftSize);
    const buf = waveBufs[name];
    analyser.getFloatTimeDomainData(buf);
    let start = 0;
    for (let i = 1; i < buf.length / 2; i++) {
      if (buf[i - 1] <= 0 && buf[i] > 0) { start = i; break; }
    }
    const g = c.g;
    g.clearRect(0, 0, c.w, c.h);
    g.strokeStyle = cssVar('--scope-grid');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, c.h / 2);
    g.lineTo(c.w, c.h / 2);
    g.stroke();
    const ghost = ghostActive() && ghosts[name] && ghosts[name].wave;
    if (ghost) drawWavePath(g, ghost.buf, ghost.start, c, cssVar('--scope-ghost'), true);
    drawWavePath(g, buf, start, c, cssVar('--scope-wave'), false);
  }

  function drawWavePath(g, buf, start, c, color, dashed) {
    const N = Math.min(900, buf.length - start - 1);
    g.strokeStyle = color;
    g.lineWidth = dashed ? 1 : 1.6;
    g.setLineDash(dashed ? [3, 3] : []);
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const x = (i / N) * c.w;
      const y = c.h / 2 - buf[start + i] * c.h * 0.45;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.setLineDash([]);
  }

  // ---- スペクトル描画（対数周波数軸。倍音の間隔が見えることが学習の要） ----

  const F_MIN = 30, F_MAX = 18000;

  function drawSpec(name, analyser, sampleRate) {
    const c = canvases[name];
    if (!c) return;
    if (!specBufs[name]) specBufs[name] = new Uint8Array(analyser.frequencyBinCount);
    const buf = specBufs[name];
    analyser.getByteFrequencyData(buf);
    const g = c.g;
    g.clearRect(0, 0, c.w, c.h);
    // 目盛り: 100Hz / 1kHz / 10kHz
    g.strokeStyle = cssVar('--scope-grid');
    g.lineWidth = 1;
    for (const f of [100, 1000, 10000]) {
      const x = freqToX(f, c.w);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.h); g.stroke();
    }
    const ghost = ghostActive() && ghosts[name] && ghosts[name].spec;
    if (ghost) drawSpecPath(g, ghost.buf, c, sampleRate, cssVar('--scope-ghost'), true);
    drawSpecPath(g, buf, c, sampleRate, cssVar('--scope-spec'), false);
  }

  function freqToX(f, w) {
    return Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN) * w;
  }

  function drawSpecPath(g, buf, c, sampleRate, color, ghost) {
    const nyq = sampleRate / 2;
    g.beginPath();
    g.moveTo(0, c.h);
    for (let x = 0; x <= c.w; x += 2) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, x / c.w);
      const bin = Math.min(buf.length - 1, Math.round(f / nyq * buf.length));
      const v = buf[bin] / 255;
      g.lineTo(x, c.h - v * c.h * 0.96);
    }
    if (ghost) {
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.stroke();
      g.setLineDash([]);
    } else {
      g.lineTo(c.w, c.h);
      g.closePath();
      g.fillStyle = color + '44';
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 1.2;
      g.stroke();
    }
  }

  // ---- レベルメーター ----

  function drawMeter(analyser) {
    const c = canvases.meter;
    if (!c) return;
    if (!waveBufs.meter) waveBufs.meter = new Float32Array(analyser.fftSize);
    const buf = waveBufs.meter;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      sum += v * v;
      if (v > peak) peak = v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const g = c.g;
    g.clearRect(0, 0, c.w, c.h);
    const lvl = Math.min(1, rms * 2.5);
    g.fillStyle = lvl > 0.85 ? cssVar('--ng') : cssVar('--ok');
    g.fillRect(0, c.h * 0.3, c.w * lvl, c.h * 0.4);
    const px = Math.min(1, peak) * c.w;
    g.fillStyle = cssVar('--text-dim');
    g.fillRect(px - 1, c.h * 0.2, 2, c.h * 0.6);
  }

  // ---- ENV1カーブ（ADSRの形＋現在位置ドット） ----

  function drawEnvCurve(mirror) {
    const c = canvases.env;
    if (!c) return;
    const patch = SynthEngine.getPatch();
    const adsr = {
      attack: patch['ampEnv.attack'], decay: patch['ampEnv.decay'],
      sustain: patch['ampEnv.sustain'], release: patch['ampEnv.release'],
    };
    // 時間軸: A / D×1.5 / サステイン固定幅 / R×1.5 を比例配分（見やすさ優先の擬似スケール）
    const segA = Math.max(0.05, adsr.attack);
    const segD = Math.max(0.08, adsr.decay * 1.5);
    const segS = (segA + segD) * 0.4 + 0.3;
    const segR = Math.max(0.08, adsr.release * 1.5);
    const total = segA + segD + segS + segR;
    const g = c.g;
    g.clearRect(0, 0, c.w, c.h);
    const xOf = (t) => (t / total) * c.w;
    const yOf = (v) => c.h - 4 - v * (c.h - 10);
    // フェーズごとに envValue（音と同じ式）で曲線を描く
    g.strokeStyle = cssVar('--env-line');
    g.lineWidth = 1.6;
    g.beginPath();
    const STEPS = 120;
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * total;
      let v;
      if (t <= segA + segD + segS) {
        // 押下中: 実時間 = A内はそのまま、D区間は実ディケイ時間へ写像
        const tOn = t <= segA ? (t / segA) * adsr.attack
          : adsr.attack + ((t - segA) / (segD + segS)) * (adsr.decay * 1.5 + 0.3);
        v = envValue(adsr, tOn, null);
      } else {
        const tOff = ((t - segA - segD - segS) / segR) * adsr.release * 1.5;
        v = envValue(adsr, 100, null) * Math.exp(-3 * tOff / adsr.release);
      }
      const x = xOf(t), y = yOf(v);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    // リリース開始位置の目印
    g.strokeStyle = cssVar('--scope-grid');
    g.beginPath();
    g.moveTo(xOf(segA + segD + segS), 0);
    g.lineTo(xOf(segA + segD + segS), c.h);
    g.stroke();
    // 現在位置ドット（controlTickのミラー時刻から算出 = 音と同期）
    if (mirror && mirror.envT !== null) {
      let t;
      if (mirror.envOffT === null) {
        t = mirror.envT <= adsr.attack
          ? (mirror.envT / adsr.attack) * segA
          : segA + Math.min(1, (mirror.envT - adsr.attack) / (adsr.decay * 1.5 + 0.3)) * (segD + segS);
      } else {
        t = segA + segD + segS + Math.min(1, mirror.envOffT / (adsr.release * 1.5)) * segR;
      }
      g.fillStyle = cssVar('--env-line');
      g.beginPath();
      g.arc(xOf(t), yOf(mirror.envVal), 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ---- SVGオーバーレイ: モジュレーション線（ベジェを事前サンプリングして粒子を走らせる） ----

  const overlay = { svg: null, env: null, mod: null, particle: null, modPoints: null };

  function mk(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function centerOf(el, mainRect) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - mainRect.left, y: r.top + r.height / 2 - mainRect.top, top: r.top - mainRect.top, bottom: r.bottom - mainRect.top };
  }

  // ベジェ曲線を40点にサンプリング（getPointAtLengthはSafariで遅いため使わない）
  function sampleBezier(p0, c1, c2, p1) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, u = 1 - t;
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
      });
    }
    return pts;
  }

  function bezierPath(p0, c1, c2, p1) {
    return `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p1.x} ${p1.y}`;
  }

  // 配線ジオメトリの再計算（初期化・リサイズ・割当変更時のみ。毎フレームは呼ばない）
  function updateGeometry() {
    const svg = document.getElementById('overlay');
    if (!svg) return;
    overlay.svg = svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    overlay.env = null; overlay.mod = null; overlay.particle = null; overlay.modPoints = null;
    const mainRect = document.getElementById('main').getBoundingClientRect();
    svg.setAttribute('width', mainRect.width);
    svg.setAttribute('height', mainRect.height);
    svg.setAttribute('viewBox', `0 0 ${mainRect.width} ${mainRect.height}`);

    // ENV1 → AMP の固定配線（「音量は最初からエンベロープに揺らされている」の可視化）
    const envBlock = document.getElementById('block-ampEnv');
    const ampBlock = document.getElementById('block-amp');
    if (envBlock && ampBlock) {
      const a = centerOf(envBlock, mainRect);
      const b = centerOf(ampBlock, mainRect);
      const p0 = { x: a.x, y: a.top };
      const p1 = { x: b.x, y: b.bottom };
      const d = bezierPath(p0, { x: p0.x, y: p0.y - 40 }, { x: p1.x, y: p1.y + 40 }, p1);
      const glow = mk('path', { d, class: 'env-line-glow', 'stroke-width': 6, opacity: 0.15 });
      const core = mk('path', { d, class: 'env-line-core', 'stroke-width': 1.6, opacity: 0.5 });
      svg.appendChild(glow);
      svg.appendChild(core);
      overlay.env = { glow, core };
    }

    // LFO1 → 割当先ノブの配線
    const routes = resolveModRoutes(SynthEngine.getPatch());
    const route = routes.find((r) => r.src === 'lfo1');
    if (route) {
      const lfoBlock = document.getElementById('block-lfo1');
      const knobEl = knobElForDest(route.dst);
      if (lfoBlock && knobEl) {
        const a = centerOf(lfoBlock, mainRect);
        const b = centerOf(knobEl, mainRect);
        const p0 = { x: a.x, y: a.top };
        const p1 = { x: b.x, y: b.y + 26 };
        const c1 = { x: p0.x, y: p0.y - 70 };
        const c2 = { x: p1.x, y: p1.y + 70 };
        const d = bezierPath(p0, c1, c2, p1);
        const glow = mk('path', { d, class: 'mod-line-glow', 'stroke-width': 7, opacity: 0.2 });
        const core = mk('path', { d, class: 'mod-line-core', 'stroke-width': 1.8, opacity: 0.7 });
        const particle = mk('circle', { r: 3, class: 'particle' });
        svg.appendChild(glow);
        svg.appendChild(core);
        svg.appendChild(particle);
        overlay.mod = { glow, core, route };
        overlay.particle = particle;
        overlay.modPoints = sampleBezier(p0, c1, c2, p1);
      }
    }
  }

  // 変調先 → 対応するノブ要素（oscA.pitchはファインノブに代表させる）
  function knobElForDest(dst) {
    const id = dst === 'oscA.pitch' ? 'oscA.fine' : dst;
    const wrap = document.querySelector(`.param[data-param="${CSS.escape(id)}"] .knob`);
    return wrap || null;
  }

  // 毎フレームの脈動更新（線の透明度・太さ・粒子位置）
  function updateModPulse(mirror) {
    if (overlay.env && mirror) {
      const v = mirror.envVal;
      overlay.env.core.setAttribute('opacity', 0.35 + v * 0.65);
      overlay.env.core.setAttribute('stroke-width', 1.2 + v * 1.8);
      overlay.env.glow.setAttribute('opacity', 0.08 + v * 0.3);
    }
    if (overlay.mod && mirror) {
      const strength = Math.abs(mirror.lfoVal) * Math.min(1, Math.abs(overlay.mod.route.amt));
      overlay.mod.core.setAttribute('opacity', 0.35 + strength * 0.65);
      overlay.mod.core.setAttribute('stroke-width', 1.4 + strength * 2);
      overlay.mod.glow.setAttribute('opacity', 0.1 + strength * 0.35);
      if (overlay.particle && overlay.modPoints) {
        // 粒子はLFO1周期で線を1往行する（ミラー位相と同期）
        const t = SynthEngine.audibleTime();
        const patch = SynthEngine.getPatch();
        const phase = ((t * patch['lfo1.rateHz']) % 1 + 1) % 1;
        const idx = Math.min(overlay.modPoints.length - 1, Math.round(phase * (overlay.modPoints.length - 1)));
        const p = overlay.modPoints[idx];
        overlay.particle.setAttribute('cx', p.x);
        overlay.particle.setAttribute('cy', p.y);
      }
    }
  }

  // ---- ゴースト（変更前の波形/スペクトルを破線で残す） ----

  function ghostActive() {
    return ghostHold || performance.now() < ghostUntil;
  }

  function snapshotGhosts() {
    ghostHold = true;
    for (const [name, tapName] of [['osc-wave', 'osc'], ['filter-wave', 'filter']]) {
      const buf = waveBufs[name];
      if (!buf) continue;
      let start = 0;
      for (let i = 1; i < buf.length / 2; i++) {
        if (buf[i - 1] <= 0 && buf[i] > 0) { start = i; break; }
      }
      ghosts[name] = ghosts[name] || {};
      ghosts[name].wave = { buf: Float32Array.from(buf), start };
    }
    for (const name of ['osc-spec', 'filter-spec']) {
      const buf = specBufs[name];
      if (!buf) continue;
      ghosts[name] = ghosts[name] || {};
      ghosts[name].spec = { buf: Uint8Array.from(buf) };
    }
  }

  function releaseGhosts() {
    ghostHold = false;
    ghostUntil = performance.now() + 2000;
  }

  // ---- スコープ枠のパルス点灯（説明パネルの「どこを見るか」との連動） ----

  function pulseScope(block) {
    const map = {
      oscA: ['scope-osc-wave', 'scope-osc-spec'],
      filter: ['scope-filter-wave', 'scope-filter-spec'],
      ampEnv: ['scope-amp-wave'],
      master: ['scope-out-meter'],
    };
    for (const id of map[block] || []) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.remove('pulse');
      void el.offsetWidth; // アニメーション再始動のためのリフロー
      el.classList.add('pulse');
    }
  }

  // ---- メインループ（全画面で1本。document.hiddenで停止） ----

  function frame() {
    rafId = requestAnimationFrame(frame);
    frameCount++;
    const taps = SynthEngine.taps;
    const mirror = SynthEngine.ready ? SynthEngine.controlTick() : null;
    if (taps) {
      const sr = SynthEngine.audioCtx.sampleRate;
      drawWave('osc-wave', taps.osc);
      drawWave('filter-wave', taps.filter);
      drawWave('amp-wave', taps.amp);
      if (frameCount % 2 === 0) {
        drawSpec('osc-spec', taps.osc, sr);
        drawSpec('filter-spec', taps.filter, sr);
      }
      drawMeter(taps.out);
    }
    if (frameCount % 2 === 1) drawEnvCurve(mirror);
    updateModPulse(mirror);
    if (onMirror) onMirror(mirror);
  }

  function start() {
    if (rafId === null) rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  function init() {
    setupCanvas('osc-wave', 'scope-osc-wave');
    setupCanvas('osc-spec', 'scope-osc-spec');
    setupCanvas('filter-wave', 'scope-filter-wave');
    setupCanvas('filter-spec', 'scope-filter-spec');
    setupCanvas('amp-wave', 'scope-amp-wave');
    setupCanvas('meter', 'scope-out-meter');
    setupCanvas('env', 'env-curve');
    updateGeometry();
    window.addEventListener('resize', () => {
      for (const name of Object.keys(canvases)) resizeCanvas(name);
      updateGeometry();
    });
    start();
  }

  return {
    init,
    updateGeometry,
    snapshotGhosts,
    releaseGhosts,
    pulseScope,
    set onMirror(fn) { onMirror = fn; },
  };
})();
