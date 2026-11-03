// Fills the violation-notice PDF template. Shared by the web app and tests.
// `values` maps PDF field names to strings (text fields), booleans
// (checkboxes), or an export value (the "Pictures Attached" radio group).
// "Description of Violation" is special: it is wrapped across the form's
// three ruled "Description Line N" fields, shrinking the text if needed.
// The result is flattened: answers are printed on the page, not form fields.
// "Member Signature Drawing" and "Staff Signature Drawing" are PNGs (data
// URLs or bytes) of drawn signatures, stamped on their signature lines.
(function (root) {
  const DESC_LINES = ["Description Line 1", "Description Line 2", "Description Line 3"];
  const MIN_DESC_SIZE = 3.5;
  const SIGNATURES = {
    "Member Signature Drawing": "Member Signature",
    "Staff Signature Drawing": "Staff Volunteer Name Signature",
  };
  const SIG_MAX_HEIGHT = 16; // points; rises above the line like a real signature

  function fontSize(field, fallback) {
    const da = field.acroField.getDefaultAppearance() || "";
    return parseFloat((da.match(/([\d.]+)\s+Tf/) || [])[1]) || fallback;
  }

  function wrap(text, font, size, width) {
    const lines = [];
    for (const para of text.split(/\r?\n/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? line + " " + word : word;
        if (line && font.widthOfTextAtSize(next, size) > width) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function fillDescription(form, font, text) {
    const fields = DESC_LINES.map((n) => form.getTextField(n));
    const widget = fields[0].acroField.getWidgets()[0];
    const width = widget.getRectangle().width - 4;
    let size = fontSize(fields[0], 6);

    let lines = wrap(text, font, size, width);
    while (lines.length > fields.length && size > MIN_DESC_SIZE) {
      size = Math.max(MIN_DESC_SIZE, size - 0.25);
      lines = wrap(text, font, size, width);
    }
    if (lines.length > fields.length) {
      lines = lines.slice(0, fields.length - 1).concat(lines.slice(fields.length - 1).join(" "));
    }
    fields.forEach((f, i) => {
      f.setFontSize(size);
      f.setText(lines[i] || "");
    });
  }

  async function drawSignature(pdf, form, fieldName, png) {
    const field = form.getTextField(fieldName);
    const r = field.acroField.getWidgets()[0].getRectangle();
    const x = r.x + 2;
    const img = await pdf.embedPng(png);
    const k = Math.min((r.width - 2) / img.width, SIG_MAX_HEIGHT / img.height);
    pdf.getPage(0).drawImage(img, { x, y: r.y - 1.5, width: img.width * k, height: img.height * k });
  }

  async function fillCitation(PDFLib, templateBytes, values) {
    const pdf = await PDFLib.PDFDocument.load(templateBytes);
    const form = pdf.getForm();
    const helvetica = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);

    for (const field of form.getFields()) {
      const name = field.getName();
      if (!(name in values)) continue;
      const v = values[name];
      if (field instanceof PDFLib.PDFTextField) {
        field.setText(v ? String(v) : "");
      } else if (field instanceof PDFLib.PDFCheckBox) {
        v ? field.check() : field.uncheck();
      } else if (field instanceof PDFLib.PDFRadioGroup) {
        v ? field.select(v) : field.clear();
      }
    }
    if ("Description of Violation" in values) {
      fillDescription(form, helvetica, values["Description of Violation"] || "");
    }

    form.updateFieldAppearances(helvetica);
    for (const [key, fieldName] of Object.entries(SIGNATURES)) {
      if (values[key]) await drawSignature(pdf, form, fieldName, values[key]);
    }
    // Bake the answers into the page so the issued notice can't be edited
    // as a form. flatten() leaves the radio group's deleted widgets in the
    // page's annotation list, which viewers flag as a broken file; the form
    // has no other annotations, so drop the list (and the now-empty form).
    form.flatten();
    pdf.getPage(0).node.delete(PDFLib.PDFName.of("Annots"));
    pdf.catalog.delete(PDFLib.PDFName.of("AcroForm"));
    return pdf.save();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { fillCitation };
  else root.fillCitation = fillCitation;
})(this);
