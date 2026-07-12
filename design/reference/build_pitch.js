const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.3, height: 7.5 }); p.layout = "W";
const NAVY="12263A",TEAL="2FB6A8",STEEL="3E7CB1",BG="F6F8FB",PANEL="EAEFF5",INK="12263A",MUTED="6B7787",WHITE="FFFFFF",ICE="AEC3D6",TINT="E7F4F2";
const HEAD="Inter",BODY="Inter",W=13.3,H=7.5,M=0.6;
function bg(s,c){s.background={color:c};}
function footer(s,n){s.addText([{text:"BTX Precision Machining",options:{bold:true,color:MUTED}},{text:"   ·   Sales pitch · illustrative sample",options:{color:MUTED}}],{x:M,y:H-0.42,w:9,h:0.3,fontFace:BODY,fontSize:9,margin:0,valign:"middle"});s.addText(String(n),{x:W-1.1,y:H-0.42,w:0.5,h:0.3,fontFace:BODY,fontSize:9,color:MUTED,align:"right",margin:0,valign:"middle"});}
function head(s,eb,t){s.addShape(p.ShapeType.ellipse,{x:M,y:M,w:0.26,h:0.26,fill:{color:TEAL}});s.addText(eb.toUpperCase(),{x:M+0.4,y:M-0.03,w:10,h:0.3,fontFace:BODY,fontSize:11,bold:true,color:TEAL,charSpacing:2,margin:0,valign:"middle"});s.addText(t,{x:M,y:M+0.32,w:W-2*M,h:0.7,fontFace:HEAD,fontSize:30,bold:true,color:INK,margin:0});}

// SLIDE 1 — value prop cover
let s=p.addSlide();bg(s,NAVY);
s.addShape(p.ShapeType.ellipse,{x:M,y:1.9,w:0.5,h:0.5,fill:{color:TEAL}});
s.addText("BTX",{x:M,y:1.9,w:0.5,h:0.5,fontFace:HEAD,fontSize:15,bold:true,color:NAVY,align:"center",valign:"middle",margin:0});
s.addText("FOR LOCKHEED MARTIN · F-35 SUSTAINMENT",{x:M+0.7,y:1.98,w:10,h:0.36,fontFace:BODY,fontSize:12,bold:true,color:TEAL,charSpacing:2,margin:0,valign:"middle"});
s.addText("A domestic 5-axis partner with AS9100 capacity available now",{x:M,y:2.75,w:11.6,h:1.6,fontFace:HEAD,fontSize:34,bold:true,color:WHITE,margin:0});
s.addText("Build-to-print spares for lot-19, delivered on a 99.2% on-time record, with open capacity to take load off your schedule this quarter.",{x:M,y:4.5,w:11.4,h:0.9,fontFace:BODY,fontSize:15,color:ICE,margin:0});
s.addText("Prepared for a supply-chain introduction · Confidential",{x:M,y:6.5,w:11,h:0.3,fontFace:BODY,fontSize:11,color:"8AA0B6",margin:0});
s.addNotes("Value-prop cover for a specific prospect. One sentence: who we are and why now.");

// SLIDE 2 — two projections
s=p.addSlide();bg(s,BG);
head(s,"The case in figures","What this partnership is worth to both sides");
// internal chart
s.addChart(p.ChartType.bar,[{name:"BTX revenue ($M)",labels:["FY26","FY27","FY28"],values:[4.3,6.1,7.8]}],{
 x:M,y:1.65,w:5.9,h:3.7,barDir:"col",chartColors:[TEAL],showTitle:false,showLegend:false,
 showValue:true,dataLabelPosition:"outEnd",dataLabelColor:INK,dataLabelFontSize:11,dataLabelFontFace:BODY,dataLabelFormatCode:'"$"0.0"M"',
 catAxisLabelColor:INK,catAxisLabelFontFace:BODY,catAxisLabelFontSize:11,catGridLine:{style:"none"},catAxisTitle:"Fiscal year",showCatAxisTitle:true,catAxisTitleColor:MUTED,catAxisTitleFontSize:9,catAxisTitleFontFace:BODY,
 valAxisTitle:"$ millions",showValAxisTitle:true,valAxisTitleColor:MUTED,valAxisTitleFontSize:9,valAxisTitleFontFace:BODY,
 valAxisHidden:true,valGridLine:{style:"none"},barGapWidthPct:55});
s.addText([{text:"Figure 1.  ",options:{bold:true,color:INK}},{text:"Projected BTX revenue from the account, internal view ($M). Ramps to $7.8M by FY28 as lot-19 spares scale.",options:{color:MUTED}}],{x:M,y:5.45,w:5.9,h:0.8,fontFace:BODY,fontSize:9.5,margin:0,valign:"top"});
// external chart
const x2=M+6.2;
s.addChart(p.ChartType.bar,[{name:"Client value ($M/yr)",labels:["FY26","FY27","FY28"],values:[1.9,2.6,3.2]}],{
 x:x2,y:1.65,w:5.9,h:3.7,barDir:"col",chartColors:[STEEL],showTitle:false,showLegend:false,
 showValue:true,dataLabelPosition:"outEnd",dataLabelColor:INK,dataLabelFontSize:11,dataLabelFontFace:BODY,dataLabelFormatCode:'"$"0.0"M"',
 catAxisLabelColor:INK,catAxisLabelFontFace:BODY,catAxisLabelFontSize:11,catGridLine:{style:"none"},catAxisTitle:"Fiscal year",showCatAxisTitle:true,catAxisTitleColor:MUTED,catAxisTitleFontSize:9,catAxisTitleFontFace:BODY,
 valAxisTitle:"$ millions / year",showValAxisTitle:true,valAxisTitleColor:MUTED,valAxisTitleFontSize:9,valAxisTitleFontFace:BODY,
 valAxisHidden:true,valGridLine:{style:"none"},barGapWidthPct:55});
s.addText([{text:"Figure 2.  ",options:{bold:true,color:INK}},{text:"Projected value to the client, external view ($M/yr): expedite/AOG avoidance, scrap reduction, and dual-source risk relief.",options:{color:MUTED}}],{x:x2,y:5.45,w:5.9,h:0.8,fontFace:BODY,fontSize:9.5,margin:0,valign:"top"});
footer(s,2);
s.addNotes("Two projections side by side: internal (revenue to BTX) and external (value to client). Both illustrative; captions summarize each.");

// SLIDE 3 — the ask
s=p.addSlide();bg(s,BG);
head(s,"The ask","A 20-minute introduction");
const steps=[["1","Intro call","Walk your build-to-print spares scope and our current capacity windows."],["2","Capability review","Share AS9100 / ITAR docs, sample first articles, and quality record."],["3","Pilot package","Quote a first lot-19 spares package against your priority parts."]];
let cx=M;const cw=(W-2*M-0.6)/3;
steps.forEach(([n,t,d])=>{s.addShape(p.ShapeType.roundRect,{x:cx,y:1.9,w:cw,h:3.3,rectRadius:0.08,fill:{color:WHITE},line:{color:PANEL,width:1}});s.addShape(p.ShapeType.ellipse,{x:cx+0.35,y:2.25,w:0.5,h:0.5,fill:{color:TEAL}});s.addText(n,{x:cx+0.35,y:2.25,w:0.5,h:0.5,fontFace:HEAD,fontSize:20,bold:true,color:WHITE,align:"center",valign:"middle",margin:0});s.addText(t,{x:cx+0.35,y:3.0,w:cw-0.7,h:0.5,fontFace:HEAD,fontSize:17,bold:true,color:INK,margin:0});s.addText(d,{x:cx+0.35,y:3.55,w:cw-0.7,h:1.5,fontFace:BODY,fontSize:12.5,color:MUTED,margin:0});cx+=cw+0.3;});
s.addShape(p.ShapeType.roundRect,{x:M,y:5.5,w:W-2*M,h:0.95,rectRadius:0.08,fill:{color:NAVY}});
s.addText([{text:"Next step:  ",options:{bold:true,color:TEAL}},{text:"reply with a 20-minute window, or we can hold two options for your team this week.",options:{color:WHITE}}],{x:M+0.3,y:5.5,w:W-2*M-0.6,h:0.95,fontFace:BODY,fontSize:15,valign:"middle",margin:0});
footer(s,3);
s.addNotes("Clear, low-friction ask with a three-step path and a single next action.");

p.writeFile({fileName:"/sessions/compassionate-gallant-ptolemy/mnt/outputs/BTX_Sales_Pitch.pptx"}).then(f=>console.log("WROTE",f));
