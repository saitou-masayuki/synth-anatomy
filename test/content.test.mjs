import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// レシピコンテンツとエンジン定義の整合性を機械検証する。
// 「コンテンツの数値の矛盾はテストが検出する」のがこのプロジェクトの運用方針
const ctx = createContext({});
for (const file of ['../content-params.js', '../recipe-engine.js', '../content-recipes.js']) {
  runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
}
const { PARAMS, RECIPES, paramById, defaultPatch, recipeTargetBlocks, recipeJudgeAll, recipeBlockCloseness } = ctx;

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

// ---- 基本構造 ----

test('レシピが存在し、必須フィールドを持つ', () => {
  assert.ok(Array.isArray(RECIPES) && RECIPES.length >= 5);
  const ids = RECIPES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'レシピIDが重複');
  for (const r of RECIPES) {
    assert.ok(r.title && r.goal, `${r.id}: title/goalがない`);
    assert.ok([1, 2, 3].includes(r.difficulty), `${r.id}: difficultyが不正`);
    assert.ok(Array.isArray(r.audition.notes) && r.audition.notes.length > 0, `${r.id}: auditionがない`);
    assert.ok(r.audition.dur > 0, `${r.id}: audition.durが不正`);
    assert.ok(r.approach && r.approach.length > 0, `${r.id}: approach（ヒント段階1）がない`);
    assert.ok(r.insight && r.insight.length > 0, `${r.id}: insight（完成後の一言）がない`);
    assert.ok(Object.keys(r.target).length > 0, `${r.id}: targetが空`);
  }
});

test('レシピの全パラメーター値が定義の範囲内', () => {
  for (const r of RECIPES) {
    for (const [id, v] of Object.entries(r.init)) assertValidValue(id, v, `${r.id}.init`);
    for (const [id, v] of Object.entries(r.target)) assertValidValue(id, v, `${r.id}.target`);
  }
});

test('blockHints: targetが関わる全ブロックぶんのヒントが過不足なく用意されている', () => {
  for (const r of RECIPES) {
    const blocks = plain(recipeTargetBlocks(r.target)).sort();
    const hintBlocks = Object.keys(r.blockHints).sort();
    assert.deepEqual(hintBlocks, blocks, `${r.id}: blockHintsがtargetのブロック集合と一致しない`);
    for (const [block, text] of Object.entries(r.blockHints)) {
      assert.ok(text && text.length > 0, `${r.id}.${block}: ヒント文言が空`);
    }
  }
});

test('恒等性: init+targetを適用すると答え合わせで完全一致（全ブロックでcloseness=1・ズレ0件）', () => {
  for (const r of RECIPES) {
    const initFull = Object.assign(defaultPatch(), r.init);
    const patch = Object.assign({}, initFull, r.target);
    assert.deepEqual(plain(recipeJudgeAll(patch, r.target)), [], `${r.id}: targetそのものが答え合わせに通らない`);
    for (const block of recipeTargetBlocks(r.target)) {
      assert.equal(recipeBlockCloseness(patch, r.target, block), 1, `${r.id}.${block}: 完全一致でcloseness≠1`);
    }
  }
});

test('レシピのinitはtargetからじゅうぶん離れている（挑戦として成立する）', () => {
  // targetの値をそのまま初期状態にしてしまうと「答え合わせ」が挑戦なしで通ってしまう。
  // 既定パッチ+initがtargetと一致していない（＝最低1ブロックはズレている）ことを保証する
  for (const r of RECIPES) {
    const initFull = Object.assign(defaultPatch(), r.init);
    const offBlocks = recipeJudgeAll(initFull, r.target);
    assert.ok(offBlocks.length > 0, `${r.id}: 開始状態が既にtargetと一致しており、挑戦にならない`);
  }
});

test('レシピのtol（任意の許容誤差上書き）は妥当な範囲にある', () => {
  for (const r of RECIPES) {
    if (r.tol === undefined) continue;
    assert.ok(typeof r.tol === 'number' && r.tol > 0 && r.tol < 0.2, `${r.id}: tol=${r.tol} が不正`);
    // tolを狭めた課題は、initがその狭いtolでも挑戦として成立していること
    const initFull = Object.assign(defaultPatch(), r.init);
    assert.ok(plain(recipeJudgeAll(initFull, r.target, r.tol)).length > 0, `${r.id}: tol指定でも開始状態が一致`);
  }
});

test('チューニング課題: ±8セントは合格し、±9セントと±1半音は不合格', () => {
  const r = RECIPES.find((recipe) => recipe.id === 'tune-up');
  assert.ok(r, 'tune-upレシピがない');
  const judge = (overrides) => plain(recipeJudgeAll(
    Object.assign(defaultPatch(), r.target, overrides), r.target, r.tol,
  ));

  for (const fine of [-8, 8]) {
    assert.deepEqual(judge({ 'oscA.fine': fine }), [], `${fine}セントは許容範囲内`);
  }
  for (const fine of [-9, 9]) {
    assert.deepEqual(judge({ 'oscA.fine': fine }), ['oscA'], `${fine}セントは許容範囲外`);
  }
  for (const semi of [-1, 1]) {
    assert.deepEqual(judge({ 'oscA.semi': semi }), ['oscA'], `${semi}半音は許容範囲外`);
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
