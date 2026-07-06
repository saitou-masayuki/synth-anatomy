import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// content-params.js（純粋データ+純粋関数）を vm で評価する
const src = readFileSync(new URL('../content-params.js', import.meta.url), 'utf8');
const ctx = createContext({});
runInContext(src, ctx);
const { PARAMS, MOD_DESTS, paramById, normParam, denormParam, clampParam, fmtValue, defaultPatch } = ctx;

function plain(x) {
  return JSON.parse(JSON.stringify(x));
}

// ---- PARAMS の構造 ----

test('PARAMSは空でない配列', () => {
  assert.ok(Array.isArray(PARAMS));
  assert.ok(PARAMS.length > 0);
});

test('idは一意でドット区切り形式', () => {
  const ids = PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/, `不正なid: ${id}`);
});

test('全パラメーターが必須フィールドを持つ', () => {
  for (const p of PARAMS) {
    assert.ok(p.block, `${p.id}: blockがない`);
    assert.ok(p.name, `${p.id}: nameがない`);
    assert.ok(p.short, `${p.id}: short（一言説明）がない`);
    assert.ok(['float', 'int', 'enum', 'bool'].includes(p.type), `${p.id}: 不正なtype`);
    assert.ok(['knob', 'select', 'toggle'].includes(p.ui), `${p.id}: 不正なui`);
    assert.ok(Number.isInteger(p.phase), `${p.id}: phaseがない`);
  }
});

test('数値パラメーターは範囲とカーブを持ち、既定値が範囲内', () => {
  for (const p of PARAMS) {
    if (p.type !== 'float' && p.type !== 'int') continue;
    assert.ok(typeof p.min === 'number' && typeof p.max === 'number' && p.min < p.max, `${p.id}: min/maxが不正`);
    assert.ok(['lin', 'log', 'exp2'].includes(p.curve), `${p.id}: 不正なcurve`);
    assert.ok(p.default >= p.min && p.default <= p.max, `${p.id}: defaultが範囲外`);
    if (p.curve === 'log') assert.ok(p.min > 0, `${p.id}: logカーブはmin>0が必要`);
  }
});

test('enumパラメーターは値一覧を持ち、既定値が一覧に含まれる', () => {
  for (const p of PARAMS) {
    if (p.type !== 'enum') continue;
    assert.ok(Array.isArray(p.values) && p.values.length >= 2, `${p.id}: valuesが不正`);
    const vs = p.values.map((o) => o.v);
    assert.equal(new Set(vs).size, vs.length, `${p.id}: 値が重複`);
    assert.ok(vs.includes(p.default), `${p.id}: defaultが一覧にない`);
    for (const o of p.values) assert.ok(o.name, `${p.id}.${o.v}: 表示名がない`);
  }
});

test('PARAMSは純粋データ（JSON往復で恒等）', () => {
  assert.deepEqual(plain(PARAMS), plain(JSON.parse(JSON.stringify(plain(PARAMS)))));
  for (const p of PARAMS) {
    for (const v of Object.values(p)) assert.notEqual(typeof v, 'function', `${p.id}: 関数を含む`);
  }
});

// ---- モジュレーション定義 ----

test('modTargetパラメーターはmodRateとmodRangeを持つ', () => {
  for (const p of PARAMS) {
    if (!p.modTarget) continue;
    assert.ok(['audio', 'control'].includes(p.modRate), `${p.id}: modRateが不正`);
    assert.ok(typeof p.modRange === 'number' && p.modRange > 0, `${p.id}: modRangeが不正`);
  }
});

test('mod1.dstの全選択肢（none以外）にMOD_DESTSのエントリがある', () => {
  const dstDef = paramById('mod1.dst');
  assert.ok(dstDef, 'mod1.dstが定義されていない');
  for (const o of dstDef.values) {
    if (o.v === 'none') continue;
    const dest = MOD_DESTS.find((d) => d.id === o.v);
    assert.ok(dest, `MOD_DESTSに ${o.v} がない`);
    assert.ok(['audio', 'control'].includes(dest.kind), `${o.v}: kindが不正`);
    assert.ok(typeof dest.range === 'number' && dest.range > 0, `${o.v}: rangeが不正`);
  }
});

// ---- Phase 1 に必要なパラメーターが揃っている ----

test('Phase 1のコアパラメーターが定義されている', () => {
  const required = [
    'oscA.wave', 'oscA.wtPos', 'oscA.octave', 'oscA.semi', 'oscA.fine', 'oscA.level',
    'filter.type', 'filter.cutoff', 'filter.reso',
    'ampEnv.attack', 'ampEnv.decay', 'ampEnv.sustain', 'ampEnv.release',
    'lfo1.shape', 'lfo1.rateHz',
    'mod1.src', 'mod1.dst', 'mod1.amt',
    'master.gain',
  ];
  for (const id of required) {
    const p = paramById(id);
    assert.ok(p, `${id} が未定義`);
    assert.equal(p.phase, 1, `${id} はphase 1であるべき`);
  }
});

// ---- 正規化・カーブ写像 ----

test('normParamは端点で0と1を返す', () => {
  for (const p of PARAMS) {
    if (p.type !== 'float' && p.type !== 'int') continue;
    assert.ok(Math.abs(normParam(p.id, p.min) - 0) < 1e-9, `${p.id}: norm(min)≠0`);
    assert.ok(Math.abs(normParam(p.id, p.max) - 1) < 1e-9, `${p.id}: norm(max)≠1`);
  }
});

test('denormParam∘normParamは恒等（代表値で往復）', () => {
  for (const p of PARAMS) {
    if (p.type !== 'float' && p.type !== 'int') continue;
    for (const t of [0.1, 0.5, 0.9]) {
      const v = denormParam(p.id, t);
      const back = denormParam(p.id, normParam(p.id, v));
      assert.ok(Math.abs(back - v) < 1e-6 * Math.max(1, Math.abs(v)), `${p.id}: 往復がズレる (${v} → ${back})`);
    }
  }
});

test('logカーブは中点が幾何平均になる', () => {
  const v = denormParam('filter.cutoff', 0.5);
  const def = paramById('filter.cutoff');
  const geo = Math.sqrt(def.min * def.max);
  assert.ok(Math.abs(v - geo) / geo < 0.01, `中点${v}が幾何平均${geo}とズレる`);
});

test('intパラメーターのdenormは整数を返す', () => {
  const v = denormParam('oscA.octave', 0.37);
  assert.equal(v, Math.round(v));
});

test('clampParamは範囲外を丸める', () => {
  assert.equal(clampParam('filter.cutoff', 999999), paramById('filter.cutoff').max);
  assert.equal(clampParam('filter.cutoff', 1), paramById('filter.cutoff').min);
  assert.equal(clampParam('mod1.amt', -5), -1);
});

// ---- 表示フォーマット ----

test('fmtValueが人間向けの表記を返す', () => {
  assert.equal(fmtValue('filter.cutoff', 8200), '8.2kHz');
  assert.equal(fmtValue('filter.cutoff', 350), '350Hz');
  assert.equal(fmtValue('ampEnv.attack', 0.005), '5ms');
  assert.equal(fmtValue('ampEnv.release', 1.5), '1.50s');
  assert.equal(fmtValue('ampEnv.sustain', 0.8), '80%');
  assert.equal(fmtValue('oscA.semi', 7), '+7st');
  assert.equal(fmtValue('oscA.wave', 'saw'), 'ノコギリ');
});

// ---- 既定パッチ ----

test('defaultPatchは全Phase 1パラメーターのid→既定値の辞書', () => {
  const patch = defaultPatch();
  for (const p of PARAMS.filter((q) => q.phase === 1)) {
    assert.ok(p.id in patch, `${p.id} がdefaultPatchにない`);
    assert.equal(patch[p.id], p.default);
  }
});
