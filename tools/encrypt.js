// Encryption tool for Mahabharata Reader content.
// Constants here MUST match the reader's decrypt code (planned for step 2).

const KDF = 'PBKDF2';
const HASH = 'SHA-256';
const ITERATIONS = 600000;
const SALT_BYTES = 32;
const IV_BYTES = 12;
const KEY_BITS = 256;
const VERIFY_TOKEN = 'mb-ok';
const ENVELOPE_VERSION = 1;

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
    { name: KDF },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: KDF, salt, iterations: ITERATIONS, hash: HASH },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  );
  return {
    v: ENVELOPE_VERSION,
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ct))
  };
}

async function decryptEnvelope(key, envelope) {
  const iv = b64ToBytes(envelope.iv);
  const ct = b64ToBytes(envelope.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setStatus(el, text, isError) {
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

// Mode A: setup
const setupBtn = document.getElementById('setup-btn');
const setupPass1 = document.getElementById('setup-pass1');
const setupPass2 = document.getElementById('setup-pass2');
const setupStatus = document.getElementById('setup-status');

setupBtn.addEventListener('click', async () => {
  const p1 = setupPass1.value;
  const p2 = setupPass2.value;
  if (!p1) return setStatus(setupStatus, 'Passphrase required.', true);
  if (p1 !== p2) return setStatus(setupStatus, 'Passphrases do not match.', true);
  if (p1.length < 8) return setStatus(setupStatus, 'Use at least 8 characters.', true);

  setupBtn.disabled = true;
  setStatus(setupStatus, 'Deriving key…');
  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const key = await deriveKey(p1, salt);
    const verify = await encryptText(key, VERIFY_TOKEN);
    const config = {
      v: ENVELOPE_VERSION,
      kdf: 'PBKDF2-SHA256',
      iterations: ITERATIONS,
      salt: bytesToB64(salt),
      verify: { iv: verify.iv, ct: verify.ct }
    };
    downloadBlob('encryption.json', JSON.stringify(config, null, 2), 'application/json');
    setStatus(setupStatus, 'Saved encryption.json. Place it at parts/encryption.json in the repo.');
    setupPass1.value = '';
    setupPass2.value = '';
  } catch (err) {
    setStatus(setupStatus, 'Error: ' + err.message, true);
  } finally {
    setupBtn.disabled = false;
  }
});

// Mode B: encrypt files
const configInput = document.getElementById('config-input');
const encryptPass = document.getElementById('encrypt-pass');
const verifyBtn = document.getElementById('verify-btn');
const verifyStatus = document.getElementById('verify-status');
const filesSection = document.getElementById('files-section');
const filesInput = document.getElementById('files-input');
const encryptStatus = document.getElementById('encrypt-status');

let activeKey = null;

function resetActiveKey() {
  activeKey = null;
  filesSection.hidden = true;
  encryptStatus.textContent = '';
}

configInput.addEventListener('change', resetActiveKey);
encryptPass.addEventListener('input', resetActiveKey);

verifyBtn.addEventListener('click', async () => {
  resetActiveKey();
  const file = configInput.files[0];
  const pass = encryptPass.value;
  if (!file) return setStatus(verifyStatus, 'Pick an encryption.json file.', true);
  if (!pass) return setStatus(verifyStatus, 'Enter your passphrase.', true);

  verifyBtn.disabled = true;
  setStatus(verifyStatus, 'Verifying…');
  try {
    const text = await file.text();
    const config = JSON.parse(text);
    if (config.kdf !== 'PBKDF2-SHA256' || config.iterations !== ITERATIONS) {
      return setStatus(verifyStatus, 'Unsupported encryption.json (KDF or iteration mismatch).', true);
    }
    const salt = b64ToBytes(config.salt);
    const key = await deriveKey(pass, salt);
    let token;
    try {
      token = await decryptEnvelope(key, config.verify);
    } catch {
      return setStatus(verifyStatus, 'Incorrect passphrase.', true);
    }
    if (token !== VERIFY_TOKEN) {
      return setStatus(verifyStatus, 'Incorrect passphrase.', true);
    }
    activeKey = key;
    setStatus(verifyStatus, 'Key verified. Select files below.');
    filesSection.hidden = false;
    encryptPass.value = '';
  } catch (err) {
    setStatus(verifyStatus, 'Error: ' + err.message, true);
  } finally {
    verifyBtn.disabled = false;
  }
});

filesInput.addEventListener('change', async () => {
  if (!activeKey) return;
  const files = Array.from(filesInput.files);
  if (!files.length) return;

  setStatus(encryptStatus, `Encrypting ${files.length} file(s)…`);
  try {
    let done = 0;
    for (const f of files) {
      const text = await f.text();
      const envelope = await encryptText(activeKey, text);
      downloadBlob(f.name + '.enc', JSON.stringify(envelope), 'application/json');
      done++;
      setStatus(encryptStatus, `Encrypted ${done}/${files.length}…`);
    }
    setStatus(encryptStatus, `Encrypted ${files.length} file(s). Check your downloads folder.`);
    filesInput.value = '';
  } catch (err) {
    setStatus(encryptStatus, 'Error: ' + err.message, true);
  }
});
