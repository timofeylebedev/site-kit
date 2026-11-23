// SSIMULACRA 2 (Jon Sneyers, Cloudinary, 2022–2023): how close a compressed picture looks to its original, 100 at
// identical, 90 «no visible loss at 1:1 even when you look closely», 70 «high quality», 50 «medium». A port of the
// reference (libjxl tools/ssimulacra2.cc, with its recursive Gaussian from tools/gauss_blur.cc and the XYB of
// lib/jxl/cms/opsin_params.h), in plain JS with no dependencies, so the kit needs no binary to search for the lowest
// quality that still scores 90. Doubles instead of the reference's floats: scores agree to about ±0.05.
//
// score(a, b): a and b are { data, width, height, channels (3 | 4), max (255 | 65535) } in sRGB (sharp's raw output).
// A picture with alpha is blended on grey 0.5 as the reference does; flatten both on the page's colour first to score
// it as it is seen (images/search.mjs does).

const WEIGHTS = [0.0, 0.0007376606707406586, 0.0, 0.0, 0.0007793481682867309, 0.0, 0.0, 0.0004371155730107379, 0.0,
  1.1041726426657346, 0.00066284834129271, 0.00015231632783718752, 0.0, 0.0016406437456599754, 0.0, 1.8422455520539298,
  11.441172603757666, 0.0, 0.0007989109436015163, 0.000176816438078653, 0.0, 1.8787594979546387, 10.94906990605142, 0.0,
  0.0007289346991508072, 0.9677937080626833, 0.0, 0.00014003424285435884, 0.9981766977854967, 0.00031949755934435053,
  0.0004550992113792063, 0.0, 0.0, 0.0013648766163243398, 0.0, 0.0, 0.0, 0.0, 0.0, 7.466890328078848, 0.0,
  17.445833984131262, 0.0006235601634041466, 0.0, 0.0, 6.683678146179332, 0.00037724407979611296, 1.027889937768264,
  225.20515300849274, 0.0, 0.0, 19.213238186143016, 0.0011401524586618361, 0.001237755635509985, 176.39317598450694,
  0.0, 0.0, 24.43300999870476, 0.28520802612117757, 0.0004485436923833408, 0.0, 0.0, 0.0, 34.77906344483772,
  44.835625328877896, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0008680556573291698, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0005313191874358747, 0.0, 0.00016533814161379112, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0004179171803251336,
  0.0017290828234722833, 0.0, 0.0020827005846636437, 0.0, 0.0, 8.826982764996862, 23.19243343998926, 0.0,
  95.1080498811086, 0.9863978034400682, 0.9834382792465353, 0.0012286405048278493, 171.2667255897307,
  0.9807858872435379, 0.0, 0.0, 0.0, 0.0005130064588990679, 0.0, 0.00010854057858411537];

const C2 = 0.0009, SCALES = 6;

// ── the recursive Gaussian (Charalampidis 2016, as libjxl's FastGaussian), sigma 1.5 ────────────────────────────────
const GAUSS = (() => {
  const sigma = 1.5, radius = Math.round(3.2795 * sigma + 0.2546);
  const w = Math.PI / (2 * radius), omega = [w, 3 * w, 5 * w];
  const p = [1 / Math.tan(0.5 * omega[0]), -1 / Math.tan(0.5 * omega[1]), 1 / Math.tan(0.5 * omega[2])];
  const r = [p[0] * p[0] / Math.sin(omega[0]), -p[1] * p[1] / Math.sin(omega[1]), p[2] * p[2] / Math.sin(omega[2])];
  const rho = omega.map((o) => Math.exp(-0.5 * sigma * sigma * o * o) / radius);
  const D13 = p[0] * r[1] - r[0] * p[1], D35 = p[1] * r[2] - r[1] * p[2], D51 = p[2] * r[0] - r[2] * p[0];
  const z15 = D35 / D13, z35 = D51 / D13;
  const beta = solve3([[p[0], p[1], p[2]], [r[0], r[1], r[2]], [z15, z35, 1]], [1, radius * radius - sigma * sigma, z15 * rho[0] + z35 * rho[1] + rho[2]]);
  return { N: radius, n2: beta.map((b, i) => -b * Math.cos(omega[i] * (radius + 1))), d1: omega.map((o) => -2 * Math.cos(o)) };
})();

function solve3(A, v) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  return [0, 1, 2].map((c) => det(A.map((row, i) => row.map((x, j) => (j === c ? v[i] : x)))) / d);
}

// one line of `size` values read at in[at + k * step], written likewise into out: zero outside the picture
function line(inp, out, at, step, size) {
  const { N, n2, d1 } = GAUSS;
  let a1 = 0, a3 = 0, a5 = 0, b1 = 0, b3 = 0, b5 = 0;          // y[n-1] and y[n-2] of the three filters
  for (let n = -N + 1; n < size; n++) {
    const l = n - N - 1, r = n + N - 1;
    const sum = (l >= 0 ? inp[at + l * step] : 0) + (r < size ? inp[at + r * step] : 0);
    const y1 = n2[0] * sum - d1[0] * a1 - b1, y3 = n2[1] * sum - d1[1] * a3 - b3, y5 = n2[2] * sum - d1[2] * a5 - b5;
    b1 = a1; b3 = a3; b5 = a5; a1 = y1; a3 = y3; a5 = y5;
    if (n >= 0) out[at + n * step] = y1 + y3 + y5;
  }
}

function blur(plane, w, h, tmp, out) {
  for (let y = 0; y < h; y++) line(plane, tmp, y * w, 1, w);
  for (let x = 0; x < w; x++) line(tmp, out, x, w, h);
  return out;
}

// ── colour: sRGB → linear → XYB (rescaled to about 0..1, B − Y) ───────────────────────────────────────────────────
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const LUT = new Map();
const lut = (max) => {
  if (!LUT.has(max)) { const t = new Float64Array(max + 1); for (let i = 0; i <= max; i++) t[i] = toLinear(i / max); LUT.set(max, t); }
  return LUT.get(max);
};

// linear RGB planes (Float64Array × 3); alpha blended on grey 0.5 in the encoded values, as the reference does
function linear({ data, width, height, channels, max = 255 }) {
  const n = width * height, rgb = [new Float64Array(n), new Float64Array(n), new Float64Array(n)], t = lut(max);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    if (channels === 4) {
      const a = data[o + 3] / max;
      for (let c = 0; c < 3; c++) rgb[c][i] = toLinear(a * (data[o + c] / max) + (1 - a) * 0.5);
    } else if (channels >= 3) for (let c = 0; c < 3; c++) rgb[c][i] = t[data[o + c]];
    else { const v = t[data[o]]; rgb[0][i] = rgb[1][i] = rgb[2][i] = v; }
  }
  return rgb;
}

const M = [[0.30, 0.622, 0.078], [0.23, 0.692, 0.078], [0.24342268924547819, 0.20476744424496821, 1 - 0.24342268924547819 - 0.20476744424496821]];
const BIAS = 0.0037930732552754493, CBIAS = Math.cbrt(BIAS);

function xyb(rgb, n) {
  const out = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; i++) {
    const r = rgb[0][i], g = rgb[1][i], b = rgb[2][i];
    const l = Math.cbrt(Math.max(0, M[0][0] * r + M[0][1] * g + M[0][2] * b + BIAS)) - CBIAS;
    const m = Math.cbrt(Math.max(0, M[1][0] * r + M[1][1] * g + M[1][2] * b + BIAS)) - CBIAS;
    const s = Math.cbrt(Math.max(0, M[2][0] * r + M[2][1] * g + M[2][2] * b + BIAS)) - CBIAS;
    const X = 0.5 * (l - m), Y = 0.5 * (l + m);
    out[0][i] = X * 14 + 0.42; out[1][i] = Y + 0.01; out[2][i] = (s - Y) + 0.55;
  }
  return out;
}

// half size, averaged in linear light (the last row and column repeat when the size is odd)
function half(rgb, w, h) {
  const W = Math.ceil(w / 2), H = Math.ceil(h / 2);
  const out = rgb.map(() => new Float64Array(W * H));
  for (let c = 0; c < 3; c++) for (let oy = 0; oy < H; oy++) for (let ox = 0; ox < W; ox++) {
    let s = 0;
    for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) s += rgb[c][Math.min(oy * 2 + iy, h - 1) * w + Math.min(ox * 2 + ix, w - 1)];
    out[c][oy * W + ox] = s / 4;
  }
  return { rgb: out, w: W, h: H };
}

export function score(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`ssimulacra2: sizes differ (${a.width}×${a.height}, ${b.width}×${b.height})`);
  let w = a.width, h = a.height, A = linear(a), B = linear(b);
  const scales = [];
  for (let s = 0; s < SCALES; s++) {
    if (w < 8 || h < 8) break;
    if (s) { const ha = half(A, w, h), hb = half(B, w, h); A = ha.rgb; B = hb.rgb; w = ha.w; h = ha.h; }
    const n = w * h, x1 = xyb(A, n), x2 = xyb(B, n);
    const tmp = new Float64Array(n), mul = new Float64Array(n);
    const ssim = [], edge = [];
    for (let c = 0; c < 3; c++) {
      const p1 = x1[c], p2 = x2[c];
      const sq = (f) => { for (let i = 0; i < n; i++) mul[i] = f(i); return blur(mul, w, h, tmp, new Float64Array(n)); };
      const s11 = sq((i) => p1[i] * p1[i]), s22 = sq((i) => p2[i] * p2[i]), s12 = sq((i) => p1[i] * p2[i]);
      const mu1 = blur(p1, w, h, tmp, new Float64Array(n)), mu2 = blur(p2, w, h, tmp, new Float64Array(n));
      let d1 = 0, d4 = 0, r1 = 0, r4 = 0, l1 = 0, l4 = 0;
      for (let i = 0; i < n; i++) {
        const m1 = mu1[i], m2 = mu2[i];
        const numM = 1 - (m1 - m2) * (m1 - m2);
        const numS = 2 * (s12[i] - m1 * m2) + C2;
        const denS = (s11[i] - m1 * m1) + (s22[i] - m2 * m2) + C2;
        const d = Math.max(0, 1 - (numM * numS) / denS);
        d1 += d; d4 += d ** 4;
        const e = (1 + Math.abs(p2[i] - m2)) / (1 + Math.abs(p1[i] - m1)) - 1;
        const art = Math.max(e, 0), lost = Math.max(-e, 0);
        r1 += art; r4 += art ** 4; l1 += lost; l4 += lost ** 4;
      }
      ssim.push(d1 / n, Math.sqrt(Math.sqrt(d4 / n)));
      edge.push(r1 / n, Math.sqrt(Math.sqrt(r4 / n)), l1 / n, Math.sqrt(Math.sqrt(l4 / n)));
    }
    scales.push({ ssim, edge });
  }
  let sum = 0, i = 0;
  for (let c = 0; c < 3; c++) for (let s = 0; s < scales.length; s++) for (let k = 0; k < 2; k++) {
    sum += WEIGHTS[i++] * Math.abs(scales[s].ssim[c * 2 + k]);
    sum += WEIGHTS[i++] * Math.abs(scales[s].edge[c * 4 + k]);
    sum += WEIGHTS[i++] * Math.abs(scales[s].edge[c * 4 + k + 2]);
  }
  // (as the reference: on a picture too small for six scales the weights simply run on, unaligned)
  sum *= 0.9562382616834844;
  sum = 2.326765642916932 * sum - 0.020884521182843837 * sum * sum + 6.248496625763138e-05 * sum * sum * sum;
  return sum > 0 ? 100 - 10 * Math.pow(sum, 0.6276336467831387) : 100;
}
