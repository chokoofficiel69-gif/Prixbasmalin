/**
 * Hôte d'effets WebAudio/WASM avec fournisseur injecté.
 * Les plugins sont ajoutés en série par piste ; aucun package fournisseur n'est supposé installé.
 */
export function createPluginHost({ audioContext, loadPlugin, pluginModule, getTrackInput, getTrackOutput }) {
  if (!audioContext) throw new TypeError('audioContext requis');
  if (typeof loadPlugin !== 'function' || typeof pluginModule !== 'function') throw new TypeError('loadPlugin et pluginModule doivent être injectés');
  const instances = new Map();
  const tracks = new Map();
  let nextId = 1;

  function ensureTrack(trackId) {
    let track = tracks.get(trackId);
    if (!track) {
      const input = getTrackInput?.(trackId), output = getTrackOutput?.(trackId);
      if (!input || !output) throw new Error(`Piste inconnue ou non routée : ${trackId}`);
      track = { input, output, effects: [] };
      tracks.set(trackId, track);
    }
    return track;
  }

  function rebuild(track) {
    try { track.input.disconnect(); } catch {}
    for (const id of track.effects) {
      const e = instances.get(id);
      if (!e) continue;
      try { e.node.input.disconnect(); } catch {}
      try { e.node.output.disconnect(); } catch {}
      try { e.dry.disconnect(); e.wet.disconnect(); e.sum.disconnect(); } catch {}
    }
    let source = track.input;
    for (const id of track.effects) {
      const e = instances.get(id);
      if (!e) continue;
      source.connect(e.dry);
      source.connect(e.node.input);
      e.node.output.connect(e.wet);
      e.dry.connect(e.sum);
      e.wet.connect(e.sum);
      source = e.sum;
    }
    source.connect(track.output);
  }

  async function addEffect(trackId, pluginId, initialState = {}) {
    const track = ensureTrack(trackId);
    const node = await loadPlugin(audioContext, pluginModule(pluginId));
    if (!node?.input || !node?.output || typeof node.set !== 'function') {
      await node?.destroy?.();
      throw new TypeError(`Plugin effet incompatible : ${pluginId}`);
    }
    const id = `wasm-fx-${nextId++}`;
    const dry = audioContext.createGain(), wet = audioContext.createGain(), sum = audioContext.createGain();
    dry.gain.value = 0; wet.gain.value = 1;
    for (const [name, value] of Object.entries(initialState)) node.set(name, value);
    instances.set(id, { id, kind: 'effect', trackId, pluginId, node, dry, wet, sum, bypass: false });
    track.effects.push(id);
    rebuild(track);
    return { instanceId: id, pluginId, trackId };
  }

  async function addInstrument(trackId, pluginId) {
    const track = ensureTrack(trackId);
    const instrument = await loadPlugin(audioContext, pluginModule(pluginId));
    if (!instrument?.output || typeof instrument.noteOn !== 'function' || typeof instrument.noteOff !== 'function') {
      await instrument?.destroy?.();
      throw new TypeError(`Plugin instrument incompatible : ${pluginId}`);
    }
    instrument.output.connect(track.input);
    const id = `wasm-inst-${nextId++}`;
    instances.set(id, { id, kind: 'instrument', trackId, pluginId, node: instrument });
    return { instanceId: id, pluginId, trackId };
  }

  function setParameter(instanceId, name, value) {
    const e = instances.get(instanceId);
    if (!e || e.kind !== 'effect') throw new Error('Instance effet introuvable');
    e.node.set(name, value);
  }
  function setBypass(instanceId, bypass) {
    const e = instances.get(instanceId);
    if (!e || e.kind !== 'effect') throw new Error('Instance effet introuvable');
    e.bypass = Boolean(bypass);
    e.dry.gain.setTargetAtTime(e.bypass ? 1 : 0, audioContext.currentTime, 0.008);
    e.wet.gain.setTargetAtTime(e.bypass ? 0 : 1, audioContext.currentTime, 0.008);
  }
  function noteOn(instanceId, note, velocity = 100) {
    const e = instances.get(instanceId);
    if (!e || e.kind !== 'instrument') throw new Error('Instance instrument introuvable');
    e.node.noteOn(note, velocity);
  }
  function noteOff(instanceId, note) {
    const e = instances.get(instanceId);
    if (!e || e.kind !== 'instrument') throw new Error('Instance instrument introuvable');
    e.node.noteOff(note);
  }
  async function remove(instanceId) {
    const e = instances.get(instanceId);
    if (!e) return false;
    if (e.kind === 'effect') {
      const track = tracks.get(e.trackId);
      if (track) { track.effects = track.effects.filter(id => id !== instanceId); rebuild(track); }
      try { e.node.input.disconnect(); e.node.output.disconnect(); e.dry.disconnect(); e.wet.disconnect(); e.sum.disconnect(); } catch {}
    } else {
      try { e.node.output.disconnect(); } catch {}
    }
    await e.node.destroy?.();
    instances.delete(instanceId);
    return true;
  }
  async function dispose() {
    for (const id of [...instances.keys()]) await remove(id);
    tracks.clear();
  }
  return {
    addEffect, addInstrument, setParameter, setBypass, noteOn, noteOff, remove, dispose,
    get instances() { return [...instances.values()].map(({ id, kind, trackId, pluginId, bypass }) => ({ id, kind, trackId, pluginId, bypass: Boolean(bypass) })); }
  };
}
