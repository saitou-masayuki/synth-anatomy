import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// recipe-engine.js は content-params.js を参照するため、同じ vm で評価する
const ctx = createContext({});
for (const file of ['../content-params.js', '../recipe-engine.js']) {
  runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
}
const { recipeApplySteps, recipeStepDone, recipeNextStep, defaultPatch } = ctx;

function plain(x) {
  return JSON.parse(JSON.stringify(x));
}

const RECIPE = {
  init: { 'oscA.wave': 'saw' },
  target: { 'ampEnv.sustain': 0, 'ampEnv.decay': 0.4, 'filter.cutoff': 2500 },
  steps: [
    { title: '減衰音にする', params: { 'ampEnv.sustain': 0, 'ampEnv.decay': 0.4 }, tol: 0.05 },
    { title: '少し丸める', params: { 'filter.cutoff': 2500 }, tol: 0.08 },
  ],
};

// ---- 恒等性（コンテンツの数値矛盾をここで機械検出する） ----

test('recipeApplySteps: initに全ステップを適用するとtargetに一致する', () => {
  const initFull = Object.assign(defaultPatch(), RECIPE.init);
  const result = recipeApplySteps(initFull, RECIPE.steps);
  const targetFull = Object.assign({}, initFull, RECIPE.target);
  assert.deepEqual(plain(result), plain(targetFull));
});

test('recipeApplySteps: 元のパッチを破壊しない（純粋関数）', () => {
  const initFull = Object.assign(defaultPatch(), RECIPE.init);
  const before = plain(initFull);
  recipeApplySteps(initFull, RECIPE.steps);
  assert.deepEqual(plain(initFull), before);
});

// ---- ステップ完了判定（正規化空間の許容誤差） ----

test('recipeStepDone: 目標値ぴったりで完了', () => {
  const patch = Object.assign(defaultPatch(), { 'ampEnv.sustain': 0, 'ampEnv.decay': 0.4 });
  assert.equal(recipeStepDone(patch, RECIPE.steps[0]), true);
});

test('recipeStepDone: 許容誤差内なら完了、超えたら未完了', () => {
  // sustain(lin 0..1)の正規化はそのまま値。tol=0.05なので0.04はOK、0.10はNG
  const near = Object.assign(defaultPatch(), { 'ampEnv.sustain': 0.04, 'ampEnv.decay': 0.4 });
  assert.equal(recipeStepDone(near, RECIPE.steps[0]), true);
  const far = Object.assign(defaultPatch(), { 'ampEnv.sustain': 0.10, 'ampEnv.decay': 0.4 });
  assert.equal(recipeStepDone(far, RECIPE.steps[0]), false);
});

test('recipeStepDone: enumは完全一致のみ', () => {
  const step = { params: { 'oscA.wave': 'square' }, tol: 0.5 };
  assert.equal(recipeStepDone(Object.assign(defaultPatch(), { 'oscA.wave': 'square' }), step), true);
  assert.equal(recipeStepDone(Object.assign(defaultPatch(), { 'oscA.wave': 'saw' }), step), false);
});

test('recipeStepDone: tol未指定は既定0.05', () => {
  const step = { params: { 'ampEnv.sustain': 0.5 } };
  assert.equal(recipeStepDone(Object.assign(defaultPatch(), { 'ampEnv.sustain': 0.53 }), step), true);
  assert.equal(recipeStepDone(Object.assign(defaultPatch(), { 'ampEnv.sustain': 0.6 }), step), false);
});

// ---- 進行管理 ----

test('recipeNextStep: 最初の未完了ステップの番号を返し、全完了で総数を返す', () => {
  const initFull = Object.assign(defaultPatch(), RECIPE.init);
  assert.equal(recipeNextStep(initFull, RECIPE), 0);
  const mid = Object.assign({}, initFull, { 'ampEnv.sustain': 0, 'ampEnv.decay': 0.4 });
  assert.equal(recipeNextStep(mid, RECIPE), 1);
  const done = Object.assign({}, mid, { 'filter.cutoff': 2500 });
  assert.equal(recipeNextStep(done, RECIPE), 2);
});
