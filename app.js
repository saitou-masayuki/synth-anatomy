// シンセ解剖図 — UI層。
// PARAMSの宣言的定義からノブ・セレクトを自動生成し、SynthEngineと結線する。
// 鍵盤・PCキーボード入力・iOS音声解錠・設定保存はchord-labの実績パターンを踏襲。

function $(id) { return document.getElementById(id); }

// ---------- 設定の永続化（chord-lab方式: バージョン付き・壊れたデータ耐性） ----------
const STORAGE_KEY = 'synth-anatomy-settings-v1';
let settings = { v: 1, theme: 'dark', mode: 'simple', patch: null, presets: {} };
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const s = JSON.parse(raw);
    if (s && s.v === 1) settings = Object.assign(settings, s);
  }
} catch {}
// 壊れたデータへの耐性: 型が崩れていたら既定値に戻す（Object.keys(null)等での初期化中断を防ぐ）
if (!settings.presets || typeof settings.presets !== 'object' || Array.isArray(settings.presets)) settings.presets = {};
if (settings.patch !== null && (typeof settings.patch !== 'object' || Array.isArray(settings.patch))) settings.patch = null;
if (settings.theme !== 'light' && settings.theme !== 'dark') settings.theme = 'dark';
if (settings.mode !== 'simple' && settings.mode !== 'full') settings.mode = 'simple';
if (!['play', 'make', 'ear'].includes(settings.view)) settings.view = 'play';
for (const key of ['quizStats', 'quizBest', 'recipesDone']) {
  if (!settings[key] || typeof settings[key] !== 'object' || Array.isArray(settings[key])) settings[key] = {};
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // きくモード中や試聴（お手本/A・B）の一時パッチは「自分の音」ではないため保存しない。
    // 保存すると、リロード時に作りかけの音がクイズ用パッチ等で上書きされてしまう
    if (lesson.view !== 'ear' && !SynthEngine.auditioning) {
      settings.patch = SynthEngine.getPatch();
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }, 300);
}

// ---------- ノブ・セレクトの自動生成 ----------

// 発展的パラメーター（シンプルモードでは中身だけ隠す）
const ADV_PARAMS = new Set(['oscA.octave', 'oscA.semi', 'oscA.fine', 'oscA.level']);
// ブロック → コントロール配置先のコンテナID
const BLOCK_CONTAINERS = {
  oscA: 'controls-oscA', filter: 'controls-filter', ampEnv: 'controls-ampEnv',
  lfo1: 'controls-lfo1', master: 'controls-master',
};
// mod1.src/dst は割当UI（🎯ボタン）経由で操作するため直接は描画しない。amtはLFOブロックに置く
const HIDDEN_PARAMS = new Set(['mod1.src', 'mod1.dst']);

const knobEls = new Map(); // paramId → { wrap, svg, valueArc, pointer, modRing, modDot, valueText, zeroNorm }

function angleOf(norm) { return -135 + norm * 270; }
function polar(r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: 36 + r * Math.cos(rad), y: 36 + r * Math.sin(rad) };
}
function arcPath(r, a0, a1) {
  if (Math.abs(a1 - a0) < 0.5) return '';
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const p0 = polar(r, lo), p1 = polar(r, hi);
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${hi - lo > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
}

function buildKnob(def) {
  const wrap = document.createElement('div');
  wrap.className = 'param knob-wrap';
  wrap.dataset.param = def.id;
  if (ADV_PARAMS.has(def.id)) wrap.dataset.adv = '1';
  const knob = document.createElement('div');
  knob.className = 'knob';
  knob.tabIndex = 0;
  knob.innerHTML = `
    <svg viewBox="0 0 72 72">
      <path class="k-track" d="${arcPath(26, -135, 135)}" stroke-width="5" fill="none"/>
      <path class="k-value" d="" stroke-width="5" fill="none"/>
      <line class="k-pointer" x1="36" y1="36" x2="36" y2="14" stroke-width="2"/>
      <path class="k-modring" d="" stroke-width="3" fill="none" visibility="hidden"/>
      <circle class="k-moddot" r="3.2" visibility="hidden"/>
    </svg>`;
  const label = document.createElement('div');
  label.className = 'p-label';
  label.textContent = def.name;
  label.title = def.short;
  const valueText = document.createElement('div');
  valueText.className = 'p-value';
  wrap.appendChild(knob);
  wrap.appendChild(label);
  wrap.appendChild(valueText);
  knobEls.set(def.id, {
    wrap, knob,
    valueArc: knob.querySelector('.k-value'),
    pointer: knob.querySelector('.k-pointer'),
    modRing: knob.querySelector('.k-modring'),
    modDot: knob.querySelector('.k-moddot'),
    valueText,
    zeroNorm: (def.type !== 'enum' && def.min < 0) ? normParam(def.id, 0) : 0,
  });
  attachKnobEvents(knob, def);
  return wrap;
}

function buildSelect(def) {
  const wrap = document.createElement('div');
  wrap.className = 'param select-wrap';
  wrap.dataset.param = def.id;
  if (ADV_PARAMS.has(def.id)) wrap.dataset.adv = '1';
  const label = document.createElement('div');
  label.className = 'p-label';
  label.textContent = def.name;
  label.title = def.short;
  const sel = document.createElement('select');
  for (const o of def.values) {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.name;
    opt.title = o.short;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    const prev = SynthEngine.getPatch()[def.id];
    setParam(def.id, sel.value);
    updateReadout(def.id, prev, sel.value);
    Viz.pulseScope(def.block);
  });
  wrap.appendChild(label);
  wrap.appendChild(sel);
  return wrap;
}

function buildControls() {
  for (const def of PARAMS) {
    if (def.phase !== 1 || HIDDEN_PARAMS.has(def.id)) continue;
    const containerId = def.id === 'mod1.amt' ? 'controls-lfo1' : BLOCK_CONTAINERS[def.block];
    const container = containerId && $(containerId);
    if (!container) continue;
    container.appendChild(def.ui === 'select' ? buildSelect(def) : buildKnob(def));
  }
}

// ---------- パラメーター変更（全変更がここを通る） ----------

function setParam(id, value) {
  SynthEngine.applyParam(id, value);
  refreshParamVisual(id);
  if (id.startsWith('mod1.')) {
    renderAssigned();
    updateModRing();          // has-modクラス（非表示ノブの強制表示）を先に反映してから
    Viz.updateGeometry();     // 配線ジオメトリを計算する（非表示要素は座標が全て0になるため）
  } else if (id === 'filter.cutoff' || id === 'oscA.wtPos' || id === 'oscA.level' || id === 'oscA.fine') {
    updateModRing();
  }
  saveSettings();
  lessonOnParamChange(id);
}

function refreshParamVisual(id) {
  const patch = SynthEngine.getPatch();
  const def = paramById(id);
  const k = knobEls.get(id);
  if (k) {
    const norm = normParam(id, patch[id]);
    k.valueArc.setAttribute('d', arcPath(26, angleOf(k.zeroNorm), angleOf(norm)));
    const p = polar(22, angleOf(norm));
    k.pointer.setAttribute('x2', p.x);
    k.pointer.setAttribute('y2', p.y);
    k.valueText.textContent = fmtValue(id, patch[id]);
  }
  const sel = document.querySelector(`.param[data-param="${CSS.escape(id)}"] select`);
  if (sel && def.type === 'enum') sel.value = patch[id];
}

function refreshAllVisuals() {
  for (const def of PARAMS) {
    if (def.phase === 1) refreshParamVisual(def.id);
  }
}

// ---------- ノブ操作（縦ドラッグ / Shift微調整 / ホイール / ダブルクリック初期値） ----------

const bubble = $('bubble');
let bubbleTimer = null;

function showBubble(knobEl, text) {
  clearTimeout(bubbleTimer); // ダブルクリック時の自動非表示タイマーがドラッグ中のバブルを消さないように
  const r = knobEl.getBoundingClientRect();
  bubble.hidden = false;
  bubble.innerHTML = text;
  bubble.style.left = (r.left + r.width / 2) + 'px';
  bubble.style.top = r.top + 'px';
}

let readoutTimer = 0;
function throttledReadout(id, prev, next) {
  const now = performance.now();
  if (now - readoutTimer < 150) return;
  readoutTimer = now;
  updateReadout(id, prev, next);
}

function attachKnobEvents(knob, def) {
  let dragging = false;
  let lastY = 0;
  let curNorm = 0;
  let startValue = 0;

  knob.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // 右クリック等でドラッグ状態に入らない
    if (document.body.classList.contains('assign-mode')) {
      // 割当モード中: このノブを変調先として確定する
      if (knob.classList.contains('assignable')) assignTo(def.id);
      e.preventDefault();
      return;
    }
    dragging = true;
    lastY = e.clientY;
    const patch = SynthEngine.getPatch();
    startValue = patch[def.id];
    curNorm = normParam(def.id, startValue);
    knob.setPointerCapture(e.pointerId);
    Viz.snapshotGhosts();
    e.preventDefault();
  });

  knob.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // 移動量を毎イベント加算する増分方式。ドラッグ途中でShiftを押し引きしても
    // 蓄積済み移動量が再解釈されず、値がジャンプしない
    const scale = e.shiftKey ? 1440 : 180; // Shiftで1/8精度
    curNorm = Math.min(1, Math.max(0, curNorm + (lastY - e.clientY) / scale));
    lastY = e.clientY;
    const v = denormParam(def.id, curNorm);
    setParam(def.id, v);
    const cur = SynthEngine.getPatch()[def.id];
    showBubble(knob, `${fmtValue(def.id, startValue)}<span class="arrow">→</span>${fmtValue(def.id, cur)}`);
    throttledReadout(def.id, startValue, cur);
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    bubble.hidden = true;
    Viz.releaseGhosts();
    const cur = SynthEngine.getPatch()[def.id];
    if (cur !== startValue) {
      updateReadout(def.id, startValue, cur);
      Viz.pulseScope(def.block);
    }
  };
  knob.addEventListener('pointerup', endDrag);
  knob.addEventListener('pointercancel', endDrag);

  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    const patch = SynthEngine.getPatch();
    const prev = patch[def.id];
    if (def.type === 'int') {
      // 整数ノブは正規化1/50刻みだと丸めで元に戻ってしまうため、1ステップずつ動かす
      setParam(def.id, prev + (e.deltaY < 0 ? 1 : -1));
    } else {
      const norm = normParam(def.id, prev);
      const step = (e.deltaY < 0 ? 1 : -1) / 50;
      setParam(def.id, denormParam(def.id, Math.min(1, Math.max(0, norm + step))));
    }
    throttledReadout(def.id, prev, SynthEngine.getPatch()[def.id]);
  }, { passive: false });

  knob.addEventListener('dblclick', () => {
    const prev = SynthEngine.getPatch()[def.id];
    setParam(def.id, def.default);
    showBubble(knob, `${fmtValue(def.id, prev)}<span class="arrow">→</span>${fmtValue(def.id, def.default)}（初期値）`);
    bubbleTimer = setTimeout(() => { bubble.hidden = true; }, 900);
    updateReadout(def.id, prev, def.default);
  });
}

// ---------- 説明パネル（今なにが起きた？） ----------

function updateReadout(id, prev, next) {
  if (prev === next) return;
  const d = describeChange(id, prev, next, SynthEngine.getPatch());
  if (!d) return;
  $('roAction').textContent = d.action;
  $('roDetail').innerHTML = `${escapeHtml(d.effect)}　<span class="watch">見る場所: ${escapeHtml(d.watch)}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- モジュレーション割当（Phase 1: クリック選択式） ----------

// 変調先IDと「クリックするノブ」の対応（ピッチはファインノブに代表させる）
const ASSIGN_KNOB_TO_DEST = {
  'filter.cutoff': 'filter.cutoff',
  'oscA.wtPos': 'oscA.wtPos',
  'oscA.level': 'oscA.level',
  'oscA.fine': 'oscA.pitch',
};

function enterAssignMode() {
  document.body.classList.add('assign-mode');
  for (const [knobParam] of Object.entries(ASSIGN_KNOB_TO_DEST)) {
    const k = knobEls.get(knobParam);
    if (k) k.knob.classList.add('assignable');
  }
  $('roAction').textContent = '割当モード: 光っているノブをクリック';
  $('roDetail').textContent = 'LFO1で揺らすノブを選びます。Escキーまたはもう一度ボタンでキャンセル。';
}

function exitAssignMode() {
  document.body.classList.remove('assign-mode');
  for (const k of knobEls.values()) k.knob.classList.remove('assignable');
}

function assignTo(knobParamId) {
  const dest = ASSIGN_KNOB_TO_DEST[knobParamId];
  if (!dest) return;
  exitAssignMode();
  const patch = SynthEngine.getPatch();
  SynthEngine.applyParam('mod1.src', 'lfo1');
  if (!patch['mod1.amt']) SynthEngine.applyParam('mod1.amt', 0.5);
  setParam('mod1.dst', dest);
  refreshParamVisual('mod1.amt');
  // 同じ変調先を選び直した場合もupdateReadoutのprev===next早期returnに阻まれないよう、
  // 割当の完了は常に直接表示する（割当モードの案内文の残留防止）
  const destDef = MOD_DESTS.find((d) => d.id === dest);
  const d = describeChange('mod1.dst', 'none', dest, SynthEngine.getPatch());
  $('roAction').textContent = `LFO1 を ${destDef ? destDef.name : dest} に配線しました`;
  if (d) $('roDetail').innerHTML = `${escapeHtml(d.effect)}　<span class="watch">見る場所: ${escapeHtml(d.watch)}</span>`;
}

function unassign() {
  const prev = SynthEngine.getPatch()['mod1.dst'];
  SynthEngine.applyParam('mod1.src', 'none');
  setParam('mod1.dst', 'none');
  updateReadout('mod1.dst', prev, 'none');
}

function renderAssigned() {
  const list = $('assignedList');
  list.innerHTML = '';
  const patch = SynthEngine.getPatch();
  const routes = resolveModRoutes(patch);
  for (const route of routes) {
    const dest = MOD_DESTS.find((d) => d.id === route.dst);
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `LFO1 〜▶ ${escapeHtml(dest ? dest.name : route.dst)} <button type="button" title="割当を解除">×</button>`;
    chip.querySelector('button').addEventListener('click', unassign);
    list.appendChild(chip);
  }
  if (routes.length === 0) {
    const hint = document.createElement('span');
    hint.style.color = 'var(--text-faint)';
    hint.textContent = '未割当（ボタンでノブに配線してみよう）';
    list.appendChild(hint);
  }
}

// ---------- モッドリング（割当先ノブの外周に揺れの範囲と現在位置を表示） ----------

let activeModKnob = null; // { knobParamId, route }

function updateModRing() {
  for (const k of knobEls.values()) {
    k.modRing.setAttribute('visibility', 'hidden');
    k.modDot.setAttribute('visibility', 'hidden');
    k.wrap.classList.remove('has-mod');
  }
  activeModKnob = null;
  const patch = SynthEngine.getPatch();
  const route = resolveModRoutes(patch).find((r) => r.src === 'lfo1');
  if (!route) return;
  const knobParamId = route.dst === 'oscA.pitch' ? 'oscA.fine' : route.dst;
  const k = knobEls.get(knobParamId);
  if (!k) return;
  // シンプルモードで隠れる発展ノブでも、変調が刺さっている間は表示する
  // （非表示のままだと変調線が座標0,0へ描かれ、揺れの確認もできないため）
  k.wrap.classList.add('has-mod');
  const bounds = modRingBounds(route, patch);
  if (!bounds) return;
  k.modRing.setAttribute('d', arcPath(32, angleOf(bounds.lo), angleOf(bounds.hi)));
  k.modRing.setAttribute('visibility', 'visible');
  k.modDot.setAttribute('visibility', 'visible');
  activeModKnob = { knobParamId, route };
}

// 揺れの範囲（正規化空間）。cutoff/pitchはセント→実値に変換してから正規化する
function modRingBounds(route, patch) {
  const depth = Math.abs(route.amt) * route.range;
  if (route.dst === 'filter.cutoff') {
    const base = patch['filter.cutoff'];
    return {
      lo: normParam('filter.cutoff', base * Math.pow(2, -depth / 1200)),
      hi: normParam('filter.cutoff', base * Math.pow(2, depth / 1200)),
    };
  }
  if (route.dst === 'oscA.wtPos') {
    const base = patch['oscA.wtPos'];
    return { lo: normParam('oscA.wtPos', base - depth), hi: normParam('oscA.wtPos', base + depth) };
  }
  if (route.dst === 'oscA.level') {
    // レベル変調は乗算型（実効値 = レベル × (1 + 深さ×LFO)）。エンジンのトレモロノードと同じ式
    const base = patch['oscA.level'];
    return { lo: normParam('oscA.level', base * (1 - depth)), hi: normParam('oscA.level', base * (1 + depth)) };
  }
  if (route.dst === 'oscA.pitch') {
    const base = patch['oscA.fine'];
    return { lo: normParam('oscA.fine', base - depth), hi: normParam('oscA.fine', base + depth) };
  }
  return null;
}

// 毎フレーム: モッドリング上の点を実際の変調位置へ動かす（Vizのミラー値駆動）
Viz.onMirror = (mirror) => {
  if (!mirror || !activeModKnob) return;
  const k = knobEls.get(activeModKnob.knobParamId);
  if (!k) return;
  const route = activeModKnob.route;
  const patch = SynthEngine.getPatch();
  const contrib = modContribution(route, mirror.lfoVal);
  let norm;
  if (route.dst === 'filter.cutoff') {
    norm = normParam('filter.cutoff', patch['filter.cutoff'] * Math.pow(2, contrib / 1200));
  } else if (route.dst === 'oscA.wtPos') {
    norm = mirror.wtPosEffective;
  } else if (route.dst === 'oscA.level') {
    norm = normParam('oscA.level', patch['oscA.level'] * (1 + contrib));
  } else if (route.dst === 'oscA.pitch') {
    norm = normParam('oscA.fine', patch['oscA.fine'] + contrib);
  } else return;
  const p = polar(32, angleOf(norm));
  k.modDot.setAttribute('cx', p.x);
  k.modDot.setAttribute('cy', p.y);
};

// ---------- 鍵盤（chord-labのSVG鍵盤を25鍵に固定して移植） ----------

const KB_LO = 48, KB_HI = 72; // C3〜C5
const WK_W = 30, WK_H = 100, BK_W = 18, BK_H = 62;
const BLACK_PC = [1, 3, 6, 8, 10];
const kbRects = new Map();

function buildKeyboard() {
  const svg = $('kb');
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const mk = (tag, attrs) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  const whiteX = new Map();
  let x = 0;
  for (let n = KB_LO; n <= KB_HI; n++) {
    if (!BLACK_PC.includes(n % 12)) { whiteX.set(n, x); x += WK_W; }
  }
  svg.setAttribute('viewBox', `0 0 ${x} ${WK_H + 4}`);
  for (const [n, wx] of whiteX) {
    const r = mk('rect', { x: wx + 0.5, y: 1, width: WK_W - 1, height: WK_H, rx: 3, class: 'wk', 'data-note': n });
    svg.appendChild(r);
    kbRects.set(n, r);
  }
  for (const [n, wx] of whiteX) {
    if (n % 12 === 0) {
      const t = mk('text', { x: wx + WK_W / 2, y: WK_H - 7, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-faint)' });
      t.textContent = 'C' + (Math.floor(n / 12) - 1);
      svg.appendChild(t);
    }
  }
  for (let n = KB_LO; n <= KB_HI; n++) {
    if (BLACK_PC.includes(n % 12)) {
      const prevWhiteX = whiteX.get(n - 1);
      if (prevWhiteX === undefined) continue;
      const r = mk('rect', { x: prevWhiteX + WK_W - BK_W / 2, y: 1, width: BK_W, height: BK_H, rx: 2.5, class: 'bk', 'data-note': n });
      svg.appendChild(r);
      kbRects.set(n, r);
    }
  }
}

// ---------- 発音（エンジン呼び出し＋鍵の点灯＋パイプ加速） ----------

// 同じノートを複数の入力源（画面鍵盤の複数の指・PCキー）が同時に押せるため、
// 参照カウントで管理し、最後の1つが離れたときだけエンジンに伝える
const noteRefs = new Map();

function noteOn(note) {
  const n = (noteRefs.get(note) || 0) + 1;
  noteRefs.set(note, n);
  if (n > 1) return;
  SynthEngine.noteOn(note);
  const r = kbRects.get(note);
  if (r) r.classList.add('on');
  document.body.classList.add('playing');
}

function noteOff(note) {
  const n = (noteRefs.get(note) || 0) - 1;
  if (n > 0) { noteRefs.set(note, n); return; }
  noteRefs.delete(note);
  SynthEngine.noteOff(note);
  const r = kbRects.get(note);
  if (r) r.classList.remove('on');
  if (noteRefs.size === 0) document.body.classList.remove('playing');
}

// 指（ポインター）ごとに押鍵を管理し、離した指の音だけを止める（chord-lab実績パターン）
const pointerHeld = new Map();
function setupKeyboardInput() {
  $('kb').addEventListener('pointerdown', (e) => {
    const attr = e.target.getAttribute && e.target.getAttribute('data-note');
    if (attr === null || attr === undefined) return;
    e.preventDefault();
    const note = Number(attr);
    pointerHeld.set(e.pointerId, note);
    noteOn(note);
  });
  const releaseHeldPointer = (e) => {
    const note = pointerHeld.get(e.pointerId);
    if (note === undefined) return;
    pointerHeld.delete(e.pointerId);
    noteOff(note);
  };
  window.addEventListener('pointerup', releaseHeldPointer);
  window.addEventListener('pointercancel', releaseHeldPointer);
  // グリッサンド: 押した指を滑らせると触れた鍵に追従する
  window.addEventListener('pointermove', (e) => {
    const cur = pointerHeld.get(e.pointerId);
    if (cur === undefined) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const attr = el && el.getAttribute && el.getAttribute('data-note');
    if (attr === null || attr === undefined) return;
    const note = Number(attr);
    if (note === cur) return;
    noteOff(cur);
    pointerHeld.set(e.pointerId, note);
    noteOn(note);
  });

  // PCキーボード演奏（A・W・S…の定番マッピング、Z / X でオクターブ移動）
  const PC_KEYMAP = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
    KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
  };
  let pcBase = 60;
  const pcHeld = new Map();
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    // Escapeはフォーカス位置に関係なく割当モードを解除する（SELECT系ガードより先に判定）
    if (e.code === 'Escape') { exitAssignMode(); return; }
    const t = e.target;
    if (t && t.tagName && /^(SELECT|INPUT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.code === 'KeyZ') { pcBase = Math.max(24, pcBase - 12); return; }
    if (e.code === 'KeyX') { pcBase = Math.min(84, pcBase + 12); return; }
    const offset = PC_KEYMAP[e.code];
    if (offset === undefined || pcHeld.has(e.code)) return;
    const note = pcBase + offset;
    pcHeld.set(e.code, note);
    noteOn(note);
  });
  document.addEventListener('keyup', (e) => {
    const note = pcHeld.get(e.code);
    if (note === undefined) return;
    pcHeld.delete(e.code);
    noteOff(note);
  });
  // フォーカス喪失時は押鍵をすべて解放（Cmd+Tab後の鳴り残り対策）
  window.addEventListener('blur', () => {
    for (const [, note] of pcHeld) noteOff(note);
    pcHeld.clear();
    for (const [, note] of pointerHeld) noteOff(note);
    pointerHeld.clear();
  });
}

// ---------- プリセット ----------

// 工場出荷プリセット: defaultPatchとの差分だけ書く
const FACTORY_PRESETS = {
  '初期状態': {},
  'プラック': {
    'ampEnv.attack': 0.002, 'ampEnv.decay': 0.4, 'ampEnv.sustain': 0, 'ampEnv.release': 0.4,
    'filter.cutoff': 2500, 'filter.reso': 0.3,
  },
  'ワウベース': {
    'oscA.octave': -1, 'filter.cutoff': 500, 'filter.reso': 0.4,
    'lfo1.shape': 'sine', 'lfo1.rateHz': 3,
    'mod1.src': 'lfo1', 'mod1.dst': 'filter.cutoff', 'mod1.amt': 0.6,
    'ampEnv.sustain': 1,
  },
  'WTモーション・パッド': {
    'oscA.wave': 'wt.basic', 'oscA.wtPos': 0.3,
    'ampEnv.attack': 0.6, 'ampEnv.release': 1.5, 'ampEnv.sustain': 0.9,
    'lfo1.shape': 'tri', 'lfo1.rateHz': 0.15,
    'mod1.src': 'lfo1', 'mod1.dst': 'oscA.wtPos', 'mod1.amt': 0.6,
    'filter.cutoff': 9000,
  },
  'ビブラート・リード': {
    'oscA.wave': 'square', 'filter.cutoff': 3000,
    'lfo1.shape': 'sine', 'lfo1.rateHz': 5.5,
    'mod1.src': 'lfo1', 'mod1.dst': 'oscA.pitch', 'mod1.amt': 0.05,
    'ampEnv.attack': 0.02, 'ampEnv.sustain': 1,
  },
};

function renderPresetSelect() {
  const sel = $('presetSelect');
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'プリセット…';
  sel.appendChild(ph);
  const addGroup = (label, names) => {
    if (!names.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const n of names) {
      const o = document.createElement('option');
      o.value = label + ':' + n;
      o.textContent = n;
      g.appendChild(o);
    }
    sel.appendChild(g);
  };
  addGroup('内蔵', Object.keys(FACTORY_PRESETS));
  addGroup('マイプリセット', Object.keys(settings.presets));
}

function applyPreset(patch) {
  SynthEngine.applyPatch(Object.assign(defaultPatch(), patch));
  refreshAllVisuals();
  renderAssigned();
  updateModRing();      // has-mod（非表示ノブの強制表示）を反映してから
  Viz.updateGeometry(); // 配線ジオメトリを計算する
  saveSettings();
  lessonOnParamChange(); // レシピ進行中にプリセットを読み込んだ場合、ステップ表示を実態に合わせ直す
}

function setupPresets() {
  renderPresetSelect();
  $('presetSelect').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) return;
    const [group, name] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    const patch = group === '内蔵' ? FACTORY_PRESETS[name] : settings.presets[name];
    if (patch) {
      applyPreset(patch);
      $('roAction').textContent = `プリセット「${name}」を読み込みました`;
      $('roDetail').textContent = 'ノブの位置を眺めてから音を鳴らすと「この音はこう作られている」が見えてきます。';
    }
    e.target.value = '';
  });
  $('presetSave').addEventListener('click', () => {
    const name = prompt('プリセット名を入力してください');
    if (!name) return;
    settings.presets[name] = SynthEngine.getPatch();
    saveSettings();
    renderPresetSelect();
  });
  $('presetInit').addEventListener('click', () => {
    applyPreset({});
    $('roAction').textContent = '初期状態に戻しました';
    $('roDetail').textContent = 'まっさらなノコギリ波から音作りを始めましょう。';
  });
}

// ---------- レッスン（つくる=音作りテスト / きく=聞き取りテスト） ----------

const lesson = {
  view: null,          // play | make | ear（初期化時にapplyViewが設定する）
  recipe: null,        // 進行中のレシピ
  stepIdx: 0,
  sandboxPatch: null,  // きくモードに入る前の音（戻るときに復元する）
  quiz: null,          // { level, qIdx, score, q, answered }
};

const BLOCK_LABELS = { oscA: 'OSC', filter: 'FILTER', ampEnv: 'ENV1', lfo1: 'LFO1', mod: 'MOD', master: 'OUT' };
const DIFFICULTY_LABELS = { 1: 'やさしい', 2: 'ふつう', 3: 'むずかしい' };

function paramLabel(id) {
  const def = paramById(id);
  return def ? `${BLOCK_LABELS[def.block] || def.block}の${def.name}` : id;
}

// 小さなDOM生成ヘルパー
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function refreshAfterPatchApply() {
  refreshAllVisuals();
  renderAssigned();
  updateModRing();
  Viz.updateGeometry();
}

// 発展的パラメーターのうち、現在のレシピステップで要求されているものは
// 「かんたん表示」でも表示する（has-modと同じ仕組み）。作業中でなければ全て解除する
function markLessonRequiredParams(ids) {
  const idSet = new Set(ids || []);
  for (const [pid, k] of knobEls) {
    k.wrap.classList.toggle('lesson-required', idSet.has(pid));
  }
}

// 試聴（お手本/A・B）を中断し、UIロックも解除する
function stopAudition() {
  SynthEngine.stopPhrase();
  document.body.classList.remove('audition-lock');
}

// ---- モード切替 ----

function applyView(view) {
  const prev = lesson.view;
  if (prev === view) return;
  stopAudition();
  if (prev === 'make') markLessonRequiredParams([]);
  exitAssignMode();
  // きくモードを離れるときは、入る前に作っていた音を復元する
  if (prev === 'ear' && lesson.sandboxPatch) {
    SynthEngine.applyPatch(lesson.sandboxPatch);
    refreshAfterPatchApply();
    lesson.sandboxPatch = null;
  }
  if (prev === 'ear') {
    lesson.quiz = null;
    document.body.classList.remove('quiz-lock');
  }
  if (view === 'ear') {
    lesson.sandboxPatch = SynthEngine.getPatch();
  }
  lesson.view = view;
  settings.view = view;
  saveSettings();
  for (const [id, v] of [['viewPlay', 'play'], ['viewMake', 'make'], ['viewEar', 'ear']]) {
    $(id).classList.toggle('on', view === v);
  }
  $('lessonPanel').hidden = view === 'play';
  renderLesson();
}

function renderLesson() {
  const body = $('lessonBody');
  body.innerHTML = '';
  if (lesson.view === 'make') renderMake(body);
  if (lesson.view === 'ear') renderEar(body);
}

// ---- つくる: 音作りテスト（レシピ再現） ----

function renderMake(body) {
  if (!lesson.recipe) {
    markLessonRequiredParams([]);
    const head = el('div', 'lesson-head');
    head.appendChild(el('h2', null, '音作りテスト'));
    head.appendChild(el('span', 'goal', 'お手本の音を聴いて、手順どおりにノブを動かして再現します。できた音はそのまま使えます。'));
    body.appendChild(head);
    const cards = el('div', 'lesson-cards');
    for (const r of RECIPES.slice().sort((a, b) => a.order - b.order)) {
      const card = el('button', 'lesson-card');
      card.type = 'button';
      card.appendChild(el('div', 'lc-title', r.title));
      card.appendChild(el('div', 'lc-goal', r.goal));
      const done = settings.recipesDone[r.id] ? '　完成済み' : '';
      card.appendChild(el('div', 'lc-meta', `${DIFFICULTY_LABELS[r.difficulty]}・全${r.steps.length}ステップ${done}`));
      card.addEventListener('click', () => startRecipe(r));
      cards.appendChild(card);
    }
    body.appendChild(cards);
    return;
  }

  const r = lesson.recipe;
  const targetFull = Object.assign(defaultPatch(), r.init, r.target);
  const head = el('div', 'lesson-head');
  head.appendChild(el('h2', null, r.title));
  head.appendChild(el('span', 'goal', r.goal));
  body.appendChild(head);

  const actions = el('div', 'lesson-actions');
  const btnTarget = el('button', 'primary', 'お手本の音を聴く');
  btnTarget.type = 'button';
  btnTarget.addEventListener('click', () => {
    // 再生中はエンジンのパッチがお手本に一時差し替わるため、ノブ操作をロックする。
    // ロックせずに触ると、レシピの達成判定がお手本パッチ基準で誤発火する
    stopAudition();
    document.body.classList.add('audition-lock');
    SynthEngine.playPhrase(r.audition, {
      patch: targetFull,
      onDone: () => document.body.classList.remove('audition-lock'),
    });
  });
  const btnCurrent = el('button', null, 'いまの音を聴く');
  btnCurrent.type = 'button';
  btnCurrent.addEventListener('click', () => { stopAudition(); SynthEngine.playPhrase(r.audition); });
  const btnBack = el('button', null, 'テスト一覧へ戻る');
  btnBack.type = 'button';
  btnBack.addEventListener('click', () => { stopAudition(); lesson.recipe = null; renderLesson(); });
  actions.appendChild(btnTarget);
  actions.appendChild(btnCurrent);
  actions.appendChild(btnBack);
  body.appendChild(actions);

  if (lesson.stepIdx >= r.steps.length) {
    markLessonRequiredParams([]);
    settings.recipesDone[r.id] = true;
    saveSettings();
    const done = el('div', 'lesson-done');
    done.appendChild(el('div', 'ld-title', 'できあがり'));
    done.appendChild(el('div', null, 'お手本と聴き比べてみましょう。この音は「さわる」に戻ってそのまま使えますし、「音を保存」もできます。'));
    body.appendChild(done);
    return;
  }

  const list = el('div', 'step-list');
  r.steps.forEach((s, i) => {
    const state = i < lesson.stepIdx ? 'done' : i === lesson.stepIdx ? 'current' : '';
    const card = el('div', `step-card ${state}`);
    card.appendChild(el('div', 'st-title', `${i + 1}. ${s.title}`));
    if (i === lesson.stepIdx) {
      card.appendChild(el('div', 'st-text', s.text));
      if (s.listen) card.appendChild(el('div', 'st-listen', `聴きどころ: ${s.listen}`));
      if (s.auto) {
        const btn = el('button', null, 'この操作を適用する');
        btn.type = 'button';
        btn.style.marginTop = '8px';
        btn.addEventListener('click', () => {
          for (const [id, v] of Object.entries(s.params)) setParam(id, v);
        });
        card.appendChild(btn);
      }
    }
    list.appendChild(card);
  });
  body.appendChild(list);
  // 現在のステップが要求するノブは、かんたん表示でも隠さない（オクターブ等の発展パラメーター対策）
  markLessonRequiredParams(Object.keys(r.steps[lesson.stepIdx].params));
}

function startRecipe(r) {
  stopAudition();
  SynthEngine.applyPatch(Object.assign(defaultPatch(), r.init));
  refreshAfterPatchApply();
  lesson.recipe = r;
  lesson.stepIdx = recipeNextStep(SynthEngine.getPatch(), r);
  renderLesson();
  $('roAction').textContent = `音作りテスト「${r.title}」を開始`;
  $('roDetail').textContent = 'まず「お手本の音を聴く」で完成形を確認してから、ステップ1に取りかかりましょう。';
}

// ノブが動くたびに呼ばれ、現在のステップが達成されたら次へ進める
function lessonOnParamChange() {
  if (lesson.view !== 'make' || !lesson.recipe) return;
  const next = recipeNextStep(SynthEngine.getPatch(), lesson.recipe);
  if (next === lesson.stepIdx) return;
  const finished = next >= lesson.recipe.steps.length;
  const advanced = next > lesson.stepIdx;
  lesson.stepIdx = next;
  renderLesson();
  if (finished) {
    $('roAction').textContent = 'できあがり';
    $('roDetail').textContent = '「お手本の音を聴く」と「いまの音を聴く」で聴き比べてみましょう。';
  } else if (advanced) {
    $('roAction').textContent = 'ステップ完了';
    $('roDetail').textContent = `次は「${lesson.recipe.steps[next].title}」です。`;
  }
}

// ---- きく: 聞き取りテスト（どのノブが変わった？） ----

function renderEar(body) {
  if (!lesson.quiz) {
    document.body.classList.remove('quiz-lock');
    const head = el('div', 'lesson-head');
    head.appendChild(el('h2', null, '聞き取りテスト'));
    head.appendChild(el('span', 'goal', 'AとBの音を聴き比べて、どのノブが変わったかを当てます。逃げない耳が育ちます。'));
    body.appendChild(head);
    const cards = el('div', 'lesson-cards');
    for (const lv of QUIZ_LEVELS) {
      const card = el('button', 'lesson-card');
      card.type = 'button';
      card.appendChild(el('div', 'lc-title', lv.name));
      card.appendChild(el('div', 'lc-goal', lv.desc));
      const best = settings.quizBest[lv.id];
      card.appendChild(el('div', 'lc-meta',
        `全${lv.questionCount}問・${lv.passScore}問正解で合格${best !== undefined ? `　自己ベスト ${best}/${lv.questionCount}` : ''}`));
      card.addEventListener('click', () => startQuiz(lv));
      cards.appendChild(card);
    }
    body.appendChild(cards);
    return;
  }

  const quiz = lesson.quiz;

  if (quiz.qIdx >= quiz.level.questionCount) {
    const passed = quiz.score >= quiz.level.passScore;
    const done = el('div', 'lesson-done');
    done.appendChild(el('div', 'ld-title', passed ? '合格' : 'もう少し'));
    done.appendChild(el('div', null, `${quiz.level.name}: ${quiz.score} / ${quiz.level.questionCount} 問正解（合格ラインは${quiz.level.passScore}問）`));
    const actions = el('div', 'lesson-actions');
    actions.style.justifyContent = 'center';
    const again = el('button', 'primary', 'もう一度挑戦');
    again.type = 'button';
    again.addEventListener('click', () => startQuiz(quiz.level));
    const back = el('button', null, 'レベル一覧へ');
    back.type = 'button';
    back.addEventListener('click', () => { lesson.quiz = null; renderLesson(); });
    actions.appendChild(again);
    actions.appendChild(back);
    done.appendChild(actions);
    body.appendChild(done);
    return;
  }

  const q = quiz.q;
  body.appendChild(el('div', 'quiz-status',
    `${quiz.level.name}　問題 ${quiz.qIdx + 1} / ${quiz.level.questionCount}　ここまで ${quiz.score} 問正解`));

  const ab = el('div', 'quiz-actions');
  const btnA = el('button', 'ab', 'Aの音（もと）');
  btnA.type = 'button';
  // 回答前はノブの見た目を更新しない（値が動いて見えると聴かずに正解できてしまうため）。
  // 音だけをA/Bで切り替える
  btnA.addEventListener('click', () => {
    SynthEngine.applyPatch(q.base);
    SynthEngine.playPhrase(QUIZ_BASE_PATCHES[q.baseId].audition);
  });
  const btnB = el('button', 'ab', 'Bの音（どこかが変わった）');
  btnB.type = 'button';
  btnB.addEventListener('click', () => {
    SynthEngine.applyPatch(Object.assign({}, q.base, { [q.target]: q.after }));
    SynthEngine.playPhrase(QUIZ_BASE_PATCHES[q.baseId].audition);
  });
  ab.appendChild(btnA);
  ab.appendChild(btnB);
  body.appendChild(ab);
  body.appendChild(el('div', 'quiz-status', '何度でも聴き比べてOK。変わったのはどのノブ？'));

  const choices = el('div', 'quiz-choices');
  for (const c of q.choices) {
    const btn = el('button', null, paramLabel(c));
    btn.type = 'button';
    btn.dataset.choice = c;
    btn.addEventListener('click', () => answerQuiz(c, choices));
    choices.appendChild(btn);
  }
  body.appendChild(choices);

  const fb = el('div', 'quiz-feedback');
  fb.id = 'quizFeedback';
  body.appendChild(fb);
}

function startQuiz(level) {
  lesson.quiz = { level, qIdx: 0, score: 0, q: null, answered: false };
  document.body.classList.add('quiz-lock');
  nextQuizQuestion();
}

function nextQuizQuestion() {
  stopAudition();
  const quiz = lesson.quiz;
  quiz.q = quizGenQuestion(quiz.level, QUIZ_BASE_PATCHES, Math.random, settings.quizStats);
  quiz.answered = false;
  SynthEngine.applyPatch(quiz.q.base);
  // ここではノブ表示を更新しない（回答前に見た目で答えが分かってしまうため）。
  // 正解発表時に answerQuiz() が改めて表示を同期させる
  renderLesson();
}

function answerQuiz(choice, choicesEl) {
  const quiz = lesson.quiz;
  if (quiz.answered) return;
  quiz.answered = true;
  const q = quiz.q;
  const correct = quizJudge(q, choice);
  // 弱点の記録（正答率が低いパラメーターほど次から出やすくなる）
  const s = settings.quizStats[q.target] || { seen: 0, correct: 0 };
  s.seen += 1;
  if (correct) s.correct += 1;
  settings.quizStats[q.target] = s;
  if (correct) quiz.score += 1;
  saveSettings();

  // 回答後は初めて実際の状態（値・配線）を見せる。正解のノブがどこにあったか確認できる
  SynthEngine.applyPatch(Object.assign({}, q.base, { [q.target]: q.after }));
  refreshAfterPatchApply();

  for (const btn of choicesEl.querySelectorAll('button')) {
    if (btn.dataset.choice === q.target) btn.classList.add('correct');
    else if (btn.dataset.choice === choice) btn.classList.add('wrong');
    btn.disabled = true;
  }
  const def = paramById(q.target);
  const dirText = q.dir === null ? '' : q.dir > 0 ? '（上げた）' : '（下げた）';
  const fb = $('quizFeedback');
  fb.innerHTML = `<span class="${correct ? 'ok' : 'ng'}">${correct ? '正解' : '不正解'}</span>　変わったのは「${escapeHtml(paramLabel(q.target))}」${dirText}。${escapeHtml(def.short)}`;
  const next = el('button', null, quiz.qIdx + 1 >= quiz.level.questionCount ? '結果を見る' : '次の問題へ');
  next.type = 'button';
  next.style.marginLeft = '12px';
  next.addEventListener('click', () => {
    quiz.qIdx += 1;
    if (quiz.qIdx >= quiz.level.questionCount) {
      const best = settings.quizBest[quiz.level.id];
      if (best === undefined || quiz.score > best) settings.quizBest[quiz.level.id] = quiz.score;
      saveSettings();
      renderLesson();
    } else {
      nextQuizQuestion();
    }
  });
  fb.appendChild(next);
}

// ---------- 表示モード（シンプル/フル）とテーマ ----------

function applyMode(mode) {
  settings.mode = mode;
  document.body.classList.toggle('simple', mode === 'simple');
  $('modeSimple').classList.toggle('on', mode === 'simple');
  $('modeFull').classList.toggle('on', mode === 'full');
  Viz.updateGeometry();
  saveSettings();
}

function applyTheme(theme) {
  settings.theme = theme;
  document.documentElement.dataset.theme = theme;
  saveSettings();
}

// ---------- iOS対策: 最初のユーザー操作で音声を解錠（chord-lab実績トリック） ----------

let audioUnlocked = false;
function silentWavUrl() {
  const sr = 8000, n = sr / 2, b = new ArrayBuffer(44 + n * 2), d = new DataView(b);
  const writeStr = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
  writeStr(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  writeStr(36, 'data'); d.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
let silentAudioEl = null; // 参照を保持し、無音ループがGCで止まらないようにする
function unlockAudio() {
  if (!SynthEngine.ensureAudio()) return;
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    silentAudioEl = new Audio(silentWavUrl());
    silentAudioEl.loop = true;
    silentAudioEl.volume = 0.001;
    silentAudioEl.setAttribute('playsinline', '');
    silentAudioEl.play().then(() => {
      ['pointerdown', 'touchend', 'mousedown', 'keydown'].forEach((ev) => document.removeEventListener(ev, unlockAudio));
    }).catch(() => { audioUnlocked = false; silentAudioEl = null; });
  } catch { audioUnlocked = false; silentAudioEl = null; }
}
['pointerdown', 'touchend', 'mousedown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));

// バックグラウンドや音声中断から戻ったとき、自動で音を復帰させる
function resumeAudioIfNeeded() {
  const ctx = SynthEngine.audioCtx;
  if (ctx && ctx.state !== 'running') {
    try { ctx.resume(); } catch {}
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeAudioIfNeeded(); });
window.addEventListener('pageshow', resumeAudioIfNeeded);
window.addEventListener('focus', resumeAudioIfNeeded);

// ---------- 初期化 ----------

buildControls();
buildKeyboard();
setupKeyboardInput();
setupPresets();

if (settings.patch) SynthEngine.applyPatch(settings.patch);
refreshAllVisuals();
renderAssigned();

$('assignBtn').addEventListener('click', () => {
  if (document.body.classList.contains('assign-mode')) exitAssignMode();
  else enterAssignMode();
});
document.addEventListener('pointerdown', (e) => {
  // 割当モード中に背景をクリックしたらキャンセル（ノブ・ボタンは各自で処理）
  if (!document.body.classList.contains('assign-mode')) return;
  if (e.target.closest('.knob') || e.target.closest('#assignBtn')) return;
  exitAssignMode();
});

$('modeSimple').addEventListener('click', () => applyMode('simple'));
$('modeFull').addEventListener('click', () => applyMode('full'));
$('themeBtn').addEventListener('click', () => applyTheme(settings.theme === 'dark' ? 'light' : 'dark'));
$('viewPlay').addEventListener('click', () => applyView('play'));
$('viewMake').addEventListener('click', () => applyView('make'));
$('viewEar').addEventListener('click', () => applyView('ear'));

applyMode(settings.mode);
applyTheme(settings.theme);
applyView(settings.view);
Viz.init();
updateModRing();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
