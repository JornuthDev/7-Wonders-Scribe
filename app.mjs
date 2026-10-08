import {createAPI, downloadRelease} from './download.mjs';
import {config} from './config.mjs';
const $ = id => document.getElementById(id);
let api, release, active, objectURL;
let busy = false;
const sizeLabel = size => `${(size / 1024 / 1024).toLocaleString('fr-FR', {maximumFractionDigits: 1})} Mo`;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function showNotes(notes) {
  $('notes').replaceChildren();
  for (const category of ['Design', 'Features', 'Correctifs', 'Performances', 'Autres']) {
    if (!Array.isArray(notes?.[category]) || !notes[category].length) continue;
    const title = document.createElement('h3'); title.textContent = category;
    const list = document.createElement('ul');
    for (const text of notes[category]) {
      const item = document.createElement('li'); item.textContent = text; list.append(item);
    }
    $('notes').append(title, list);
  }
  $('release-notes').hidden = !$('notes').children.length;
}
async function load() {
  $('retry').hidden = true;
  $('download').disabled = true;
  status('Recherche de la dernière version…');
  try {
    if (!crypto?.subtle) throw new Error('Ouvrez cette page en HTTPS dans Chrome ou Firefox.');
    api = createAPI(config);
    release = await api.latest(AbortSignal.timeout(15000));
    if (!release) { status('La première version sera bientôt disponible.'); return; }
    $('version').textContent = `Version ${release.version} · build ${release.build}`;
    $('size').textContent = `Android · ${sizeLabel(release.apk_size)}`;
    showNotes(release.patch_notes);
    $('download').disabled = false;
    status('Téléchargez l’application, puis ouvrez le fichier APK sur votre téléphone Android.');
  } catch (error) { status(error.name === 'TimeoutError' ? 'Le serveur ne répond pas. Réessayez.' : error.message, true); $('retry').hidden = false; }
}
$('download').addEventListener('click', async () => {
  if (busy || !release) return;
  busy = true;
  active = new AbortController();
  $('download').disabled = true;
  $('retry').hidden = true;
  $('save').hidden = true;
  $('cancel').hidden = false;
  $('progress').hidden = false;
  $('progress').value = 0;
  if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
  let last = -1;
  try {
    const apk = await downloadRelease(release, api, {signal: active.signal, progress(value, phase) {
      const percent = Math.floor(value * 100);
      $('progress').value = value;
      if (phase === 'verify') status('Vérification de l’application…');
      else if (percent !== last) { last = percent; status(`Téléchargement : ${percent} % — gardez cette page ouverte.`); }
    }});
    objectURL = URL.createObjectURL(apk);
    $('save').href = objectURL;
    $('save').download = `7-wonders-scribe-${release.version}-${release.build}.apk`;
    $('save').hidden = false;
    status('Votre APK est prêt. Appuyez sur « Enregistrer l’APK », puis ouvrez-le depuis vos téléchargements.');
  } catch (error) {
    status(error.name === 'AbortError' ? 'Téléchargement annulé.' : error.message || 'Téléchargement impossible. Réessayez dans Chrome sur Android.', error.name !== 'AbortError');
  } finally {
    busy = false;
    active = null;
    $('cancel').hidden = true;
    $('progress').hidden = true;
    $('download').disabled = false;
  }
});
$('cancel').addEventListener('click', () => active?.abort());
$('retry').addEventListener('click', load);
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('https://jornuthdev.github.io/7-Wonders-Scribe/'); $('copy').textContent = 'Lien copié'; }
  catch (_) { $('copy').textContent = 'Copiez l’adresse de cette page'; }
});
load();
