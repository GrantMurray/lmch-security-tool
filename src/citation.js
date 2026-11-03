"use strict";

// Violation notice: map picker, fines list, autofill and the 4×6 PDF.
const Citation = (() => {
  // Private files live inside the encrypted bundle (see src/vault.js).
  const TEMPLATE_PATH = "assets/forms/citation_fillable.pdf";
  const SITES_PATH = "assets/data/numbers.csv";
  const FINES_PATH = "assets/data/fines.csv";
  const STORE = {
    issuedBy: "cg.issuedBy", next: "cg.nextCitation", draft: "cg.draft",
    deviceCode: "cg.deviceCode", violationMode: "cg.violationMode",
  };
  const DEFAULT_NEXT = "100000"; // where a new device starts counting

  const form = $("#citation");
  const field = (name) => form.elements.namedItem(name);

  // ---- Site data ---------------------------------------------------------

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    const [head, ...body] = rows.filter((r) => r.some(Boolean));
    return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || "").trim()])));
  }

  function pageLabel(page) {
    const m = /^(\d+)([UL])?$/i.exec(page);
    if (!m) return `Block ${page}`;
    const half = { U: " (Upper)", L: " (Lower)" }[(m[2] || "").toUpperCase()] || "";
    return `Block ${m[1]}${half}`;
  }

  const siteKey = (block, site) => `${Number(block)}-${Number(site)}`;
  const siteText = (s) => `Block ${s.block}, Site ${s.label || s.site}`;

  let pages = [];          // [{ page, label, image, pdfPage, sites: [] }]
  const sites = new Map(); // "block-site" -> row
  const byCode = new Map();

  function loadSites(rows) {
    const grouped = new Map();
    for (const r of rows) {
      const s = {
        ...r,
        left: +r.left, top: +r.top, width: +r.width, height: +r.height,
      };
      sites.set(siteKey(s.block, s.site), s);
      byCode.set(s.code, s);
      if (!grouped.has(s.page)) {
        grouped.set(s.page, { page: s.page, label: pageLabel(s.page), image: s.image, pdfPage: +s.pdf_page, sites: [] });
      }
      grouped.get(s.page).sites.push(s);
    }
    pages = [...grouped.values()].sort((a, b) => a.pdfPage - b.pdfPage);
  }

  // Accepts "4-23", "4 23", "4U-23", "Block 4 Site 23", "b4 s23", or a site code like "04023".
  function parseLocation(text) {
    const nums = text.match(/\d+/g) || [];
    if (nums.length === 1 && nums[0].length === 5 && byCode.has(nums[0])) {
      return { site: byCode.get(nums[0]) };
    }
    if (nums.length === 2) {
      const [block, site] = nums;
      return { block, siteNo: site, site: sites.get(siteKey(block, site)) || null };
    }
    return { block: null, site: null, hasNumbers: nums.length > 0 };
  }

  // ---- Map ---------------------------------------------------------------

  let currentPage = null;
  let picked = null;

  const MAX_ZOOM = 8;
  const TAP_RADIUS = 22; // px on screen around a tap that counts as "on" a site
  const mapVp = $("#map-viewport");
  const mapCanvas = $("#map-canvas");
  const mapImg = $("#map-img");
  // The canvas is laid out at "fit" size (the whole block visible) and then
  // scaled by view.s and moved by view.x/y, in viewport pixels.
  const view = { s: 1, x: 0, y: 0 };
  let fitW = 0, fitH = 0;

  function renderPageTabs() {
    const wrap = $("#map-pages");
    wrap.innerHTML = "";
    for (const p of pages) {
      const b = document.createElement("button");
      b.type = "button";
      b.role = "tab";
      b.textContent = p.page;
      b.title = b.ariaLabel = p.label;
      b.dataset.page = p.page;
      b.addEventListener("click", () => showPage(p.page));
      wrap.append(b);
    }
  }

  function showPage(page, { focusSite } = {}) {
    const p = pages.find((x) => x.page === page);
    if (!p) return;
    if (currentPage !== p) {
      currentPage = p;
      mapImg.src = Vault.url(`assets/maps/pages/${p.image}`);
      mapImg.alt = `${p.label} site map`;
      const layer = $("#hotspots");
      layer.innerHTML = "";
      for (const s of p.sites) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "site";
        b.dataset.key = siteKey(s.block, s.site);
        b.setAttribute("aria-label", siteText(s));
        Object.assign(b.style, {
          left: `${s.left * 100}%`, top: `${s.top * 100}%`,
          width: `${s.width * 100}%`, height: `${s.height * 100}%`,
        });
        b.addEventListener("click", () => pickSite(s)); // keyboard
        layer.append(b);
      }
      for (const tab of $("#map-pages").children) tab.setAttribute("aria-selected", tab.dataset.page === page);
      setView(1, 0, 0);
    }
    markPicked();
    if (focusSite) {
      const go = () => focusOn(focusSite);
      mapImg.complete ? go() : mapImg.addEventListener("load", go, { once: true });
    }
  }

  function markPicked() {
    const key = picked && siteKey(picked.block, picked.site);
    for (const b of $("#hotspots").children) b.classList.toggle("picked", b.dataset.key === key);
    const onPage = picked && currentPage && picked.page === currentPage.page;
    const pin = $("#map-pin");
    pin.hidden = !onPage;
    if (onPage) {
      pin.style.left = `${(picked.left + picked.width / 2) * 100}%`;
      pin.style.top = `${(picked.top + picked.height / 2) * 100}%`;
    }
    const title = $("#map-title");
    title.textContent = currentPage ? currentPage.label : "";
    if (onPage) {
      const small = document.createElement("small");
      small.textContent = ` · Site ${picked.label || picked.site}`;
      title.append(small);
    }
  }

  // Size the canvas so the whole block fits the viewport, keeping the point
  // at the centre of the view where it was.
  function layoutMap() {
    const vw = mapVp.clientWidth, vh = mapVp.clientHeight;
    if (!vw || !vh) return; // on a hidden tab; laid out again when shown
    const aspect = mapImg.naturalWidth ? mapImg.naturalWidth / mapImg.naturalHeight : 2200 / 1700;
    const cx = fitW ? (vw / 2 - view.x) / (fitW * view.s) : 0.5;
    const cy = fitH ? (vh / 2 - view.y) / (fitH * view.s) : 0.5;
    fitW = Math.min(vw, vh * aspect);
    fitH = fitW / aspect;
    mapCanvas.style.width = `${fitW}px`;
    setView(view.s, vw / 2 - cx * fitW * view.s, vh / 2 - cy * fitH * view.s);
  }

  function setView(s, x, y, animate = false) {
    const vw = mapVp.clientWidth, vh = mapVp.clientHeight;
    s = Math.max(1, Math.min(MAX_ZOOM, s));
    const w = fitW * s, h = fitH * s;
    // Centre the map when it is smaller than the viewport; otherwise keep
    // its edges from coming inside the viewport.
    x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, x));
    y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, y));
    Object.assign(view, { s, x, y });
    mapCanvas.classList.toggle("animate", animate);
    mapCanvas.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    mapCanvas.style.setProperty("--inv", 1 / s);
    mapVp.classList.toggle("zoomed", s > 1.01);
    $("#zoom-out").disabled = s <= 1.01;
    $("#zoom-in").disabled = s >= MAX_ZOOM - 0.01;
  }

  // Zoom to scale s, keeping viewport point (px, py) over the same spot.
  function zoomAt(s, px, py, animate = false) {
    const nx = (px - view.x) / view.s, ny = (py - view.y) / view.s;
    s = Math.max(1, Math.min(MAX_ZOOM, s));
    setView(s, px - nx * s, py - ny * s, animate);
  }

  const zoomBy = (k) => zoomAt(view.s * k, mapVp.clientWidth / 2, mapVp.clientHeight / 2, true);

  function focusOn(site) {
    const s = Math.max(view.s, 4);
    const cx = (site.left + site.width / 2) * fitW * s, cy = (site.top + site.height / 2) * fitH * s;
    setView(s, mapVp.clientWidth / 2 - cx, mapVp.clientHeight / 2 - cy, true);
  }

  // A tap picks the nearest site if it is clearly the one meant; when several
  // are close together it zooms in on them instead.
  function onMapTap(px, py) {
    if (!currentPage || !fitW) return;
    const w = fitW * view.s, h = fitH * view.s;
    const near = currentPage.sites
      .map((s) => ({ s, d: Math.hypot((s.left + s.width / 2) * w + view.x - px, (s.top + s.height / 2) * h + view.y - py) }))
      .sort((a, b) => a.d - b.d);
    const [first, second] = near;
    if (!first || first.d > TAP_RADIUS * 3) return;
    const clear = !second || second.d > Math.max(TAP_RADIUS, first.d * 1.8);
    if (first.d <= TAP_RADIUS && (clear || view.s >= MAX_ZOOM - 0.01)) pickSite(first.s);
    else zoomAt(view.s * 2.5, px, py, true);
  }

  function setUpMapGestures() {
    const pts = new Map();
    let drag = null, pinch = null;
    const local = (e) => {
      const r = mapVp.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const startPinch = () => {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ...view };
      drag = null;
    };

    mapVp.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      try { mapVp.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) {
        const p = local(e);
        drag = { px: p.x, py: p.y, x: view.x, y: view.y, moved: false };
      } else if (pts.size === 2) startPinch();
    });
    mapVp.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const s = Math.max(1, Math.min(MAX_ZOOM, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // keep the map point that was under the fingers' midpoint under it
        setView(s, mx - (pinch.mx - pinch.x) / pinch.s * s, my - (pinch.my - pinch.y) / pinch.s * s);
      } else if (drag) {
        const dx = p.x - drag.px, dy = p.y - drag.py;
        if (!drag.moved && Math.hypot(dx, dy) > 6) {
          drag.moved = true;
          mapVp.classList.add("dragging");
        }
        if (drag.moved) setView(view.s, drag.x + dx, drag.y + dy);
      }
    });
    const end = (e, cancelled) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.delete(e.pointerId);
      if (drag && !drag.moved && !cancelled && pts.size === 0) onMapTap(p.x, p.y);
      if (pinch && pts.size === 1) {
        // carry on as a drag with the remaining finger, without tapping
        const [q] = pts.values();
        drag = { px: q.x, py: q.y, x: view.x, y: view.y, moved: true };
      }
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) { drag = null; mapVp.classList.remove("dragging"); }
    };
    mapVp.addEventListener("pointerup", (e) => end(e, false));
    mapVp.addEventListener("pointercancel", (e) => end(e, true));
    // Trackpad pinch (and ctrl + scroll wheel) zooms the map, not the page.
    mapVp.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const p = local(e);
      zoomAt(view.s * Math.exp(-e.deltaY * 0.01), p.x, p.y);
    }, { passive: false });

    $("#zoom-in").addEventListener("click", () => zoomBy(2));
    $("#zoom-out").addEventListener("click", () => zoomBy(0.5));
    $("#zoom-fit").addEventListener("click", () => setView(1, 0, 0, true));
    $("#map-full").addEventListener("click", () => setMapFull(!$("#map").classList.contains("full")));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#map").classList.contains("full")) setMapFull(false);
    });
    mapImg.addEventListener("load", layoutMap);
    new ResizeObserver(layoutMap).observe(mapVp);
  }

  function setMapFull(on) {
    $("#map").classList.toggle("full", on);
    document.body.classList.toggle("map-open", on);
    $("#map-full").textContent = on ? "Done" : "Full screen";
    if (!on) $("#map").scrollIntoView({ block: "nearest" });
  }

  // ---- Location & autofill -----------------------------------------------

  let autoVehicleLocation = "";

  function setStatus(text, kind = "") {
    const el = $("#loc-status");
    el.textContent = text;
    el.className = `hint ${kind}`;
  }

  function pickSite(s, { fromTyping = false } = {}) {
    picked = s;
    if (!fromTyping) field("Block/Site Or Address").value = siteText(s);
    setStatus(`${siteText(s)} on the ${pageLabel(s.page)} map.`, "ok");
    showPage(s.page, { focusSite: fromTyping ? s : null });
    syncVehicleLocation();
    changed();
  }

  function onLocationTyped() {
    const text = field("Block/Site Or Address").value.trim();
    const r = parseLocation(text);
    if (!text) {
      picked = null; markPicked();
      setStatus("Type a block and site, or tap a site on the map.");
    } else if (r.site) {
      pickSite(r.site, { fromTyping: true });
      setStatus(`Found ${siteText(r.site)} on the ${pageLabel(r.site.page)} map.`, "ok");
    } else {
      picked = null; markPicked();
      if (r.block) {
        setStatus(`Block ${Number(r.block)}, Site ${Number(r.siteNo)} isn't on the map. It will print as typed.`, "warn");
        const p = pages.find((x) => x.sites[0].block === String(Number(r.block)));
        if (p && currentPage?.sites[0].block !== p.sites[0].block) showPage(p.page);
      } else {
        setStatus("Not a block/site. It will print as typed (e.g. an address or area).");
      }
    }
    syncVehicleLocation();
  }

  function locationText() {
    return picked ? siteText(picked) : field("Block/Site Or Address").value.trim();
  }

  // Vehicle location follows the site only when the vehicle section is in use.
  function syncVehicleLocation() {
    const vl = field("Vehicle Location");
    const inUse = field("Category Vehicle/Traffic").checked ||
      ["Vehicle Make Model", "Vehicle License"].some((n) => field(n).value.trim());
    const untouched = !vl.value.trim() || vl.value === autoVehicleLocation;
    if (inUse && untouched) {
      autoVehicleLocation = locationText();
      vl.value = autoVehicleLocation;
    }
  }

  // ---- Fines list ----------------------------------------------------------
  // In "Fines list" mode, choosing a violation fills in its category,
  // item # and fine amount; "Manual" shows the category boxes instead.

  // Fines list section -> category checkbox on the form.
  const SECTION_CATEGORY = {
    1: "General", 2: "Vehicle/Traffic", 3: "Vehicle/Traffic", 4: "Waterfront/Moorage",
    6: "Tree/Greenspace", 7: "Noise/Nuisance", 8: "Garbage/Littering",
    9: "Camp Endangerment", 10: "Campsite Usage", 11: "Acts of Deception",
  };
  const CATEGORY_BOXES = [...form.querySelectorAll('input[name^="Category "][type=checkbox]')];
  const fines = new Map(); // item -> row

  function loadFines(rows) {
    const select = field("Fine Item");
    let group = null;
    for (const r of rows) {
      if (r.item.endsWith(".0")) {
        group = null; // header row; sections with no fines get no group
        continue;
      }
      if (!group || group.dataset.section !== r.section) {
        group = document.createElement("optgroup");
        group.label = `${r.section}. ${r.category}`;
        group.dataset.section = r.section;
        select.append(group);
      }
      fines.set(r.item, r);
      const desc = r.description.length > 70 ? `${r.description.slice(0, 68).trimEnd()}…` : r.description;
      group.append(new Option(`${r.item}  ${desc}`, r.item));
    }
  }

  // The amount to print, or "" when the officer has to decide it (TBD, ranges,
  // termination). Seasonal moorage fines use the citation date.
  function fineAmount(r) {
    if (r.amount_min === "0") return ""; // n/c: warning only
    if (r.amount_min && r.amount_min === r.amount_max) return r.amount_min;
    if (/May.Sept/.test(r.fine) && r.amount_min && r.amount_max) {
      const month = +(field("Date").value.split("-")[1] || new Date().getMonth() + 1);
      return month >= 5 && month <= 9 ? r.amount_max : r.amount_min;
    }
    return "";
  }

  function showFineHint() {
    const r = fines.get(field("Fine Item").value);
    const el = $("#fine-hint");
    el.classList.toggle("warn", !!r && !fineAmount(r) && r.amount_min !== "0");
    if (!r) { el.textContent = "Fills in the category, item #, fine amount and description."; return; }
    const parts = [`${r.item} ${r.description}`, `Fine: ${r.fine}${r.per ? ` per ${r.per}` : ""}`];
    if (r.action) parts.push(r.action);
    if (r.notes) parts.push(r.notes);
    if (!fineAmount(r) && r.amount_min !== "0") parts.push("Enter the fine amount below.");
    el.textContent = parts.join(" · ");
  }

  function pickFine() {
    const r = fines.get(field("Fine Item").value);
    showFineHint();
    if (!r) return;
    const category = `Category ${SECTION_CATEGORY[r.section] || "Other"}`;
    for (const box of CATEGORY_BOXES) box.checked = box.name === category;
    field("Category Other Text").value = category === "Category Other" ? r.category : "";
    field("Item Number").value = r.item;
    field("Description of Violation").value = r.description;
    updateDescHint();
    const amount = field("Fine Amount");
    amount.value = fineAmount(r);
    setAsideAmount = "";
    if (amount.value) markFineIssued();
    else field("Outcome Fine Issued").checked = false;
    syncVehicleLocation();
  }

  // A fine and a warning are mutually exclusive outcomes. Ticking Warning
  // puts the fine amount aside; ticking Fine issued brings it back.
  let setAsideAmount = "";

  function onWarning(e) {
    if (!e.target.checked) return;
    const amount = field("Fine Amount");
    if (amount.value.trim()) setAsideAmount = amount.value;
    amount.value = "";
  }

  function onFineIssued(e) {
    const amount = field("Fine Amount");
    if (!e.target.checked || amount.value.trim()) return;
    const r = violationMode() === "auto" && fines.get(field("Fine Item").value);
    amount.value = setAsideAmount || (r ? fineAmount(r) : "");
  }

  function markFineIssued() {
    field("Outcome Fine Issued").checked = true;
    field("Outcome Warning").checked = false;
  }

  function violationMode() {
    return fines.size && form.elements.namedItem("Violation Mode").value === "manual" ? "manual" : "auto";
  }

  // Each mode keeps its own description: switching puts the current one aside
  // and brings back the other mode's. With nothing set aside, the fines list
  // falls back to the chosen violation's text.
  let otherDescription = "";

  function switchDescription() {
    const desc = field("Description of Violation");
    const r = violationMode() === "auto" && fines.get(field("Fine Item").value);
    const next = otherDescription || (r ? r.description : "");
    otherDescription = desc.value;
    desc.value = next;
    updateDescHint();
  }

  function showViolationMode() {
    const auto = fines.size > 0 && violationMode() === "auto";
    $("#cat-mode").hidden = !fines.size;
    $("#cat-auto").hidden = !auto;
    $("#cat-manual").hidden = auto;
    showFineHint();
  }

  function nextCitation() {
    return store.get(STORE.next) || DEFAULT_NEXT;
  }

  function bumpCitation(used) {
    if (!/^\d+$/.test(used) || used !== nextCitation()) return;
    store.set(STORE.next, String(BigInt(used) + 1n).padStart(used.length, "0"));
  }

  function applyDefaults() {
    field("Date").value = today();
    field("Time").value = nowTime();
    field("Device Code").value = store.get(STORE.deviceCode) || "";
    field("Citation Number").value = nextCitation();
    field("Issued By").value = store.get(STORE.issuedBy) || "";
    const mode = store.get(STORE.violationMode);
    if (mode) form.elements.namedItem("Violation Mode").value = mode;
    clearSignatures();
  }

  // ---- Form state ----------------------------------------------------------

  // Called whenever the citation changes: keep the draft and the PDF current.
  function changed() {
    saveDraft(form, STORE.draft);
    schedulePdf();
  }

  function newCitation() {
    form.reset();
    picked = null;
    autoVehicleLocation = "";
    setAsideAmount = "";
    otherDescription = "";
    store.del(STORE.draft);
    applyDefaults();
    onLocationTyped();
    updateDescHint();
    showViolationMode();
    schedulePdf();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateDescHint() {
    const n = field("Description of Violation").value.length;
    const el = $("#desc-hint");
    el.textContent = n > 270
      ? `${n} characters — will print in smaller text to fit the three lines.`
      : `${n}/270 characters fit at normal size.`;
    el.className = `hint ${n > 270 ? "warn" : ""}`;
  }

  const sigPads = [];
  const clearSignatures = () => sigPads.forEach((p) => p.reset());

  // ---- PDF -----------------------------------------------------------------

  let templateBytes = null;
  let lastUrl = null;
  let lastFile = null;
  let lastValues = null;

  // Phones and tablets get a share sheet (Save to Files, Print, AirDrop...);
  // downloads from an installed iOS web app are unreliable.
  const touchDevice = () => window.matchMedia("(pointer: coarse)").matches;

  const schedulePdf = livePdf(form, $("#cg-pdf-status"), async () => {
    templateBytes ||= Vault.bytes(TEMPLATE_PATH);
    const values = collectValues(form);
    // Each device has its own code, printed in front of its numbers
    // (001-260171) so two devices never issue the same citation number.
    const number = values["Citation Number"];
    const code = values["Device Code"];
    values["Citation Number"] = code && number ? `${code}-${number}` : number;
    const bytes = await window.fillCitation(PDFLib, templateBytes, values);

    const num = values["Citation Number"] || "draft";
    const where = picked ? `-B${picked.block}-S${picked.site}` : "";
    const name = `citation-${num}${where}.pdf`;
    lastValues = { ...values, "Citation Number": number };
    lastFile = new File([bytes], name, { type: "application/pdf" });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(lastFile);

    for (const dl of [$("#cg-download-main"), $("#cg-download-link")]) {
      dl.href = lastUrl;
      dl.download = name;
    }
    $("#cg-open-link").href = lastUrl;
    // The bottom bar offers one main action: the share sheet on phones and
    // tablets, a download elsewhere. The rest sit under the status line.
    const share = canShareFile(lastFile) && touchDevice();
    $("#cg-share-btn").hidden = !share;
    $("#cg-download-main").hidden = share;
    $("#cg-download-link").hidden = !share;
    $("#cg-pdf-result").hidden = false;
    $("#cg-pdf-status").textContent = `${name} is up to date. Print at actual size (100%).`;
  });

  // Once the PDF has been handed out, remember the issuer and move on to the
  // next citation number for the next "New citation".
  function pdfUsed() {
    if (!lastValues) return;
    if (lastValues["Issued By"]) store.set(STORE.issuedBy, lastValues["Issued By"]);
    bumpCitation(lastValues["Citation Number"]);
  }

  async function sharePdf() {
    if (!lastFile) return;
    try {
      await navigator.share({ files: [lastFile], title: lastFile.name });
      pdfUsed();
    } catch (err) {
      if (err.name !== "AbortError") $("#cg-pdf-status").textContent = `Couldn't share: ${err.message}`;
    }
  }

  // ---- Wiring --------------------------------------------------------------

  function init() {
    const loc = field("Block/Site Or Address");
    loc.addEventListener("input", onLocationTyped);
    loc.addEventListener("change", () => { if (picked) loc.value = siteText(picked); changed(); });
    loc.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); loc.dispatchEvent(new Event("change")); loc.blur(); }
    });

    setUpMapGestures();
    linkCheckboxes(form);

    // Entering a fine or a deadline ticks the matching outcome.
    field("Fine Amount").addEventListener("input", (e) => {
      if (e.target.value.trim()) markFineIssued();
    });
    field("Corrective Action Required By").addEventListener("change", (e) => {
      if (e.target.value) field("Outcome Corrective Action Required").checked = true;
    });
    // Status boxes, and Warning vs Fine issued, behave like a single choice.
    const singleChoice = [
      ["Status Member", "Status Guest", "Status Contractor", "Status Vendor"],
      ["Outcome Warning", "Outcome Fine Issued"],
    ];
    for (const group of singleChoice) {
      for (const n of group) {
        field(n).addEventListener("change", (e) => {
          if (e.target.checked) group.filter((o) => o !== n).forEach((o) => { field(o).checked = false; });
        });
      }
    }
    for (const n of ["Category Vehicle/Traffic", "Vehicle Make Model", "Vehicle License"]) {
      field(n).addEventListener(n.startsWith("Category") ? "change" : "input", syncVehicleLocation);
    }
    field("Outcome Warning").addEventListener("change", onWarning);
    field("Outcome Fine Issued").addEventListener("change", onFineIssued);
    field("Fine Item").addEventListener("change", pickFine);
    for (const el of form.querySelectorAll('[name="Violation Mode"]')) {
      el.addEventListener("change", () => {
        store.set(STORE.violationMode, el.value);
        switchDescription();
        showViolationMode();
      });
    }
    for (const box of form.querySelectorAll(".sig")) {
      sigPads.push(makeSignaturePad(box, field(box.dataset.input), changed));
    }
    field("Description of Violation").addEventListener("input", updateDescHint);
    // The device code is a setting for this device, kept as soon as it's typed.
    field("Device Code").addEventListener("input", (e) => {
      const el = e.target;
      el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      el.value ? store.set(STORE.deviceCode, el.value) : store.del(STORE.deviceCode);
    });

    form.addEventListener("input", changed);
    form.addEventListener("change", changed);
    form.addEventListener("submit", (e) => e.preventDefault());
    $("#cg-share-btn").addEventListener("click", sharePdf);
    $("#cg-download-main").addEventListener("click", pdfUsed);
    $("#cg-download-link").addEventListener("click", pdfUsed);
    $("#cg-open-link").addEventListener("click", pdfUsed);
    $("#cg-new-btn").addEventListener("click", () => {
      if (confirm("Clear this citation and start a new one?")) newCitation();
    });
  }

  // Runs once the bundle is unlocked.
  function start() {
    // Options must exist before the draft restores the chosen violation.
    try {
      if (Vault.has(FINES_PATH) && !fines.size) loadFines(parseCSV(Vault.text(FINES_PATH)));
    } catch (err) {
      console.error("Couldn't load the fines list:", err);
    }
    if (!restoreDraft(form, STORE.draft)) applyDefaults();
    showViolationMode();
    updateDescHint();
    try {
      loadSites(parseCSV(Vault.text(SITES_PATH)));
    } catch (err) {
      console.error(err);
      setStatus("Couldn't load the site list. You can still type a location.", "warn");
      schedulePdf();
      return;
    }
    renderPageTabs();
    showPage(pages[0].page);
    if (field("Block/Site Or Address").value) onLocationTyped();
    schedulePdf();
  }

  return { init, start };
})();
