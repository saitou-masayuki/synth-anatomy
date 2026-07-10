import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// recipe-engine.js は content-params.js を参照するため、同じ vm で評価する
const ctx = createContext({});
for (const file of ['../content-params.js', '../recipe-engine.js']) {
  runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
}
const { recipeTargetBlocks, recipeJudgeAll, recipeBlockCloseness, recipeTotalDistance, defaultPatch } = ctx;

// vm コンテキスト（別realm）由来のArray/Objectはプロトタイプが異なり deepEqual が
// 通らないため、プレーンな同realm値に変換してから比較する
function plain(x) {
  return JSON.parse(JSON.stringify(x));
}

// 「答え合わせ」「近さ枠」の対象となるテスト用ターゲット（ampEnv・filterの2ブロックにまたがる）
const TARGET = {
  'ampEnv.sustain': 0, 'ampEnv.decay': 0.4,
  'filter.cutoff': 2500,
};

// ---- ブロック集合の導出（content-params.jsのparam.blockから機械的に求まる） ----

test('recipeTargetBlocks: targetのparamIdからブロック集合を重複なく導出する', () => {
  const blocks = plain(recipeTargetBlocks(TARGET)).sort();
  assert.deepEqual(blocks, ['ampEnv', 'filter']);
});

test('recipeTargetBlocks: 未定義のparamIdは無視する', () => {
  const blocks = plain(recipeTargetBlocks({ 'ampEnv.sustain': 0, 'no.such.param': 1 }));
  assert.deepEqual(blocks, ['ampEnv']);
});

// ---- 答え合わせ（ブロック単位でズレを返す。パラメーター名や数値は返さない） ----

test('recipeJudgeAll: 完全一致ならズレているブロックは無い', () => {
  const patch = Object.assign(defaultPatch(), TARGET);
  assert.deepEqual(plain(recipeJudgeAll(patch, TARGET)), []);
});

test('recipeJudgeAll: 一部のブロックだけズレている場合、そのブロック名だけを返す', () => {
  const patch = Object.assign(defaultPatch(), TARGET, { 'ampEnv.sustain': 0.8 }); // filterは一致、ampEnvだけズレ
  assert.deepEqual(plain(recipeJudgeAll(patch, TARGET)), ['ampEnv']);
});

test('recipeJudgeAll: 1ブロックに複数パラメーターがあっても、ブロック名は重複せず1回だけ出る', () => {
  const patch = Object.assign(defaultPatch(), TARGET, { 'ampEnv.sustain': 0.9, 'ampEnv.decay': 2 });
  assert.deepEqual(plain(recipeJudgeAll(patch, TARGET)), ['ampEnv']);
});

test('recipeJudgeAll: enumパラメーターは完全一致でのみ合格する（正規化距離を使わない）', () => {
  const target = { 'oscA.wave': 'square', 'mod1.src': 'lfo1', 'mod1.dst': 'oscA.level' };
  const patch = Object.assign(defaultPatch(), target);
  assert.deepEqual(plain(recipeJudgeAll(patch, target)), []);
  patch['mod1.dst'] = 'filter.cutoff'; // わずかでも違えば不一致（enumに「近い」は無い）
  assert.deepEqual(plain(recipeJudgeAll(patch, target)), ['mod']);
});

test('recipeJudgeAll: 許容誤差(既定0.06)の範囲内は合格とみなす', () => {
  const patch = Object.assign(defaultPatch(), TARGET);
  // filter.cutoffはlogカーブ。正規化距離で0.03程度ずらす
  const nudged = denormNudge('filter.cutoff', TARGET['filter.cutoff'], 0.03, ctx);
  patch['filter.cutoff'] = nudged;
  assert.deepEqual(plain(recipeJudgeAll(patch, TARGET)), []);
});

test('recipeJudgeAll: カスタム許容誤差を渡すとそちらが優先される', () => {
  const patch = Object.assign(defaultPatch(), TARGET);
  const nudged = denormNudge('filter.cutoff', TARGET['filter.cutoff'], 0.03, ctx);
  patch['filter.cutoff'] = nudged;
  assert.deepEqual(plain(recipeJudgeAll(patch, TARGET, 0.01)), ['filter']);
});

// ---- 近さ（ブロック単位の連続値。UIの「近さ枠」の濃淡に使う） ----

test('recipeBlockCloseness: 完全一致なら1', () => {
  const patch = Object.assign(defaultPatch(), TARGET);
  assert.equal(recipeBlockCloseness(patch, TARGET, 'ampEnv'), 1);
  assert.equal(recipeBlockCloseness(patch, TARGET, 'filter'), 1);
});

test('recipeBlockCloseness: 遠いほど0に近づき、0未満にはならない', () => {
  const patch = Object.assign(defaultPatch(), TARGET, { 'ampEnv.sustain': 1, 'ampEnv.decay': 4 });
  const c = recipeBlockCloseness(patch, TARGET, 'ampEnv');
  assert.ok(c >= 0 && c < 0.5, `期待より近い判定: ${c}`);
});

test('recipeBlockCloseness: そのブロックにtargetの対象が無ければ1（ズレようがない）', () => {
  const patch = defaultPatch();
  assert.equal(recipeBlockCloseness(patch, TARGET, 'lfo1'), 1);
});

test('recipeBlockCloseness: enumの不一致は距離1として寄与する', () => {
  const target = { 'oscA.wave': 'square' };
  const patch = Object.assign(defaultPatch(), { 'oscA.wave': 'saw' });
  assert.equal(recipeBlockCloseness(patch, target, 'oscA'), 0);
});

test('recipeBlockCloseness: 複数パラメーターのうち最も遠いものだけで決まる（平均で薄まらない）', () => {
  // recipeJudgeAllが「1つでも許容誤差を超えたらブロックごとアウト」という
  // 最も厳しい1件で判定する方式なので、連続値のcloseness側も同じ基準に揃える。
  // 片方は完全一致・もう片方は最大距離(1)の場合、平均なら0.5になってしまうが、
  // 最悪の1件を採用するので0が正しい（「サステインだけ大きくズレている」を薄めない）
  const target = { 'ampEnv.sustain': 0, 'ampEnv.decay': 4 };
  const patch = Object.assign(defaultPatch(), { 'ampEnv.sustain': 0, 'ampEnv.decay': 0.01 });
  const c = recipeBlockCloseness(patch, target, 'ampEnv');
  assert.equal(c, 0, `最も遠いパラメーターが結果に反映されていない: ${c}`);
});

// ---- 全体距離（トレンド表示用の連続値） ----

test('recipeTotalDistance: 完全一致なら0', () => {
  const patch = Object.assign(defaultPatch(), TARGET);
  assert.equal(recipeTotalDistance(patch, TARGET), 0);
});

test('recipeTotalDistance: 近づくほど小さくなる（単調性）', () => {
  const far = Object.assign(defaultPatch(), TARGET, { 'ampEnv.sustain': 1, 'filter.cutoff': 18000 });
  const near = Object.assign(defaultPatch(), TARGET, { 'ampEnv.sustain': 0.2, 'filter.cutoff': 3000 });
  const dFar = recipeTotalDistance(far, TARGET);
  const dNear = recipeTotalDistance(near, TARGET);
  assert.ok(dFar > dNear && dNear > 0, `遠い=${dFar} 近い=${dNear}`);
});

test('recipeTotalDistance: 未定義のparamIdは無視する', () => {
  const patch = Object.assign(defaultPatch(), TARGET);
  assert.equal(recipeTotalDistance(patch, Object.assign({ 'no.such.param': 1 }, TARGET)), 0);
});

// ---- 変調の深さ（mod*.amt）: 揺れの有無は数値の近さでなく「活性の不一致」として扱う ----
// mod-engine.resolveModRoutes は amt=0 のルートを「配線なし」として破棄するため、
// 目標が揺れあり(amt≠0)なのに amt=0 のままでは音は一切揺れない。距離だけ見ると
// 極小目標（ビブラートの0.04等）は amt=0 でも許容誤差内に収まってしまうので、
// enum と同じ二値（距離1）として判定する

test('recipeJudgeAll: 目標が揺れあり(amt≠0)のとき、amt=0（実際には揺れない）は不合格', () => {
  const target = { 'mod1.src': 'lfo1', 'mod1.dst': 'oscA.pitch', 'mod1.amt': 0.04 };
  const patch = Object.assign(defaultPatch(), target, { 'mod1.amt': 0 });
  assert.deepEqual(plain(recipeJudgeAll(patch, target)), ['mod']);
});

test('recipeJudgeAll: 非ゼロの微小な深さは従来どおり許容誤差内で合格する', () => {
  const target = { 'mod1.src': 'lfo1', 'mod1.dst': 'oscA.pitch', 'mod1.amt': 0.04 };
  const patch = Object.assign(defaultPatch(), target, { 'mod1.amt': 0.05 });
  assert.deepEqual(plain(recipeJudgeAll(patch, target)), []);
});

test('recipeJudgeAll: 逆向き（目標が揺れなし・現在が揺れあり）も不一致になる', () => {
  const target = { 'mod1.src': 'lfo1', 'mod1.dst': 'oscA.pitch', 'mod1.amt': 0 };
  const patch = Object.assign(defaultPatch(), target, { 'mod1.amt': 0.1 });
  assert.deepEqual(plain(recipeJudgeAll(patch, target)), ['mod']);
});

test('recipeBlockCloseness: 目標が揺れありでamt=0なら、modブロックの近さは0', () => {
  const target = { 'mod1.src': 'lfo1', 'mod1.dst': 'oscA.pitch', 'mod1.amt': 0.04 };
  const patch = Object.assign(defaultPatch(), target, { 'mod1.amt': 0 });
  assert.equal(recipeBlockCloseness(patch, target, 'mod'), 0);
});

// テスト用ヘルパー: 指定パラメーターを正規化空間でnだけずらした実値を返す
function denormNudge(id, value, n, ctx) {
  const norm = ctx.normParam(id, value);
  return ctx.denormParam(id, Math.min(1, Math.max(0, norm + n)));
}
