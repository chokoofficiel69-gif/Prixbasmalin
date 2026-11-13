// Sauvegarde automatique du projet d'enregistrement dans le navigateur (IndexedDB).
// Rien n'est envoyé ailleurs : les pistes restent sur l'appareil, même après un rafraîchissement,
// une coupure de batterie ou une fermeture de l'onglet.
const DB = 'studio-ia', STORE = 'sessions';
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
    const req = fn(s);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const putItem = (key, value) => tx('readwrite', s => s.put(value, key));
export const getItem = (key) => tx('readonly', s => s.get(key));
export const delItem = (key) => tx('readwrite', s => s.delete(key));

const chans = (b) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice());
export const packBuffer = (b) => b && { sr: b.sampleRate, ch: chans(b) };
export function unpackBuffer(p) {
  if (!p?.ch?.length) return null;
  const b = new AudioBuffer({ numberOfChannels: p.ch.length, length: Math.max(1, p.ch[0].length), sampleRate: p.sr });
  p.ch.forEach((d, c) => b.copyToChannel(d, c));
  return b;
}
