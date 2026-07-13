import { useMemo, useState } from "react";
import type { BusinessMotion } from "../../engine/brain/entities.ts";
import { defaultDateAnchor, defaultTripWindow } from "../../app/dateDefaults.ts";
import type { World } from "../../app/useWorld.ts";

export interface TripFormValues {
  region: string;
  radius: number;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  goals: BusinessMotion[];
  eventAnchor?: {
    name?: string;
    date?: string;
  };
  meetingCapacity: number;
}

const GOALS: Array<{ id: BusinessMotion; label: string }> = [
  { id: "grow_existing_business", label: "Grow existing business" },
  { id: "manage_current_business", label: "Manage current business" },
  { id: "reduce_risk", label: "Reduce risk" },
  { id: "prospect_new_business", label: "Prospect new business" },
];

export function TripInputForm({ world, onSubmit, busy = false }: { world: World; onSubmit(values: TripFormValues): void; busy?: boolean }) {
  const tripDefaults = defaultTripWindow(defaultDateAnchor(world));
  const regions = useMemo(() => ["All markets", ...new Set(world.companies.map((company) => company.location.city).filter(Boolean))].sort(), [world]);
  const [region, setRegion] = useState(world.city ?? "All markets");
  const [radius, setRadius] = useState(90);
  const [startDate, setStartDate] = useState(tripDefaults.startDate);
  const [endDate, setEndDate] = useState(tripDefaults.endDate);
  const [goals, setGoals] = useState<BusinessMotion[]>(["prospect_new_business", "grow_existing_business"]);
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [meetingCapacity, setMeetingCapacity] = useState(6);

  function toggleGoal(goal: BusinessMotion) {
    setGoals((current) => {
      if (current.includes(goal)) return current.length === 1 ? current : current.filter((item) => item !== goal);
      return [...current, goal];
    });
  }

  function submitValues() {
    onSubmit({
      region,
      radius,
      dateRange: { startDate, endDate },
      goals,
      eventAnchor: eventName || eventDate ? { name: eventName, date: eventDate } : undefined,
      meetingCapacity,
    });
  }

  return (
    <form
      className="trip-input-form surface-panel"
      onSubmit={(event) => {
        event.preventDefault();
        submitValues();
      }}
    >
      <div className="panel-head">
        <h2>Plan a trip</h2>
        <span>Form first</span>
      </div>
      <label>
        Region
        <input list="trip-regions" value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Austin" required />
        <datalist id="trip-regions">
          {regions.map((item) => <option key={item} value={item} />)}
        </datalist>
      </label>
      <label>
        Radius
        <input type="number" min={1} max={500} value={radius} onChange={(event) => setRadius(Number(event.target.value))} />
      </label>
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
      <fieldset>
        <legend>Goals</legend>
        <div className="trip-goals">
          {GOALS.map((goal) => (
            <label key={goal.id}>
              <input type="checkbox" checked={goals.includes(goal.id)} onChange={() => toggleGoal(goal.id)} />
              {goal.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="trip-form-row">
        <label>
          Event anchor
          <input value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="AUSA, supplier visit, customer QBR" />
        </label>
        <label>
          Event date
          <input value={eventDate} onChange={(event) => setEventDate(event.target.value)} placeholder="2026-08-12 or same week" />
        </label>
      </div>
      <label>
        Meeting capacity
        <input type="number" min={1} max={20} value={meetingCapacity} onChange={(event) => setMeetingCapacity(Number(event.target.value))} />
      </label>
      <button type="button" className="accent-action-button" disabled={busy || goals.length === 0 || !region || !startDate || !endDate} onClick={submitValues}>
        {busy ? "Generating..." : "Generate trip plan"}
      </button>
    </form>
  );
}
