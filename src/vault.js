// Unlocks assets/locked/bundle.bin (made by tools/lock_assets.py) with the
// access code. The key is derived with PBKDF2-SHA256 and the bundle is
// AES-256-GCM, so a wrong code simply fails to decrypt.
//
// "Remember on this device" stores the derived key (never the code) in a
// cookie scoped to the app's path.
(function (root) {
  const BUNDLE_URL = "assets/locked/bundle.bin";
  const COOKIE = "lmch_security_key";
  const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // browsers cap cookies at 400 days

  const b64 = {
    decode: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
    encode: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))),
  };

  let bundle = null; // { header, ciphertext }
  const files = new Map(); // path -> { type, bytes }
  const urls = new Map();

  async function loadBundle() {
    if (bundle) return bundle;
    const res = await fetch(BUNDLE_URL);
    if (!res.ok) throw new Error(`Couldn't load the app data (${res.status}).`);
    const buf = await res.arrayBuffer();
    const headerLen = new DataView(buf).getUint32(0);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLen)));
    bundle = { header, ciphertext: new Uint8Array(buf, 4 + headerLen) };
    return bundle;
  }

  async function deriveKey(code) {
    const { header } = await loadBundle();
    const base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(code.normalize("NFKC").trim()), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: b64.decode(header.salt), iterations: header.iterations },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }

  async function open(key) {
    const { header, ciphertext } = await loadBundle();
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.decode(header.iv) }, key, ciphertext);
    } catch {
      return false; // wrong code, or the bundle was re-encrypted with a new code
    }
    const manifestLen = new DataView(plain).getUint32(0);
    const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(plain, 4, manifestLen)));
    const start = 4 + manifestLen;
    for (const e of manifest) {
      files.set(e.path, { type: e.type, bytes: new Uint8Array(plain, start + e.offset, e.length) });
    }
    return true;
  }

  function cookiePath() {
    return location.pathname.replace(/[^/]*$/, "") || "/";
  }

  function rememberKey(raw) {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE}=${b64.encode(raw)}; Max-Age=${COOKIE_MAX_AGE}; Path=${cookiePath()}; SameSite=Strict${secure}`;
  }

  function forgetKey() {
    document.cookie = `${COOKIE}=; Max-Age=0; Path=${cookiePath()}; SameSite=Strict`;
  }

  function rememberedKey() {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  const Vault = {
    isSupported: () => !!(root.crypto && crypto.subtle),

    // Try the key saved in the cookie. Resolves true if it opened the bundle.
    async unlockRemembered() {
      const saved = rememberedKey();
      if (!saved) return false;
      try {
        const key = await crypto.subtle.importKey("raw", b64.decode(saved), "AES-GCM", false, ["decrypt"]);
        if (await open(key)) return true;
      } catch { /* malformed cookie */ }
      forgetKey();
      return false;
    },

    async unlock(code, remember) {
      const key = await deriveKey(code);
      if (!(await open(key))) return false;
      if (remember) rememberKey(await crypto.subtle.exportKey("raw", key));
      else forgetKey();
      return true;
    },

    lock() {
      forgetKey();
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
      files.clear();
    },

    has: (path) => files.has(path),
    bytes(path) {
      const f = files.get(path);
      if (!f) throw new Error(`Missing ${path}`);
      return f.bytes;
    },
    text: (path) => new TextDecoder().decode(Vault.bytes(path)),
    url(path) {
      if (!urls.has(path)) {
        const f = files.get(path);
        if (!f) throw new Error(`Missing ${path}`);
        urls.set(path, URL.createObjectURL(new Blob([f.bytes], { type: f.type })));
      }
      return urls.get(path);
    },
  };

  root.Vault = Vault;
})(this);
