# -*- coding: utf-8 -*-
import cairosvg
W,H=816,1056
NAVY="#12263A";TEAL="#2FB6A8";INK="#12263A";MUTED="#6B7787";PANEL="#EAEFF5"
TINT="#E7F4F2";LINE="#D8E0EA";WHITE="#FFFFFF";ICE="#AEC3D6"
F='font-family="Inter, Arial, sans-serif"'
e=[]
def esc(s):return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def rect(x,y,w,h,fill,rx=0,stroke=None,sw=1):
    s=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"'
    if stroke:s+=f' stroke="{stroke}" stroke-width="{sw}"'
    e.append(s+'/>')
def circ(cx,cy,r,fill):e.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"/>')
def txt(x,y,s,size,fill,bold=False,anchor="start",spacing=None,italic=False):
    w='font-weight="700"' if bold else 'font-weight="400"'
    it='font-style="italic"' if italic else ''
    ls=f'letter-spacing="{spacing}"' if spacing else ''
    e.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" {F} {w} {it} {ls} text-anchor="{anchor}">{esc(s)}</text>')
def para(x,y,lines,size,fill,lh):
    for i,ln in enumerate(lines):txt(x,y+i*lh,ln,size,fill)

rect(0,0,W,H,WHITE)
# header
rect(0,0,W,120,NAVY)
circ(70,54,22,TEAL);txt(70,60,"BTX",15,NAVY,bold=True,anchor="middle")
txt(102,50,"BTX PRECISION MACHINING",12,TEAL,bold=True,spacing="2.5")
txt(102,68,"Outreach draft · prepared for review before sending",11,ICE)
txt(W-44,60,"DRAFT",11,ICE,anchor="end",spacing="2")

M=54;y=158
# meta
for lbl,val in [("To","J. Rivera, Supply Chain, Lockheed Martin Aeronautics"),
                ("From","VP Sales, BTX Precision Machining"),
                ("Subject","5-axis capacity for F-35 lot-19 build-to-print spares")]:
    txt(M,y,lbl.upper(),10,TEAL,bold=True,spacing="1.5")
    txt(M+70,y,val,12.5,INK,bold=(lbl=="Subject"))
    y+=26
y+=6;rect(M,y,W-2*M,1,LINE);y+=30

txt(M,y,"Hi Jordan,",13.5,INK);y+=30
body=[
 "Congratulations on the F-35 lot-19 sustainment award. As spares volume ramps",
 "into FY27, I wanted to introduce BTX as a domestic partner with open 5-axis",
 "capacity right now.",
 "",
 "We are an AS9100D, ITAR-registered precision machining shop specializing in",
 "build-to-print work for aerospace primes. Against the lot-19 spares scope we",
 "assess a 91% capability fit, and we hold a trailing-12-month on-time delivery",
 "rate of 99.2% with a sub-15 PPM quality escape rate.",
 "",
 "Would you be open to a 20-minute call to walk through your build-to-print",
 "spares needs and where our current capacity could take load off your schedule?",
]
para(M,y,body,12.5,INK,21);y+=len(body)*21+8
txt(M,y,"Best regards,",12.5,INK);y+=22
txt(M,y,"Alex Chen · VP Sales · BTX Precision Machining",12.5,INK,bold=True);y+=18
txt(M,y,"alex.chen@btx.example · (682) 555-0140",11.5,MUTED);y+=34

# why-now evidence box
rect(M,y,W-2*M,96,TINT,rx=8,stroke="#BFE3DD")
txt(M+20,y+26,"WHY NOW · EVIDENCE",10,"#1E8C7E",bold=True,spacing="1.5")
txt(M+20,y+50,"Signal: “Lockheed awards F-35 lot-19 sustainment; spares volume rises into FY27.”",11.5,INK,bold=True)
txt(M+20,y+72,"Source: monitor artifact → Lockheed Martin Corp (CAGE 81755) · match: CAGE + program (F-35) · high confidence",10.5,MUTED)
y+=96+22
txt(M,y,"Draft only. Review recipient, tone, and claims before sending; on approval this creates a HubSpot task and logs the send.",10.5,MUTED,italic=True)
txt(W-54,H-28,"BTX Precision Machining  ·  Confidential draft  ·  Illustrative sample",9.5,MUTED,anchor="end")

svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'+"".join(e)+"</svg>"
cairosvg.svg2pdf(bytestring=svg.encode(),write_to="/sessions/compassionate-gallant-ptolemy/mnt/outputs/BTX_Outreach_Draft.pdf")
cairosvg.svg2png(bytestring=svg.encode(),write_to="/sessions/compassionate-gallant-ptolemy/mnt/outputs/_outreach_preview.png",output_width=1000,output_height=1294)
print("OK")
