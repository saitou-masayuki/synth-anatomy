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
if (!['play', 'make'].includes(settings.view)) settings.view = 'play';
if (!settings.recipesDone || typeof settings.recipesDone !== 'object' || Array.isArray(settings.recipesDone)) settings.recipesDone = {};
settings.introSeen = settings.introSeen === true;

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // 試聴（お手本）中の一時パッチは「自分の音」ではないため保存しない。
    // 保存すると、リロード時に作りかけの音がお手本パッチで上書きされてしまう
    if (!SynthEngine.auditioning) {
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
// mod1.src/dst は割当UI（LFO1をノブにつなぐボタン）経由で操作するため直接は描画しない。amtはLFOブロックに置く
const HIDDEN_PARAMS = new Set(['mod1.src', 'mod1.dst']);

const knobEls = new Map(); // paramId → { wrap, svg, valueArc, pointer, modRing, modDot, valueText, zeroNorm }
// 現在ドラッグ中のノブの終了処理。ウィンドウのフォーカス喪失時（Cmd+Tab等）に
// pointerup/pointercancelが届かず、ドラッグ状態やスコープ強調が残留するのを防ぐ
const activeKnobDrags = new Set();

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
    Viz.snapshotGhosts();
    Viz.setScopeActive(def.block, true); // 触っている間、対応するスコープの枠を強調する
    activeKnobDrags.add(endDrag); // ウィンドウのフォーカス喪失時に強制終了できるよう登録する
    try { knob.setPointerCapture(e.pointerId); } catch {} // 環境により失敗し得るが、ドラッグ自体は続行できる
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
    activeKnobDrags.delete(endDrag);
    bubble.hidden = true;
    Viz.releaseGhosts();
    Viz.setScopeActive(def.block, false);
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
  flashReadout();
}

// 説明パネルの更新を短いフラッシュで知らせる（アニメーションを毎回リスタートさせる）
function flashReadout() {
  const ro = $('readout');
  ro.classList.remove('flash');
  void ro.offsetWidth;
  ro.classList.add('flash');
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
  // フォーカス喪失時は押鍵をすべて解放（Cmd+Tab後の鳴り残り対策）。
  // ドラッグ中のノブも同様に強制終了する（pointerup/pointercancelが届かないまま
  // dragging状態やスコープの強調表示が残留するのを防ぐ）
  window.addEventListener('blur', () => {
    for (const [, note] of pcHeld) noteOff(note);
    pcHeld.clear();
    for (const [, note] of pointerHeld) noteOff(note);
    pointerHeld.clear();
    for (const endDrag of [...activeKnobDrags]) endDrag();
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

// ---------- つくる: 診断チャレンジ（お手本の音を、聴いて・触って・答え合わせしながら再現する） ----------

const lesson = {
  view: null,       // play | make（初期化時にapplyViewが設定する）
  recipe: null,     // 挑戦中のレシピ
  hints: [],        // 開いたヒント（{label, text}）。一度開いたら閉じずに残す
  mismatch: null,   // 直近の答え合わせ結果（ズレているブロック名の配列）。未実施ならnull
  done: false,
  idleTimer: null,  // 一定時間操作が無いとヒントをそっと促す
};

const BLOCK_LABELS = { oscA: 'OSC', filter: 'FILTER', ampEnv: 'ENV1', lfo1: 'LFO1', mod: 'MOD', master: 'OUT' };
const DIFFICULTY_LABELS = { 1: 'やさしい', 2: 'ふつう', 3: 'むずかしい' };
const MODE_DESCRIPTIONS = {
  play: 'さわる — 自由に音作りをする場所。鍵盤で鳴らしながらノブを回すと、下の説明パネルが解説します',
  make: 'つくる — お手本の音を聴いて、どうすれば同じ音になるか自分で考えながら作る診断チャレンジ',
};
// ヒントラダー・近さ枠の対象となる「答え合わせ」ブロック名 → 実ラックのDOM要素id。
// modには専用のラック区画が無く、配線・深さの操作はLFO1ブロック内で行うため同じ要素にまとめる
const BLOCK_DOM_ID = { oscA: 'block-oscA', filter: 'block-filter', ampEnv: 'block-amp', lfo1: 'block-lfo1', mod: 'block-lfo1', master: 'block-out' };
const PROXIMITY_RACK_IDS = ['block-oscA', 'block-filter', 'block-amp', 'block-lfo1', 'block-out'];
const HINT_LABELS = ['聴きどころ', '注目ブロック', '具体的な操作'];

// タブに進捗を表示する（数字だけでも「つくる」の全体量が見える）
function updateNavProgress() {
  const doneCount = RECIPES.filter((r) => settings.recipesDone[r.id]).length;
  $('progressMake').textContent = `${doneCount}/${RECIPES.length}`;
}

// 初回だけ「つくる」への案内バナーを出す（閉じるか、レシピを1つでも完成したら出さない）
function updateIntroBanner() {
  const anyDone = RECIPES.some((r) => settings.recipesDone[r.id]);
  const wasHidden = $('introBanner').hidden;
  $('introBanner').hidden = !(lesson.view === 'play' && !settings.introSeen && !anyDone);
  // 表示状態が変わった＝レイアウトの高さが変わったので、オーバーレイの配線座標を計算し直す
  if (wasHidden !== $('introBanner').hidden) Viz.updateGeometry();
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

// 発展的パラメーターのうち、挑戦中のレシピが対象とするものは
// 「かんたん表示」でも表示する（has-modと同じ仕組み）。挑戦中でなければ全て解除する
function markLessonRequiredParams(ids) {
  const idSet = new Set(ids || []);
  for (const [pid, k] of knobEls) {
    k.wrap.classList.toggle('lesson-required', idSet.has(pid));
  }
}

// 試聴（お手本/いまの音）を中断し、UIロックも解除する
function stopAudition() {
  SynthEngine.stopPhrase();
  document.body.classList.remove('audition-lock');
}

// ---- モード切替 ----

function applyView(view) {
  const prev = lesson.view;
  if (prev === view) return;
  stopAudition();
  if (prev === 'make') {
    clearProximityFrames();
    markLessonRequiredParams([]);
    if (lesson.idleTimer) clearTimeout(lesson.idleTimer);
  }
  exitAssignMode();
  lesson.view = view;
  settings.view = view;
  saveSettings();
  for (const [id, v] of [['viewPlay', 'play'], ['viewMake', 'make']]) {
    $(id).classList.toggle('on', view === v);
  }
  $('modeDesc').textContent = MODE_DESCRIPTIONS[view] || '';
  updateIntroBanner();
  $('lessonPanel').hidden = view === 'play';
  renderLesson(); // renderMakeが挑戦中の状態（発展パラメーター表示等）を正しく反映する
  if (view === 'make' && lesson.recipe && !lesson.done) {
    applyProximityFrames();
    armStallTimer();
  }
  // バナー・レッスンパネルの表示切替でsignalRack/modRackの縦位置がずれるため、
  // オーバーレイの配線座標（ENV1→AMP線・LFOモジュレーション線）を計算し直す
  Viz.updateGeometry();
}

function renderLesson() {
  const body = $('lessonBody');
  body.innerHTML = '';
  if (lesson.view === 'make') renderMake(body);
}

// ---- 近さ枠: targetに関わる実ブロックの縁を、近づくほど太く・強く見せる（色は使わない） ----

function clearProximityFrames() {
  for (const id of PROXIMITY_RACK_IDS) resetProximity($(id));
}

function applyProximityFrames() {
  if (!lesson.recipe) { clearProximityFrames(); return; }
  const patch = SynthEngine.getPatch();
  const blocks = recipeTargetBlocks(lesson.recipe.target);
  const domCloseness = {};
  for (const block of blocks) {
    const domId = BLOCK_DOM_ID[block];
    const c = recipeBlockCloseness(patch, lesson.recipe.target, block);
    // 1つのDOM要素に複数のブロックが重なる場合（mod+lfo1）は、厳しい方の近さを見せる
    domCloseness[domId] = domId in domCloseness ? Math.min(domCloseness[domId], c) : c;
  }
  for (const id of PROXIMITY_RACK_IDS) {
    const target = domCloseness[id];
    if (target === undefined) resetProximity($(id));
    else setProximity($(id), target);
  }
}

function setProximity(blockEl, closeness) {
  blockEl.style.borderWidth = (2 + closeness * 3.5) + 'px';
  blockEl.style.boxShadow = closeness > 0.5 ? `0 0 ${(6 * closeness).toFixed(1)}px rgba(168,194,255,${(closeness * 0.5).toFixed(2)})` : 'none';
}

function resetProximity(blockEl) {
  blockEl.style.borderWidth = '';
  blockEl.style.boxShadow = '';
}

// ---- 停滞検知: しばらく操作が無く、直近の答え合わせも不一致のままなら、そっとヒントを促す ----

function armStallTimer() {
  if (lesson.idleTimer) clearTimeout(lesson.idleTimer);
  lesson.idleTimer = setTimeout(() => {
    if (lesson.recipe && !lesson.done && lesson.mismatch && lesson.mismatch.length > 0) {
      const nudge = $('stallNudge');
      if (nudge) nudge.classList.add('show');
    }
  }, 15000);
}

function resetStallTimer() {
  const nudge = $('stallNudge');
  if (nudge) nudge.classList.remove('show');
  armStallTimer();
}

// ---- 一覧・挑戦画面のレンダリング ----

function renderMake(body) {
  if (!lesson.recipe) {
    markLessonRequiredParams([]);
    clearProximityFrames();
    const head = el('div', 'lesson-head');
    head.appendChild(el('h2', null, 'つくる'));
    head.appendChild(el('span', 'goal', 'お手本の音を聴いて、どうすれば同じ音になるか自分で考えながら作ります。'));
    body.appendChild(head);
    const cards = el('div', 'lesson-cards');
    for (const r of RECIPES.slice().sort((a, b) => a.order - b.order)) {
      const card = el('button', 'lesson-card');
      card.type = 'button';
      card.appendChild(el('div', 'lc-title', r.title));
      card.appendChild(el('div', 'lc-goal', r.goal));
      card.appendChild(el('div', 'lc-meta', DIFFICULTY_LABELS[r.difficulty] + (settings.recipesDone[r.id] ? '　完成済み' : '')));
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
  const btnTarget = el('button', 'primary', 'お手本を聴く');
  btnTarget.type = 'button';
  btnTarget.addEventListener('click', () => {
    // 再生中はエンジンのパッチがお手本に一時差し替わるため、ノブ操作をロックする
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
  const btnBack = el('button', null, '一覧へ戻る');
  btnBack.type = 'button';
  btnBack.addEventListener('click', () => {
    stopAudition();
    clearProximityFrames();
    markLessonRequiredParams([]);
    if (lesson.idleTimer) clearTimeout(lesson.idleTimer);
    lesson.recipe = null;
    renderLesson();
  });
  actions.appendChild(btnTarget);
  actions.appendChild(btnCurrent);
  actions.appendChild(btnBack);
  body.appendChild(actions);

  // 答え合わせ（いつでも押せる。ブロック単位のズレ件数だけを返し、パラメーター名や数値は明かさない）
  const checkRow = el('div', 'check-row');
  const checkBtn = el('button', 'check-btn', '答え合わせ');
  checkBtn.type = 'button';
  checkBtn.disabled = lesson.done;
  checkBtn.addEventListener('click', doCheck);
  const feedback = el('span', 'check-feedback');
  feedback.innerHTML = lesson.done
    ? '<span class="ok">ズレなし</span>'
    : (lesson.mismatch === null ? 'まだ答え合わせをしていません' : escapeHtml(mismatchText(lesson.mismatch)));
  checkRow.appendChild(checkBtn);
  checkRow.appendChild(feedback);
  body.appendChild(checkRow);

  if (lesson.done) {
    markLessonRequiredParams([]);
    const sweep = el('div', 'sweep-line run');
    sweep.appendChild(el('div', 'sweep-fill'));
    body.appendChild(sweep);

    const doneBox = el('div', 'lesson-done show');
    doneBox.appendChild(el('div', 'ld-title', 'できあがり'));
    doneBox.appendChild(el('div', null, r.insight));
    const nav = el('div', 'lesson-actions');
    nav.style.justifyContent = 'center';
    const nextRecipe = RECIPES.slice().sort((a, b) => a.order - b.order).find((x) => !settings.recipesDone[x.id] && x.id !== r.id);
    if (nextRecipe) {
      const nextBtn = el('button', 'primary', `次の課題へ（${nextRecipe.title}）`);
      nextBtn.type = 'button';
      nextBtn.addEventListener('click', () => startRecipe(nextRecipe));
      nav.appendChild(nextBtn);
    }
    const playBtn = el('button', null, 'さわるで続ける');
    playBtn.type = 'button';
    playBtn.addEventListener('click', () => applyView('play'));
    nav.appendChild(playBtn);
    doneBox.appendChild(nav);
    body.appendChild(doneBox);
    return;
  }

  markLessonRequiredParams(Object.keys(r.target));

  const hintArea = el('div', 'hint-area');
  const hintBtn = el('button', 'hint-btn', hintButtonLabel());
  hintBtn.type = 'button';
  hintBtn.disabled = lesson.hints.length >= 3;
  hintBtn.addEventListener('click', revealNextHint);
  hintArea.appendChild(hintBtn);
  const nudge = el('div', 'stall-nudge', '行き詰まったら、ヒントを見てみましょう');
  nudge.id = 'stallNudge';
  hintArea.appendChild(nudge);
  const hintList = el('div', 'hint-list');
  for (const h of lesson.hints) {
    const item = el('div', 'hint-item');
    item.innerHTML = `<b>ヒント${lesson.hints.indexOf(h) + 1}: ${escapeHtml(h.label)}</b>${escapeHtml(h.text)}`;
    hintList.appendChild(item);
  }
  hintArea.appendChild(hintList);
  body.appendChild(hintArea);
}

function hintButtonLabel() {
  const n = lesson.hints.length;
  return n >= 3 ? 'ヒントを見る（3/3・すべて開きました）' : `ヒントを見る（${n + 1}/3）`;
}

// 現在のパッチをtargetと突き合わせ、ズレているブロック名（表示用ラベル）を返す
function currentMismatchBlocks() {
  if (!lesson.recipe) return [];
  return recipeJudgeAll(SynthEngine.getPatch(), lesson.recipe.target);
}

function mismatchText(off) {
  if (off.length === 0) return 'ズレなし';
  return `ズレているものが、あと ${off.length} 個あります（${off.map((b) => BLOCK_LABELS[b] || b).join('・')}周辺）`;
}

// ヒント段階ごとの文言。段階0=抽象的な聴きどころ（レシピ固定）、段階1=注目ブロック名
// （その時点の答え合わせ結果から動的に生成）、段階2=ブロックごとの具体的な操作方針。
// 一度生成した文言は開いた時点で固定し、以後ノブを動かしても変わらない
function hintTextAt(r, levelIdx) {
  if (levelIdx === 0) return r.approach;
  const off = currentMismatchBlocks();
  if (off.length === 0) return 'いまのところ近づけているようです。答え合わせしてみましょう';
  if (levelIdx === 1) return `${off.map((b) => BLOCK_LABELS[b] || b).join('・')}のあたりに注目してみて`;
  return off.map((b) => r.blockHints[b]).filter(Boolean).join('　/　');
}

function revealNextHint() {
  if (!lesson.recipe || lesson.hints.length >= 3) return;
  resetStallTimer();
  const levelIdx = lesson.hints.length;
  lesson.hints.push({ label: HINT_LABELS[levelIdx], text: hintTextAt(lesson.recipe, levelIdx) });
  renderLesson();
}

function doCheck() {
  if (!lesson.recipe || lesson.done) return;
  resetStallTimer();
  const off = currentMismatchBlocks();
  lesson.mismatch = off;
  if (off.length === 0) {
    lesson.done = true;
    settings.recipesDone[lesson.recipe.id] = true;
    saveSettings();
    updateNavProgress();
    if (lesson.idleTimer) clearTimeout(lesson.idleTimer);
  }
  renderLesson();
}

function startRecipe(r) {
  stopAudition();
  SynthEngine.applyPatch(Object.assign(defaultPatch(), r.init));
  refreshAfterPatchApply();
  lesson.recipe = r;
  lesson.hints = [];
  lesson.mismatch = null;
  lesson.done = false;
  renderLesson();
  applyProximityFrames();
  armStallTimer();
  $('roAction').textContent = `「${r.title}」を開始`;
  $('roDetail').textContent = 'お手本を聴いて、どこがどう違うか自分の耳で確かめてみましょう。';
}

// ノブが動くたびに呼ばれる。答え合わせやヒントの内容はここでは変えず、
// 近さ枠（実ブロックの縁の強調）だけをその場で更新する
function lessonOnParamChange() {
  if (lesson.view !== 'make' || !lesson.recipe || lesson.done) return;
  resetStallTimer();
  applyProximityFrames();
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
$('introGo').addEventListener('click', () => {
  settings.introSeen = true;
  saveSettings();
  applyView('make');
});
$('introClose').addEventListener('click', () => {
  settings.introSeen = true;
  saveSettings();
  updateIntroBanner();
});
updateNavProgress();

applyMode(settings.mode);
applyTheme(settings.theme);
applyView(settings.view);
Viz.init();
updateModRing();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
