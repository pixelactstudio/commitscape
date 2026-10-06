import { createContext } from "react";

export const HelpContext = createContext(false);

export const LoginsContext = createContext<ReadonlyMap<number, string>>(new Map());
