"use strict";

// Helpers shared by the citation and shift-report forms.

const BUNDLE_URL = "assets/locked/bundle.bin";

const $ = (sel) => document.querySelector(sel);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

// ---- Dates and times -----------------------------------------------------

function pad(n) { return String(n).padStart(2, "0"); }

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v;
}

function formatTime(v) {
  const m = /^(\d{2}):(\d{2})/.exec(v);
  if (!m) return v;
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

// ---- Form values ---------------------------------------------------------

// The answers as the PDF fillers expect them: booleans for checkboxes, the
// chosen value for radios, dates and times formatted for print.
function collectValues(form) {
  const values = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") values[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) values[el.name] = el.value; else values[el.name] ??= ""; }
    else if (el.type === "date") values[el.name] = formatDate(el.value);
    else if (el.type === "time") values[el.name] = formatTime(el.value);
    else values[el.name] = el.value.trim();
  }
  return values;
}

function saveDraft(form, key) {
  const raw = {};
  for (const el of form.elements) {
    if (!el.name || el.type === "hidden") continue; // signatures stay off the device
    if (el.type === "checkbox") raw[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) raw[el.name] = el.value; }
    else raw[el.name] = el.value;
  }
  store.set(key, JSON.stringify(raw));
}

function restoreDraft(form, key) {
  let raw;
  try { raw = JSON.parse(store.get(key) || "null"); } catch { raw = null; }
  if (!raw) return false;
  for (const el of form.elements) {
    if (!el.name || !(el.name in raw)) continue;
    if (el.type === "checkbox") el.checked = !!raw[el.name];
    else if (el.type === "radio") el.checked = raw[el.name] === el.value;
    else el.value = raw[el.name];
  }
  return true;
}

// Typing in an "Other (describe)" box (or a total) ticks its checkbox.
function linkCheckboxes(form) {
  for (const el of form.querySelectorAll("[data-checks]")) {
    el.addEventListener("input", () => {
      if (el.value.trim()) form.elements.namedItem(el.dataset.checks).checked = true;
    });
  }
}

// ---- Signature pads ------------------------------------------------------
// Each .sig box holds a canvas to sign on and a hidden input that keeps the
// strokes, cropped to the ink, as a PNG data URL; the fillers stamp it on the
// PDF. Signatures are never saved on the device, not even in the draft.

const SIG_INK = "#1b2f6b";

function makeSignaturePad(box, input, onChange) {
  const canvas = box.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  let last = null, lastMid = null, width = 2.5, lastTime = 0;

  function clear() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // Redraws the current signature, scaled to fit (after a resize or reset).
  function show() {
    clear();
    const url = input.value;
    if (!url || !canvas.width) return;
    const img = new Image();
    img.onload = () => {
      if (input.value !== url) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr, ch = canvas.height / dpr;
      const k = Math.min((cw - 16) / img.width, (ch - 16) / img.height, 1 / dpr);
      const iw = img.width * k, ih = img.height * k;
      ctx.drawImage(img, (cw - iw) / 2, (ch - ih) / 2, iw, ih);
    };
    img.src = url;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return; // on a hidden tab; resized again when shown
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    show();
  }

  // PNG of just the inked area (plus a little margin), or "" if blank.
  function cropped() {
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return "";
    const m = 4;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
    x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }

  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Faster strokes draw thinner, like a real pen; a stylus uses pressure.
  const penWidth = (e, p, t) => {
    let target;
    if (e.pointerType === "pen" && e.pressure > 0) target = 1 + e.pressure * 3;
    else {
      const speed = Math.hypot(p.x - last.x, p.y - last.y) / Math.max(1, t - lastTime);
      target = Math.min(3.4, Math.max(1.1, 3.4 - speed * 1.1));
    }
    return (width = width * 0.7 + target * 0.3);
  };

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    last = lastMid = point(e);
    lastTime = e.timeStamp;
    width = 2.5;
    ctx.fillStyle = SIG_INK;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!last) return;
    for (const ev of e.getCoalescedEvents ? e.getCoalescedEvents() : [e]) {
      const p = point(ev);
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.strokeStyle = SIG_INK;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.lineWidth = penWidth(ev, p, ev.timeStamp);
      ctx.beginPath();
      ctx.moveTo(lastMid.x, lastMid.y);
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      ctx.stroke();
      last = p; lastMid = mid; lastTime = ev.timeStamp;
    }
  });
  const end = () => {
    if (!last) return;
    last = lastMid = null;
    input.value = cropped();
    onChange();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  box.querySelector(".sig-clear").addEventListener("click", () => {
    input.value = "";
    clear();
    onChange();
  });
  new ResizeObserver(resize).observe(canvas);
  return { reset() { input.value = ""; clear(); } };
}

// ---- PDF -----------------------------------------------------------------

const installedApp = () => window.matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
const canShareFile = (file) => !!(navigator.canShare && navigator.canShare({ files: [file] }));

// Rebuilds a form's PDF shortly after every change, so Download / Share /
// Open always hand out the current version. Builds never overlap; changes
// made during one trigger another when it finishes. Returns the scheduler.
function livePdf(form, status, build) {
  const DELAY = 250;
  let timer = null, building = false, dirty = false;

  function schedule() {
    dirty = true;
    form.classList.add("stale");
    clearTimeout(timer);
    timer = setTimeout(run, DELAY);
  }

  async function run() {
    if (building) return;
    building = true;
    dirty = false;
    try {
      await build();
    } catch (err) {
      console.error(err);
      status.textContent = `Couldn't update the PDF: ${err.message}`;
    } finally {
      building = false;
      if (dirty) schedule();
      else form.classList.remove("stale");
    }
  }

  return schedule;
}
