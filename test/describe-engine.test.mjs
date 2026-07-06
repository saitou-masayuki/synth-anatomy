import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// describe-engine.js は content-params.js を参照するため、同じ vm で評価する
const ctx = createContext({});
for (const file of ['../content-params.js', '../describe-engine.js']) {
  runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
}
const { PARAMS, describeChange, defaultPatch } = ctx;

// ---- 網羅性（IDの同期切れをここで検出する） ----

test('全パラメーターにdescribeが定義されている', () => {
  const patch = defaultPatch();
  for (const p of PARAMS) {
    const d = p.type === 'enum'
      ? describeChange(p.id, p.values[0].v, p.values[1].v, patch)
      : describeChange(p.id, p.default, p.max ?? p.default, patch);
    assert.ok(d, `${p.id}: describeがない`);
    assert.ok(d.action && d.action.length > 0, `${p.id}: actionが空`);
    assert.ok(d.effect && d.effect.length > 0, `${p.id}: effectが空`);
    assert.ok(d.watch && d.watch.length > 0, `${p.id}: watchが空`);
  }
});

// ---- action行: 何をしたかが値表記と方向つきで示される ----

test('数値を下げるとactionに「下げました」と両方の値が入る', () => {
  const d = describeChange('filter.cutoff', 8200, 3100, defaultPatch());
  assert.match(d.action, /カットオフ/);
  assert.match(d.action, /8\.2kHz/);
  assert.match(d.action, /3\.1kHz/);
  assert.match(d.action, /下げました/);
});

test('数値を上げるとactionに「上げました」と入る', () => {
  const d = describeChange('filter.cutoff', 500, 5000, defaultPatch());
  assert.match(d.action, /上げました/);
});

test('enumの変更はactionに「変更しました」と表示名が入る', () => {
  const d = describeChange('oscA.wave', 'saw', 'square', defaultPatch());
  assert.match(d.action, /ノコギリ/);
  assert.match(d.action, /矩形/);
  assert.match(d.action, /変更しました/);
});

// ---- effect/watch行: 音の変化と見るべき場所 ----

test('カットオフを下げるとeffectに「こもる」系の説明が出る', () => {
  const d = describeChange('filter.cutoff', 8000, 500, defaultPatch());
  assert.match(d.effect, /こも/);
  assert.match(d.watch, /FILTER/);
});

test('文脈分岐: LFOがカットオフに割当済みならワウに触れる', () => {
  const patch = defaultPatch();
  patch['mod1.src'] = 'lfo1';
  patch['mod1.dst'] = 'filter.cutoff';
  patch['mod1.amt'] = 0.5;
  const d = describeChange('filter.cutoff', 8000, 500, patch);
  assert.match(d.effect, /ワウ|揺れ/);
});

test('文脈分岐: レゾナンスを上げたときカットオフが低いとクセに触れる', () => {
  const patch = defaultPatch();
  patch['filter.cutoff'] = 300;
  const d = describeChange('filter.reso', 0.1, 0.7, patch);
  assert.match(d.effect, /クセ|うなり|ミョ/);
});

test('波形をWTにするとWT位置ノブへ誘導される', () => {
  const d = describeChange('oscA.wave', 'saw', 'wt.basic', defaultPatch());
  assert.match(d.effect + d.watch, /WT位置/);
});

test('サステインを0にするとプラックに触れる', () => {
  const d = describeChange('ampEnv.sustain', 0.8, 0, defaultPatch());
  assert.match(d.effect, /プラック|減衰/);
});
