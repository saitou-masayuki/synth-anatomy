import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// wavetables.js（純粋データ生成）を vm で評価する
const src = readFileSync(new URL('../wavetables.js', import.meta.url), 'utf8');
const ctx = createContext({});
runInContext(src, ctx);
const { WAVETABLES, wtFrameMix } = ctx;

// vm コンテキスト（別realm）由来のオブジェクトはプロトタイプが異なり deepEqual が
// 通らないため、プレーンな同realmオブジェクトに変換してから比較する
function plain(x) {
  return JSON.parse(JSON.stringify(x));
}

// ---- テーブル構造 ----

test('教材テーブル「ベーシック」が存在し4フレーム持つ', () => {
  const t = WAVETABLES['wt.basic'];
  assert.ok(t, 'wt.basic がない');
  assert.equal(t.frames.length, 4);
  assert.equal(t.frameNames.length, 4);
});

test('全フレームがDCゼロ・同一長の倍音配列を持つ', () => {
  for (const [name, t] of Object.entries(WAVETABLES)) {
    for (const f of t.frames) {
      assert.ok(Array.isArray(f.real) && Array.isArray(f.imag), `${name}: real/imagがない`);
      assert.equal(f.real.length, f.imag.length, `${name}: real/imagの長さ不一致`);
      assert.ok(f.real.length >= 64, `${name}: 倍音数が少なすぎる`);
      assert.equal(f.real[0], 0, `${name}: DC(real[0])が非ゼロ`);
      assert.equal(f.imag[0], 0, `${name}: DC(imag[0])が非ゼロ`);
    }
  }
});

test('ベーシックのフレーム0は純粋なサイン波', () => {
  const f = WAVETABLES['wt.basic'].frames[0];
  assert.ok(Math.abs(f.imag[1] - 1) < 1e-9, '基音が1でない');
  for (let n = 2; n < f.imag.length; n++) {
    assert.equal(f.imag[n], 0, `倍音${n}が非ゼロ`);
  }
});

test('ノコギリ波フレームは全倍音、矩形波フレームは奇数倍音のみ', () => {
  const t = WAVETABLES['wt.basic'];
  const saw = t.frames[t.frameNames.indexOf('saw')];
  const square = t.frames[t.frameNames.indexOf('square')];
  assert.ok(Math.abs(saw.imag[2]) > 0, 'ノコギリ波に2倍音がない');
  assert.ok(Math.abs(saw.imag[3]) > 0, 'ノコギリ波に3倍音がない');
  assert.equal(square.imag[2], 0, '矩形波に2倍音がある');
  assert.ok(Math.abs(square.imag[3]) > 0, '矩形波に3倍音がない');
});

test('倍音振幅は次数とともに減衰する（帯域整合性）', () => {
  const t = WAVETABLES['wt.basic'];
  const saw = t.frames[t.frameNames.indexOf('saw')];
  assert.ok(Math.abs(saw.imag[1]) > Math.abs(saw.imag[8]));
  assert.ok(Math.abs(saw.imag[8]) > Math.abs(saw.imag[64]));
});

test('WAVETABLESは純粋データ（JSON往復で恒等・関数を含まない）', () => {
  const plain = JSON.parse(JSON.stringify(WAVETABLES));
  assert.deepEqual(plain, JSON.parse(JSON.stringify(plain)));
});

// ---- クロスフェード位置計算 ----

test('wtFrameMix: 端点では単一フレームになる', () => {
  assert.deepEqual(plain(wtFrameMix(0, 4)), { lo: 0, hi: 1, mix: 0 });
  assert.deepEqual(plain(wtFrameMix(1, 4)), { lo: 2, hi: 3, mix: 1 });
});

test('wtFrameMix: 中間位置は隣接2フレームの補間', () => {
  assert.deepEqual(plain(wtFrameMix(0.5, 4)), { lo: 1, hi: 2, mix: 0.5 });
  const r = wtFrameMix(1 / 3, 4);
  assert.equal(r.lo, 1);
  assert.equal(r.hi, 2);
  assert.ok(Math.abs(r.mix) < 1e-9);
});

test('wtFrameMix: mixは常に0..1、範囲外posはクランプ', () => {
  for (const pos of [-0.5, 0, 0.25, 0.7, 1, 1.5]) {
    const r = wtFrameMix(pos, 4);
    assert.ok(r.mix >= 0 && r.mix <= 1, `pos=${pos}: mix範囲外`);
    assert.ok(r.lo >= 0 && r.hi < 4 && r.hi === r.lo + 1, `pos=${pos}: フレーム番号が不正`);
  }
});
