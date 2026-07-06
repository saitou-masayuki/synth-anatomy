import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// コンテンツ（レシピ・クイズ）とエンジン定義の整合性を機械検証する。
// 「コンテンツの数値の矛盾はテストが検出する」のがこのプロジェクトの運用方針
const ctx = createContext({});
for (const file of ['../content-params.js', '../recipe-engine.js', '../quiz-engine.js', '../content-recipes.js', '../content-quiz.js']) {
  runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
}
const { PARAMS, RECIPES, QUIZ_LEVELS, QUIZ_BASE_PATCHES, paramById, defaultPatch, recipeApplySteps, quizGenQuestion } = ctx;

function plain(x) {
  return JSON.parse(JSON.stringify(x));
}

// 値がパラメーター定義の範囲内かを検証するヘルパー
function assertValidValue(id, v, where) {
  const def = paramById(id);
  assert.ok(def, `${where}: 未定義のパラメーター ${id}`);
  assert.equal(def.phase, 1, `${where}: ${id} はPhase 1で使えない`);
  if (def.type === 'enum') {
    assert.ok(def.values.some((o) => o.v === v), `${where}: ${id} の不正な値 ${v}`);
  } else if (def.type === 'float' || def.type === 'int') {
    assert.ok(typeof v === 'number' && v >= def.min && v <= def.max, `${where}: ${id}=${v} が範囲外`);
  }
}

// ---- レシピ ----

test('レシピが存在し、必須フィールドを持つ', () => {
  assert.ok(Array.isArray(RECIPES) && RECIPES.length >= 5);
  const ids = RECIPES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'レシピIDが重複');
  for (const r of RECIPES) {
    assert.ok(r.title && r.goal, `${r.id}: title/goalがない`);
    assert.ok([1, 2, 3].includes(r.difficulty), `${r.id}: difficultyが不正`);
    assert.ok(Array.isArray(r.audition.notes) && r.audition.notes.length > 0, `${r.id}: auditionがない`);
    assert.ok(r.audition.dur > 0, `${r.id}: audition.durが不正`);
    assert.ok(r.steps.length >= 2, `${r.id}: ステップが少なすぎる`);
    for (const s of r.steps) {
      assert.ok(s.title && s.text, `${r.id}: ステップにtitle/textがない`);
      assert.ok(Object.keys(s.params).length > 0, `${r.id}: パラメーターのないステップ`);
    }
  }
});

test('レシピの全パラメーター値が定義の範囲内', () => {
  for (const r of RECIPES) {
    for (const [id, v] of Object.entries(r.init)) assertValidValue(id, v, `${r.id}.init`);
    for (const [id, v] of Object.entries(r.target)) assertValidValue(id, v, `${r.id}.target`);
    for (const s of r.steps) {
      for (const [id, v] of Object.entries(s.params)) assertValidValue(id, v, `${r.id}/${s.title}`);
    }
  }
});

test('恒等性: initに全ステップを適用するとinit+targetに一致する（全レシピ）', () => {
  for (const r of RECIPES) {
    const initFull = Object.assign(defaultPatch(), r.init);
    const result = recipeApplySteps(initFull, r.steps);
    const targetFull = Object.assign({}, initFull, r.target);
    assert.deepEqual(plain(result), plain(targetFull), `${r.id}: ステップとtargetが矛盾`);
  }
});

test('レシピのaudition.notesは有効なMIDIノート番号', () => {
  for (const r of RECIPES) {
    for (const n of r.audition.notes) {
      assert.ok(Number.isInteger(n) && n >= 12 && n <= 108, `${r.id}: 不正なノート ${n}`);
    }
  }
});

test('レシピは純粋データ（JSON往復で恒等）', () => {
  assert.deepEqual(plain(RECIPES), plain(JSON.parse(JSON.stringify(plain(RECIPES)))));
});

// ---- クイズ ----

test('クイズレベルが存在し、構造が正しい', () => {
  assert.ok(Array.isArray(QUIZ_LEVELS) && QUIZ_LEVELS.length >= 3);
  for (const lv of QUIZ_LEVELS) {
    assert.ok(lv.id && lv.name && lv.desc, `${lv.id}: 名前がない`);
    assert.ok(lv.pool.length >= lv.choices, `${lv.id}: 選択肢数が出題対象より多い`);
    assert.ok(lv.delta > 0 && lv.delta <= 1, `${lv.id}: deltaが不正`);
    assert.ok(lv.questionCount > 0 && lv.passScore <= lv.questionCount, `${lv.id}: 問題数/合格ラインが不正`);
    for (const p of lv.pool) {
      const def = paramById(p);
      assert.ok(def && def.phase === 1, `${lv.id}: 不正なpool ${p}`);
    }
    for (const b of lv.basePatches) {
      assert.ok(QUIZ_BASE_PATCHES[b], `${lv.id}: ベースパッチ ${b} がない`);
    }
  }
});

test('クイズのベースパッチの値が定義の範囲内で、試聴フレーズを持つ', () => {
  for (const [id, base] of Object.entries(QUIZ_BASE_PATCHES)) {
    for (const [pid, v] of Object.entries(base.patch)) assertValidValue(pid, v, `base ${id}`);
    assert.ok(Array.isArray(base.audition.notes) && base.audition.dur > 0, `base ${id}: auditionがない`);
  }
});

test('可聴性ルール: 出題対象が聴こえるベースパッチだけが使われている', () => {
  for (const lv of QUIZ_LEVELS) {
    for (const b of lv.basePatches) {
      const patch = Object.assign(defaultPatch(), QUIZ_BASE_PATCHES[b].patch);
      if (lv.pool.includes('oscA.wtPos')) {
        assert.equal(patch['oscA.wave'], 'wt.basic', `${lv.id}/${b}: WT位置を出題するのにWT波形でない`);
      }
      if (lv.pool.includes('lfo1.rateHz')) {
        assert.ok(patch['mod1.src'] === 'lfo1' && patch['mod1.dst'] !== 'none' && patch['mod1.amt'] !== 0,
          `${lv.id}/${b}: LFO速さを出題するのにLFOが未配線`);
      }
      if (lv.pool.includes('ampEnv.release')) {
        assert.ok(patch['ampEnv.sustain'] > 0, `${lv.id}/${b}: サステイン0だとリリースの変化が聴こえない`);
      }
      if (lv.pool.includes('ampEnv.decay')) {
        assert.ok(patch['ampEnv.sustain'] <= 0.85, `${lv.id}/${b}: サステインが高すぎるとディケイの変化が聴こえない`);
      }
    }
  }
});

test('出題生成が全レベルで安定して動く（100問生成でエラー・範囲外なし）', () => {
  let seed = 1;
  const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (const lv of QUIZ_LEVELS) {
    for (let i = 0; i < 100; i++) {
      const q = quizGenQuestion(lv, QUIZ_BASE_PATCHES, rng, {});
      assert.ok(lv.pool.includes(q.target));
      assert.equal(q.choices.length, lv.choices);
      const def = paramById(q.target);
      if (def.type !== 'enum') {
        assert.ok(q.after >= def.min && q.after <= def.max, `${lv.id}: after範囲外 ${q.target}=${q.after}`);
        assert.notEqual(q.after, q.before, `${lv.id}: 値が変わっていない`);
      }
    }
  }
});
