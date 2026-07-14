/**
 * Account status ring: a small token whose ring color reflects account
 * health, derived from the existing risk-dimension score (no new backend
 * data). Used in Account 360's account list and the Map's account markers.
 */
export type AccountHealthTier = "growing" | "at-risk" | "churned";

export function accountHealthTier(riskScore: number | undefined): AccountHealthTier {
  const risk = riskScore ?? 0;
  if (risk >= 66) return "churned";
  if (risk >= 33) return "at-risk";
  return "growing";
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function AccountToken({ name, riskScore, size = "md" }: { name: string; riskScore: number | undefined; size?: "sm" | "md" }) {
  const tier = accountHealthTier(riskScore);
  return (
    <span className={`account-token account-token-${size} account-token-${tier}`} title={`${name} · ${tier.replace("-", " ")}`}>
      {initials(name)}
    </span>
  );
}
