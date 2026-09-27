import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";

export function Tile({ value, label, note, children }: { value: string; label: string; note?: string; children?: ReactNode }) {
  return (
    <Card className="tile" padding={3}>
      <strong>{value}</strong>
      <span>{label}</span>
      {note && <span className="note small">{note}</span>}
      {children}
    </Card>
  );
}
