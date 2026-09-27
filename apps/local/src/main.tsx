import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reportSource, serverSource, type Meta, type Report, type WrappedYear } from "@commitscape/data";
import { App, SourceContext, Wrapped } from "@commitscape/ui";
import "@commitscape/ui/styles.css";

declare global {
  interface Window {
    /** A Report's answers, written into the page by `commitscape report`. */
    __COMMITSCAPE__?: Report;
    /** The server's state when it served the page. */
    __COMMITSCAPE_META__?: Meta;
    /** A Wrapped page's year, written into the page by `commitscape wrapped`. */
    __COMMITSCAPE_WRAPPED__?: WrappedYear;
  }
}

// A Report written into the page, or the server that served it.
const inlined = window.__COMMITSCAPE__;
const source = inlined ? reportSource(inlined) : serverSource(window.__COMMITSCAPE_META__ ?? null);
const wrapped = window.__COMMITSCAPE_WRAPPED__;

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      {wrapped ? (
        <Wrapped y={wrapped} />
      ) : (
        <SourceContext value={source}>
          <App />
        </SourceContext>
      )}
    </StrictMode>,
  );
}
