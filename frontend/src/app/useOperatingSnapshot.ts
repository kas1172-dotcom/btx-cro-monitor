import { useEffect, useState } from "react";
import { createDataAdapter } from "../adapters/createDataAdapter.ts";
import type { OperatingSnapshot } from "../engine/brain/operatingSnapshot.ts";

const adapter = createDataAdapter();

export function useOperatingSnapshot(): OperatingSnapshot | null {
  const [snapshot, setSnapshot] = useState<OperatingSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    void adapter.getOperatingSnapshot().then((next) => {
      if (alive) setSnapshot(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return snapshot;
}
