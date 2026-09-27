import { Kbd } from "@astryxdesign/core/Kbd";

/**
 * A key's hint beside what it does. `?` highlights every hint on screen
 * (the page's `keys-on` class), as npmx.dev does.
 */
export function Key({ keys }: { keys: string }) {
  return (
    <span className="key-hint">
      <Kbd keys={keys} />
    </span>
  );
}
