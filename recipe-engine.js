// シンセ解剖図 — 音作りテスト（レシピ再現）の純粋ロジック。DOM/AudioContext非依存。
// レシピの構造:
//   init   既定パッチとの差分（開始状態）
//   target init との差分（完成形。通常のパッチとしてそのまま試聴に使える）
//   steps  [{ title, text, params: {paramId: 目標値}, tol?, auto?, listen? }]
// 不変条件「init に全ステップの params を順に適用した結果 ≡ init + target」は
// テスト（コンテンツ整合性）で機械検証する。

// 全ステップを順に適用したパッチを返す（恒等性検証用。引数は破壊しない）
function recipeApplySteps(initPatch, steps) {
  const patch = Object.assign({}, initPatch);
  for (const step of steps) {
    Object.assign(patch, step.params);
  }
  return patch;
}

// ステップの全パラメーターが目標に達しているか。
// 数値は正規化空間の許容誤差（既定0.05）、enum/boolは完全一致で判定する
function recipeStepDone(patch, step) {
  const tol = step.tol === undefined ? 0.05 : step.tol;
  for (const [id, targetValue] of Object.entries(step.params)) {
    const def = paramById(id);
    if (!def) return false;
    if (def.type === 'enum' || def.type === 'bool') {
      if (patch[id] !== targetValue) return false;
    } else {
      if (Math.abs(normParam(id, patch[id]) - normParam(id, targetValue)) > tol) return false;
    }
  }
  return true;
}

// 最初の未完了ステップの番号を返す（全完了ならステップ総数）
function recipeNextStep(patch, recipe) {
  for (let i = 0; i < recipe.steps.length; i++) {
    if (!recipeStepDone(patch, recipe.steps[i])) return i;
  }
  return recipe.steps.length;
}
