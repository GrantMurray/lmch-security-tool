"use strict";

// Shift report: security checklist and journal, laid out like the paper form.
const ShiftReport = (() => {
  // Private files live inside the encrypted bundle (see src/vault.js).
  const TEMPLATE_PATH = "assets/forms/shift_report_fillable.pdf";
  const STORE = { draft: "sr.draft" };

  const form = $("#report");
  const field = (name) => form.elements.namedItem(name);

  function applyDefaults() {
    field("Date").value = today();
    clearSignatures();
  }

  // Called whenever the report changes: keep the draft and the PDF current.
  function changed() {
    saveDraft(form, STORE.draft);
    schedulePdf();
  }

  function newReport() {
    form.reset();
    store.del(STORE.draft);
    applyDefaults();
    updateJournalHint();
    schedulePdf();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // The journal has 18 ruled lines of about 105 characters at normal size;
  // longer entries print smaller to fit. This is an estimate for the hint.
  const JOURNAL_LINES = 18;
  const JOURNAL_LINE_CHARS = 105;

  function updateJournalHint() {
    const text = field("Journal").value.trimEnd();
    const used = text ? text.split(/\r?\n/)
      .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / JOURNAL_LINE_CHARS)), 0) : 0;
    const el = $("#journal-hint");
    el.textContent = used > JOURNAL_LINES
      ? `About ${used} lines — will print in smaller text to fit the ${JOURNAL_LINES} lines.`
      : `About ${used} of ${JOURNAL_LINES} lines used at normal size.`;
    el.className = `hint ${used > JOURNAL_LINES ? "warn" : ""}`;
  }

  const sigPads = [];
  const clearSignatures = () => sigPads.forEach((p) => p.reset());

  // ---- PDF -----------------------------------------------------------------

  let templateBytes = null;
  let lastUrl = null;
  let lastFile = null;

  const schedulePdf = livePdf(form, $("#packet-status"), async () => {
    templateBytes ||= Vault.bytes(TEMPLATE_PATH);
    const values = collectValues(form);
    const bytes = await window.fillShiftReport(PDFLib, templateBytes, values);

    // shift-report-month-day-year.pdf, e.g. shift-report-10-26-2026.pdf
    const date = formatDate(field("Date").value).replaceAll("/", "-") || "undated";
    const name = `shift-report-${date}.pdf`;
    lastFile = new File([bytes], name, { type: "application/pdf" });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(lastFile);
    await buildPacket(lastFile, date);
  });

  // ---- Shift packet --------------------------------------------------------
  // The packet is this report plus every citation, incident report and photo
  // added to it, each submitted as its own file (see Packet.files for the
  // order and names). Phones and tablets share the files; desktops download
  // them in one .zip. It's rebuilt alongside the report, so Submit can open
  // the share sheet straight away: iOS only allows that right after a tap,
  // with no waiting in between.

  let packetItems = [];
  let packetFiles = [];
  let zipUrl = null;
  const shownCounts = {}; // totals last filled in from the packet, by field

  const packetDocs = () => packetItems.filter((i) => !Packet.isPhoto(i));
  const packetCitations = () => packetDocs().filter((i) => i.type !== "incident");
  const packetIncidents = () => packetDocs().filter((i) => i.type === "incident");
  const packetPhotos = () => packetItems.filter(Packet.isPhoto);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  // "a", "a and b", "a, b and c"
  const listOf = (parts) => parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join("");

  // What a set of packet items holds, e.g. "2 citations and 3 photos".
  function describe(items) {
    const docs = items.filter((i) => !Packet.isPhoto(i));
    const incidents = docs.filter((i) => i.type === "incident").length;
    const photos = items.length - docs.length;
    return listOf([
      docs.length - incidents && plural(docs.length - incidents, "citation"),
      incidents && plural(incidents, "incident report"),
      photos && plural(photos, "photo"),
    ].filter(Boolean));
  }

  async function buildPacket(reportFile, date) {
    packetFiles = Packet.files(reportFile, packetItems, date);
    const btn = $("#packet-submit");
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    zipUrl = null;
    const shares = sharesPacket();
    const single = packetFiles.length === 1; // just this report
    if (shares) {
      btn.href = "#";
      btn.removeAttribute("download");
    } else if (single) {
      // Nothing else to bundle: download the report as a plain PDF.
      btn.href = lastUrl;
      btn.download = reportFile.name;
    } else {
      const name = `shift-report-${date}`;
      zipUrl = URL.createObjectURL(await Packet.zip(packetFiles, name));
      btn.href = zipUrl;
      btn.download = `${name}.zip`;
    }
    btn.hidden = false;
    $("#packet-files").textContent = single
      ? `Submit sends the shift report${shares ? "" : " as a PDF"}.`
      : `Submit sends ${plural(packetFiles.length, "separate file")}` +
        (shares ? "." : " (downloaded together in one .zip).");
  }

  function renderPacket() {
    const docs = packetDocs();
    const photos = packetPhotos();
    $("#packet-summary").textContent = packetItems.length
      ? `This report plus ${describe(packetItems)}. Submit at the end of the shift.`
      : "Nothing added yet: use Add to shift report on the Citation or Incident report tab. Submitting now sends just this report.";
    const list = $("#packet-list");
    list.innerHTML = "";
    for (const item of docs) {
      const own = photos.filter((p) => p.doc === item.id);
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = (item.summary || item.name) + (own.length ? ` · ${plural(own.length, "photo")}` : "");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link-btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        const also = own.length ? ` and its ${plural(own.length, "photo")}` : "";
        if (confirm(`Remove ${item.label || `Citation ${item.id}`}${also} from the shift report?`)) {
          await Packet.removeMany([item.id, ...own.map((p) => p.id)]);
        }
      });
      li.append(text, remove);
      list.append(li);
    }
    // Shift photos, and photos of documents that aren't in the packet.
    const ids = new Set(docs.map((d) => d.id));
    Packet.renderThumbs($("#packet-photos"), photos.filter((p) => !p.doc || !ids.has(p.doc)));
  }

  // The citations and incident reports totals follow the packet until
  // someone types their own. Returns true if a total changed.
  function syncTotal(totalName, boxName, n) {
    const total = field(totalName);
    const shown = shownCounts[totalName];
    const auto = !total.value.trim() || total.value === String(shown ?? n);
    shownCounts[totalName] = n;
    if (!auto || total.value === (n ? String(n) : "")) return false;
    total.value = n ? String(n) : "";
    if (n) field(boxName).checked = true;
    else if (shown) field(boxName).checked = false;
    return true;
  }

  const syncTotals = () => [
    syncTotal("Citations Total", "Citations", packetCitations().length),
    syncTotal("Incident Reports Total", "Incident Reports", packetIncidents().length),
  ].some(Boolean);

  async function refreshPacket() {
    try {
      packetItems = await Packet.list();
    } catch (err) {
      console.error(err);
      $("#packet-status").textContent = `Couldn't read the added documents: ${err.message}`;
      packetItems = [];
    }
    renderPacket();
    if (syncTotals()) changed();
    else schedulePdf();
  }

  // Phones and tablets get the share sheet; elsewhere the link downloads.
  const touchDevice = () => window.matchMedia("(pointer: coarse)").matches;
  const sharesPacket = () => touchDevice() && canShareFiles(packetFiles);

  async function submitPacket(e) {
    const status = $("#packet-status");
    if (!packetFiles.length) { e.preventDefault(); return; }
    if (form.classList.contains("stale")) {
      e.preventDefault();
      status.textContent = "The shift report is still updating. Try again in a moment.";
      return;
    }
    const items = packetItems;
    const files = packetFiles;
    if (sharesPacket()) {
      e.preventDefault();
      try {
        await navigator.share({ files });
      } catch (err) {
        if (err.name !== "AbortError") status.textContent = `Couldn't share the shift report: ${err.message}`;
        return;
      }
    }
    status.textContent = `Submitted ${plural(files.length, "file")}.`;
    // Let the download start before asking.
    setTimeout(() => offerClear(items), 300);
  }

  async function offerClear(items) {
    if (!items.length) return;
    if (!confirm(`Remove the submitted ${describe(items)} from the shift report?`)) return;
    // Only what was submitted: anything added since stays for next time.
    await Packet.removeMany(items.map((i) => i.id));
  }

  async function addShiftPhotos(e) {
    e.stopPropagation(); // the report itself doesn't change
    const input = e.target;
    if (!input.files.length) return;
    const status = $("#packet-status");
    const btn = $("#sr-photo-btn");
    btn.disabled = true;
    status.textContent = "Adding photos…";
    try {
      const n = await Packet.addPhotos(input.files, { label: "Shift photo" });
      status.textContent = `${plural(n, "photo")} added to the shift report.`;
    } catch (err) {
      console.error(err);
      status.textContent = `Couldn't add the photos: ${err.message}`;
    } finally {
      input.value = "";
      btn.disabled = false;
    }
  }

  // ---- Wiring --------------------------------------------------------------

  function init() {
    linkCheckboxes(form);
    for (const box of form.querySelectorAll(".sig")) {
      sigPads.push(makeSignaturePad(box, field(box.dataset.input), changed));
    }
    field("Journal").addEventListener("input", updateJournalHint);

    form.addEventListener("input", changed);
    form.addEventListener("change", changed);
    form.addEventListener("submit", (e) => e.preventDefault());
    $("#packet-submit").addEventListener("click", submitPacket);
    Packet.onChange(refreshPacket);
    $("#sr-photo-btn").addEventListener("click", () => $("#sr-photo-input").click());
    for (const type of ["input", "change"]) $("#sr-photo-input").addEventListener(type, (e) => e.stopPropagation());
    $("#sr-photo-input").addEventListener("change", addShiftPhotos);
    $("#sr-new-btn").addEventListener("click", () => {
      if (confirm("Clear this report and start a new one?")) newReport();
    });
  }

  // Runs once the bundle is unlocked.
  function start() {
    if (!restoreDraft(form, STORE.draft)) applyDefaults();
    updateJournalHint();
    if (Packet.isSupported()) refreshPacket();
    else {
      $("#packet-summary").textContent = "This browser can't keep citations, incident reports or photos with the shift report.";
      schedulePdf();
    }
  }

  return { init, start };
})();
