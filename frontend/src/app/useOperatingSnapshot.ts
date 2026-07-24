import { useEffect, useState } from "react";
import type { OperatingSnapshot } from "../engine/brain/operatingSnapshot.ts";
import { operatingSnapshotFromWorld, revenueDataClient } from "./revenueDataClient.ts";

export function useOperatingSnapshot(): OperatingSnapshot | null {
  const [snapshot, setSnapshot] = useState<OperatingSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    void revenueDataClient
      .getWorldSnapshot()
      .then(operatingSnapshotFromWorld)
      .then((next) => {
        if (alive) setSnapshot(next);
      })
      .catch(() => {
        if (alive) setSnapshot(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return snapshot;
}
