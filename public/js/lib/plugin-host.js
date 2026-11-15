/**
 * Adaptateur de base pour hôte de plugins WebAudio/WASM.
 * Le fournisseur (ex. Wadspa) est injecté : aucun package non publié n'est importé ici.
 */
export function createPluginHost({ audioContext, loadPlugin, pluginModule, getTrackInput, getTrackOutput }) {
  if (!audioContext) throw new TypeError('audioContext requis');
  if (typeof loadPlugin !== 'function' || typeof pluginModule !== 'function') {
    throw new TypeError('loadPlugin et pluginModule doivent être injectés par le fournisseur');
  }
  const instances = new Map();
  let nextId = 1;

  async function addEffect(trackId, pluginId, initialState = {}) {
    const trackInput = getTrackInput?.(trackId);
    const trackOutput = getTrackOutput?.(trackId);
    if (!trackInput || !trackOutput) throw new Error(`Piste inconnue ou non routée : ${trackId}`);
    const node = await loadPlugin(audioContext, pluginModule(pluginId));
    if (!node?.input || !node?.output || typeof node.set !== 'function') {
      node?.destroy?.();
      throw new TypeError(`Plugin effet incompatible : ${pluginId}`);
    }
    const id = `wasm-fx-${nextId++}`;
    const dry = audioContext.createGain();
    const wet = audioContext.createGain();
    const sum = audioContext.createGain();
    dry.gain.value = 0;
    wet.gain.value = 1;
    trackInput.connect(node.input);
    node.output.connect(wet);
    wet.connect(sum);
    // Le chemin sec est conservé pour bypass sans détruire l'instance.
    trackInput.connect(dry);
    dry.connect(sum);
    sum.connect(trackOutput);
    for (const [name, value] of Object.entries(initialState)) node.set(name, value);
    const entry = { id, kind: 'effect', trackId, pluginId, node, dry, wet, sum, bypass: false };
    instances.set(id, entry);
    return { instanceId: id, pluginId, trackId };
  }

  async function addInstrument(trackId, pluginId) {
    const trackOutput = getTrackOutput?.(trackId);
    if (!trackOutput) throw new Error(`Piste inconnue ou non routée : ${trackId}`);
    const instrument = await loadPlugin(audioContext, pluginModule(pluginId));
    if (!instrument?.output || typeof instrument.noteOn !== 'function' || typeof instrument.noteOff !== 'function') {
      instrument?.destroy?.();
      throw new TypeError(`Plugin instrument incompatible : ${pluginId}`);
    }
    instrument.output.connect(trackOutput);
    const id = `wasm-inst-${nextId++}`;
    instances.set(id, { id, kind: 'instrument', trackId, pluginId, node: instrument });
    return { instanceId: id, pluginId, trackId };
  }

  function setParameter(instanceId, name, value) {
    const entry = instances.get(instanceId);
    if (!entry || entry.kind !== 'effect') throw new Error('Instance effet introuvable');
    entry.node.set(name, value);
  }

  function setBypass(instanceId, bypass) {
    const entry = instances.get(instanceId);
    if (!entry || entry.kind !== 'effect') throw new Error('Instance effet introuvable');
    entry.bypass = Boolean(bypass);
    entry.dry.gain.setTargetAtTime(entry.bypass ? 1 : 0, audioContext.currentTime, 0.008);
    entry.wet.gain.setTargetAtTime(entry.bypass ? 0 : 1, audioContext.currentTime, 0.008);
  }

  function noteOn(instanceId, note, velocity = 100) {
    const entry = instances.get(instanceId);
    if (!entry || entry.kind !== 'instrument') throw new Error('Instance instrument introuvable');
    entry.node.noteOn(note, velocity);
  }

  function noteOff(instanceId, note) {
    const entry = instances.get(instanceId);
    if (!entry || entry.kind !== 'instrument') throw new Error('Instance instrument introuvable');
    entry.node.noteOff(note);
  }

  async function remove(instanceId) {
    const entry = instances.get(instanceId);
    if (!entry) return false;
    if (entry.kind === 'effect') {
      try { entry.node.input.disconnect(); } catch {}
      try { entry.node.output.disconnect(); } catch {}
      try { entry.dry.disconnect(); entry.wet.disconnect(); entry.sum.disconnect(); } catch {}
    } else {
      try { entry.node.output.disconnect(); } catch {}
    }
    await entry.node.destroy?.();
    instances.delete(instanceId);
    return true;
  }

  async function dispose() {
    for (const id of [...instances.keys()]) await remove(id);
  }

  return {
    addEffect, addInstrument, setParameter, setBypass, noteOn, noteOff, remove, dispose,
    get instances() { return [...instances.values()].map(({ id, kind, trackId, pluginId, bypass }) => ({ id, kind, trackId, pluginId, bypass: Boolean(bypass) })); }
  };
}
