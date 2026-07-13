import { useEffect, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { useStore } from "../../store/store.ts";
import type { MetricId } from "../../metrics/types.ts";
import { dispatchBrainQuestion } from "../../app/brainActions.ts";
import { defaultDateAnchor, defaultTripWindow, quarterOptions } from "../../app/dateDefaults.ts";

const ACTIONS = [
  "Plan a trip",
  "Meeting brief",
  "Weekly brief",
  "Board deck",
  "Analysis view",
  "Draft outreach",
  "Sales pitch",
  "Capabilities assessment",
];

const PREFILLS: Record<string, string> = {
  "Plan a trip": "I'm in Austin next week. Who should I talk to?",
  "Meeting brief": "Create a meeting brief for the top opportunity.",
  "Weekly brief": "What should I care about this week?",
  "Board deck": "Generate a quarterly board deck.",
  "Analysis view": "Show revenue by client by quarter.",
  "Draft outreach": "Draft outreach for the top opportunity.",
  "Sales pitch": "Draft a sales pitch for the top opportunity.",
  "Capabilities assessment": "Can we actually serve the top opportunity?",
};

interface WorkStage {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "fallback";
}

const INITIAL_STAGES: WorkStage[] = [
  { id: "routed", label: "Routing question", status: "pending" },
  { id: "retrieved", label: "Retrieving accounts and signals", status: "pending" },
  { id: "scored", label: "Scoring relevant opportunities", status: "pending" },
  { id: "composing", label: "Composing the answer", status: "pending" },
];

export function AskBrainBar({ world, large = false, seedPrompt }: { world: World; large?: boolean; seedPrompt?: string }) {
  const { askDraftPrompt } = useStore();
  const [question, setQuestion] = useState(seedPrompt ?? "");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [workingQuestion, setWorkingQuestion] = useState<string | null>(null);
  const [workingStages, setWorkingStages] = useState<WorkStage[]>(INITIAL_STAGES);
  const [showWorking, setShowWorking] = useState(false);
  const [accountId, setAccountId] = useState(world.prospects[0]?.company.id ?? world.companies[0]?.id ?? "");
  const [tripCity, setTripCity] = useState(world.city ?? "Austin");
  const tripDefaults = defaultTripWindow(defaultDateAnchor(world));
  const quarters = quarterOptions(defaultDateAnchor(world));
  const [startDate, setStartDate] = useState(tripDefaults.startDate);
  const [endDate, setEndDate] = useState(tripDefaults.endDate);
  const [quarter, setQuarter] = useState(quarters[0]);
  const [metric, setMetric] = useState<MetricId>("revenue");
  const [instructions, setInstructions] = useState("");
  const cities = [...new Set(world.companies.map((c) => c.location.city))].sort();
  const accounts = world.prospects.map((p) => p.company);

  useEffect(() => {
    if (!pendingAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingAction(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingAction]);

  useEffect(() => {
    if (askDraftPrompt) setQuestion(askDraftPrompt);
  }, [askDraftPrompt]);

  useEffect(() => {
    if (!askDraftPrompt && !question && seedPrompt) setQuestion(seedPrompt);
  }, [askDraftPrompt, question, seedPrompt]);

  function updateStage(id: string, patch: Partial<WorkStage>) {
    setWorkingStages((stages) => stages.map((stage) => stage.id === id ? { ...stage, ...patch } : stage));
  }

  async function submit(text: string) {
    const q = text.trim();
    if (!q) return;
    let showTimer: number | undefined;
    setWorkingQuestion(q);
    setShowWorking(false);
    setWorkingStages(INITIAL_STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? "active" : "pending" })));
    showTimer = window.setTimeout(() => setShowWorking(true), 300);
    try {
      await dispatchBrainQuestion(q, world, {
        accountId,
        city: tripCity,
        startDate,
        endDate,
        quarter,
        metric,
        instructions,
      }, {
        routed: (response, usedFallback) => updateStage("routed", {
          status: usedFallback ? "fallback" : "done",
          label: usedFallback
            ? `Using offline fallback · ${response.activatedBrainAreas.join(", ")}`
            : `Routed: ${response.activatedBrainAreas.join(", ")}`,
        }),
        retrieved: (response) => updateStage("retrieved", {
          status: "done",
          label: `Retrieved ${response.relatedOpportunities.length} accounts, ${response.contextUsed.length} context sources`,
        }),
        scored: (_response, scoredCount) => updateStage("scored", { status: "done", label: `Scored ${scoredCount} opportunities` }),
        composing: (label) => updateStage("composing", { status: "active", label }),
      });
      updateStage("composing", { status: "done" });
      setQuestion("");
    } finally {
      if (showTimer) window.clearTimeout(showTimer);
      setShowWorking(false);
      setWorkingQuestion(null);
    }
  }

  async function runParameterizedAction(action: string) {
    setBusyAction(action);
    const actionInstructions = instructions;
    setPendingAction(null);
    try {
      if (action === "Meeting brief" || action === "Sales pitch" || action === "Capabilities assessment") {
        const account = accounts.find((item) => item.id === accountId);
        const label = action === "Meeting brief"
          ? "Meeting brief"
          : action === "Sales pitch"
            ? "Draft a sales pitch"
            : "Can we actually serve";
        await submit(`${label} for ${account?.name ?? accountId}${actionInstructions ? `. Instructions: ${actionInstructions}` : ""}`);
      } else if (action === "Plan a trip") {
        await submit(`Plan a trip to ${tripCity} from ${startDate} to ${endDate}${actionInstructions ? `. Instructions: ${actionInstructions}` : ""}`);
      } else if (action === "Board deck") {
        await submit(`Generate a ${quarter} board deck${actionInstructions ? `. Instructions: ${actionInstructions}` : ""}`);
      } else if (action === "Analysis view") {
        await submit(`Analysis view for ${metric}${actionInstructions ? `. Instructions: ${actionInstructions}` : ""}`);
      } else {
        await submit(`${PREFILLS[action]}${actionInstructions ? `. Instructions: ${actionInstructions}` : ""}`);
      }
      setInstructions("");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className={large ? "ask-brain ask-brain-large" : "ask-brain"}>
      <form
        className="ask-brain-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <span>✦</span>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about accounts, markets, funding, geography, or sales priorities..."
          disabled={workingQuestion !== null}
        />
        <button type="submit" disabled={workingQuestion !== null}>{workingQuestion ? "Working..." : "Ask"}</button>
      </form>
      {workingQuestion && showWorking && !pendingAction && (
        <div className="ask-working" aria-live="polite">
          <strong>You asked: {workingQuestion}</strong>
          <ol>
            {workingStages.map((stage) => (
              <li key={stage.id} className={`stage-${stage.status}`}>
                <span>{stage.status === "done" ? "✓" : stage.status === "fallback" ? "↻" : stage.status === "active" ? "…" : "○"}</span>
                {stage.label}
              </li>
            ))}
          </ol>
          <div className="ask-skeleton"><i /><i /><i /></div>
        </div>
      )}
      <div className="ask-action-row">
        {ACTIONS.map((action) => (
          <button key={action} disabled={busyAction !== null || workingQuestion !== null} onClick={() => setPendingAction(action)}>{action}</button>
        ))}
      </div>
      {pendingAction && (
        <div className="ask-param-popover" role="dialog" aria-label={`${pendingAction} parameters`}>
          <button className="ask-param-close" onClick={() => setPendingAction(null)} aria-label="Close">×</button>
          <strong>{pendingAction}</strong>
          {["Meeting brief", "Sales pitch", "Capabilities assessment"].includes(pendingAction) && (
            <label>Account
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
          )}
          {pendingAction === "Plan a trip" && (
            <>
              <label>City
                <select value={tripCity} onChange={(event) => setTripCity(event.target.value)}>
                  {cities.map((city) => <option key={city} value={city}>{city}</option>)}
                </select>
              </label>
              <label>Start <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
              <label>End <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            </>
          )}
          {pendingAction === "Board deck" && (
            <label>Quarter
              <select value={quarter} onChange={(event) => setQuarter(event.target.value)}>
                {quarters.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          )}
          {pendingAction === "Analysis view" && (
            <label>Metric
              <select value={metric} onChange={(event) => setMetric(event.target.value as MetricId)}>
                <option value="revenue">Revenue</option>
                <option value="bookings">Bookings</option>
                <option value="backlog">Backlog</option>
                <option value="capacity_utilization">Capacity utilization</option>
              </select>
            </label>
          )}
          {["Weekly brief", "Draft outreach"].includes(pendingAction) && <p>{PREFILLS[pendingAction]}</p>}
          <label>Instructions
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Optional: emphasize, include, or avoid anything…"
            />
          </label>
          <button onClick={() => void runParameterizedAction(pendingAction)} disabled={busyAction !== null}>
            {busyAction === pendingAction ? "Working..." : "Confirm"}
          </button>
        </div>
      )}
    </div>
  );
}
