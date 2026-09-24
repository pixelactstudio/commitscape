import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import type { WrappedYear } from "./api/types";
import App from "./App";
import Wrapped from "./Wrapped";

declare global {
  interface Window {
    /** A Wrapped page's year, written into the page by `commitscape wrapped`. */
    __COMMITSCAPE_WRAPPED__?: WrappedYear;
  }
}

const root = document.getElementById("root");
const wrapped = window.__COMMITSCAPE_WRAPPED__;
if (root) {
  createRoot(root).render(<StrictMode>{wrapped ? <Wrapped y={wrapped} /> : <App />}</StrictMode>);
}
