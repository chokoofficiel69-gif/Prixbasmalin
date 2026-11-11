// Test de bout en bout de l'interface (Chromium headless, micro simulé).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import path from 'node:path';
const B = process.env.BASE || 'http://127.0.0.1:8099';
const A = path.resolve('test/assets');
const OUT = path.resolve('test/.tmp');
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['OK', name]); console.log('✅', name); }
  catch (e) { results.push(['ÉCHEC', name, e.message.split('\n')[0]]); console.log('❌', name, '—', e.message.split('\n')[0]); }
};
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|cdnjs/.test(m.text())) errors.push('console: ' + m.text()); });
page.setDefaultTimeout(20000);
const go = async (hash) => { await page.goto(`${B}/#/${hash}`); await page.waitForTimeout(400); };
const clickText = (t) => page.getByRole('button', { name: t }).first().click();

await step('Connexion', async () => {
  await page.goto(B);
  await page.fill('#login-pass', 'mauvais');
  await page.click('#login-form button');
  await page.getByText('Mot de passe incorrect').waitFor();
  await page.fill('#login-pass', 'test-password-123');
  await page.click('#login-form button');
  await page.locator('#nav a').first().waitFor();
  if ((await page.locator('#nav a').count()) !== 10) throw new Error('menu incomplet');
});

await step('Accueil', async () => {
  await go('accueil');
  await page.getByText('modèles prêts').waitFor();
  await page.screenshot({ path: `${OUT}/01-accueil.png` });
});

await step('Parler aux IA : discussion streamée + pièce jointe image', async () => {
  await go('parler');
  await page.locator('.composer input[type=file], .composer').first().waitFor();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.composer button[title^="Joindre depuis l’appareil"]').click()]);
  await fc.setFiles(`${A}/photo2.jpg`);
  await page.locator('.att-chip').waitFor();
  await page.fill('.composer textarea', 'Bonjour, que vois-tu ?');
  await page.locator('.composer textarea').press('Enter');
  await page.locator('.msg.assistant .meta').getByText('via ovh/gpt-oss-120b').waitFor();
  await page.locator('.msg.assistant pre code').waitFor();
  await page.locator('.conv-list .item').first().waitFor();
  await page.screenshot({ path: `${OUT}/02-chat.png` });
});

await step('Parler aux IA : message vocal (micro → transcription)', async () => {
  await page.locator('.composer button[title^="Message vocal"]').click();
  await page.waitForTimeout(1200);
  await page.locator('.composer button[title^="Message vocal"]').click();
  await page.waitForFunction(() => document.querySelector('.composer textarea').value.includes('Transcription test'));
});

await step('Parler aux IA : comparaison de 3 modèles', async () => {
  await clickText('⚖️ Comparer');
  await clickText('＋ Ajouter un modèle');
  const cols = page.locator('.compare-col');
  if ((await cols.count()) !== 3) throw new Error('3 colonnes attendues');
  await cols.nth(2).locator('select').selectOption('qwen3-32b');
  await page.fill('.composer textarea', 'Compare-vous');
  await page.locator('.composer textarea').press('Enter');
  await page.locator('.compare-col').nth(2).getByText('via ovh/qwen3-32b').waitFor();
  await page.screenshot({ path: `${OUT}/03-comparer.png` });
});

await step('Parler aux IA : mode vocal (écoute → réponse)', async () => {
  await clickText('🎙️ Vocal');
  await page.locator('.voice-orb').click();
  await page.getByText('Je vous écoute').waitFor();
  await page.waitForTimeout(1500);
  await page.locator('.voice-orb').click({ force: true });
  await page.locator('.msg.user').filter({ hasText: 'Transcription test' }).first().waitFor({ timeout: 30000 });
  await page.locator('.msg.assistant .meta').getByText('via').last().waitFor({ timeout: 30000 });
  await clickText('⏹ Terminer la conversation');
});

await step('Agents : équipe dev en mode chef de projet', async () => {
  await go('agents');
  await page.locator('.view select').first().selectOption('dev');
  await page.fill('textarea[placeholder^="Décrivez la tâche"]', 'Script de comparaison de prix');
  await clickText('▶ Lancer l’équipe');
  await page.locator('.step.final .tiny, .step.final header').first().waitFor();
  await page.getByText('Total :').waitFor();
  await page.screenshot({ path: `${OUT}/04-agents.png`, fullPage: true });
});

await step('Images : génération', async () => {
  await go('images');
  await page.fill('textarea', 'Pochette rap nocturne');
  await clickText('✨ Améliorer la description');
  await page.waitForTimeout(500);
  await clickText('🎨 Générer');
  await page.getByText('Créé par pollinations').waitFor();
});

await step('Images : retouche (filtres, texte, export)', async () => {
  await page.getByRole('link', { name: '🖌️ Retoucher' }).first().click();
  await page.locator('canvas.editor-canvas').waitFor({ state: 'visible' });
  await clickText('Cinéma');
  await clickText('⟳ 90°');
  await page.fill('textarea[placeholder^="Texte à ajouter"]', 'TITRE');
  await clickText('＋ Ajouter le texte');
  await clickText('✂️ Recadrer');
  const box = await page.locator('canvas.editor-canvas').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + box.width - 30, box.y + box.height - 30, { steps: 5 }); await page.mouse.up();
  await clickText('✅ Appliquer le recadrage');
  await clickText('💾 Enregistrer');
  await page.getByText('Enregistré dans Fichiers').waitFor();
  await page.screenshot({ path: `${OUT}/05-retouche.png` });
});

await step('Studio musique : composition IA + rendu + export WAV', async () => {
  await go('musique');
  await page.fill('textarea', 'trap sombre');
  await clickText('🎼 Composer avec l’IA');
  await page.getByText('Ambiance sombre de test').waitFor({ timeout: 60000 });
  await page.getByText('Prêt :').waitFor({ timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), clickText('⬇️ WAV')]);
  const p = await dl.path();
  const fs = await import('node:fs');
  const size = fs.statSync(p).size;
  if (size < 100000) throw new Error('WAV trop petit : ' + size);
  fs.copyFileSync(p, `${OUT}/instru.wav`);
  await page.screenshot({ path: `${OUT}/06-musique.png`, fullPage: true });
});

await step('Studio musique : paroles + voix IA', async () => {
  await clickText('✍️ Paroles & refrains');
  await page.fill('input[placeholder^="Thème"]', 'la persévérance');
  await clickText('✍️ Écrire');
  await page.getByText('Écrit via').waitFor();
  await clickText('🗣️ Voix IA');
  await page.fill('textarea', 'Bonjour, ceci est une intro.');
  await clickText('🗣️ Générer la voix');
  await page.locator('audio').first().waitFor();
});

await step('Studio musique → « Poser ma voix dessus »', async () => {
  await clickText('🥁 Instrumentale');
  await clickText('🎙️ Poser ma voix dessus');
  await page.waitForURL(/enregistrement\?beat=/);
  await page.getByText('🥁').first().waitFor();
});

await step('Enregistrement : prise micro + import + débruitage + voix + master', async () => {
  await clickText('⏺ Enregistrer');
  await page.waitForTimeout(2000);
  await clickText('⏹ Arrêter');
  await page.getByText('Prise 1').first().waitFor();
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), clickText('📱 Importer')]);
  await fc.setFiles(`${A}/voice.wav`);
  await page.getByText('voice.wav').first().waitFor();
  await clickText('🧹 Réduire le bruit de fond');
  await page.getByText('Débruitage terminé').waitFor({ timeout: 60000 });
  await clickText('✨ Appliquer');
  await page.getByText('Traitement voix terminé').waitFor({ timeout: 60000 });
  await clickText('🎛️ Mixer + masteriser');
  await page.getByText(/LUFS \(cible -14\)/).waitFor({ timeout: 60000 });
  const info = await page.getByText(/LUFS \(cible/).textContent();
  console.log('   ', info);
  await clickText('💾 Enregistrer le master');
  await page.getByText('Master enregistré').waitFor();
  await page.screenshot({ path: `${OUT}/07-enregistrement.png`, fullPage: true });
});

await step('Vidéos et clips : photos + vidéo + musique + IA + calage + export', async () => {
  await go('clips');
  let [fc] = await Promise.all([page.waitForEvent('filechooser'), clickText('📱 Photos / vidéos')]);
  await fc.setFiles([`${A}/photo1.png`, `${A}/photo2.jpg`, `${A}/clip.webm`]);
  await page.locator('.clip-item').nth(2).waitFor();
  [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '📱 Musique' }).click()]);
  await fc.setFiles(`${OUT}/instru.wav`);
  await page.getByText('🎵 instru.wav').waitFor();
  await clickText('🥁 Caler : 2 temps / plan');
  await page.getByText(/BPM · changement/).waitFor();
  console.log('   ', await page.getByText(/BPM · changement/).textContent());
  await page.fill('input[placeholder^="Idée"]', 'souvenirs');
  await clickText('🤖 Monter avec l’IA');
  await page.getByText('Montage proposé').waitFor();
  await page.fill('textarea[placeholder^="Sous-titres"]', 'Première ligne\nDeuxième ligne');
  await clickText('📝 Sous-titres depuis l’audio');
  await page.waitForFunction(() => document.querySelector('textarea[placeholder^="Sous-titres"]').value.includes('Bonjour le studio'));
  await page.fill('input[placeholder^="Plan vidéo IA"]', 'lac au lever du soleil');
  await clickText('🎥 Générer le plan');
  await page.getByText('Plan vidéo IA ajouté').waitFor();
  await page.screenshot({ path: `${OUT}/08-clips.png`, fullPage: true });
  await clickText('🎬 Exporter la vidéo');
  await page.getByText(/Clip prêt/).waitFor({ timeout: 90000 });
  console.log('   ', await page.getByText(/Clip prêt/).textContent());
  await clickText('💾 Enregistrer dans Fichiers');
  await page.getByText('Clip enregistré').waitFor();
});

await step('Fichiers : liste, filtre, aperçu', async () => {
  await go('fichiers');
  await page.locator('.file-card').first().waitFor();
  await clickText('Tous les projets');
  await clickText('🎞️ Vidéos');
  await page.locator('.file-card .thumb').first().click();
  await page.locator('.modal video').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.modal-back').click({ position: { x: 5, y: 5 } });
  await page.screenshot({ path: `${OUT}/09-fichiers.png` });
});

await step('Mes projets : création + mémoire', async () => {
  await go('projets');
  await page.getByText('Nouveau projet').click();
  await page.locator('.modal input').first().fill('Test projet');
  await clickText('Enregistrer');
  await page.locator('.card h3', { hasText: 'Test projet' }).waitFor();
  await page.getByRole('button', { name: '⚙️ Consignes & mémoire' }).first().click();
  await page.locator('.modal textarea').nth(1).fill('Objectif : 1000 visiteurs/jour');
  await clickText('Enregistrer');
  await page.getByText('Projet enregistré').first().waitFor();
  await page.screenshot({ path: `${OUT}/10-projets.png` });
});

await step('Suivi des tokens', async () => {
  await go('tokens');
  await page.getByText('Modèles utilisés ce mois').waitFor();
  await page.getByText('gpt-oss-120b').first().waitFor();
  await page.screenshot({ path: `${OUT}/11-tokens.png`, fullPage: true });
});

await step('Amis : invitation, première connexion, données séparées', async () => {
  await go('tokens');
  await clickText('＋ Inviter un ami');
  await page.locator('.modal input').first().fill('Lina');
  await clickText('Créer le compte');
  const creds = await page.locator('.modal pre').textContent();
  const pw = /Mot de passe provisoire : (\S+)/.exec(creds)[1];
  const user = /Identifiant : (\S+)/.exec(creds)[1];
  if (user !== 'lina') throw new Error('identifiant inattendu ' + user);
  await page.locator('.modal-back').click({ position: { x: 5, y: 5 } });
  await page.getByText('Lina').first().waitFor();
  await page.screenshot({ path: `${OUT}/15-amis.png`, fullPage: true });
  const f = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  const fp = await f.newPage();
  fp.on('pageerror', (e) => errors.push('ami pageerror: ' + e.message));
  await fp.goto(B);
  await fp.fill('#login-user', 'lina');
  await fp.fill('#login-pass', pw);
  await fp.click('#login-form button');
  await fp.getByText('Choisissez votre mot de passe').waitFor();
  await fp.locator('.modal input').nth(0).fill(pw);
  await fp.locator('.modal input').nth(1).fill('mot-de-passe-lina');
  await fp.getByRole('button', { name: 'Valider' }).click();
  await fp.getByText('Mot de passe enregistré').waitFor();
  await fp.getByText('Bonjour Lina').or(fp.getByText('Bonsoir Lina')).first().waitFor();
  await fp.goto(`${B}/#/parler`);
  await fp.locator('.conv-list').getByText('Aucune conversation').waitFor();
  await fp.goto(`${B}/#/tokens`);
  await fp.getByText('Ma consommation du jour').waitFor();
  if (await fp.getByText('Amis et accès').count()) throw new Error('un ami voit la gestion des comptes');
  await fp.screenshot({ path: `${OUT}/16-ami-vue.png` });
  await f.close();
});

await step('Mobile (iPhone) : menu + chat', async () => {
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(B);
  await mp.fill('#login-pass', 'test-password-123');
  await mp.click('#login-form button');
  await mp.locator('#menu-btn').click();
  await mp.screenshot({ path: `${OUT}/12-mobile-menu.png` });
  await mp.getByRole('link', { name: /PARLER/ }).click();
  await mp.fill('.composer textarea', 'Salut depuis le téléphone');
  await mp.getByRole('button', { name: '➤' }).click();
  await mp.locator('.msg.assistant .meta').getByText('via').waitFor();
  await mp.screenshot({ path: `${OUT}/13-mobile-chat.png` });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error('défilement horizontal sur mobile');
  for (const v of ['clips', 'musique', 'enregistrement', 'tokens']) {
    await mp.goto(`${B}/#/${v}`); await mp.waitForTimeout(600);
    const o = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (o) throw new Error('défilement horizontal sur mobile : ' + v);
  }
  await mp.screenshot({ path: `${OUT}/14-mobile-musique.png` });
  await m.close();
});

console.log('\nErreurs JS :', errors.length ? errors : 'aucune');
console.log(`Résultat : ${results.filter(r => r[0] === 'OK').length}/${results.length} OK`);
await browser.close();
