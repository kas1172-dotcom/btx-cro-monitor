# -*- coding: utf-8 -*-
import cairosvg

W, H = 816, 1056
NAVY="#12263A"; TEAL="#2FB6A8"; STEEL="#3E7CB1"; INK="#12263A"; MUTED="#6B7787"
PANEL="#EAEFF5"; TINT="#E7F4F2"; GREEN="#3FA66A"; AMBER="#E0A93B"; LINE="#D8E0EA"
WHITE="#FFFFFF"; ICE="#AEC3D6"
F='font-family="Inter, Arial, sans-serif"'
e=[]
def esc(s): return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def rect(x,y,w,h,fill,rx=0,stroke=None,sw=1):
    s=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"'
    if stroke: s+=f' stroke="{stroke}" stroke-width="{sw}"'
    e.append(s+'/>')
def circ(cx,cy,r,fill): e.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>')
def txt(x,y,s,size,fill,bold=False,anchor="start",spacing=None,italic=False):
    w='font-weight="700"' if bold else 'font-weight="400"'
    it='font-style="italic"' if italic else ''
    ls=f'letter-spacing="{spacing}"' if spacing else ''
    e.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" {F} {w} {it} {ls} text-anchor="{anchor}">{esc(s)}</text>')

# background
rect(0,0,W,H,WHITE)
# ---- header band ----
rect(0,0,W,150,NAVY)
circ(70,58,22,TEAL); txt(70,64,"BTX",15,NAVY,bold=True,anchor="middle")
txt(102,54,"BTX PRECISION MACHINING",12,TEAL,bold=True,spacing="2.5")
txt(102,72,"Aerospace & Defense · AS9100D · ITAR",11,ICE)
txt(44,118,"Capabilities Assessment",34,WHITE,bold=True)
txt(W-44,60,"CONFIDENTIAL",10,ICE,anchor="end",spacing="2")
txt(W-44,120,"Prepared for: Lockheed Martin · F-35 Sustainment",12,ICE,anchor="end")

M=44; y=176
# ---- fit callout row: context card + fit card ----
rect(M,y,470,86,WHITE,rx=8,stroke=LINE);
txt(M+22,y+30,"OPPORTUNITY",10,TEAL,bold=True,spacing="2")
txt(M+22,y+55,"F-35 lot-19 sustainment: build-to-print spares",13.5,INK,bold=True)
txt(M+22,y+74,"Matched to BTX 5-axis capacity and AS9100 line.",11,MUTED)
rect(M+486,y,242,86,NAVY,rx=8)
txt(M+506,y+34,"CAPABILITY FIT",10,TEAL,bold=True,spacing="2")
txt(M+506,y+72,"91%",40,WHITE,bold=True)
y+=112

# ---- core capabilities ----
txt(M,y,"Core capabilities",17,INK,bold=True); y+=16
caps=[
 ("5-axis CNC machining","Complex geometries, single-setup"),
 ("Build-to-print","From customer models and specs"),
 ("Precision turning","Swiss + multi-axis, ±0.0002 in"),
 ("Assembly & kitting","Sub-assembly, integration, kitting"),
 ("CMM metrology","Full first-article + in-process"),
 ("Special processes","Coordinated NDT, finishing, coatings"),
]
cw=(W-2*M-2*14)/3; ch=76
for i,(t,d) in enumerate(caps):
    cx=M+(i%3)*(cw+14); cy=y+(i//3)*(ch+14)
    rect(cx,cy,cw,ch,WHITE,rx=8,stroke=LINE)
    circ(cx+26,cy+28,7,TEAL)
    txt(cx+44,cy+32,t,12.5,INK,bold=True)
    txt(cx+20,cy+56,d,10.5,MUTED)
y+=2*ch+14+26

# ---- certifications ----
txt(M,y,"Certifications & compliance",17,INK,bold=True); y+=18
certs=["AS9100D","ITAR Registered","NIST SP 800-171","CMMC Level 2","DFARS 252.204","Nadcap (NDT)"]
cx=M
for c in certs:
    wpill=20+len(c)*7.2
    rect(cx,y,wpill,26,TINT,rx=13,stroke="#BFE3DD")
    txt(cx+wpill/2,y+17,c,11,"#1E8C7E",bold=True,anchor="middle")
    cx+=wpill+10
y+=52

# ---- current production capacity ----
txt(M,y,"Current production capacity",17,INK,bold=True)
txt(W-M,y,"available capacity highlighted",10.5,MUTED,anchor="end",italic=True); y+=14
# table
rows=[("Facility","5-axis centers","Shifts","Utilization","Available"),
      ("Fort Worth, TX","8","2","93%","Q1 FY27"),
      ("Wichita, KS","5","2","88%","Limited"),
      ("Tulsa, OK","6","1","71%","Now")]
colx=[M+16, M+250, M+380, M+470, M+590]
rh=34; ty=y
rect(M,ty,W-2*M,rh,NAVY,rx=6)
for cxi,head in zip(colx,rows[0]):
    txt(cxi,ty+22,head,11,WHITE,bold=True)
ty+=rh
for ri,r in enumerate(rows[1:]):
    fill=WHITE if ri%2 else PANEL
    rect(M,ty,W-2*M,rh,fill)
    for ci,(cxi,val) in enumerate(zip(colx,r)):
        col=INK
        if ci==4: col=GREEN if val=="Now" else (AMBER if val in("Limited","Q1 FY27") else INK)
        txt(cxi,ty+22,val,11.5,col,bold=(ci==0 or ci==4))
    ty+=rh
rect(M,y,W-2*M,rh*4,"none",rx=6,stroke=LINE)
y=ty+30

# ---- materials + track record (two columns) ----
colw=(W-2*M-18)/2
# materials
rect(M,y,colw,132,WHITE,rx=8,stroke=LINE)
txt(M+20,y+28,"Materials & tolerances",13.5,INK,bold=True)
for i,ln in enumerate(["Titanium, Inconel & nickel alloys","Aluminum, stainless & specialty steels","Tolerances to ±0.0002 in","Part envelope to 40 in, 5-axis"]):
    circ(M+26,y+50+i*20-4,3,TEAL); txt(M+40,y+50+i*20,ln,11,MUTED)
# track record
rx0=M+colw+18
rect(rx0,y,colw,132,WHITE,rx=8,stroke=LINE)
txt(rx0+20,y+28,"Track record",13.5,INK,bold=True)
tr=[("20+ yrs","supplying tier-1 aerospace primes"),("99.2%","on-time delivery (trailing 12 mo)"),("<15 PPM","quality escape rate"),("100%","ITAR-compliant data handling")]
for i,(a,b) in enumerate(tr):
    txt(rx0+20,y+50+i*20,a,11.5,TEAL,bold=True)
    txt(rx0+96,y+50+i*20,b,11,MUTED)
y+=132+22

# ---- footer / provenance ----
rect(M,y,W-2*M,52,TINT,rx=8,stroke="#BFE3DD")
txt(M+18,y+21,"SOURCE",9,"#1E8C7E",bold=True,spacing="2")
txt(M+18,y+40,"Fit computed from BTX capability match to F-35 lot-19 program scope · illustrative sample.",10.5,MUTED)
txt(W-44,H-24,"BTX Precision Machining  ·  sales@btx.example  ·  Confidential",9.5,MUTED,anchor="end")

svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'+ "".join(e) + "</svg>"
open("/sessions/compassionate-gallant-ptolemy/mnt/outputs/_caps.svg","w").write(svg)
cairosvg.svg2pdf(bytestring=svg.encode(), write_to="/sessions/compassionate-gallant-ptolemy/mnt/outputs/BTX_Capabilities_Assessment.pdf")
cairosvg.svg2png(bytestring=svg.encode(), write_to="/sessions/compassionate-gallant-ptolemy/mnt/outputs/_caps_preview.png", output_width=1000, output_height=1294)
print("OK")
