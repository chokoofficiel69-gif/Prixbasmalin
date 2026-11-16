// Ingé son IA — avatar humanoïde animé de Marco.
// Portrait vectoriel original : aucune photo, aucun service externe, aucun coût réseau.
// Les helpers purs restent testables sous Node.
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
.expert-face{display:flex;gap:12px;align-items:center;min-width:0}
.expert-face .ef-portrait{width:118px;height:138px;flex:0 0 auto;border-radius:16px;overflow:hidden;position:relative;
  background:radial-gradient(100% 90% at 50% 24%,#1b4260 0%,#10182b 58%,#080d19 100%);
  border:1px solid rgba(72,210,255,.55);box-shadow:0 0 24px rgba(34,211,238,.24),inset 0 0 22px rgba(34,211,238,.08)}
.expert-face .ef-portrait:after{content:'';position:absolute;inset:5px;border:1px solid rgba(106,190,255,.12);border-radius:12px;pointer-events:none}
.expert-face .ef-portrait svg{width:100%;height:100%;display:block}
.expert-face .ef-meta{min-width:0}
.expert-face .ef-name{font-weight:800;letter-spacing:.2px}
.expert-face .ef-role{opacity:.72;font-size:12px;line-height:1.25}
.expert-face .ef-status{display:inline-flex;align-items:center;gap:6px;font-size:11px;margin-top:5px;opacity:.95}
.expert-face .ef-dot{width:8px;height:8px;border-radius:50%;background:#22e39a;box-shadow:0 0 7px #22e39a}
.ef-head-group{transform-box:fill-box;transform-origin:50% 90%;animation:ef-idle 5s ease-in-out infinite}
@keyframes ef-idle{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-1.2px) rotate(.6deg)}}
.ef-eyelids{transform-box:fill-box;transform-origin:center;animation:ef-blink 5.8s infinite}
@keyframes ef-blink{0%,45%,48%,100%{transform:scaleY(0)}46.5%{transform:scaleY(1)}}
.ef-mouth-open{opacity:0;transform-box:fill-box;transform-origin:center}
.expert-face[data-state="speaking"] .ef-mouth-closed{opacity:0}
.expert-face[data-state="speaking"] .ef-mouth-open{opacity:1;animation:ef-talk .22s infinite alternate}
@keyframes ef-talk{from{transform:scaleY(.65)}to{transform:scaleY(1.15)}}
.ef-ring{opacity:0;transform-box:fill-box;transform-origin:center}
.expert-face[data-state="thinking"] .ef-ring{opacity:1;animation:ef-pulse 1.5s infinite ease-out}
@keyframes ef-pulse{0%{transform:scale(.88);opacity:.6}100%{transform:scale(1.13);opacity:0}}
.ef-scan{opacity:0}
.expert-face[data-state="thinking"] .ef-scan{opacity:.7;animation:ef-scan 2s linear infinite}
@keyframes ef-scan{from{transform:translateY(-55px)}to{transform:translateY(145px)}}
.expert-face[data-state="thinking"] .ef-dot{background:#f5a623;box-shadow:0 0 7px #f5a623}
.expert-face[data-state="speaking"] .ef-dot{background:#22d3ee;box-shadow:0 0 7px #22d3ee}
@media (prefers-reduced-motion:reduce){.ef-head-group,.ef-eyelids,.ef-mouth-open,.ef-ring,.ef-scan{animation:none!important}}
`;

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('expert-face-css')) return;
  const s = document.createElement('style');
  s.id = 'expert-face-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// Portrait humain stylisé : visage, cheveux, yeux, nez, bouche, cou, épaules et casque studio.
const PORTRAIT_SVG = `
<svg viewBox="0 0 120 140" role="img" aria-label="Portrait humanoïde de Marco, ingénieur du son IA" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ef-skin" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f0c6a5"/><stop offset=".55" stop-color="#c98f72"/><stop offset="1" stop-color="#8d5d54"/></linearGradient>
    <linearGradient id="ef-hair" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#29364c"/><stop offset="1" stop-color="#090f1c"/></linearGradient>
    <linearGradient id="ef-jacket" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#263e5b"/><stop offset="1" stop-color="#101a2c"/></linearGradient>
    <linearGradient id="ef-glow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a6f1ff"/><stop offset="1" stop-color="#278bd0"/></linearGradient>
    <clipPath id="ef-screen-clip"><rect width="120" height="140" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#ef-screen-clip)">
    <circle cx="60" cy="56" r="48" fill="none" stroke="#36c8f5" stroke-opacity=".18"/>
    <circle class="ef-ring" cx="60" cy="55" r="49" fill="none" stroke="#54ddff" stroke-width="1.5"/>
    <path d="M8 142 Q12 108 39 103 L81 103 Q108 108 112 142Z" fill="url(#ef-jacket)" stroke="#4a9bc8" stroke-opacity=".45"/>
    <path d="M45 91 L75 91 L78 112 Q60 124 42 112Z" fill="url(#ef-skin)"/>
    <path d="M42 105 L60 119 L78 105 L91 113 L75 140 L45 140 L29 113Z" fill="#142a43"/>
    <path d="M50 110 L60 119 L70 110 L66 140 L54 140Z" fill="#d6e7f4" opacity=".9"/>
    <g class="ef-head-group">
      <!-- Oreille et visage -->
      <path d="M32 51 Q25 48 27 61 Q29 72 38 70 L40 55Z" fill="url(#ef-skin)"/>
      <path d="M88 51 Q95 48 93 61 Q91 72 82 70 L80 55Z" fill="url(#ef-skin)"/>
      <path d="M34 36 Q35 15 60 14 Q85 15 86 38 L83 68 Q78 91 60 96 Q42 91 37 68Z" fill="url(#ef-skin)" stroke="#f0c3a1" stroke-opacity=".4"/>
      <!-- Cheveux et ligne frontale -->
      <path d="M33 49 Q26 27 40 15 Q53 4 73 12 Q91 18 88 45 L83 38 Q79 29 70 28 Q56 33 42 27 L38 47Z" fill="url(#ef-hair)"/>
      <path d="M39 25 Q54 18 68 23 Q78 24 84 34 Q70 29 61 31 Q48 33 39 29Z" fill="#40516a" opacity=".7"/>
      <!-- Sourcils -->
      <path d="M42 48 Q49 43 55 47" fill="none" stroke="#45332f" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M65 47 Q72 43 78 48" fill="none" stroke="#45332f" stroke-width="2.6" stroke-linecap="round"/>
      <!-- Yeux -->
      <path d="M42 54 Q49 49 56 54 Q49 60 42 54Z" fill="#f5eee8"/>
      <path d="M64 54 Q71 49 78 54 Q71 60 64 54Z" fill="#f5eee8"/>
      <ellipse cx="49" cy="54" rx="2.5" ry="3.1" fill="#3d8c9c"/>
      <ellipse cx="71" cy="54" rx="2.5" ry="3.1" fill="#3d8c9c"/>
      <circle cx="49.8" cy="53.3" r=".9" fill="#fff"/><circle cx="71.8" cy="53.3" r=".9" fill="#fff"/>
      <path class="ef-eyelids" d="M41 53 Q49 47 57 53 L57 57 Q49 62 41 57Z M63 53 Q71 47 79 53 L79 57 Q71 62 63 57Z" fill="#bd826c"/>
      <!-- Nez -->
      <path d="M59 54 Q57 66 54 70 Q60 74 66 70" fill="none" stroke="#9b6258" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M55 70 Q60 72 65 70" fill="none" stroke="#f0c0a0" stroke-width="1"/>
      <!-- Bouche -->
      <path class="ef-mouth-closed" d="M51 80 Q60 84 69 80" fill="none" stroke="#713f43" stroke-width="2" stroke-linecap="round"/>
      <ellipse class="ef-mouth-open" cx="60" cy="81" rx="5.4" ry="4.2" fill="#542d36" stroke="#f0b5a0" stroke-width="1"/>
      <path d="M56 80 Q60 82 64 80" fill="none" stroke="#f6d5c4" stroke-width="1"/>
      <!-- Ombres de barbe discrètes -->
      <path d="M43 78 Q46 91 60 93 Q74 91 77 78" fill="none" stroke="#77524d" stroke-opacity=".34" stroke-width="4" stroke-linecap="round"/>
      <!-- Casque studio -->
      <path d="M28 55 Q22 13 60 9 Q98 13 92 55" fill="none" stroke="#111d2c" stroke-width="6" stroke-linecap="round"/>
      <path d="M28 52 Q24 17 60 13 Q96 17 92 52" fill="none" stroke="#36c8f5" stroke-opacity=".8" stroke-width="1.4"/>
      <rect x="23" y="48" width="10" height="22" rx="4" fill="#172b43" stroke="#43c9ef" stroke-width="1.2"/>
      <rect x="87" y="48" width="10" height="22" rx="4" fill="#172b43" stroke="#43c9ef" stroke-width="1.2"/>
      <path d="M91 68 Q91 83 78 84" fill="none" stroke="#3bc8f0" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="77" cy="84" r="2" fill="#74e7ff"/>
    </g>
    <!-- Ligne de scan réservée à l'état d'analyse -->
    <rect class="ef-scan" x="8" y="0" width="104" height="1.5" fill="url(#ef-glow)"/>
    <path d="M13 125 H30 M90 125 H107" stroke="#42c9f0" stroke-opacity=".45"/>
    <circle cx="60" cy="125" r="2" fill="#56dfff"/>
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
