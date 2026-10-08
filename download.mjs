export const MAX_SIZE = 512 * 1024 * 1024;
const PART_SIZE = 40 * 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/;

export function validateRelease(release) {
  if (!release || !Number.isSafeInteger(release.build) || release.build < 1 ||
      !/^\d+\.\d+\.\d+$/.test(release.version) || !Number.isSafeInteger(release.apk_size) ||
      release.apk_size <= 0 || release.apk_size > MAX_SIZE || !digestPattern.test(release.sha256)) {
    throw new Error('Les informations de cette version sont invalides.');
  }
  const path = `android/${release.build}/${release.sha256}.apk`;
  if (release.apk_path !== path) throw new Error('Chemin de téléchargement invalide.');
  const parts = release.apk_parts?.length ? release.apk_parts : [{path, size: release.apk_size, sha256: release.sha256}];
  if (!Array.isArray(parts) || parts.length > 13) throw new Error('Liste des fichiers invalide.');
  let total = 0;
  for (const [index, part] of parts.entries()) {
    const expected = release.apk_parts?.length ? `${path}.part${String(index + 1).padStart(3, '0')}` : path;
    if (part.path !== expected || !Number.isSafeInteger(part.size) || part.size <= 0 ||
        part.size > PART_SIZE || !digestPattern.test(part.sha256)) throw new Error('Fichier de mise à jour invalide.');
    total += part.size;
  }
  if (total !== release.apk_size) throw new Error('La taille des fichiers ne correspond pas à la version.');
  return parts;
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

export function createAPI(config, fetcher = fetch) {
  const origin = new URL(config.url);
  if (origin.protocol !== 'https:' || origin.username || !config.key || config.key.startsWith('sb_secret_')) {
    throw new Error('La page de téléchargement n’est pas configurée.');
  }
  const headers = {'apikey': config.key, 'Content-Type': 'application/json'};
  if (!config.key.startsWith('sb_publishable_')) headers.Authorization = `Bearer ${config.key}`;
  async function post(path, data, signal) {
    const response = await fetcher(new URL(path, origin), {method: 'POST', headers, body: JSON.stringify(data), signal, cache: 'no-store'});
    if (!response.ok) throw new Error('Supabase est indisponible. Réessayez dans quelques instants.');
    return response.json();
  }
  return {
    async latest(signal) {
      const policy = await post('/rest/v1/rpc/get_app_update', {}, signal);
      if (!policy?.release) return null;
      validateRelease(policy.release);
      return policy.release;
    },
    async url(path, signal) {
      const result = await post(`/storage/v1/object/sign/app-releases/${path}`, {expiresIn: 3600}, signal);
      const value = result.signedURL ?? result.signedUrl;
      if (!value || typeof value !== 'string') throw new Error('Lien de téléchargement indisponible.');
      const url = new URL(value.startsWith('/object/') ? `/storage/v1${value}` : value, origin);
      if (url.protocol !== 'https:' || url.origin !== origin.origin) throw new Error('Destination de téléchargement inattendue.');
      return url.href;
    },
  };
}

export async function downloadRelease(release, api, {signal, progress = () => {}, fetcher = fetch} = {}) {
  const parts = validateRelease(release);
  const blobs = [];
  let completed = 0;
  for (const part of parts) {
    const url = await api.url(part.path, signal);
    const response = await fetcher(url, {signal, credentials: 'omit', redirect: 'error'});
    if (!response.ok || !response.body) throw new Error('Téléchargement interrompu. Vérifiez votre connexion puis réessayez.');
    const reader = response.body.getReader();
    const bytes = new Uint8Array(part.size);
    let offset = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        if (offset + value.length > part.size) throw new Error('Le fichier reçu n’a pas la taille attendue.');
        bytes.set(value, offset);
        offset += value.length;
        progress((completed + offset) / release.apk_size, 'download');
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    if (offset !== part.size || await sha256(bytes) !== part.sha256) throw new Error('Le fichier reçu est incomplet ou endommagé. Réessayez.');
    blobs.push(new Blob([bytes]));
    completed += offset;
  }
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
  progress(1, 'verify');
  const apk = new Blob(blobs, {type: 'application/vnd.android.package-archive'});
  blobs.length = 0;
  if (await sha256(await apk.arrayBuffer()) !== release.sha256) throw new Error('L’intégrité de l’APK n’a pas pu être confirmée.');
  if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
  return apk;
}
