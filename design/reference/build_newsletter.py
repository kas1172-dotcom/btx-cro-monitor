# -*- coding: utf-8 -*-
import cairosvg
W,H=816,1056
NAVY="#12263A";TEAL="#2FB6A8";STEEL="#3E7CB1";INK="#12263A";MUTED="#6B7787"
PANEL="#EAEFF5";TINT="#E7F4F2";LINE="#D8E0EA";WHITE="#FFFFFF";ICE="#AEC3D6"
GREEN="#3FA66A";AMBER="#E0A93B"
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

rect(0,0,W,H,WHITE)
# masthead
rect(0,0,W,132,NAVY)
circ(70,52,22,TEAL);txt(70,58,"BTX",15,NAVY,bold=True,anchor="middle")
txt(102,44,"BTX DEFENSE SIGNAL",20,WHITE,bold=True,spacing="1")
txt(102,66,"Monthly market brief for the revenue team",11.5,ICE)
txt(W-44,44,"JULY 2026",12,TEAL,bold=True,anchor="end",spacing="1.5")
txt(W-44,64,"Issue 07 · Internal",10.5,ICE,anchor="end")
txt(54,108,"Three moves in the defense-machining market, and what each means for BTX pipeline.",12,ICE)

M=54;y=168
stories=[
 ("01","F-35 lot-19 sustainment award lands at Lockheed",GREEN,
  "Lockheed booked the F-35 lot-19 sustainment award; spares demand steps up through FY27.",
  "$2.4B","award value, multi-year",
  "Build-to-print spares are squarely in our 5-axis, AS9100 lane. Priority outreach opened; 91% fit."),
 ("02","Spirit AeroSystems signals a structures schedule slip",AMBER,
  "Spirit flagged schedule pressure on structures; two programs need a domestic AS9100 machining partner.",
  "2 programs","seeking re-shore capacity",
  "A qualification lane for us. BD to scope fit and confirm certifications this month."),
 ("03","DoD FY27 budget lifts precision-component demand",STEEL,
  "The FY27 request increases funding lines tied to precision aerospace components and sustainment.",
  "+8%","YoY in relevant lines",
  "Sector tailwind for the whole target list. Portfolio-level signal; not tied to one account."),
]
for num,head,accent,tell,stat,statsub,sowhat in stories:
    bh=250
    rect(M,y,W-2*M,bh,WHITE,rx=10,stroke=LINE)
    circ(M+34,y+40,17,accent);txt(M+34,y+46,num,14,WHITE,bold=True,anchor="middle")
    txt(M+68,y+46,head,15.5,INK,bold=True)
    # tell me
    txt(M+24,y+82,"TELL ME",9.5,TEAL,bold=True,spacing="1.5")
    txt(M+24,y+104,tell,11.5,INK)
    # show me (stat callout) + so what — two columns
    colw=(W-2*M-48)/2
    sx=M+24; syy=y+124
    rect(sx,syy,colw,96,TINT,rx=8)
    txt(sx+18,syy+26,"SHOW ME",9.5,"#1E8C7E",bold=True,spacing="1.5")
    txt(sx+18,syy+66,stat,30,INK,bold=True)
    txt(sx+18,syy+86,statsub,10.5,MUTED)
    wx=M+24+colw+16
    rect(wx,syy,colw,96,PANEL,rx=8)
    txt(wx+18,syy+26,"SO WHAT",9.5,NAVY,bold=True,spacing="1.5")
    # wrap so-what to ~2 lines
    words=sowhat.split();lines=[];cur=""
    for wd in words:
        if len(cur+" "+wd)>46:lines.append(cur);cur=wd
        else:cur=(cur+" "+wd).strip()
    lines.append(cur)
    for i,ln in enumerate(lines[:3]):txt(wx+18,syy+50+i*18,ln,11,INK)
    y+=bh+16

# footer
rect(M,y,W-2*M,58,TINT,rx=8,stroke="#BFE3DD")
txt(M+18,y+23,"SOURCES",9.5,"#1E8C7E",bold=True,spacing="1.5")
txt(M+18,y+43,"Monitor-engine market artifacts · HubSpot CRM · SAM.gov · DoD budget documents. Account links via canonical relationship records.",10,MUTED)
txt(W-54,H-26,"BTX Defense Signal · Internal monthly brief · Illustrative sample data",9.5,MUTED,anchor="end")

svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'+"".join(e)+"</svg>"
cairosvg.svg2pdf(bytestring=svg.encode(),write_to="/sessions/compassionate-gallant-ptolemy/mnt/outputs/BTX_Monthly_Newsletter.pdf")
cairosvg.svg2png(bytestring=svg.encode(),write_to="/sessions/compassionate-gallant-ptolemy/mnt/outputs/_news_preview.png",output_width=1000,output_height=1294)
print("OK")
