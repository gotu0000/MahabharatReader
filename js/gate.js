// Entry page logic. Three cases on load:
//   1. No encryption.json on the server → site is unencrypted. Skip the
//      gate and go straight to the reader.
//   2. encryption.json present + cached key validates → already unlocked,
//      redirect to the reader.
//   3. encryption.json present + no valid cached key → show the prompt.

(function applyStoredTheme() {
  const t = localStorage.getItem('reader_theme');
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
  }
})();

(async function init() {
  const form = document.getElementById('gateForm');
  const input = document.getElementById('gateInput');
  const button = document.getElementById('gateSubmit');
  const status = document.getElementById('gateStatus');

  function setStatus(text, isError) {
    status.textContent = text;
    status.classList.toggle('gate__status--error', !!isError);
  }

  const config = await loadEncryptionConfig();
  if (!config) {
    window.location.replace('reader.html');
    return;
  }

  const cached = await loadCachedKey();
  if (cached && (await verifyKeyAgainstConfig(cached, config))) {
    window.location.replace('reader.html');
    return;
  }
  if (cached) await clearCachedKey();

  form.hidden = false;
  input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = input.value;
    if (!pass) {
      setStatus('Enter your passphrase.', true);
      return;
    }
    button.disabled = true;
    setStatus('Unlocking…');
    try {
      const salt = b64ToBytes(config.salt);
      const key = await deriveKey(pass, salt);
      const ok = await verifyKeyAgainstConfig(key, config);
      if (!ok) {
        setStatus('Incorrect passphrase.', true);
        input.value = '';
        input.focus();
        return;
      }
      await storeCachedKey(key);
      input.value = '';
      window.location.replace('reader.html');
    } catch (err) {
      setStatus('Error: ' + err.message, true);
    } finally {
      button.disabled = false;
    }
  });
})();
