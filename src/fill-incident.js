// Fills the incident-report PDF template. Shared by the web app and tests.
//
// The template's fields have unhelpful names ("1", "undefined_2", "Text5"),
// auto-sized text and a description box split across both pages, so each
// answer is printed at its widget's position instead, like the shift report,
// then the form is removed: the result is flat, answers printed on the page.
//
// `values` maps the names below to strings (text) or booleans (checkboxes).
// "Signature Drawing" is a PNG (data URL or bytes) of a drawn signature,
// stamped on the signature line.
(function (root) {
  // name -> template field (one widget each), or [field, vertical nudge in points]
  const TEXT = {
    "Reported By": "REPORTED BY",
    "Block/Site": "BLOCKSITE",
    "Date Reported": "DATE REPORTED",
    // This widget is taller than the blank and reaches above it.
    "Type Other Text": ["OTHER", -3],
    "Incident Date": "DATE OF INCIDENT",
    "Incident Time": "Time Of Incident",
    "Location": "LOCATION",
    "Party 1 Name": "1", "Party 1 Role": "undefined_2", "Party 1 Contact": "undefined_3",
    "Party 2 Name": "2", "Party 2 Role": "undefined_4", "Party 2 Contact": "undefined_5",
    "Party 3 Name": "3", "Party 3 Role": "undefined_6", "Party 3 Contact": "undefined_7",
    "Witness 1 Name": "1_2", "Witness 1 Role": "undefined_8", "Witness 1 Contact": "undefined_9",
    "Witness 2 Name": "2_2", "Witness 2 Role": "undefined_10", "Witness 2 Contact": "undefined_11",
    "Witness 3 Name": "3_2", "Witness 3 Role": "undefined_12", "Witness 3 Contact": "undefined_13",
    "Police Report Filed": "POLICE REPORT FILED",
    "Precinct": "PRECINCT",
    "Reporting Officer": "REPORTING OFFICER",
    "Officer Phone": "PHONE",
  };

  const CHECKS = {
    "Type Emergency": "EMERGENCY",
    "Type Traffic": "TRAFFIC",
    "Type Waterfront": "WATERFRONT",
    "Type Disturbance": "DISTURBANCE",
    "Type Suspicious Activity": "SUSPICIOUS ACTIVITY",
    "Type Public Assistance": "PUBLIC ASSISTENCE",
    "Type Pet": "PET",
    "Type Wildlife": "WILDLIFE",
    "Type Weather": "WEATHER  NATURAL DISASTER",
    "Type Other": "undefined",
  };

  // Text wrapped inside boxes, continuing from one box to the next and
  // shrinking if needed. The description starts on page 1 and carries on in
  // the box at the top of page 2.
  const BOXES = {
    "Incident Description": { fields: ["INCIDENT DESCRIPTION 1", "1_3"], size: 11, min: 6 },
    "Follow-up Action": { fields: ["Text5"], size: 11, min: 6 },
  };

  const SIGNATURES = { "Signature Drawing": "SIGNATURE" };
  const SIG_MAX_HEIGHT = 30; // points; rises above the line like a real signature

  const TEXT_SIZE = 10;
  const MIN_TEXT_SIZE = 5;
  const LEADING = 1.25;
  const PAD = 5;
  const CHECK = "✔"; // ✔
  const INK = [0.05, 0.12, 0.35]; // dark blue, so answers stand out from the form

  function widget(pdf, form, name) {
    const w = form.getField(name).acroField.getWidgets()[0];
    if (!w) throw new Error(`Template is missing "${name}"`);
    const pages = pdf.getPages();
    const page = pages.find((p) => p.ref === w.P()) || pages[0];
    return { page, rect: w.getRectangle() };
  }

  function fit(font, text, size, min, width) {
    while (size > min && font.widthOfTextAtSize(text, size) > width) size -= 0.25;
    return size;
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
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines;
  }

  function drawBoxes(ctx, spec, text) {
    const slots = spec.fields.map((f) => widget(ctx.pdf, ctx.form, f));
    const width = Math.min(...slots.map((s) => s.rect.width)) - 2 * PAD;
    const capacity = (size) => slots.map((s) => Math.floor((s.rect.height - 2 * PAD) / (size * LEADING)));
    let size = spec.size;
    let lines = wrap(text, ctx.font, size, width);
    const total = (sz) => capacity(sz).reduce((a, b) => a + b, 0);
    while (lines.length > total(size) && size > spec.min) {
      size = Math.max(spec.min, size - 0.25);
      lines = wrap(text, ctx.font, size, width);
    }
    const room = total(size);
    if (lines.length > room) lines = lines.slice(0, room - 1).concat(lines.slice(room - 1).join(" "));
    const caps = capacity(size);
    let i = 0;
    slots.forEach(({ page, rect }, b) => {
      for (let row = 0; row < caps[b] && i < lines.length; row++, i++) {
        const line = lines[i];
        if (!line) continue;
        page.drawText(line, {
          x: rect.x + PAD, y: rect.y + rect.height - PAD - size - row * size * LEADING,
          size: Math.min(size, fit(ctx.font, line, size, 1, width)), font: ctx.font, color: ctx.ink,
        });
      }
    });
  }

  // Drops the form and its widgets (keeping any other annotations), so the
  // filled pages are all that's left.
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

  async function fillIncident(PDFLib, templateBytes, values) {
    const pdf = await PDFLib.PDFDocument.load(templateBytes);
    const ctx = {
      pdf,
      form: pdf.getForm(),
      font: await pdf.embedFont(PDFLib.StandardFonts.Helvetica),
      dingbats: await pdf.embedFont(PDFLib.StandardFonts.ZapfDingbats),
      ink: PDFLib.rgb(...INK),
    };

    // Blanks sit on the form's underlines, which run along the widget's bottom.
    for (const [key, at] of Object.entries(TEXT)) {
      const text = String(values[key] || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const [name, dy = 0] = [].concat(at);
      const { page, rect } = widget(pdf, ctx.form, name);
      const size = fit(ctx.font, text, TEXT_SIZE, MIN_TEXT_SIZE, rect.width - 4);
      page.drawText(text, { x: rect.x + 2, y: rect.y + 4 + dy, size, font: ctx.font, color: ctx.ink });
    }
    for (const [key, name] of Object.entries(CHECKS)) {
      if (!values[key]) continue;
      const { page, rect } = widget(pdf, ctx.form, name);
      const size = rect.height * 1.1;
      const w = ctx.dingbats.widthOfTextAtSize(CHECK, size);
      page.drawText(CHECK, {
        x: rect.x + (rect.width - w) / 2, y: rect.y + rect.height * 0.08,
        size, font: ctx.dingbats, color: ctx.ink,
      });
    }
    for (const [key, spec] of Object.entries(BOXES)) {
      if (values[key]) drawBoxes(ctx, spec, values[key]);
    }
    for (const [key, name] of Object.entries(SIGNATURES)) {
      if (!values[key]) continue;
      const { page, rect: r } = widget(pdf, ctx.form, name);
      const img = await pdf.embedPng(values[key]);
      const k = Math.min((r.width - 4) / img.width, SIG_MAX_HEIGHT / img.height);
      page.drawImage(img, { x: r.x + 4, y: r.y + r.height / 2 - 4, width: img.width * k, height: img.height * k });
    }

    removeForm(PDFLib, pdf);
    return pdf.save();
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { fillIncident };
  else root.fillIncident = fillIncident;
})(this);
