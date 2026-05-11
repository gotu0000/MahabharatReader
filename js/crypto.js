// Shared crypto helpers and constants. Loaded by the gate, the reader,
// and the encrypt tool. These constants MUST stay in sync across all
// callers — a mismatch silently breaks decryption.

const CRYPTO = {
  kdf: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 600000,
  saltBytes: 32,
  ivBytes: 12,
  keyBits: 256,
  verifyToken: 'mb-ok',
  envelopeVersion: 1,
};

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: CRYPTO.kdf },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: CRYPTO.kdf, salt, iterations: CRYPTO.iterations, hash: CRYPTO.hash },
    baseKey,
    { name: 'AES-GCM', length: CRYPTO.keyBits },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(CRYPTO.ivBytes));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  );
  return {
    v: CRYPTO.envelopeVersion,
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ct)),
  };
}

async function decryptEnvelope(key, envelope) {
  const iv = b64ToBytes(envelope.iv);
  const ct = b64ToBytes(envelope.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function verifyKeyAgainstConfig(key, config) {
  try {
    const token = await decryptEnvelope(key, config.verify);
    return token === CRYPTO.verifyToken;
  } catch {
    return false;
  }
}

async function loadEncryptionConfig(path) {
  const url = path || 'parts/encryption.json';
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// IndexedDB cache for the derived key. Stores a non-extractable
// CryptoKey via structured cloning. Cleared when the user wipes
// browsing data.

const KEY_DB = 'reader_keys';
const KEY_STORE = 'keys';
const KEY_ID = 'active';

function openKeyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(KEY_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadCachedKey() {
  try {
    const db = await openKeyDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const req = tx.objectStore(KEY_STORE).get(KEY_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function storeCachedKey(key) {
  try {
    const db = await openKeyDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).put(key, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function clearCachedKey() {
  try {
    const db = await openKeyDB();
    await new Promise((resolve) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).delete(KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}
