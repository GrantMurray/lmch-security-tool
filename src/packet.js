"use strict";

// The shift packet: citations, incident reports and photos added during the
// shift, waiting to be submitted with the shift report. Kept in IndexedDB (localStorage is too
// small for PDFs and pictures) until the packet is submitted and cleared, so
// it survives closing the app mid-shift.
//
// Document entries: { id, type: "citation" or "incident", label (e.g.
//                     "Citation 001-100000"), name: file name, summary: one
//                     line for the list, bytes: PDF, addedAt }
// Photo entries:    { id: "photo-…", type: "photo", doc: id of the document
//                     it goes with, or null for a shift photo, label,
//                     bytes: JPEG, width, height, addedAt }
const Packet = (() => {
  const DB_NAME = "st-packet";
  const STORE = "citations"; // holds everything; the name predates the rest
  const listeners = new Set();
  let dbPromise = null;

  function db() {
    dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  // Runs fn(store) in a transaction; resolves with its request's result.
  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }

  async function change(fn) {
    await run("readwrite", fn);
    listeners.forEach((f) => f());
  }

  const isPhoto = (item) => item.type === "photo";

  // Adding a document that's already in the packet replaces it.
  const add = (entry) => change((s) => s.put({ ...entry, addedAt: Date.now() }));
  const removeMany = (ids) => change((s) => { let req; for (const id of ids) req = s.delete(id); return req; });
  const has = async (id) => (await run("readonly", (s) => s.count(id))) > 0;
  async function list() {
    const all = await run("readonly", (s) => s.getAll());
    return all.sort((a, b) => a.addedAt - b.addedAt);
  }

  // ---- Photos ----------------------------------------------------------------
  // Phone photos are several MB each; they're stored as JPEGs no larger than
  // PHOTO_MAX px on the long side, which is plenty for a printed page.

  const PHOTO_MAX = 1600;
  const PHOTO_QUALITY = 0.82;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} isn't a picture this browser can open`)); };
      img.src = url; // drawn upright: browsers apply the photo's orientation
    });
  }

  async function shrink(file) {
    const img = await loadImage(file);
    const k = Math.min(1, PHOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
    if (!blob) throw new Error(`Couldn't read ${file.name}`);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
  }

  async function addPhotos(files, { doc = null, label }) {
    const now = Date.now();
    const entries = [];
    for (const [i, file] of [...files].entries()) {
      entries.push({
        id: `photo-${now}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        type: "photo", doc, label, ...(await shrink(file)), addedAt: now + i,
      });
    }
    if (entries.length) await change((s) => { let req; for (const e of entries) req = s.put(e); return req; });
    return entries.length;
  }

  // Small previews with a remove button, for the photo lists in both tools.
  const thumbUrls = new WeakMap(); // container -> object URLs to revoke
  function renderThumbs(container, photos) {
    (thumbUrls.get(container) || []).forEach((u) => URL.revokeObjectURL(u));
    const urls = [];
    container.innerHTML = "";
    for (const [i, p] of photos.entries()) {
      const url = URL.createObjectURL(new Blob([p.bytes], { type: "image/jpeg" }));
      urls.push(url);
      const fig = document.createElement("figure");
      fig.className = "photo-thumb";
      const img = document.createElement("img");
      img.src = url;
      img.alt = `${p.label}, photo ${i + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "photo-remove";
      remove.textContent = "×";
      remove.ariaLabel = `Remove photo ${i + 1}`;
      remove.addEventListener("click", async () => {
        if (confirm("Remove this photo from the packet?")) await removeMany([p.id]);
      });
      fig.append(img, remove);
      container.append(fig);
    }
    thumbUrls.set(container, urls);
  }

  // ---- Add to packet ---------------------------------------------------------
  // The "Add to packet" button and photo picker of a document tool (citation,
  // incident report). Its elements are #<prefix>-packet-btn, -photos-box,
  // -photos, -photo-btn, -photo-input and -photo-hint.
  //   status:   element for messages
  //   idle():   resolves true once the tool's PDF is up to date
  //   current(): { id, type, label, summary, file } of the document as it is
  //   onAdded(), onPhotos(): called after adding the document / photos
  //   next:     what to say after adding, e.g. "Tap New citation for the next one."
  // The tool calls edited() when the document changes (it then needs adding
  // again) and built(id) after each PDF build.
  function controls({ prefix, status, idle, current, onAdded, onPhotos, next }) {
    const el = (name) => document.getElementById(`${prefix}-${name}`);
    const btn = el("packet-btn"), box = el("photos-box"), thumbs = el("photos");
    const photoBtn = el("photo-btn"), input = el("photo-input"), hint = el("photo-hint");
    const idleHint = hint.textContent;
    let id = null, inPacket = false, photosFor = null;

    async function show() {
      // Hidden until the tool has made its first PDF (or with no packet).
      btn.hidden = box.hidden = !("indexedDB" in window) || id === null;
      if (btn.hidden) return;
      let items = [];
      try { items = await list(); } catch (err) { console.error(err); }
      const stored = items.some((i) => i.id === id);
      btn.textContent = stored ? (inPacket ? "✓ In packet" : "Update in packet") : "Add to packet";
      btn.classList.toggle("secondary", stored && inPacket);
      if (photosFor !== id) {
        photosFor = id;
        hint.className = "hint";
        hint.textContent = idleHint;
      }
      renderThumbs(thumbs, items.filter((p) => isPhoto(p) && p.doc === id));
    }

    async function addDoc() {
      btn.disabled = true;
      try {
        if (!(await idle())) throw new Error("the PDF couldn't be made");
        const doc = current();
        await add({
          id: doc.id, type: doc.type, label: doc.label, name: doc.file.name, summary: doc.summary,
          bytes: new Uint8Array(await doc.file.arrayBuffer()),
        });
        inPacket = true;
        onAdded?.();
        const n = (await list()).filter((i) => !isPhoto(i)).length;
        status.textContent = `${doc.label} is in the shift packet (${n} in the packet so far). ${next}`;
      } catch (err) {
        console.error(err);
        status.textContent = `Couldn't add to the packet: ${err.message}`;
      } finally {
        btn.disabled = false;
        await show();
      }
    }

    // Photos go in the packet straight away, linked to the document, and
    // print right after it. They don't change the document itself, so adding
    // one doesn't mean adding the document again.
    async function addDocPhotos() {
      if (!input.files.length) return;
      photoBtn.disabled = true;
      hint.className = "hint";
      hint.textContent = "Adding photos…";
      try {
        await idle();
        const doc = current();
        const n = await addPhotos(input.files, { doc: doc.id, label: doc.label });
        hint.className = "hint ok";
        hint.textContent = `${n} photo${n === 1 ? "" : "s"} added to the shift packet with ${doc.label}.`;
        onPhotos?.();
      } catch (err) {
        console.error(err);
        hint.className = "hint warn";
        hint.textContent = `Couldn't add the photos: ${err.message}`;
      } finally {
        input.value = "";
        photoBtn.disabled = false;
      }
    }

    btn.addEventListener("click", addDoc);
    photoBtn.addEventListener("click", () => input.click());
    // Picking photos isn't an edit to the form the input sits in.
    for (const type of ["input", "change"]) input.addEventListener(type, (e) => e.stopPropagation());
    input.addEventListener("change", addDocPhotos);
    listeners.add(show);

    return {
      edited() { inPacket = false; },
      async built(newId) {
        // After a reload, a document already in the packet counts as added.
        if (id === null) inPacket = await has(newId).catch(() => false);
        else if (id !== newId) inPacket = false;
        id = newId;
        await show();
      },
      // Whether the document, as it stands, is in the packet (or there's no packet).
      get inPacket() { return inPacket || !("indexedDB" in window); },
    };
  }

  // ---- Packet files ------------------------------------------------------------
  // Submitting hands over every document and photo as its own file, so each
  // can be saved and filed separately: the report, then each document
  // (citations and incident reports, in the order added) followed by its
  // photos, then shift photos (and photos of documents that aren't in the
  // packet). Photos are named after what they go with, e.g.
  // citation-001-100000-B4-S23-photo-1.jpg or shift-11-02-2026-photo-1.jpg.

  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function files(reportFile, items, date) {
    const docs = items.filter((i) => !isPhoto(i));
    const photos = items.filter(isPhoto);
    const out = [reportFile];
    const used = new Set([reportFile.name]);
    const unique = (name) => {
      const [, base, ext] = /^(.*?)(\.[^.]*)?$/.exec(name);
      let n = name;
      for (let i = 2; used.has(n); i++) n = `${base}-${i}${ext || ""}`;
      used.add(n);
      return n;
    };
    const pushPhotos = (group, base) => group.forEach((p, i) => out.push(
      new File([p.bytes], unique(`${base}-photo-${i + 1}.jpg`), { type: "image/jpeg", lastModified: p.addedAt })));

    for (const d of docs) {
      out.push(new File([d.bytes], unique(d.name), { type: "application/pdf", lastModified: d.addedAt }));
      pushPhotos(photos.filter((p) => p.doc === d.id), d.name.replace(/\.pdf$/i, ""));
    }
    const ids = new Set(docs.map((d) => d.id));
    const loose = new Map(); // what they were taken for -> photos
    for (const p of photos.filter((p) => !p.doc || !ids.has(p.doc))) {
      const key = p.doc || "";
      if (!loose.has(key)) loose.set(key, []);
      loose.get(key).push(p);
    }
    for (const [doc, group] of loose) pushPhotos(group, doc ? slug(group[0].label) : `shift-${date}`);
    return out;
  }

  // An uncompressed .zip (PDFs and JPEGs are compressed already) of the files
  // in one folder, for desktops, where a burst of separate downloads is
  // blocked.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function zip(fileList, folder) {
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of fileList) {
      const data = new Uint8Array(await f.arrayBuffer());
      const name = new TextEncoder().encode(`${folder}/${f.name}`);
      const crc = crc32(data);
      // Local file header, then the file.
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local, name, data);
      // Its central directory entry.
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, day, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry, name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, fileList.length, true);
    end.setUint16(10, fileList.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  return {
    isSupported: () => "indexedDB" in window,
    isPhoto,
    addPhotos,
    removeMany,
    list,
    onChange(f) { listeners.add(f); },
    renderThumbs,
    controls,
    files,
    zip,
  };
})();
