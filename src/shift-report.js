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

  // An app opened from the iPad/iPhone Home Screen can't download files: a
  // download link replaces the app with the PDF. There the button becomes
  // Share PDF and opens the share sheet, whose "Save to Files" saves it.
  // Browser tabs and desktops get a normal Download PDF.
  const sharesPdf = (file) => installedApp() && canShareFile(file);

  const schedulePdf = livePdf(form, $("#sr-pdf-status"), async () => {
    templateBytes ||= Vault.bytes(TEMPLATE_PATH);
    const values = collectValues(form);
    const bytes = await window.fillShiftReport(PDFLib, templateBytes, values);

    // shift-report-month-day-year.pdf, e.g. shift-report-10-26-2026.pdf
    const date = formatDate(field("Date").value).replaceAll("/", "-") || "undated";
    const name = `shift-report-${date}.pdf`;
    lastFile = new File([bytes], name, { type: "application/pdf" });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(lastFile);

    const dl = $("#sr-download");
    dl.href = lastUrl;
    dl.download = name;
    dl.textContent = sharesPdf(lastFile) ? "Share PDF" : "Download PDF";
    dl.hidden = false;
    $("#sr-open-link").href = lastUrl;
    $("#sr-pdf-result").hidden = false;
    $("#sr-pdf-status").textContent = `${name} is up to date.`;
  });

  async function downloadPdf(e) {
    if (!lastFile || !sharesPdf(lastFile)) return; // a normal download
    e.preventDefault();
    try {
      await navigator.share({ files: [lastFile] });
    } catch (err) {
      if (err.name !== "AbortError") $("#sr-pdf-status").textContent = `Couldn't save the PDF: ${err.message}`;
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
    $("#sr-download").addEventListener("click", downloadPdf);
    $("#sr-new-btn").addEventListener("click", () => {
      if (confirm("Clear this report and start a new one?")) newReport();
    });
  }

  // Runs once the bundle is unlocked.
  function start() {
    if (!restoreDraft(form, STORE.draft)) applyDefaults();
    updateJournalHint();
    schedulePdf();
  }

  return { init, start };
})();
