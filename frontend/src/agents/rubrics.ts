export const AGENT_RUBRICS = {
  weekly_memo:
    "Open with a verdict, then the strongest evidence, then what the CRO should do. Keep recommendations concise, specific, and sourced.",
  meeting_brief:
    "Make the brief account-specific. Talking points must connect a validated signal to a provided company capability in 1-2 full sentences. Avoid generic filler.",
  itinerary:
    "Make every stop practical. Explain why visit, why now, who to talk to, and one specific company capability hook. Avoid route optimization claims.",
  board_deck:
    "Deck headlines must be so-whats, not labels. Executive summary is verdict-first: verdict, evidence, implication. Board prose must be concise.",
  outreach:
    "Draft outreach in 120 words or fewer. Include one specific hook from provided evidence, no flattery filler, no invented claims.",
  analysis_annotation:
    "Explain what changed, why it matters, and what decision it supports. Use only provided metric facts and provenance.",
  sales_pitch:
    "Create a prospect-facing one-pager under 250 words. Plain language, specific proof, clear ask. Do not expose internal scores, records, or workflow terms.",
  capabilities_assessment:
    "Write an internal should-we-chase-this assessment. Label inference, show fit line by line, be honest about gaps and constraints, and make the verdict vary with fit and capacity.",
} as const;
