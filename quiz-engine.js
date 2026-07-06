// シンセ解剖図 — 聞き取りテスト（どのパラメーターが変わった？）の純粋ロジック。
// 乱数は必ず引数 rng（0以上1未満を返す関数）で注入する。テストでは決定的な列を渡し、
// 本番では Math.random を渡す。chord-lab の trainer と同じ設計。

// 重み付き抽選（重みに比例した確率で1つ選ぶ）
function quizWeightedPick(items, weights, rng) {
  let total = 0;
  for (const w of weights) total += w;
  let x = rng() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

// 弱点の重み: 未出題は1、正答率が低いほど最大3まで重くなる（弱点ほど出題されやすい）
function quizWeakness(stats, paramId) {
  const s = stats[paramId];
  if (!s || !s.seen) return 1;
  return 1 + 2 * (1 - s.correct / s.seen);
}

// 出題を1問生成する。
//   level: { pool, delta, deltaRange?, choices, basePatches }
//   bases: { baseId: { patch: 既定値との差分, audition } }
// 返り値: { baseId, base(完全パッチ), target(変更したparamId), before, after, dir, choices }
function quizGenQuestion(level, bases, rng, stats) {
  const baseId = level.basePatches[Math.min(level.basePatches.length - 1, Math.floor(rng() * level.basePatches.length))];
  const base = Object.assign(defaultPatch(), bases[baseId].patch);
  const target = quizWeightedPick(level.pool, level.pool.map((p) => quizWeakness(stats, p)), rng);
  const def = paramById(target);
  const before = base[target];
  let after, dir;
  if (def.type === 'enum') {
    // 現在値以外からランダムに選ぶ
    const others = def.values.map((o) => o.v).filter((v) => v !== before);
    after = others[Math.min(others.length - 1, Math.floor(rng() * others.length))];
    dir = null;
  } else {
    const delta = level.deltaRange
      ? level.deltaRange[0] + rng() * (level.deltaRange[1] - level.deltaRange[0])
      : level.delta;
    dir = rng() < 0.5 ? 1 : -1;
    const n = normParam(target, before);
    if (n + dir * delta > 1 || n + dir * delta < 0) dir = -dir; // 端では反転して範囲内に収める
    after = denormParam(target, Math.min(1, Math.max(0, n + dir * delta)));
  }
  // ハズレ選択肢: 同じブロックのパラメーターを優先して紛らわしくする
  const rest = level.pool.filter((p) => p !== target);
  const shuffled = quizShuffle(rest, rng);
  shuffled.sort((a, b) => (paramById(a).block === def.block ? 0 : 1) - (paramById(b).block === def.block ? 0 : 1));
  const choices = quizShuffle([target].concat(shuffled.slice(0, level.choices - 1)), rng);
  return { baseId, base, target, before, after, dir, choices };
}

// Fisher-Yatesシャッフル（rng注入で決定的にテストできる）
function quizShuffle(items, rng) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 回答の正誤判定
function quizJudge(question, answeredParamId) {
  return answeredParamId === question.target;
}
