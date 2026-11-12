// Registre des tokens : pool mensuel global, quotas individuels, réservations.
//
// Règles (documentées dans docs/QUOTAS.md) :
//  1. Avant chaque appel, on RÉSERVE une quantité majorée (prompt estimé + plafond de sortie
//     envoyé au fournisseur via max_tokens). La vérification et la réservation sont faites dans
//     le même tour de la boucle d'événements Node (pas d'await entre les deux) : deux requêtes
//     simultanées ne peuvent donc pas dépasser le plafond.
//  2. À la fin, on RÈGLE la réservation : débit des tokens réels (champ usage du fournisseur)
//     ou, à défaut, d'une estimation marquée comme telle ; le reste de la réservation est libéré.
//  3. Un règlement est idempotent : une réservation ne peut être débitée qu'une fois.
//  4. Échec AVANT toute sortie (erreur HTTP, 429, réseau) : 0 token débité (le fournisseur ne
//     produit rien). Interruption APRÈS un début de réponse : débit estimé du prompt + du texte
//     produit. Réservation encore ouverte au redémarrage du serveur : débit de la totalité de la
//     réservation, marqué « estimé (interruption serveur) » — c'est la règle la plus prudente.
//  5. Les compteurs sont rangés par mois UTC : au 1er du mois, tout repart de zéro.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class QuotaError extends Error {
  constructor(message, scope, details = {}) { super(message); this.scope = scope; this.status = 402; Object.assign(this, details); }
}

const zero = () => ({ exact: 0, est: 0 });

export class Ledger {
  /**
   * @param {object} o
   * @param {string} o.dir dossier des journaux
   * @param {() => Date} [o.now]
   * @param {() => {pool:number, globalDaily:number}} o.limits
   * @param {(uid:string) => {quota:number, daily:number, unlimited?:boolean}} o.userLimits
   */
  constructor({ dir, now = () => new Date(), limits, userLimits }) {
    this.dir = dir; this.now = now; this.limits = limits; this.userLimits = userLimits;
    fs.mkdirSync(dir, { recursive: true });
    this.months = {};   // 'AAAA-MM' -> { all: {exact, est}, users: {uid: {exact, est}} }
    this.days = {};     // 'AAAA-MM-JJ' -> idem
    this.open = new Map(); // id -> réservation
    this.settled = new Set();
    this.history = [];  // derniers règlements (pour l'affichage)
    this.load();
  }

  month(d = this.now()) { return d.toISOString().slice(0, 7); }
  day(d = this.now()) { return d.toISOString().slice(0, 10); }
  file(month) { return path.join(this.dir, `${month}.jsonl`); }
  append(ev) { fs.appendFileSync(this.file(ev.t.slice(0, 7)), JSON.stringify(ev) + '\n'); }

  bucket(map, key, uid) {
    const b = (map[key] ||= { all: zero(), users: {} });
    return uid ? (b.users[uid] ||= zero()) : b.all;
  }

  applySettle(ev) {
    const kind = ev.exact ? 'exact' : 'est';
    for (const map of [[this.months, ev.rm || ev.t.slice(0, 7)], [this.days, ev.rd || ev.t.slice(0, 10)]]) {
      this.bucket(map[0], map[1])[kind] += ev.tok;
      this.bucket(map[0], map[1], ev.u)[kind] += ev.tok;
    }
    this.settled.add(ev.id);
    this.history.push(ev);
    if (this.history.length > 600) this.history.splice(0, this.history.length - 500);
  }

  load() {
    const files = fs.readdirSync(this.dir).filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().slice(-3);
    const pending = new Map();
    for (const f of files) {
      for (const line of fs.readFileSync(path.join(this.dir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.e === 'R') pending.set(ev.id, ev);
        else if (ev.e === 'S' && !this.settled.has(ev.id)) { pending.delete(ev.id); this.applySettle(ev); }
      }
    }
    // Réservations restées ouvertes (arrêt brutal pendant une requête) : débit prudent de la totalité.
    for (const r of pending.values()) {
      const ev = { e: 'S', id: r.id, t: this.now().toISOString(), rm: r.t.slice(0, 7), rd: r.t.slice(0, 10), u: r.u, exact: false, pt: 0, ct: 0, tok: r.amt,
        reserved: r.amt, outcome: 'interruption-serveur', provider: r.provider, model: r.model, src: r.src };
      this.append(ev);
      this.applySettle(ev);
    }
  }

  reservedFor(uid, month, day) {
    let m = 0, d = 0, mAll = 0, dAll = 0;
    for (const r of this.open.values()) {
      if (r.month === month) { mAll += r.amt; if (r.u === uid) m += r.amt; }
      if (r.day === day) { dAll += r.amt; if (r.u === uid) d += r.amt; }
    }
    return { m, d, mAll, dAll };
  }

  used(map, key, uid) {
    const b = map[key];
    const x = b ? (uid ? b.users[uid] : b.all) : null;
    return x ? x.exact + x.est : 0;
  }

  /** Marge disponible pour un compte (le minimum de toutes les limites qui s'appliquent). */
  room(uid) {
    const month = this.month(), day = this.day();
    const { pool, globalDaily } = this.limits();
    const ul = this.userLimits(uid);
    const r = this.reservedFor(uid, month, day);
    const rooms = [
      { scope: 'pool', left: pool - this.used(this.months, month) - r.mAll },
    ];
    if (!ul.unlimited) rooms.push({ scope: 'user', left: ul.quota - this.used(this.months, month, uid) - r.m });
    if (ul.daily) rooms.push({ scope: 'user-daily', left: ul.daily - this.used(this.days, day, uid) - r.d });
    if (globalDaily) rooms.push({ scope: 'daily', left: globalDaily - this.used(this.days, day) - r.dAll });
    return rooms.reduce((a, b) => (b.left < a.left ? b : a));
  }

  /**
   * Réserve de quoi traiter une requête de chat. Synchrone : la vérification et l'inscription
   * de la réservation sont indivisibles. Renvoie { id, maxTokens, amount }.
   */
  reserveChat(uid, promptEst, wantedOutput, minOutput, meta = {}) {
    const room = this.room(uid);
    const maxTokens = Math.min(wantedOutput, room.left - promptEst);
    if (maxTokens < minOutput) {
      const msg = {
        pool: 'Le pool mensuel de tokens du Studio est épuisé. Il se recharge le 1er du mois prochain.',
        user: 'Votre quota mensuel de tokens est épuisé. Il se recharge le 1er du mois prochain (ou demandez à l’administrateur d’augmenter votre quota).',
        'user-daily': 'Votre limite de tokens du jour est atteinte. Elle se remet à zéro demain.',
        daily: 'La limite journalière de tokens du Studio est atteinte. Réessayez demain.',
      }[room.scope];
      throw new QuotaError(msg, room.scope, { left: Math.max(0, room.left) });
    }
    const amount = promptEst + maxTokens;
    const t = this.now().toISOString();
    const r = { id: 'r' + crypto.randomBytes(8).toString('hex'), u: uid, amt: amount, month: t.slice(0, 7), day: t.slice(0, 10), t, provider: meta.provider, model: meta.model, src: meta.src };
    this.open.set(r.id, r);
    this.append({ e: 'R', id: r.id, t, u: uid, amt: amount, provider: meta.provider, model: meta.model, src: meta.src });
    return { id: r.id, maxTokens, amount };
  }

  /**
   * Règle une réservation. Idempotent : renvoie false si elle a déjà été réglée.
   * @param {{exact:boolean, pt:number, ct:number, tok?:number, outcome:string, provider?:string, platform?:string, model?:string}} res
   */
  settle(id, res) {
    const r = this.open.get(id);
    if (!r || this.settled.has(id)) return false;
    this.open.delete(id);
    const tok = Math.max(0, Math.round(res.tok ?? ((res.pt || 0) + (res.ct || 0))));
    const ev = { e: 'S', id, t: this.now().toISOString(), rm: r.month, rd: r.day, u: r.u, exact: !!res.exact && tok > 0, pt: res.pt || 0, ct: res.ct || 0, tok,
      reserved: r.amt, outcome: res.outcome || 'ok', provider: res.provider || r.provider, platform: res.platform || '', model: res.model || r.model, src: r.src };
    this.append(ev);
    this.applySettle(ev);
    return true;
  }

  /**
   * Reprise unique de la consommation enregistrée avant l'existence du registre (même mois).
   * Chaque entrée garde son statut réel/estimé d'origine. Sans effet si le registre a déjà des données.
   */
  importLegacy(entries) {
    if (fs.readdirSync(this.dir).some(f => f.endsWith('.jsonl'))) return 0;
    let n = 0;
    for (const x of entries) {
      if (!x.tokens || !x.u) continue;
      const ev = { e: 'S', id: 'legacy-' + crypto.randomBytes(6).toString('hex'), t: x.t, rm: x.t.slice(0, 7), rd: x.t.slice(0, 10), u: x.u, exact: !x.est, pt: x.pt || 0, ct: x.ct || 0, tok: x.tokens,
        reserved: 0, outcome: 'reprise-avant-registre', provider: 'freellmapi', platform: x.platform || '', model: x.model || '', src: x.src };
      this.append(ev); this.applySettle(ev); n++;
    }
    return n;
  }

  /** Vue d'ensemble pour le tableau de bord (toutes les valeurs proviennent du registre). */
  snapshot(uids = []) {
    const month = this.month(), day = this.day();
    const { pool, globalDaily } = this.limits();
    const m = this.months[month] || { all: zero(), users: {} };
    const d = this.days[day] || { all: zero(), users: {} };
    let reservedAll = 0, reservedToday = 0;
    const reservedByUser = {};
    for (const r of this.open.values()) {
      if (r.month === month) { reservedAll += r.amt; reservedByUser[r.u] = (reservedByUser[r.u] || 0) + r.amt; }
      if (r.day === day) reservedToday += r.amt;
    }
    const users = {};
    for (const uid of new Set([...uids, ...Object.keys(m.users)])) {
      const mu = m.users[uid] || zero(), du = d.users[uid] || zero(), ul = this.userLimits(uid);
      const consumed = mu.exact + mu.est;
      users[uid] = {
        quota: ul.unlimited ? null : ul.quota, daily: ul.daily || 0, exact: mu.exact, estimated: mu.est, consumed, reserved: reservedByUser[uid] || 0,
        remaining: ul.unlimited ? null : Math.max(0, ul.quota - consumed - (reservedByUser[uid] || 0)), today: du.exact + du.est,
      };
    }
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const k = new Date(this.now().getTime() - i * 86400_000).toISOString().slice(0, 10);
      const b = this.days[k]?.all || zero();
      days.push({ day: k, exact: b.exact, estimated: b.est });
    }
    const consumed = m.all.exact + m.all.est;
    return {
      month, day, resetsAt: new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString(),
      pool, exact: m.all.exact, estimated: m.all.est, consumed, reserved: reservedAll, remaining: Math.max(0, pool - consumed - reservedAll),
      today: { exact: d.all.exact, estimated: d.all.est, consumed: d.all.exact + d.all.est, reserved: reservedToday, cap: globalDaily || 0 },
      openReservations: this.open.size, users, days,
      history: this.history.filter(h => (h.rm || h.t.slice(0, 7)) >= new Date(this.now().getTime() - 62 * 86400_000).toISOString().slice(0, 7)).slice(-200).reverse(),
    };
  }
}
