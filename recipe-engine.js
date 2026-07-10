// シンセマスター — 音作りチャレンジ（診断チャレンジ）の純粋ロジック。DOM/AudioContext非依存。
//
// レシピの構造:
//   init   既定パッチとの差分（挑戦開始時に適用される）
//   target init との差分（完成形。「お手本を聴く」はこのパッチで試聴する）
// 「答え合わせ」「近さ枠」は、targetの各paramIdが持つcontent-params.jsのblock情報を使って
// 自動的にブロック単位へ集約する（ブロック一覧をコンテンツ側で手動管理する必要がない）。

var RECIPE_DEFAULT_TOL = 0.06;
// 正規化・逆正規化の浮動小数点丸めで、許容誤差ちょうどの値が
// 0.040000000000000036 のように境界をわずかに超えるのを吸収する。
// 判定幅そのものを広げないよう、正規化空間で十分小さい値に固定する。
var RECIPE_TOL_EPSILON = 1e-12;

// targetのparamIdから、関係するブロック名の一覧を重複なく返す
function recipeTargetBlocks(target) {
  const blocks = new Set();
  for (const id of Object.keys(target)) {
    const def = paramById(id);
    if (def) blocks.add(def.block);
  }
  return [...blocks];
}

// パラメーター1つぶんの正規化距離（0=完全一致、1=最大の隔たり）。
// enum/boolは「近い」が意味を持たないため、一致0・不一致1の二値として扱う
function recipeParamDistance(id, value, targetValue) {
  const def = paramById(id);
  if (def.type === 'enum' || def.type === 'bool') {
    return value === targetValue ? 0 : 1;
  }
  // 変調の深さ: mod-engine.resolveModRoutes は amt=0 のルートを「配線なし」として
  // 破棄するため、目標が揺れあり(amt≠0)なのに現在値が0では音は一切揺れない。
  // 極小目標（ビブラートの0.04等）は距離だけ見ると許容誤差内に収まってしまうので、
  // 揺れの有無の不一致は enum と同じ二値（距離1）として扱う
  if (/^mod\d+\.amt$/.test(id) && !value !== !targetValue) return 1;
  return Math.abs(normParam(id, value) - normParam(id, targetValue));
}

// 現在のパッチをtargetと突き合わせ、許容誤差を超えてズレているブロック名だけを返す。
// パラメーター名や具体的な値は一切含めない（「答え合わせ」はどれだけ・どこがではなく
// 何個ズレているかしか教えない、という設計上の制約をここで担保する）
function recipeJudgeAll(patch, target, tol) {
  const t = tol === undefined ? RECIPE_DEFAULT_TOL : tol;
  const offBlocks = new Set();
  for (const [id, targetValue] of Object.entries(target)) {
    const def = paramById(id);
    if (!def) continue;
    if (recipeParamDistance(id, patch[id], targetValue) > t + RECIPE_TOL_EPSILON) offBlocks.add(def.block);
  }
  return [...offBlocks];
}

// target全体の平均距離（0=完全一致、1=最大の隔たり）。答え合わせの「前回より
// 近づいたか」のトレンド表示に使う。ブロック判定（最悪1件方式）とは目的が違い、
// こちらは全体の進み具合を連続値で追いたいので平均を使う
function recipeTotalDistance(patch, target) {
  const ids = Object.keys(target).filter((id) => paramById(id));
  if (ids.length === 0) return 0;
  const sum = ids.reduce((acc, id) => acc + recipeParamDistance(id, patch[id], target[id]), 0);
  return sum / ids.length;
}

// 指定ブロックの「近さ」を0..1で返す（1=完全一致）。targetのうちそのブロックに
// 属するパラメーターだけを対象に、最も遠い1件の距離から算出する。
// recipeJudgeAll（「1つでも許容誤差を超えたらそのブロックはアウト」）と基準を揃えるため、
// 平均ではなく最大距離を使う（平均だと、大きくズレた1件が他の近い項目に薄められてしまう）。
// 対象パラメーターが無いブロック（そもそもズレようがない）は1を返す
function recipeBlockCloseness(patch, target, block) {
  const ids = Object.keys(target).filter((id) => {
    const def = paramById(id);
    return def && def.block === block;
  });
  if (ids.length === 0) return 1;
  const maxDist = Math.max(...ids.map((id) => recipeParamDistance(id, patch[id], target[id])));
  return Math.max(0, 1 - maxDist);
}
