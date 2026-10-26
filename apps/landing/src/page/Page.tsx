import { Closing } from "./Closing";
import { Features } from "./Features";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { Hero } from "./Hero";
import { Install } from "./Install";
import { Reports } from "./Reports";
import { Rails } from "./layout";

/** The landing page, as the Site drew its home before it moved out: the bar, the bands in their frame, and the footer. */
export function Page() {
  return (
    <div data-frame="page" className="contents">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        <Rails>
          <Hero />
          <Features />
          <Reports />
          <Install />
          <Closing />
        </Rails>
      </main>
      <Footer />
    </div>
  );
}
