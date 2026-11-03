// Fills the shift-report PDF template. Shared by the web app and tests.
//
// The template's form can't be filled field by field: all fourteen round and
// bathhouse time boxes are one field ("Time" / "Time 2"), both fuel gauges are
// one dropdown, both totals are one field, and the Clean / Maintenance Issue
// radio groups each span two patrol areas. So each answer is mapped to one
// widget (field name + widget index) and printed at that widget's position,
// then the form is removed: the result is flat, answers printed on the page.
//
// `values` maps the names below to strings (text), booleans (checkboxes) or
// "Yes"/"No" (the yes/no pairs). "Employee Signature Drawing" is a PNG (data
// URL or bytes) of a drawn signature, stamped on the signature line.
(function (root) {
  // name -> [field, widget index, optional vertical nudge in points]
  const TEXT = {
    "Employee Name": ["Employee name", 0],
    "Date": ["Date", 0],
    // This widget sits on its label; the blank line is below it.
    "Vehicle Defects": ["Record any defective or missing items in vehicle", 0, -14],
    // Line up with the "Fuel Level Start Of Shift" label beside it.
    "Fuel Start": ["Fuel Level Start Of Shift", 0, 6],
    "Fuel End": ["Fuel Level Start Of Shift", 1],

    "A1 Front Gate 1": ["Time", 0], "A1 Front Gate 2": ["Time 2", 0],
    "A1 KK5 1": ["Time", 1], "A1 KK5 2": ["Time 2", 1],
    "A1 Office 1": ["Time", 2], "A1 Office 2": ["Time 2", 2],
    "A1 BH Number": ["Time", 3], "A1 BH Time": ["Time 2", 3],

    "A2 Maintenance 1": ["Time", 4], "A2 Maintenance 2": ["Time 2", 4],
    "A2 KK2 1": ["Time", 5], "A2 KK2 2": ["Time 2", 5],
    "A2 Pool 1": ["Time", 6], "A2 Pool 2": ["Time 2", 6],
    "A2 Laundry Pool": ["Time", 7], "A2 Laundry Block 21": ["Time 2", 7],
    "A2 BH Number": ["Time", 8], "A2 BH Time": ["Time 2", 8],

    "A3 KK10 1": ["Time", 9], "A3 KK10 2": ["Time 2", 9],
    "A3 Meditation Point 1": ["Time", 10], "A3 Meditation Point 2": ["Time 2", 10],
    "A3 BH Number": ["Time", 11], "A3 BH Time": ["Time 2", 11],

    "A4 Waterfront 1": ["Time", 12], "A4 Waterfront 2": ["Time 2", 12],
    "A4 BH Number": ["Time", 13], "A4 BH Time": ["Time 2", 13],

    "Incident Reports Total": ["Total", 0],
    "Citations Total": ["Total", 1],
    "Other Text": ["undefined", 0],
  };

  // name -> [field, widget index, optional horizontal nudge in points]
  const CHECKS = {
    // These two widgets sit a little left of their printed boxes.
    "AED": ["AED", 0, 2.5],
    "First Aid Kit": ["First Aid Kit", 0, 2],
    "Lockout Kit": ["Lockout Kit", 0],
    "Fire Ext": ["Fire Ext", 0],
    "Radio": ["Radio", 0],
    "Phone": ["Phone", 0],
    "Keys": ["Keys", 0],
    "Incident Reports": ["Incident Reports", 0],
    "Citations": ["Citations", 0],
    "Other": ["Other", 0],
    "Vehicle Clean": ["Ensure vehicle is clean at EOS", 0],
  };

  // name -> [field, widget index of "Yes"]; "No" is the next widget.
  const YES_NO = {
    "A1 Clean": ["Clean", 0], "A2 Clean": ["Clean", 2],
    "A3 Clean": ["Clean_3", 0], "A4 Clean": ["Clean_2", 0],
    "A1 Maintenance Issue": ["Maintenance Issue", 0], "A2 Maintenance Issue": ["Maintenance Issue", 2],
    "A3 Maintenance Issue": ["Maintenance Issue_3", 0], "A4 Maintenance Issue": ["Maintenance Issue_2", 0],
  };

  // Text wrapped across several ruled lines, shrinking if needed.
  const JOURNAL_FIELDS = Array.from({ length: 18 },
    (_, i) => `Record situations and notes regarding security operations ${i + 1}`);
  const WRAPPED = {
    "Journal": { fields: JOURNAL_FIELDS, size: 10, min: 5 },
    "A1 Comments": { fields: ["Area Comments 1", "Area Comments 2"], size: 9, min: 4.5 },
    "A2 Comments": { fields: ["Area Comments 1_2", "Area Comments 2_2"], size: 9, min: 4.5 },
    "A3 Comments": { fields: ["Area Comments 1_3", "Area Comments 2_3"], size: 9, min: 4.5 },
    "A4 Comments": { fields: ["Area Comments 1_4", "Area Comments 2_4"], size: 9, min: 4.5 },
  };

  const SIGNATURES = { "Employee Signature Drawing": "Signature1_es_:signer:signature" };
  const SIG_MAX_HEIGHT = 22; // points; rises above the line like a real signature

  const TEXT_SIZE = 10;
  const MIN_TEXT_SIZE = 5;
  const CHECK = "\u2714"; // ✔
  const INK = [0.05, 0.12, 0.35]; // dark blue, so answers stand out from the form

  function widget(pdf, form, [name, index]) {
    const w = form.getField(name).acroField.getWidgets()[index];
    if (!w) throw new Error(`Template is missing widget ${index} of "${name}"`);
    const pages = pdf.getPages();
    const page = pages.find((p) => p.ref === w.P()) || pages[0];
    return { page, rect: w.getRectangle() };
  }

  function fit(font, text, size, min, width) {
    while (size > min && font.widthOfTextAtSize(text, size) > width) size -= 0.25;
    return size;
  }

  // Blanks sit on the form's underlines, which run along the widget's bottom.
  function drawText(ctx, { page, rect }, text, size, dy = 0) {
    page.drawText(text, {
      x: rect.x + 2, y: rect.y + 3 + dy, size, font: ctx.font, color: ctx.ink,
    });
  }

  function drawCheck(ctx, { page, rect }, dx = 0) {
    const size = rect.height * 1.05;
    const w = ctx.dingbats.widthOfTextAtSize(CHECK, size);
    page.drawText(CHECK, {
      x: rect.x + (rect.width - w) / 2 + dx, y: rect.y + rect.height * 0.12,
      size, font: ctx.dingbats, color: ctx.ink,
    });
  }

  // Splits text into lines for the given line widths (the last width repeats).
  function wrap(text, font, size, widths) {
    const lines = [];
    const width = () => widths[Math.min(lines.length, widths.length - 1)];
    for (const para of text.split(/\r?\n/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? line + " " + word : word;
        if (line && font.widthOfTextAtSize(next, size) > width()) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      lines.push(line);
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines;
  }

  function drawWrapped(ctx, spec, text) {
    const slots = spec.fields.map((f) => widget(ctx.pdf, ctx.form, [f, 0]));
    const widths = slots.map((s) => s.rect.width - 4);
    let size = spec.size;
    let lines = wrap(text, ctx.font, size, widths);
    while (lines.length > slots.length && size > spec.min) {
      size = Math.max(spec.min, size - 0.25);
      lines = wrap(text, ctx.font, size, widths);
    }
    if (lines.length > slots.length) {
      lines = lines.slice(0, slots.length - 1).concat(lines.slice(slots.length - 1).join(" "));
    }
    slots.forEach((slot, i) => {
      const line = lines[i];
      if (!line) return;
      const width = widths[i];
      drawText(ctx, slot, line, Math.min(size, fit(ctx.font, line, size, 1, width)));
    });
  }

  async function drawSignature(ctx, fieldName, png) {
    const { page, rect: r } = widget(ctx.pdf, ctx.form, [fieldName, 0]);
    const img = await ctx.pdf.embedPng(png);
    const k = Math.min((r.width - 2) / img.width, SIG_MAX_HEIGHT / img.height);
    page.drawImage(img, { x: r.x + 2, y: r.y - 1.5, width: img.width * k, height: img.height * k });
  }

  // Drops the form and its widgets (keeping any other annotations), so the
  // filled page is all that's left.
  function removeForm(PDFLib, pdf) {
    const { PDFName, PDFArray, PDFDict } = PDFLib;
    for (const page of pdf.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots) continue;
      const keep = annots.asArray().filter((ref) => {
        const a = pdf.context.lookupMaybe(ref, PDFDict);
        return a && a.get(PDFName.of("Subtype")) !== PDFName.of("Widget");
      });
      if (keep.length) page.node.set(PDFName.of("Annots"), pdf.context.obj(keep));
      else page.node.delete(PDFName.of("Annots"));
    }
    pdf.catalog.delete(PDFName.of("AcroForm"));
  }

  async function fillShiftReport(PDFLib, templateBytes, values) {
    const pdf = await PDFLib.PDFDocument.load(templateBytes);
    const ctx = {
      pdf,
      form: pdf.getForm(),
      font: await pdf.embedFont(PDFLib.StandardFonts.Helvetica),
      dingbats: await pdf.embedFont(PDFLib.StandardFonts.ZapfDingbats),
      ink: PDFLib.rgb(...INK),
    };

    for (const [key, at] of Object.entries(TEXT)) {
      const text = String(values[key] || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const slot = widget(pdf, ctx.form, at);
      drawText(ctx, slot, text, fit(ctx.font, text, TEXT_SIZE, MIN_TEXT_SIZE, slot.rect.width - 4), at[2]);
    }
    for (const [key, at] of Object.entries(CHECKS)) {
      if (values[key]) drawCheck(ctx, widget(pdf, ctx.form, at), at[2]);
    }
    for (const [key, [name, yes]] of Object.entries(YES_NO)) {
      if (values[key] === "Yes") drawCheck(ctx, widget(pdf, ctx.form, [name, yes]));
      else if (values[key] === "No") drawCheck(ctx, widget(pdf, ctx.form, [name, yes + 1]));
    }
    for (const [key, spec] of Object.entries(WRAPPED)) {
      if (values[key]) drawWrapped(ctx, spec, values[key]);
    }
    for (const [key, fieldName] of Object.entries(SIGNATURES)) {
      if (values[key]) await drawSignature(ctx, fieldName, values[key]);
    }

    removeForm(PDFLib, pdf);
    return pdf.save();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { fillShiftReport };
  else root.fillShiftReport = fillShiftReport;
})(this);
