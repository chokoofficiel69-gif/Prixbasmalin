/** Conversion PCM avec dither TPDF pour exports WAV entiers 16/24 bits. */
export function quantizePcmSample(sample, bits = 16, random = Math.random, dither = true) {
  if (bits !== 16 && bits !== 24) throw new RangeError('Format PCM pris en charge : 16 ou 24 bits');
  const scale = 2 ** (bits - 1);
  const max = scale - 1;
  const x = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
  const noise = dither ? (random() - random()) / scale : 0;
  const value = Math.max(-1, Math.min(1, x + noise));
  return Math.round(value < 0 ? value * scale : value * max);
}
