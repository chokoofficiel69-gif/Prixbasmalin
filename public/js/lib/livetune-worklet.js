// Autotune EN DIRECT pour le retour casque (AudioWorklet) : détection de la note (YIN sous-échantillonné)
// + décalage de hauteur par lignes à retard croisées. Léger et rapide (~25 ms), pour s'entendre juste
// pendant qu'on chante ; la prise enregistrée reste brute (corrigée ensuite avec l'algorithme complet).
class LiveTune extends AudioWorkletProcessor {
  constructor() {
    super();
    this.N = 8192; this.buf = new Float32Array(this.N); this.w = 0;          // ligne à retard
    this.ds = 4; this.win = 384; this.an = new Float32Array(this.win * this.ds); this.ai = 0; this.cnt = 0;
    this.ratio = 1; this.target = 1; this.phase = 0;
    this.strength = 1; this.speed = 0.15; this.scale = null; // null = chromatique ; sinon tableau des 12 classes autorisées
    this.port.onmessage = (e) => { const d = e.data || {}; if (d.strength !== undefined) this.strength = d.strength; if (d.speed !== undefined) this.speed = d.speed; if (d.scale !== undefined) this.scale = d.scale; };
  }
  detect() {
    // YIN sur une version sous-échantillonnée (sampleRate / 4)
    const ds = this.ds, n = this.win, x = new Float32Array(n), L = this.an.length;
    let e = 0;
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < ds; k++) s += this.an[(this.ai + i * ds + k) % L]; x[i] = s / ds; e += x[i] * x[i]; }
    if (e / n < 1e-5) return 0;
    const sr = sampleRate / ds, tMin = Math.floor(sr / 900), tMax = Math.min(Math.floor(n / 2), Math.ceil(sr / 70)), W = n - tMax;
    const d = new Float32Array(tMax + 1); let run = 0;
    for (let t = 1; t <= tMax; t++) { let s = 0; for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; s += v * v; } run += s; d[t] = s * t / (run || 1); }
    for (let t = tMin; t < tMax; t++) if (d[t] < 0.18 && d[t] < d[t + 1]) {
      const a = d[t - 1], b = d[t], c = d[t + 1], sh = (a - 2 * b + c) ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
      return sr / (t + sh);
    }
    return 0;
  }
  snap(f) {
    const m = 69 + 12 * Math.log2(f / 440);
    let best = Math.round(m);
    if (this.scale) { let bd = 99; for (let k = Math.floor(m) - 2; k <= Math.ceil(m) + 2; k++) if (this.scale[((k % 12) + 12) % 12]) { const dd = Math.abs(k - m); if (dd < bd) { bd = dd; best = k; } } }
    return 2 ** ((best - m) * this.strength / 12);
  }
  process(inputs, outputs) {
    const inp = inputs[0][0], out = outputs[0];
    if (!inp) return true;
    const N = this.N, win = 1024; // fenêtre de la ligne à retard (≈ 21 ms à 48 kHz)
    for (let i = 0; i < inp.length; i++) {
      const v = inp[i];
      this.buf[this.w] = v; this.an[this.ai] = v; this.ai = (this.ai + 1) % this.an.length;
      if (++this.cnt >= 512) { this.cnt = 0; const f = this.detect(); this.target = f ? this.snap(f) : 1; }
      this.ratio += (this.target - this.ratio) * this.speed * 0.01;
      // deux têtes de lecture décalées d'une demi-fenêtre, fondu en cosinus
      this.phase = (this.phase + (1 - this.ratio) + win) % win;
      const p2 = (this.phase + win / 2) % win;
      const r1 = (this.w - this.phase - 4 + N) % N, r2 = (this.w - p2 - 4 + N) % N;
      const g1 = Math.sin(Math.PI * this.phase / win), g2 = Math.sin(Math.PI * p2 / win);
      const rd = (pos) => { const i0 = Math.floor(pos), fr = pos - i0; return this.buf[i0 % N] * (1 - fr) + this.buf[(i0 + 1) % N] * fr; };
      const y = rd(r1) * g1 * g1 + rd(r2) * g2 * g2;
      for (let c = 0; c < out.length; c++) out[c][i] = y;
      this.w = (this.w + 1) % N;
    }
    return true;
  }
}
registerProcessor('live-tune', LiveTune);
