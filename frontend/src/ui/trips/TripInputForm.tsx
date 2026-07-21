import { useMemo, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { defaultDateAnchor, defaultTripWindow } from "../../app/dateDefaults.ts";

export interface TripFormValues {
  city: string;
  startDate: string;
  endDate: string;
  focus: "prospecting" | "customers" | "mixed";
  instructions: string;
}

export function TripInputForm({ world, onSubmit, busy = false }: { world: World; onSubmit(values: TripFormValues): void; busy?: boolean }) {
  const tripDefaults = defaultTripWindow(defaultDateAnchor(world));
  const cities = useMemo(() => [...new Set(world.companies.map((company) => company.location.city).filter(Boolean))].sort(), [world]);
  const [city, setCity] = useState(world.city ?? cities[0] ?? "Austin");
  const [startDate, setStartDate] = useState(tripDefaults.startDate);
  const [endDate, setEndDate] = useState(tripDefaults.endDate);
  const [focus, setFocus] = useState<TripFormValues["focus"]>("mixed");
  const [instructions, setInstructions] = useState("Prioritize the two demo journeys when they fit the market, then keep the trip practical.");

  return (
    <form
      className="trip-input-form surface-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ city, startDate, endDate, focus, instructions });
      }}
    >
      <div className="panel-head">
        <h2>Trip setup</h2>
        <span>Grounded itinerary</span>
      </div>
      <div className="trip-form-row">
        <label>
          Market
          <select value={city} onChange={(event) => setCity(event.target.value)} required>
            {cities.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Focus
          <select value={focus} onChange={(event) => setFocus(event.target.value as TripFormValues["focus"])}>
            <option value="mixed">Mixed</option>
            <option value="prospecting">Prospecting</option>
            <option value="customers">Customers</option>
          </select>
        </label>
      </div>
      <div className="trip-form-row">
        <label>
          Start
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
        </label>
        <label>
          End
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
        </label>
      </div>
      <label>
        Emphasis
        <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} />
      </label>
      <button type="submit" className="accent-action-button" disabled={busy || !city || !startDate || !endDate}>
        {busy ? "Generating..." : "Generate itinerary"}
      </button>
    </form>
  );
}
