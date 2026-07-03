import type { RankingExplanation } from "../../app/rankingExplain.ts";

export function RankingWhy({ explanation }: { explanation: RankingExplanation }) {
  return (
    <span className="ranking-why">
      <strong>Why ranked here?</strong>
      <span className="ranking-rationale">{explanation.rationaleLine}</span>
      <span>{explanation.driverLine}</span>
      <span>{explanation.signalLine}</span>
      <span>{explanation.actionLine}</span>
      <span>{explanation.businessContextLine}</span>
      <span>{explanation.contextLine}</span>
      <em>{explanation.evidenceLine}</em>
      <em className="ranking-disclosure">{explanation.assumptionsLine}</em>
    </span>
  );
}
