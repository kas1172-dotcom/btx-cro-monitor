import { useEffect, useState } from "react";
import type { World } from "../../app/useWorld.ts";
import { executeTourStep, TOUR_STEPS } from "../../tour/tourSteps.ts";
import { setState, clearTourRequest, goHome } from "../../store/store.ts";

interface TourHudProps {
  world: World;
  autoStart?: boolean;
  onDismiss?: () => void;
}

export function TourHud({ world, autoStart = false, onDismiss }: TourHudProps) {
  const [tourStep, setTourStep] = useState<number>(0);
  const [playing, setPlaying] = useState(autoStart);
  const [paused, setPaused] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [typedPrompt, setTypedPrompt] = useState("");
  const [narration, setNarration] = useState(autoStart ? "Starting the tour from a clean cockpit state." : "Press Play to run the demo tour.");
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);

  function exit() {
    setState({ askDraftPrompt: "" });
    clearTourRequest();
    onDismiss?.();
  }

  // Reset cockpit state when tour starts
  useEffect(() => {
    if (autoStart) {
      goHome();
      setState({ brainResponse: null, activeDeliverable: null, activeAnalysisSpec: null, activeCompanyId: null, askDraftPrompt: "" });
    }
  }, [autoStart]);

  useEffect(() => {
    if (!playing || paused) return;
    let cancelled = false;
    const step = TOUR_STEPS[tourStep];
    const displayText = step.prompt ?? step.actionLabel;
    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

    async function run() {
      setError(null);
      setNarration("Running this step through the shared brain action.");
      try {
        await Promise.race([
          (async () => {
            setTypedPrompt("");
            for (let i = 1; i <= displayText.length; i++) {
              if (cancelled) return;
              setTypedPrompt(displayText.slice(0, i));
              if (step.execution === "ask") setState({ askDraftPrompt: displayText.slice(0, i) });
              await sleep(step.execution === "ask" ? 40 : 18);
            }
            if (cancelled) return;
            setNarration(step.execution === "ask"
              ? "Submitting through the same brain action used by Ask."
              : "Opening the workspace directly.");
            await executeTourStep(step, world);
            setFailures(0);
            setState({ askDraftPrompt: "" });
            await sleep(6000);
          })(),
          sleep(15000).then(() => { throw new Error("Step timed out after 15s"); }),
        ]);
      } catch (err) {
        if (cancelled) return;
        const reason = err instanceof Error ? err.message : "Unknown failure";
        const next = failures + 1;
        setFailures(next);
        setPaused(true);
        setError(`Step ${tourStep + 1} failed: ${reason}`);
        setNarration(next >= 2 ? "Tour paused after repeated failures." : "Tour paused — retry, skip, or exit.");
        setState({ askDraftPrompt: "" });
        return;
      }
      if (cancelled) return;
      if (tourStep >= TOUR_STEPS.length - 1) {
        setPlaying(false);
        setPaused(false);
        setNarration("Tour complete — the brain remembered all of it.");
      } else {
        setTourStep((s) => s + 1);
      }
    }

    void run();
    return () => { cancelled = true; };
  }, [playing, paused, tourStep, world, failures]);

  async function retry() {
    setError(null);
    setPaused(false);
    setNarration("Retrying this step.");
    try {
      await executeTourStep(TOUR_STEPS[tourStep], world);
      setFailures(0);
      setState({ askDraftPrompt: "" });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown failure";
      setFailures((f) => f + 1);
      setPaused(true);
      setError(`Step ${tourStep + 1} failed: ${reason}`);
    }
  }

  function skipStep() {
    setError(null);
    setFailures(0);
    setPaused(false);
    if (tourStep >= TOUR_STEPS.length - 1) {
      exit();
    } else {
      setTourStep((s) => s + 1);
    }
  }

  function restart() {
    goHome();
    setState({ brainResponse: null, activeDeliverable: null, activeAnalysisSpec: null, activeCompanyId: null, askDraftPrompt: "" });
    setTourStep(0);
    setPlaying(true);
    setPaused(false);
    setMinimized(false);
    setError(null);
    setFailures(0);
    setTypedPrompt("");
    setNarration("Starting the tour from a clean cockpit state.");
  }

  if (minimized) {
    return (
      <div className="tour-hud minimized" role="dialog" aria-label="Demo tour">
        <div className="tour-actions">
          <button onClick={() => setMinimized(false)}>Tour {tourStep + 1}/{TOUR_STEPS.length}</button>
          <button onClick={() => { setPlaying(true); setPaused(false); }} disabled={playing && !paused}>Play</button>
          <button onClick={() => setPaused(!paused)} disabled={!playing}>{paused ? "Resume" : "Pause"}</button>
          <button onClick={exit}>Exit</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tour-hud" role="dialog" aria-label="Demo tour">
      <p className="eyebrow">Demo tour · {tourStep + 1} of {TOUR_STEPS.length}</p>
      <h2>{TOUR_STEPS[tourStep].title}</h2>
      <p>{narration}</p>
      <div className="tour-typewriter">{typedPrompt || TOUR_STEPS[tourStep].prompt || TOUR_STEPS[tourStep].actionLabel}</div>
      <div className="tour-actions">
        <button onClick={restart}>Restart</button>
        <button onClick={() => { setPlaying(true); setPaused(false); }} disabled={playing && !paused}>Play</button>
        <button onClick={() => setPaused(!paused)} disabled={!playing}>{paused ? "Resume" : "Pause"}</button>
        <button onClick={() => void retry()}>Run step</button>
        <button onClick={() => { setPlaying(false); setTourStep((s) => Math.max(0, s - 1)); }} disabled={tourStep === 0}>Back</button>
        <button onClick={skipStep}>{tourStep >= TOUR_STEPS.length - 1 ? "Finish" : "Next"}</button>
        <button onClick={() => setMinimized(true)}>Minimize</button>
        <button onClick={exit}>Take over</button>
      </div>
      {error && (
        <div className="tour-error" role="alert">
          <strong>{error}</strong>
          <div className="tour-actions">
            <button onClick={() => void retry()}>Retry</button>
            <button onClick={skipStep}>Skip</button>
            <button onClick={exit}>Exit</button>
          </div>
        </div>
      )}
    </div>
  );
}
