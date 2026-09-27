import { Kbd } from "@astryxdesign/core/Kbd";

export function Key({ keys }: { keys: string }) {
  return (
    <span className="key-hint">
      <Kbd keys={keys} />
    </span>
  );
}
