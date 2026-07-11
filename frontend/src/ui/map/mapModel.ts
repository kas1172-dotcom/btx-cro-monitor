import type { Company } from "../../engine/brain/entities.ts";
import type { CompanyScore } from "../../engine/decision/score.ts";

const FALLBACK_CENTER: [number, number] = [31.5, -97];

const avg = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0);

function isProspect(rel: string): boolean {
  return rel === "target" || rel === "customer";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface MapPoint {
  company: Company;
  lat: number;
  lon: number;
}

export interface MapMarker {
  company: Company;
  center: [number, number];
  opportunity: number;
  prospect: boolean;
  radius: number;
}

type CoordinateFallback = {
  canonical_account_lat?: unknown;
  canonical_account_lon?: unknown;
  canonical_lat?: unknown;
  canonical_lon?: unknown;
};

export function coordinateForCompany(company: Company): [number, number] | null {
  if (finite(company.location?.lat) && finite(company.location?.lon)) return [company.location.lat, company.location.lon];
  if (finite(company.canonical_location?.lat) && finite(company.canonical_location?.lon)) {
    return [company.canonical_location.lat, company.canonical_location.lon];
  }
  const fallback = company as Company & CoordinateFallback;
  if (finite(fallback.canonical_account_lat) && finite(fallback.canonical_account_lon)) {
    return [fallback.canonical_account_lat, fallback.canonical_account_lon];
  }
  if (finite(fallback.canonical_lat) && finite(fallback.canonical_lon)) {
    return [fallback.canonical_lat, fallback.canonical_lon];
  }
  return null;
}

export function mappableCompanies(companies: Company[]): MapPoint[] {
  return companies.flatMap((company) => {
    const coordinate = coordinateForCompany(company);
    return coordinate ? [{ company, lat: coordinate[0], lon: coordinate[1] }] : [];
  });
}

export function mapCenter(points: MapPoint[]): [number, number] {
  return points.length ? [avg(points.map((point) => point.lat)), avg(points.map((point) => point.lon))] : FALLBACK_CENTER;
}

function scoreForCompany(company: Company, byId: Map<string, CompanyScore>): CompanyScore | undefined {
  return byId.get(company.id)
    ?? (company.canonical_account_id ? byId.get(company.canonical_account_id) : undefined);
}

export function opportunityRadius(opportunity: number, prospect: boolean): number {
  return prospect ? Math.min(16, 7 + opportunity / 12) : 5;
}

export function buildMapMarkers(companies: Company[], byId: Map<string, CompanyScore>): MapMarker[] {
  return mappableCompanies(companies).map((point) => {
    const opportunity = scoreForCompany(point.company, byId)?.dimensions.opportunity.score ?? 0;
    const prospect = isProspect(point.company.relationship);
    return {
      company: point.company,
      center: [point.lat, point.lon] as [number, number],
      opportunity,
      prospect,
      radius: opportunityRadius(opportunity, prospect),
    };
  });
}
