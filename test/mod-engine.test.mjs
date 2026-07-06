import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// mod-engine.js は content-params.js の MOD_DESTS を参照するため、両方を同じ vm で評価する
const ctx = createContext({});
for (const file of ['../content-params.js', '../mod-engine.js']) {
  runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
}
const { lfoValue, envValue, resolveModRoutes, modContribution, noteStackPush, noteStackRemove, midiToFreq, defaultPatch } = ctx;

function plain(x) {
  return JSON.parse(JSON.stringify(x));
}

// ---- LFO波形数式（音の実体とモジュレーション線の脈動が同じ式を使う） ----

test('サインLFO: 周期の要所で正しい値', () => {
  assert.ok(Math.abs(lfoValue('sine', 0, 1)) < 1e-9);
  assert.ok(Math.abs(lfoValue('sine', 0.25, 1) - 1) < 1e-9);
  assert.ok(Math.abs(lfoValue('sine', 0.75, 1) + 1) < 1e-9);
});

test('三角LFO: 0→1→0→-1→0 の往復', () => {
  assert.ok(Math.abs(lfoValue('tri', 0, 1)) < 1e-9);
  assert.ok(Math.abs(lfoValue('tri', 0.25, 1) - 1) < 1e-9);
  assert.ok(Math.abs(lfoValue('tri', 0.5, 1)) < 1e-9);
  assert.ok(Math.abs(lfoValue('tri', 0.75, 1) + 1) < 1e-9);
});

test('ノコギリLFO: -1から+1へ上昇して戻る', () => {
  assert.ok(Math.abs(lfoValue('saw', 0, 1) + 1) < 1e-9);
  assert.ok(Math.abs(lfoValue('saw', 0.5, 1)) < 1e-9);
  assert.ok(lfoValue('saw', 0.99, 1) > 0.9);
});

test('矩形LFO: 前半+1・後半-1', () => {
  assert.equal(lfoValue('square', 0.1, 1), 1);
  assert.equal(lfoValue('square', 0.6, 1), -1);
});

test('S&H LFO: 同一周期内は一定、周期が変わると変化し、決定的', () => {
  const a1 = lfoValue('sh', 3.1, 1);
  const a2 = lfoValue('sh', 3.9, 1);
  const b = lfoValue('sh', 4.1, 1);
  assert.equal(a1, a2, '同一周期内で値が変わった');
  assert.notEqual(a1, b, '周期が変わっても値が同じ');
  assert.equal(lfoValue('sh', 3.5, 1), a1, '再計算で値がブレた（非決定的）');
  assert.ok(a1 >= -1 && a1 <= 1 && b >= -1 && b <= 1);
});

test('LFOはレートに応じて周期が縮む', () => {
  // rate=2Hz なら t=0.125s が1/4周期 = サインの山
  assert.ok(Math.abs(lfoValue('sine', 0.125, 2) - 1) < 1e-9);
});

// ---- ADSR評価（音のスケジュールと可視化が同じ式を使う） ----

const ADSR = { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 };

test('ADSR: アタック中は直線で上昇し頂点で1', () => {
  assert.equal(envValue(ADSR, 0, null), 0);
  assert.ok(Math.abs(envValue(ADSR, 0.05, null) - 0.5) < 1e-9);
  assert.ok(Math.abs(envValue(ADSR, 0.1, null) - 1) < 1e-9);
});

test('ADSR: ディケイはサステインへ向かって単調減少', () => {
  const v1 = envValue(ADSR, 0.15, null);
  const v2 = envValue(ADSR, 0.25, null);
  assert.ok(v1 > v2, 'ディケイが減少していない');
  assert.ok(v1 < 1 && v1 > ADSR.sustain);
  // 十分時間が経てばサステイン値に収束
  assert.ok(Math.abs(envValue(ADSR, 10, null) - ADSR.sustain) < 0.01);
});

test('ADSR: リリースは離した時点の値から0へ減衰', () => {
  const atRelease = envValue(ADSR, 10, null); // ほぼサステイン値
  const r1 = envValue(ADSR, 10, 0.01);
  const r2 = envValue(ADSR, 10, 0.15);
  assert.ok(r1 < atRelease && r2 < r1, 'リリースが減衰していない');
  assert.ok(envValue(ADSR, 10, 3) < 0.01, 'リリース後に音が残る');
});

test('ADSR: アタック途中で離しても連続的に減衰する', () => {
  const atRelease = envValue(ADSR, 0.05, null); // アタック途中 = 0.5
  const r = envValue(ADSR, 0.05, 0.001);
  assert.ok(Math.abs(r - atRelease) < 0.05, 'リリース開始で値が跳んだ');
});

// ---- モジュレーションスロット解決 ----

test('既定パッチではアクティブなルートがない', () => {
  assert.deepEqual(plain(resolveModRoutes(defaultPatch())), []);
});

test('src/dst/amtが揃うと1本のルートに解決され、MOD_DESTSの属性を持つ', () => {
  const patch = defaultPatch();
  patch['mod1.src'] = 'lfo1';
  patch['mod1.dst'] = 'filter.cutoff';
  patch['mod1.amt'] = 0.7;
  const routes = plain(resolveModRoutes(patch));
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0], {
    slot: 'mod1', src: 'lfo1', dst: 'filter.cutoff', amt: 0.7, kind: 'audio', range: 4800,
  });
});

test('srcまたはdstがnone、amtが0のスロットは無効', () => {
  const patch = defaultPatch();
  patch['mod1.src'] = 'lfo1';
  patch['mod1.dst'] = 'none';
  patch['mod1.amt'] = 0.7;
  assert.equal(resolveModRoutes(patch).length, 0);
  patch['mod1.dst'] = 'filter.cutoff';
  patch['mod1.amt'] = 0;
  assert.equal(resolveModRoutes(patch).length, 0);
});

test('modContribution: 変調元の瞬時値×深さ×振幅', () => {
  const route = { amt: 0.5, range: 4800 };
  assert.equal(modContribution(route, 1), 2400);
  assert.equal(modContribution(route, -0.5), -1200);
});

// ---- モノフォニックの後着優先ノートスタック ----

test('ノートスタック: 後着優先で、離すと前の音に戻る', () => {
  let stack = [];
  stack = noteStackPush(stack, 60);
  stack = noteStackPush(stack, 64);
  assert.equal(stack[stack.length - 1], 64, '後着が優先されていない');
  stack = noteStackRemove(stack, 64);
  assert.equal(stack[stack.length - 1], 60, '前の音に戻らない');
  stack = noteStackRemove(stack, 60);
  assert.equal(stack.length, 0);
});

test('ノートスタック: 同じノートの重複は1つにまとまる', () => {
  let stack = [];
  stack = noteStackPush(stack, 60);
  stack = noteStackPush(stack, 60);
  assert.equal(stack.length, 1);
});

// ---- 音程変換 ----

test('midiToFreq: A4=440Hz、C4≈261.63Hz', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(60) - 261.6256) < 0.01);
});
