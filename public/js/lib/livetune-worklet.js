// Autotune EN DIRECT pour le retour casque.
// Détection YIN sous-échantillonnée + pitch shifting par deux têtes de lecture.
// La prise enregistrée reste brute : ce module ne traite que le monitoring casque.
class LiveTune extends AudioWorkletProcessor {
  constructor() {
    super();
    this.N = 8192; this.buf = new Float32Array(this.N); this.w = 0;
    this.ds = 4; this.win = 384; this.an = new Float32Array(this.win * this.ds); this.ai = 0; this.cnt = 0;
    this.ratio = 1; this.target = 1; this.phase = 0;
    this.strength = 1; this.speed = 0.15; this.scale = null;
    this.lastVoicedAt = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.strength !== undefined) this.strength = Math.max(0, Math.min(1, Number(d.strength) || 0));
      if (d.speed !== undefined) this.speed = Math.max(0.001, Math.min(1, Number(d.speed) || 0.001));
      if (d.scale !== undefined) {
        this.scale = Array.isArray(d.scale) && d.scale.length === 12
          ? d.scale.map(Boolean) : null;
      }
    };
  }
  detect() {
    const ds = this.ds, n = this.win, x = new Float32Array(n), L = this.an.length;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      let sample = 0;
      for (let k = 0; k < ds; k++) sample += this.an[(this.ai + i * ds + k) % L];
      x[i] = sample / ds; energy += x[i] * x[i];
    }
    if (energy / n < 1e-5) return { frequency: 0, confidence: 0 };
    const sr = sampleRate / ds;
    const tMin = Math.max(2, Math.floor(sr / 900));
    const tMax = Math.min(Math.floor(n / 2), Math.ceil(sr / 70));
    const W = n - tMax, d = new Float32Array(tMax + 1);
    let run = 0;
    for (let t = 1; t <= tMax; t++) {
      let sum = 0;
      for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; sum += v * v; }
      run += sum; d[t] = sum * t / (run || 1);
    }
    for (let t = tMin; t < tMax; t++) {
      if (d[t] < 0.18 && d[t] <= d[t + 1]) {
        const a = d[t - 1], b = d[t], c = d[t + 1];
        const den = a - 2 * b + c;
        const shift = Math.abs(den) > 1e-9 ? 0.5 * (a - c) / den : 0;
        return { frequency: sr / (t + shift), confidence: Math.max(0, Math.min(1, 1 - b)) };
      }
    }
    return { frequency: 0, confidence: 0 };
  }
  snap(frequency) {
    const midi = 69 + 12 * Math.log2(frequency / 440);
    let best = Math.round(midi);
    if (this.scale?.some(Boolean)) {
      let distance = Infinity;
      for (let note = Math.floor(midi) - 2; note <= Math.ceil(midi) + 2; note++) {
        if (!this.scale[((note % 12) + 12) % 12]) continue;
        const delta = Math.abs(note - midi);
        if (delta < distance) { distance = delta; best = note; }
      }
    }
    return 2 ** ((best - midi) * this.strength / 12);
  }
  process(inputs, outputs) {
    const channels = inputs[0], out = outputs[0];
    if (!channels?.length || !out?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (let c = 0; c < channels.length; c++) sample += channels[c][i] || 0;
      const v = sample / channels.length;
      this.buf[this.w] = v;
      this.an[this.ai] = v; this.ai = (this.ai + 1) % this.an.length;
      if (++this.cnt >= 512) {
        this.cnt = 0;
        const result = this.detect();
        if (result.frequency > 0 && result.confidence >= 0.82) {
          this.target = this.snap(result.frequency);
          this.lastVoicedAt = currentFrame + i;
        } else {
          // Retour progressif au naturel après une courte tolérance aux micro-coupures du vibrato.
          if (currentFrame + i - this.lastVoicedAt > sampleRate * 0.035) this.target = 1;
        }
      }
      this.ratio += (this.target - this.ratio) * this.speed * 0.01;
      const win = 1024;
      this.phase = (this.phase + (1 - this.ratio) + win) % win;
      const p2 = (this.phase + win / 2) % win;
      const r1 = (this.w - this.phase - 4 + this.N) % this.N;
      const r2 = (this.w - p2 - 4 + this.N) % this.N;
      const g1 = Math.sin(Math.PI * this.phase / win), g2 = Math.sin(Math.PI * p2 / win);
      const read = (pos) => {
        const index = Math.floor(pos), frac = pos - index;
        return this.buf[index % this.N] * (1 - frac) + this.buf[(index + 1) % this.N] * frac;
      };
      const y = read(r1) * g1 * g1 + read(r2) * g2 * g2;
      for (let c = 0; c < out.length; c++) out[c][i] = Number.isFinite(y) ? y : 0;
      this.w = (this.w + 1) % this.N;
    }
    return true;
  }
}
registerProcessor('live-tune', LiveTune);
