// The picture pipeline's pure parts: the SSIMULACRA2 port and the names of the outputs (no encoding here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { score } from "../images/ssimulacra2.mjs";
import { outputs, avif, QUALITY } from "../images/make.mjs";

// a 64 × 48 picture with edges and a gradient, and changed copies of it
const W = 64, H = 48;
const picture = (f) => {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, v = ((x >> 3) + (y >> 3)) % 2 ? 200 : 40;
    const px = f(x, y, [v, (x * 4) % 256, (y * 5) % 256]);
    data.set(px.map((c) => Math.max(0, Math.min(255, Math.round(c)))), i);
  }
  return { data, width: W, height: H, channels: 3, max: 255 };
};
const orig = picture((x, y, p) => p);

test("ssimulacra2: the same picture scores 100", () => {
  assert.equal(score(orig, picture((x, y, p) => p)), 100);
});

test("ssimulacra2: more damage scores lower", () => {
  const noise = (a) => picture((x, y, p) => p.map((c, k) => c + a * Math.sin(x * 12.9898 + y * 78.233 + k * 3.1)));
  const s1 = score(orig, noise(1)), s2 = score(orig, noise(4)), s3 = score(orig, noise(24));
  assert.ok(s1 < 100 && s1 > s2 && s2 > s3, `${s1} > ${s2} > ${s3}`);
  assert.ok(s1 > 80, "a light noise is still close: " + s1);
});

test("ssimulacra2: 16-bit input of the same picture gives the same score", () => {
  const wide = (p) => ({ ...p, data: Uint16Array.from(p.data, (c) => c * 257), max: 65535 });
  const d = picture((x, y, p) => p.map((c) => c + 6));
  assert.ok(Math.abs(score(orig, d) - score(wide(orig), wide(d))) < 1e-9);
});

test("ssimulacra2: sizes must match", () => {
  assert.throws(() => score(orig, { ...orig, width: W - 1 }), /sizes differ/);
});

test("outputs: names, widths and settings as Flow Medium's images.mjs made them", () => {
  const meta = { width: 900 };
  const one = outputs({ src: "art-cube.png", widths: [null], formats: ["webp"], quality: 88 }, meta);
  assert.deepEqual(one, [{ file: "art-cube.webp", width: 900, format: "webp", options: { ...QUALITY.webp, quality: 88 } }]);
  const many = outputs({ src: "cover.png", name: "c", widths: [400, 640], formats: ["avif", "webp"], options: (w) => ({ avif: avif([w === 400 ? 86 : 80, 10]) }) }, meta);
  assert.deepEqual(many.map((o) => o.file), ["c-400.avif", "c-400.webp", "c-640.avif", "c-640.webp"]);
  assert.deepEqual(many[0].options, { quality: 86, effort: 9, bitdepth: 10 });
  assert.deepEqual(outputs({ src: "logo.png", widths: [152], formats: ["webp"], lossless: true }, meta)[0].options, { lossless: true, effort: 6 });
});
