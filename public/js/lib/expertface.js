// Ingé son IA — tête « réseau de neurones » holographique (personnage fictif, n'imite
// personne de réel). Look studio pro, 100 % SVG/CSS, 0 Ko réseau, 0 €.
// Pas d'import navigateur au chargement : les helpers purs restent testables sous Node.

export const FACE_STATES = ['idle', 'thinking', 'speaking'];
export const DEFAULT_ENGINEER = { name: 'Marco', role: "Ingénieur du son · IA" };

/** Légende sous le portrait (pure, testable). */
export function faceCaption(name = DEFAULT_ENGINEER.name, role = DEFAULT_ENGINEER.role) {
  return { name: String(name || DEFAULT_ENGINEER.name), role: String(role || DEFAULT_ENGINEER.role) };
}
/** Normalise un état d'animation (pure, testable). */
export function normalizeState(s) {
  return FACE_STATES.includes(s) ? s : 'idle';
}

const CSS = `
.expert-face{display:flex;gap:12px;align-items:center}
.expert-face .ef-portrait{width:104px;height:104px;flex:0 0 auto;border-radius:14px;overflow:hidden;position:relative;
  background:radial-gradient(120% 110% at 62% 34%, #0e2a44 0%, #060912 72%);
  box-shadow:0 0 22px rgba(34,211,238,.35), inset 0 0 0 1px rgba(34,211,238,.4)}
.expert-face .ef-portrait svg{width:100%;height:100%;display:block}
.expert-face .ef-meta{min-width:0}
.expert-face .ef-name{font-weight:800;letter-spacing:.2px}
.expert-face .ef-role{opacity:.72;font-size:12px;line-height:1.25}
.expert-face .ef-status{display:inline-flex;align-items:center;gap:6px;font-size:11px;margin-top:5px;opacity:.95}
.expert-face .ef-dot{width:8px;height:8px;border-radius:50%;background:#22e39a;box-shadow:0 0 7px #22e39a}
/* coeur lumineux : respire au repos, pulse en analyse */
.ef-core{transform-box:fill-box;transform-origin:center;animation:ef-breathe 3.4s infinite ease-in-out}
@keyframes ef-breathe{0%,100%{opacity:.78}50%{opacity:1}}
.expert-face[data-state="thinking"] .ef-core{animation:ef-think .9s infinite ease-in-out}
@keyframes ef-think{0%,100%{opacity:.6}50%{opacity:1}}
/* noeuds du réseau qui scintillent */
.ef-nodes circle{animation:ef-tw 2.6s infinite ease-in-out}
.ef-nodes circle:nth-child(3n){animation-delay:.6s}.ef-nodes circle:nth-child(3n+1){animation-delay:1.3s}
@keyframes ef-tw{0%,100%{opacity:.35}50%{opacity:1}}
/* anneau d'analyse */
.ef-ring{opacity:0;transform-box:fill-box;transform-origin:center}
.expert-face[data-state="thinking"] .ef-ring{opacity:1;animation:ef-pulse 1.4s infinite ease-out}
@keyframes ef-pulse{0%{transform:scale(.7);opacity:.6}100%{transform:scale(1.15);opacity:0}}
/* onde quand il parle */
.ef-wave{opacity:0;transition:opacity .2s}
.expert-face[data-state="speaking"] .ef-wave{opacity:1}
.ef-wave rect{transform-box:fill-box;transform-origin:center}
.expert-face[data-state="speaking"] .ef-wave rect{animation:ef-bars .55s infinite ease-in-out}
.ef-wave rect:nth-child(2){animation-delay:.08s}.ef-wave rect:nth-child(3){animation-delay:.18s}
.ef-wave rect:nth-child(4){animation-delay:.27s}.ef-wave rect:nth-child(5){animation-delay:.12s}.ef-wave rect:nth-child(6){animation-delay:.22s}
@keyframes ef-bars{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}
.expert-face[data-state="thinking"] .ef-dot{background:#f5a623;box-shadow:0 0 7px #f5a623}
.expert-face[data-state="speaking"] .ef-dot{background:#22d3ee;box-shadow:0 0 7px #22d3ee}
@media (prefers-reduced-motion: reduce){.ef-core,.ef-nodes circle,.ef-ring,.ef-wave rect{animation:none!important}}
`;

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('expert-face-css')) return;
  const s = document.createElement('style');
  s.id = 'expert-face-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Tête IA : silhouette en profil formée de noeuds + liens, coeur lumineux, casque suggéré.
const PORTRAIT_SVG = `
<svg viewBox="0 0 100 100" role="img" aria-label="Ingénieur du son IA">
  <defs>
    <radialGradient id="ef-core-g" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="#eafaff"/><stop offset="35%" stop-color="#4fd8ff"/><stop offset="100%" stop-color="#0a3b63"/>
    </radialGradient>
    <linearGradient id="ef-head-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1b4b74"/><stop offset="100%" stop-color="#0a1c33"/>
    </linearGradient>
  </defs>
  <circle class="ef-ring" cx="50" cy="50" r="44" fill="none" stroke="#22d3ee" stroke-width="2"/>
  <!-- silhouette de profil (tête tournée) -->
  <path d="M34 78 Q24 70 26 52 Q28 30 50 26 Q72 24 76 48 Q79 66 66 76 Q58 82 50 80 L50 88 L36 88 Z"
        fill="url(#ef-head-g)" stroke="#2bd6ff" stroke-width=".8" opacity=".9"/>
  <!-- liens du réseau -->
  <g stroke="#2bd6ff" stroke-width=".5" opacity=".55" fill="none">
    <path d="M38 44 L52 36 L64 46 L58 60 L44 62 Z"/>
    <path d="M52 36 L60 50 L44 62 M38 44 L44 62 M64 46 L70 58"/>
    <path d="M40 54 L58 60 M52 36 L46 48 L40 54"/>
  </g>
  <!-- noeuds -->
  <g class="ef-nodes" fill="#9befff">
    <circle cx="38" cy="44" r="2"/><circle cx="52" cy="36" r="2.4"/><circle cx="64" cy="46" r="2.2"/>
    <circle cx="58" cy="60" r="2.4"/><circle cx="44" cy="62" r="2"/><circle cx="46" cy="48" r="1.6"/>
    <circle cx="70" cy="58" r="1.8"/><circle cx="40" cy="54" r="1.6"/><circle cx="60" cy="50" r="1.6"/>
  </g>
  <!-- coeur lumineux (le "cerveau") -->
  <circle class="ef-core" cx="52" cy="49" r="8" fill="url(#ef-core-g)" style="filter:drop-shadow(0 0 6px rgba(79,216,255,.9))"/>
  <!-- casque suggéré -->
  <path d="M28 50 Q28 22 54 22" fill="none" stroke="#0c2238" stroke-width="4" stroke-linecap="round" opacity=".8"/>
  <rect x="24" y="46" width="9" height="15" rx="4" fill="#15324e" stroke="#2bd6ff" stroke-width=".6"/>
  <!-- onde (parle) -->
  <g class="ef-wave" fill="#22d3ee">
    <rect x="34" y="84" width="2.2" height="10"/><rect x="39" y="84" width="2.2" height="10"/><rect x="44" y="84" width="2.2" height="10"/>
    <rect x="49" y="84" width="2.2" height="10"/><rect x="54" y="84" width="2.2" height="10"/><rect x="59" y="84" width="2.2" height="10"/>
  </g>
</svg>`;

const STATUS_TEXT = { idle: 'En ligne', thinking: 'Analyse en cours…', speaking: 'Il te parle…' };

/** Construit la carte avatar. Retourne { el, setState(state), setStatus(text) }. */
export function expertFace({ name, role } = {}) {
  ensureCss();
  const cap = faceCaption(name, role);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const portrait = mk('div', 'ef-portrait');
  portrait.innerHTML = PORTRAIT_SVG;
  const statusText = mk('span', '', STATUS_TEXT.idle);
  const status = mk('span', 'ef-status');
  status.append(mk('span', 'ef-dot'), statusText);
  const meta = mk('div', 'ef-meta');
  meta.append(mk('div', 'ef-name', cap.name), mk('div', 'ef-role', cap.role), status);
  const el = mk('div', 'expert-face');
  el.dataset.state = 'idle';
  el.append(portrait, meta);
  const setState = (s) => { const st = normalizeState(s); el.dataset.state = st; statusText.textContent = STATUS_TEXT[st]; };
  const setStatus = (text) => { statusText.textContent = String(text || STATUS_TEXT[el.dataset.state] || ''); };
  return { el, setState, setStatus };
}
