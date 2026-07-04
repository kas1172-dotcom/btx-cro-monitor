import type { Company, Facility, Location } from "../engine/brain/entities.ts";

/** Returns "1 deal" / "3 deals" — zero falls back to the provided zero phrase if given. */
export function plural(n: number, unit: string, zeroPhrasing?: string): string {
  if (n === 0 && zeroPhrasing) return zeroPhrasing;
  return `${n} ${n === 1 ? unit : `${unit}s`}`;
}

export function formatAddress(location: Location | Pick<Facility, "address" | "city" | "state" | "postal_code" | "country">): string | null {
  const parts = [
    location.address,
    [location.city, location.state].filter(Boolean).join(", "),
    location.postal_code,
    location.country,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export function companyLinks(company: Company): Array<{ label: string; url: string }> {
  return [
    company.website_url ? { label: "Website", url: company.website_url } : null,
    company.linkedin_url ? { label: "LinkedIn", url: company.linkedin_url } : null,
    company.source_url ? { label: "Source", url: company.source_url } : null,
  ].filter((item): item is { label: string; url: string } => Boolean(item));
}
