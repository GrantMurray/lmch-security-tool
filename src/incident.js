"use strict";

// Incident report: filled in on screen, printed onto the LMCH incident report
// form, signed on the screen, and shared or added to the shift packet.
const Incident = (() => {
  // Private files live inside the encrypted bundle (see src/vault.js).
  const TEMPLATE_PATH = "assets/forms/incident_report_fillable.pdf";
  const STORE = { draft: "ir.draft", id: "ir.id", reportedBy: "ir.reportedBy" };

  const form = $("#incident");
  const field = (name) => form.elements.namedItem(name);

  // Each report gets an id when it's started, e.g. IR-261102-2245, which
  // names its file and keeps it apart from other reports in the packet.
  function newId() {
    const d = new Date();
    const id = `IR-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    store.set(STORE.id, id);
    return id;
  }
  const reportId = () => store.get(STORE.id) || newId();

  function applyDefaults() {
    field("Date Reported").value = today();
    field("Incident Date").value = today();
    field("Incident Time").value = nowTime();
    field("Reported By").value = store.get(STORE.reportedBy) || "";
    clearSignatures();
  }

  // Called whenever the report changes: keep the draft and the PDF current.
  function changed() {
    packet?.edited(); // a changed report has to be added again
    saveDraft(form, STORE.draft);
    schedulePdf();
  }

  function newReport() {
    form.reset();
    store.del(STORE.draft);
    newId();
    applyDefaults();
    updateDescHint();
    schedulePdf();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // The description has about 41 lines (15 on page 1, 26 on page 2) of about
  // 100 characters at normal size; longer text prints smaller to fit. This is
  // an estimate for the hint.
  const DESC_LINES = 41;
  const DESC_LINE_CHARS = 100;

  function updateDescHint() {
    const text = field("Incident Description").value.trimEnd();
    const used = text ? text.split(/\r?\n/)
      .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / DESC_LINE_CHARS)), 0) : 0;
    const el = $("#ir-desc-hint");
    el.textContent = used > DESC_LINES
      ? `About ${used} lines — will print in smaller text to fit.`
      : `About ${used} of ${DESC_LINES} lines used at normal size (long descriptions continue onto page 2).`;
    el.className = `hint ${used > DESC_LINES ? "warn" : ""}`;
  }

  const sigPads = [];
  const clearSignatures = () => sigPads.forEach((p) => p.reset());

  // ---- PDF -----------------------------------------------------------------

  let templateBytes = null;
  let lastUrl = null;
  let lastFile = null;
  let lastValues = null;

  // Phones and tablets get a share sheet (Save to Files, Print, AirDrop...).
  const touchDevice = () => window.matchMedia("(pointer: coarse)").matches;

  const schedulePdf = livePdf(form, $("#ir-pdf-status"), async () => {
    templateBytes ||= Vault.bytes(TEMPLATE_PATH);
    const values = collectValues(form);
    const bytes = await window.fillIncident(PDFLib, templateBytes, values);

    const id = reportId();
    const name = `incident-report-${id}.pdf`;
    lastValues = values;
    lastFile = new File([bytes], name, { type: "application/pdf" });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(lastFile);

    for (const dl of [$("#ir-download-main"), $("#ir-download-link")]) {
      dl.href = lastUrl;
      dl.download = name;
    }
    $("#ir-open-link").href = lastUrl;
    const share = canShareFile(lastFile) && touchDevice();
    $("#ir-share-btn").hidden = !share;
    $("#ir-download-main").hidden = share;
    $("#ir-download-link").hidden = !share;
    $("#ir-pdf-result").hidden = false;
    $("#ir-pdf-status").textContent = `${name} is up to date.`;
    await packet.built(id);
  });

  // Once the PDF has been handed out, remember who reported it.
  function pdfUsed() {
    if (lastValues?.["Reported By"]) store.set(STORE.reportedBy, lastValues["Reported By"]);
  }

  async function sharePdf() {
    if (!lastFile) return;
    try {
      await navigator.share({ files: [lastFile], title: lastFile.name });
      pdfUsed();
    } catch (err) {
      if (err.name !== "AbortError") $("#ir-pdf-status").textContent = `Couldn't share: ${err.message}`;
    }
  }

  // ---- Shift packet --------------------------------------------------------
  // Same as the citation: "Add to packet" and "Add photos" (see Packet.controls).

  let packet = null;

  const TYPES = [...form.querySelectorAll('input[name^="Type "][type=checkbox]')];

  function packetDoc() {
    const id = reportId();
    const v = lastValues;
    const types = TYPES.filter((b) => b.checked)
      .map((b) => (b.name === "Type Other" && v["Type Other Text"]) || b.parentElement.textContent.trim());
    return {
      id, type: "incident", label: `Incident report ${id}`, file: lastFile,
      summary: ["Incident report", types.join(", "), v["Location"] || v["Block/Site"], v["Incident Date"]]
        .filter(Boolean).join(" · "),
    };
  }

  // ---- Wiring --------------------------------------------------------------

  function init() {
    linkCheckboxes(form);
    for (const box of form.querySelectorAll(".sig")) {
      sigPads.push(makeSignaturePad(box, field(box.dataset.input), changed));
    }
    field("Incident Description").addEventListener("input", updateDescHint);

    form.addEventListener("input", changed);
    form.addEventListener("change", changed);
    form.addEventListener("submit", (e) => e.preventDefault());
    $("#ir-share-btn").addEventListener("click", sharePdf);
    for (const id of ["#ir-download-main", "#ir-download-link", "#ir-open-link"]) $(id).addEventListener("click", pdfUsed);
    packet = Packet.controls({
      prefix: "ir", status: $("#ir-pdf-status"), idle: () => schedulePdf.idle(), current: packetDoc,
      onAdded: pdfUsed, next: "Tap New report for the next one.",
    });
    $("#ir-new-btn").addEventListener("click", () => {
      const message = packet.inPacket
        ? "Clear this incident report and start a new one?"
        : "This incident report isn't in the shift report. Clear it and start a new one anyway?";
      if (confirm(message)) newReport();
    });
  }

  // Runs once the bundle is unlocked.
  function start() {
    // Bundles locked before the incident report existed don't have its form.
    if (!Vault.has(TEMPLATE_PATH)) {
      $("#ir-missing").hidden = false;
      for (const el of form.querySelectorAll(".actions button, .actions a")) el.hidden = true;
      return;
    }
    if (!restoreDraft(form, STORE.draft)) applyDefaults();
    updateDescHint();
    schedulePdf();
  }

  return { init, start };
})();
