// Encryption tool UI glue. Crypto logic lives in /js/crypto.js.

function setStatus(el, text, isError) {
  el.textContent = text;
  el.classList.toggle('error', !!isError);
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
    const salt = crypto.getRandomValues(new Uint8Array(CRYPTO.saltBytes));
    const key = await deriveKey(p1, salt);
    const verify = await encryptText(key, CRYPTO.verifyToken);
    const config = {
      v: CRYPTO.envelopeVersion,
      kdf: 'PBKDF2-SHA256',
      iterations: CRYPTO.iterations,
      salt: bytesToB64(salt),
      verify: { iv: verify.iv, ct: verify.ct },
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
    if (config.kdf !== 'PBKDF2-SHA256' || config.iterations !== CRYPTO.iterations) {
      return setStatus(verifyStatus, 'Unsupported encryption.json (KDF or iteration mismatch).', true);
    }
    const salt = b64ToBytes(config.salt);
    const key = await deriveKey(pass, salt);
    const ok = await verifyKeyAgainstConfig(key, config);
    if (!ok) return setStatus(verifyStatus, 'Incorrect passphrase.', true);

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
