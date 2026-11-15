// Visage humanisé de l'ingé son IA — portrait SVG stylisé (personnage fictif, n'imite
// personne de réel), avec dégradés de peau, casque studio, yeux qui clignent, bouche
// qui bouge quand il parle et halo d'analyse. 100 % local, 0 Ko réseau, 0 €.
// Pas d'import navigateur au chargement : les helpers purs restent testables sous Node.

export const FACE_STATES = ['idle', 'thinking', 'speaking'];
export const DEFAULT_ENGINEER = { name: 'Marco', role: "Ingénieur du son · 30 ans de studio" };

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
.expert-face .ef-portrait{width:92px;height:92px;flex:0 0 auto;border-radius:50%;overflow:hidden;
  background:radial-gradient(120% 120% at 50% 30%, #1d2230 0%, #0c0e14 70%);
  box-shadow:0 2px 10px rgba(0,0,0,.45), inset 0 0 0 1px rgba(124,92,255,.35)}
.expert-face .ef-portrait svg{width:100%;height:100%;display:block}
.expert-face .ef-meta{min-width:0}
.expert-face .ef-name{font-weight:700;letter-spacing:.2px}
.expert-face .ef-role{opacity:.72;font-size:12px;line-height:1.25}
.expert-face .ef-status{display:inline-flex;align-items:center;gap:6px;font-size:11px;margin-top:4px;opacity:.9}
.expert-face .ef-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px #22c55e}
/* clignement des yeux */
.ef-eyes{transform-box:fill-box;transform-origin:center;animation:ef-blink 5.4s infinite}
@keyframes ef-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
/* bouche : fermée au repos, s'anime quand il parle */
.ef-mouth{transform-box:fill-box;transform-origin:center;transform:scaleY(.35)}
.expert-face[data-state="speaking"] .ef-mouth{animation:ef-talk .32s infinite ease-in-out}
@keyframes ef-talk{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1.05)}}
/* halo d'analyse (thinking) : anneau qui pulse + barres EQ */
.ef-ring{opacity:0;transform-box:fill-box;transform-origin:center}
.expert-face[data-state="thinking"] .ef-ring{opacity:1;animation:ef-pulse 1.3s infinite ease-out}
@keyframes ef-pulse{0%{transform:scale(.8);opacity:.55}100%{transform:scale(1.25);opacity:0}}
.ef-eq rect{transform-box:fill-box;transform-origin:bottom}
.expert-face[data-state="thinking"] .ef-eq,.expert-face[data-state="speaking"] .ef-eq{opacity:1}
.ef-eq{opacity:0;transition:opacity .2s}
.expert-face[data-state="thinking"] .ef-eq rect,.expert-face[data-state="speaking"] .ef-eq rect{animation:ef-bars .7s infinite ease-in-out}
.ef-eq rect:nth-child(2){animation-delay:.1s}.ef-eq rect:nth-child(3){animation-delay:.22s}
.ef-eq rect:nth-child(4){animation-delay:.33s}.ef-eq rect:nth-child(5){animation-delay:.15s}
@keyframes ef-bars{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
.expert-face[data-state="thinking"] .ef-status .ef-dot{background:#f59e0b;box-shadow:0 0 6px #f59e0b}
.expert-face[data-state="speaking"] .ef-status .ef-dot{background:#2e8bff;box-shadow:0 0 6px #2e8bff}
@media (prefers-reduced-motion: reduce){.ef-eyes,.ef-mouth,.ef-ring,.ef-eq rect{animation:none!important}}
`;

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('expert-face-css')) return;
  const s = document.createElement('style');
  s.id = 'expert-face-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Portrait SVG — personnage fictif : peau dégradée, cheveux + barbe courts, casque studio,
// micro à perche, yeux expressifs. Dessiné à la main, lisible en thème sombre.
const PORTRAIT_SVG = `
<svg viewBox="0 0 100 100" role="img" aria-label="Portrait de l'ingénieur du son">
  <defs>
    <radialGradient id="ef-skin" cx="42%" cy="38%" r="70%">
      <stop offset="0%" stop-color="#f3c7a6"/><stop offset="60%" stop-color="#e0ac82"/>
      <stop offset="100%" stop-color="#b9835b"/>
    </radialGradient>
    <linearGradient id="ef-hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3a3029"/><stop offset="100%" stop-color="#15100c"/>
    </linearGradient>
    <linearGradient id="ef-tee" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2b3140"/><stop offset="100%" stop-color="#171b24"/>
    </linearGradient>
    <linearGradient id="ef-cup" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#4b5160"/><stop offset="100%" stop-color="#20242e"/>
    </linearGradient>
  </defs>
  <circle class="ef-ring" cx="50" cy="50" r="46" fill="none" stroke="#7c5cff" stroke-width="2"/>
  <!-- épaules / t-shirt studio -->
  <path d="M18 100 Q22 78 38 72 L62 72 Q78 78 82 100 Z" fill="url(#ef-tee)"/>
  <path d="M44 70 L56 70 L56 78 Q50 82 44 78 Z" fill="#cf9b70"/>
  <!-- cou -->
  <rect x="44" y="62" width="12" height="14" rx="5" fill="#c08f64"/>
  <!-- oreilles -->
  <circle cx="28" cy="46" r="5.5" fill="url(#ef-skin)"/><circle cx="72" cy="46" r="5.5" fill="url(#ef-skin)"/>
  <!-- tête -->
  <path d="M30 42 Q30 20 50 20 Q70 20 70 42 Q70 64 50 66 Q30 64 30 42 Z" fill="url(#ef-skin)"/>
  <!-- ombrage joue droite -->
  <path d="M58 30 Q66 40 62 58 Q56 64 50 65 Q60 52 58 30 Z" fill="#00000018"/>
  <!-- cheveux -->
  <path d="M29 42 Q26 16 50 15 Q74 16 71 42 Q68 30 60 27 Q50 24 40 27 Q32 30 29 42 Z" fill="url(#ef-hair)"/>
  <!-- barbe courte -->
  <path d="M33 48 Q36 66 50 68 Q64 66 67 48 Q64 60 50 61 Q36 60 33 48 Z" fill="#00000026"/>
  <!-- sourcils -->
  <path d="M37 40 Q42 37 46 40" stroke="#2b2017" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M54 40 Q58 37 63 40" stroke="#2b2017" stroke-width="2" fill="none" stroke-linecap="round"/>
  <!-- yeux (calmes, regard posé) -->
  <g class="ef-eyes">
    <ellipse cx="41.8" cy="45" rx="3.1" ry="1.9" fill="#f7f1ea"/>
    <ellipse cx="58.2" cy="45" rx="3.1" ry="1.9" fill="#f7f1ea"/>
    <circle cx="42.2" cy="45.1" r="1.5" fill="#4a3526"/><circle cx="58.6" cy="45.1" r="1.5" fill="#4a3526"/>
    <circle cx="42.7" cy="44.6" r=".45" fill="#fff"/><circle cx="59.1" cy="44.6" r=".45" fill="#fff"/>
    <path d="M38.8 45.4 Q41.8 43.6 44.8 45.4" stroke="#00000022" stroke-width=".8" fill="none"/>
    <path d="M55.2 45.4 Q58.2 43.6 61.2 45.4" stroke="#00000022" stroke-width=".8" fill="none"/>
  </g>
  <!-- nez -->
  <path d="M50 46 L48.4 52.5 Q50 54 51.6 52.5" stroke="#9c6f4a" stroke-width="1.3" fill="none" stroke-linecap="round"/>
  <!-- bouche (léger sourire) -->
  <ellipse class="ef-mouth" cx="50" cy="58.2" rx="4.6" ry="1.9" fill="#8a4a3c"/>
  <path d="M45.5 57.4 Q50 60 54.5 57.4" stroke="#6d382d" stroke-width="1" fill="none" stroke-linecap="round"/>
  <!-- casque studio : arceau + coussinets -->
  <path d="M24 44 Q24 12 50 12 Q76 12 76 44" fill="none" stroke="#11141b" stroke-width="5" stroke-linecap="round"/>
  <rect x="19" y="40" width="12" height="18" rx="5" fill="url(#ef-cup)" stroke="#0c0e14" stroke-width="1"/>
  <rect x="69" y="40" width="12" height="18" rx="5" fill="url(#ef-cup)" stroke="#0c0e14" stroke-width="1"/>
  <!-- micro perche -->
  <path d="M69 52 Q82 56 80 70" stroke="#11141b" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="80" cy="71" r="4" fill="#2b3140" stroke="#0c0e14"/>
  <!-- barres EQ (analyse) -->
  <g class="ef-eq" fill="#7c5cff">
    <rect x="38" y="80" width="2.4" height="10"/><rect x="43" y="80" width="2.4" height="10"/>
    <rect x="48" y="80" width="2.4" height="10"/><rect x="53" y="80" width="2.4" height="10"/>
    <rect x="58" y="80" width="2.4" height="10"/>
  </g>
</svg>`;

const STATUS_TEXT = { idle: 'En ligne', thinking: 'Analyse en cours…', speaking: 'Il te parle…' };

/**
 * Construit la carte avatar. Retourne { el, setState(state), setStatus(text) }.
 * `el` est prêt à insérer dans l'interface.
 */
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
  const setState = (s) => {
    const st = normalizeState(s);
    el.dataset.state = st;
    statusText.textContent = STATUS_TEXT[st];
  };
  const setStatus = (text) => { statusText.textContent = String(text || STATUS_TEXT[el.dataset.state] || ''); };
  return { el, setState, setStatus };
}
