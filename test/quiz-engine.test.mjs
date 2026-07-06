import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// quiz-engine.js は content-params.js を参照するため、同じ vm で評価する
const ctx = createContext({});
for (const file of ['../content-params.js', '../quiz-engine.js']) {
  runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
}
const { quizGenQuestion, quizWeightedPick, quizWeakness, defaultPatch, normParam } = ctx;

// テスト用の決定的な乱数（配列の値を順に返す）
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

const LEVEL = {
  id: 'test-lv',
  pool: ['filter.cutoff', 'filter.reso', 'ampEnv.attack'],
  delta: 0.3,
  choices: 2,
  basePatches: ['base1'],
};
const BASES = {
  base1: { patch: { 'filter.cutoff': 2000, 'ampEnv.sustain': 1 }, audition: { notes: [57], dur: 2 } },
};

// ---- 重み付き抽選と弱点計算 ----

test('quizWeightedPick: 重みに応じて選ばれ、決定的にテストできる', () => {
  // 累積重み [1, 3] に対して rng=0.1 → 先頭、rng=0.9 → 末尾
  assert.equal(quizWeightedPick(['a', 'b'], [1, 3], seqRng([0.1])), 'a');
  assert.equal(quizWeightedPick(['a', 'b'], [1, 3], seqRng([0.9])), 'b');
});

test('quizWeakness: 未出題は1、正答率が低いほど重い', () => {
  assert.equal(quizWeakness({}, 'filter.cutoff'), 1);
  const stats = { 'filter.cutoff': { seen: 4, correct: 1 } };
  // 1 + 2 × (1 - 0.25) = 2.5
  assert.ok(Math.abs(quizWeakness(stats, 'filter.cutoff') - 2.5) < 1e-9);
  const perfect = { 'filter.cutoff': { seen: 4, correct: 4 } };
  assert.equal(quizWeakness(perfect, 'filter.cutoff'), 1);
});

// ---- 出題生成 ----

test('quizGenQuestion: 数値パラメーターは正規化空間でdeltaだけ動かす', () => {
  // rng列: base選択, 対象抽選, 方向(0.7→下げ), ...
  const q = quizGenQuestion(LEVEL, BASES, seqRng([0, 0.01, 0.7, 0.5, 0.5]), {});
  assert.equal(q.baseId, 'base1');
  assert.ok(LEVEL.pool.includes(q.target));
  const before = q.base[q.target];
  const nBefore = normParam(q.target, before);
  const nAfter = normParam(q.target, q.after);
  assert.ok(Math.abs(Math.abs(nAfter - nBefore) - LEVEL.delta) < 0.02, `変化量が${LEVEL.delta}でない: ${Math.abs(nAfter - nBefore)}`);
});

test('quizGenQuestion: 端では方向が反転して範囲内に収まる', () => {
  const level = Object.assign({}, LEVEL, { pool: ['ampEnv.sustain'] });
  const bases = { base1: { patch: { 'ampEnv.sustain': 1 }, audition: { notes: [57], dur: 2 } } };
  // 方向rng=0.1→上げようとするが、sustain=1（正規化1.0）なので反転して下がる
  const q = quizGenQuestion(level, bases, seqRng([0, 0.1, 0.1, 0.5]), {});
  assert.ok(q.after < 1, `端で反転していない: ${q.after}`);
  assert.ok(normParam('ampEnv.sustain', q.after) >= 0);
});

test('quizGenQuestion: 選択肢は対象を含むchoices個で重複なし', () => {
  const q = quizGenQuestion(LEVEL, BASES, seqRng([0, 0.5, 0.3, 0.2, 0.8]), {});
  assert.equal(q.choices.length, LEVEL.choices);
  assert.ok(q.choices.includes(q.target));
  assert.equal(new Set(q.choices).size, q.choices.length);
  for (const c of q.choices) assert.ok(LEVEL.pool.includes(c));
});

test('quizGenQuestion: enumパラメーターは別の値に変わる', () => {
  const level = Object.assign({}, LEVEL, { pool: ['oscA.wave'] });
  const bases = { base1: { patch: {}, audition: { notes: [57], dur: 2 } } };
  const q = quizGenQuestion(level, bases, seqRng([0, 0.5, 0.5, 0.5]), {});
  const before = Object.assign(defaultPatch(), bases.base1.patch)['oscA.wave'];
  assert.notEqual(q.after, before);
});

test('quizGenQuestion: 同じrng列なら同じ問題（決定的）', () => {
  const q1 = quizGenQuestion(LEVEL, BASES, seqRng([0, 0.4, 0.6, 0.3, 0.9]), {});
  const q2 = quizGenQuestion(LEVEL, BASES, seqRng([0, 0.4, 0.6, 0.3, 0.9]), {});
  assert.equal(q1.target, q2.target);
  assert.equal(q1.after, q2.after);
  assert.deepEqual(q1.choices, q2.choices);
});

test('quizGenQuestion: baseは完全パッチ（既定値とベース差分のマージ）', () => {
  const q = quizGenQuestion(LEVEL, BASES, seqRng([0, 0.5, 0.5, 0.5]), {});
  assert.equal(q.base['filter.cutoff'], 2000);       // ベース差分
  assert.equal(q.base['oscA.wave'], 'saw');          // 既定値が埋まっている
  assert.equal(q.base['ampEnv.sustain'], 1);
});
