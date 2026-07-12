// Relationship graph — the network from the client's seat. BTX sits at the
// center; suppliers / competitors / customers / targets radiate around it, each
// edge and node colored by relationship, each node labeled with its headline
// score. Pure lens on engine output; clicking a node opens the dossier. This is
// the abstract counterpart to the geographic map (both views, per the decision).

import { useMemo } from "react";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { World } from "../../app/useWorld.ts";
import type { Relationship } from "../../engine/brain/entities.ts";
import { setState } from "../../store/store.ts";
import { uiTokens } from "../../app/uiTokens.ts";

const REL_COLOR: Record<string, string> = {
  self: uiTokens.color.textPrimary,
  supplier: uiTokens.color.danger,
  competitor: uiTokens.color.warning,
  customer: uiTokens.color.accent,
  target: uiTokens.color.success,
};
const REL_ORDER: Relationship[] = ["supplier", "competitor", "customer", "target"];

function headlineScore(world: World, id: string, rel: string): { label: string; value: number } {
  const d = world.analysis.byId.get(id)?.dimensions;
  if (!d) return { label: "", value: 0 };
  if (rel === "supplier") return { label: "risk", value: d.risk.score };
  return { label: "opp", value: d.opportunity.score }; // competitor/customer/target
}

function nodeStyle(rel: string, isSelf: boolean): React.CSSProperties {
  return {
    background: isSelf ? uiTokens.color.panel : uiTokens.color.card,
    color: uiTokens.color.textPrimary,
    border: `2px solid ${REL_COLOR[rel]}`,
    borderRadius: 10,
    padding: "8px 10px",
    width: 150,
    fontSize: 12,
    textAlign: "center",
    whiteSpace: "pre-line",
  };
}

export function RelationshipGraph({ world }: { world: World }) {
  const { nodes, edges } = useMemo(() => {
    const self = world.companies.find((c) => c.relationship === "self");
    // At ~50 companies a full star is a hairball — show self + the most active
    // accounts (highest score in any dimension), then lay them out by relationship.
    const relevance = (id: string) => {
      const d = world.analysis.byId.get(id)?.dimensions;
      return d ? Math.max(d.risk.score, d.opportunity.score, d.capacityRisk.score, d.competitivePressure.score) : 0;
    };
    const others = world.companies
      .filter((c) => c.relationship !== "self")
      .sort((a, b) => relevance(b.id) - relevance(a.id) || a.id.localeCompare(b.id))
      .slice(0, 22)
      .sort(
        (a, b) =>
          REL_ORDER.indexOf(a.relationship) - REL_ORDER.indexOf(b.relationship) ||
          a.name.localeCompare(b.name),
      );

    const cx = 480;
    const cy = 360;
    const R = 300;
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    if (self) {
      nodes.push({ id: self.id, position: { x: cx, y: cy }, data: { label: self.name }, style: nodeStyle("self", true) });
    }

    others.forEach((c, i) => {
      const angle = (i / others.length) * 2 * Math.PI - Math.PI / 2;
      const h = headlineScore(world, c.id, c.relationship);
      nodes.push({
        id: c.id,
        position: { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) },
        data: { label: `${c.name}\n${c.relationship} · ${h.label} ${h.value}` },
        style: nodeStyle(c.relationship, false),
      });
      if (self) {
        edges.push({
          id: `${self.id}-${c.id}`,
          source: self.id,
          target: c.id,
          style: { stroke: REL_COLOR[c.relationship], opacity: 0.55 },
        });
      }
    });

    return { nodes, edges };
  }, [world]);

  return (
    <div className="graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        onNodeClick={(_event, node) => setState({ activeCompanyId: node.id })}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={uiTokens.color.cardBorder} gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="graph-legend">
        {REL_ORDER.map((r) => (
          <span key={r}>
            <i style={{ background: REL_COLOR[r] }} /> {r}
          </span>
        ))}
      </div>
    </div>
  );
}
