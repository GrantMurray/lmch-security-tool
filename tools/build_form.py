"""Build the fillable 4x6 violation-notice form.

Usage: python3 tools/build_form.py [logo.png] [output.pdf]
Defaults to assets/images/logo-circle.png -> assets/forms/citation_fillable.pdf.
Field names are what src/citation.js and src/fill-citation.js fill in; keep them in sync.
"""
import sys
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.colors import transparent

ROOT = Path(__file__).resolve().parent.parent
LOGO = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "assets/images/logo-circle.png")
OUT = sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "assets/forms/citation_fillable.pdf")
W, H = 396, 612  # layout units (designed at half-letter)
PW, PH = 288, 432  # printed page: 4x6 in
S = PH / H
OX = (PW - W * S) / 2
L, R = 29, 357
CX = (L + R) / 2
INK = colors.HexColor("#1f2a36")
TITLE = colors.HexColor("#2f3b4a")
RED = colors.HexColor("#d8262e")

c = canvas.Canvas(OUT, pagesize=(PW, PH))
c.setTitle("Violation Notice - Lake Merwin Campers Hideaway")
form = c.acroForm
# Drawing uses layout units via the CTM; form widgets are placed in page
# coordinates, so field helpers convert with fx()/fy().
c.translate(OX, 0)
c.scale(S, S)


def Y(top):  # convert distance-from-top to PDF y
    return H - top


def fx(x):
    return OX + x * S


def fy(top):
    return Y(top) * S


def text(x, top, s, font="Helvetica", size=7.5, color=INK, align="left"):
    c.setFont(font, size)
    c.setFillColor(color)
    {"left": c.drawString, "center": c.drawCentredString, "right": c.drawRightString}[align](x, Y(top), s)


def tfield(name, x, top, w, h, size=8, multiline=False, tip=None, color=INK):
    form.textfield(
        name=name, tooltip=tip or name, x=fx(x), y=fy(top + h), width=w * S, height=h * S,
        fontName="Helvetica", fontSize=size * S, textColor=color,
        borderWidth=0, fillColor=transparent, borderColor=transparent,
        fieldFlags="multiline" if multiline else "", maxlen=0,
    )


def cbox(name, x, top, label=None, size=7, tip=None):
    form.checkbox(
        name=name, tooltip=tip or label or name, x=fx(x), y=fy(top + size), size=size * S,
        buttonStyle="cross", borderWidth=0.6 * S, borderColor=INK, fillColor=colors.white,
        textColor=INK,
    )
    if label:
        text(x + size + 2.5, top + size - 0.8, label)


def radio(group, value, x, top, label, size=7):
    form.radio(
        name=group, value=value, x=fx(x), y=fy(top + size), size=size * S, selected=False,
        buttonStyle="cross", shape="square", borderWidth=0.6 * S, borderColor=INK,
        fillColor=colors.white, textColor=INK, tooltip=f"{group}: {label}",
    )
    text(x + size + 2.5, top + size - 0.8, label, font="Helvetica-Bold", size=8)


def rect(x, top, w, h, lw=0.75):
    c.setLineWidth(lw)
    c.setStrokeColor(INK)
    c.rect(x, Y(top + h), w, h, stroke=1, fill=0)


def hline(x1, x2, top, lw=0.6):
    c.setLineWidth(lw)
    c.setStrokeColor(INK)
    c.line(x1, Y(top), x2, Y(top))


def vline(x, t1, t2, lw=0.75):
    c.setLineWidth(lw)
    c.setStrokeColor(INK)
    c.line(x, Y(t1), x, Y(t2))


def heading(top, s, size=9.5):
    text(CX, top, s, font="Helvetica-Bold", size=size, align="center")


# ---- Header -------------------------------------------------------------
tfield("Citation Number", 270, 14, 90, 20, size=15, tip="Citation number", color=RED)
from reportlab.pdfbase.pdfmetrics import stringWidth
# Logo is 282x212 px; its swoosh occupies rows 156-164 and ends near column 281
LS = 0.36
c.drawImage(LOGO, 10, Y(28 + 212 * LS), width=282 * LS, height=212 * LS)
SW = colors.HexColor("#141414")
p = c.beginPath()
p.moveTo(10 + 262 * LS, Y(28 + 156 * LS)); p.lineTo(299, Y(28 + 158.5 * LS))
p.lineTo(299, Y(28 + 162 * LS)); p.lineTo(10 + 262 * LS, Y(28 + 165 * LS))
p.close()
c.setFillColor(SW)
c.drawPath(p, stroke=0, fill=1)
title = "VIOLATION NOTICE"
text(104.4, 68.4, title, font="Helvetica-Bold",
     size=174 / stringWidth(title, "Helvetica-Bold", 1), color=TITLE)
tag = "LAKE MERWIN CAMPERS HIDEAWAY"
text(109, 82, tag, font="Times-Bold", size=168 / stringWidth(tag, "Times-Bold", 1), color=TITLE)
text(102, 100, "24706 NE Columbia Tie Rd.,  Amboy WA, 98601     PH: (360) 247-5589",
     font="Helvetica-Bold", size=5.3)
heading(112, "Warning • Citation • Enforcement Action", size=9.5)

# ---- Date / Time / Issued By -------------------------------------------
t = 116
cols = [L, 138, 246, R]
rect(L, t, R - L, 34)
hline(L, R, t + 17, lw=0.75)
for x in cols[1:-1]:
    vline(x, t, t + 34)
for (x0, x1), lbl in zip(zip(cols, cols[1:]), ["Date", "Time", "Issued By"]):
    text(x0 + 4, t + 9, lbl)
    tfield(lbl, x0 + 2, t + 18, x1 - x0 - 4, 15)

# ---- Responsible party --------------------------------------------------
heading(161, "RESPONSIBLE PARTY")
t = 166
lc = 125
rect(L, t, R - L, 36)
for i in (1, 2):
    hline(L, R, t + 12 * i, lw=0.75)
vline(lc, t, t + 36)
for i, lbl in enumerate(["Name", "Block/Site Or Address", "Status"]):
    text(L + 4, t + 12 * i + 8.6, lbl)
tfield("Name", lc + 2, t + 1, R - lc - 4, 11)
tfield("Block/Site Or Address", lc + 2, t + 13, R - lc - 4, 11)
x = lc + 6
for lbl, dx in [("Member", 47), ("Guest", 42), ("Contractor", 55), ("Vendor", 40)]:
    cbox(f"Status {lbl}", x, t + 26.5, lbl)
    x += dx

# ---- Violation category -------------------------------------------------
heading(215, "VIOLATION CATEGORY")
cats = [
    ["General", "Vehicle/Traffic", "Waterfront/Moorage"],
    ["Tree/Greenspace", "Noise/Nuisance", "Garbage/Littering"],
    ["Camp Endangerment", "Campsite Usage", "Acts of Deception"],
]
for col, xx in zip(cats, [L, 145, 266]):
    for i, lbl in enumerate(col):
        cbox(f"Category {lbl}", xx, 221 + 13 * i, lbl)
cbox("Category Other", L, 260, "Other:")
hline(62, R, 267)
tfield("Category Other Text", 62, 257, R - 62, 11)

# ---- Rule / fine --------------------------------------------------------
heading(279, "RULE / FINE")
t = 284
mc = 205
rect(L, t, R - L, 24)
hline(L, R, t + 12, lw=0.75)
vline(mc, t, t + 24)
text(L + 4, t + 8.6, "Item #")
text(mc + 4, t + 8.6, "Fine Amount")
text(mc + 4, t + 20.6, "$")
tfield("Item Number", L + 2, t + 13, mc - L - 4, 11)
tfield("Fine Amount", mc + 11, t + 13, R - mc - 13, 11)

x = L
for lbl, dx in [("Warning", 47), ("Fine Issued", 57), ("Suspension Review", 86), ("Corrective Action Required", 0)]:
    cbox(f"Outcome {lbl}", x, 312, lbl)
    x += dx

# ---- Vehicle / watercraft ----------------------------------------------
text(L, 331, "OPTIONAL VEHICLE / WATERCRAFT", font="Helvetica-Bold", size=7.5)
text(L, 344, "Vehicle Make/Model")
hline(98, 192, 344)
tfield("Vehicle Make Model", 98, 334, 94, 11)
text(205, 344, "Vehicle Lic #:")
hline(253, R, 344)
tfield("Vehicle License", 253, 334, R - 253, 11)
text(L, 357, "Vehicle Location")
hline(89, 192, 357)
tfield("Vehicle Location", 89, 347, 103, 11)
text(209, 357, "Watercraft / Slip #:")
hline(277, R, 357)
tfield("Watercraft Slip", 277, 347, R - 277, 11)

# ---- Description --------------------------------------------------------
heading(372, "DESCRIPTION OF VIOLATION")
t = 377
rect(L, t, R - L, 43)
for i in (1, 2):
    hline(L, R, t + 14.3 * i, lw=0.75)
for i in range(3):
    tfield(f"Description Line {i + 1}", L + 3, t + 1.5 + 14.3 * i, R - L - 6, 11.5,
           tip="Description of violation")

# Incident report / pictures
from reportlab.pdfbase.pdfmetrics import stringWidth
lbl = "Incident Report Attached:"
text(L, 432, lbl, font="Helvetica-Bold", size=8)
end = L + stringWidth(lbl, "Helvetica-Bold", 8)
hline(L, 206, 433.5, lw=0.6)
tfield("Incident Report Attached", end + 3, 423, 206 - end - 3, 10.5, size=7.5,
       tip="Incident report number or reference (optional)")

lbl = "Pictures Attached:"
text(214, 432, lbl, font="Helvetica-Bold", size=8)
end = 214 + stringWidth(lbl, "Helvetica-Bold", 8)
radio("Pictures Attached", "Yes", end + 5, 425, "Yes")
radio("Pictures Attached", "No", end + 31, 425, "No")
hline(214, end + 54, 433.5, lw=0.6)

# ---- Action required ----------------------------------------------------
heading(447, "ACTION REQUIRED")
acts = [["Contact Office", "Correct Violation"], ["Remove Vehicle", "Cease Activity"],
        ["Remove Watercraft", "Submit Plan"]]
for col, xx in zip(acts, [L, 145, 266]):
    for i, lbl in enumerate(col):
        cbox(f"Action {lbl}", xx, 452 + 14 * i, lbl)
cbox("Action Other", L, 480, "Other:")
hline(62, 345, 487)
tfield("Action Other Text", 62, 477, 287, 11)

text(L, 505, "Corrective Action Required By:")
hline(140, 247, 505)
tfield("Corrective Action Required By", 140, 495, 107, 11)

# ---- Signatures ---------------------------------------------------------
text(L, 522, "SIGNATURES", font="Helvetica-Bold", size=7.5)
text(L, 536, "Member Signature:")
hline(96, 262, 536)
tfield("Member Signature", 96, 525, 166, 12)
cbox("Refused Signature", 271, 529, "Refused Signature")

text(L, 561, "Staff/Volunteer Name/Signature:")
hline(144, 345, 561)
tfield("Staff Volunteer Name Signature", 144, 550, 201, 12)

text(CX, 573, "Additional violations or failure to comply may result in additional",
     font="Helvetica-BoldOblique", size=6.4, align="center")
text(CX, 583, "fines, suspension, or termination pursuant to LMCH policies.",
     font="Helvetica-BoldOblique", size=6.4, align="center")

c.showPage()
c.save()
