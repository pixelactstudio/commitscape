import { createContext } from "react";

/**
 * Whether help is on: `?` shows every number's explanation, the list of
 * shortcuts, and highlights each key's hint on screen.
 */
export const HelpContext = createContext(false);

/** Whether people's GitHub avatars may be shown (never with `--offline`). */
export const AvatarsContext = createContext(false);
