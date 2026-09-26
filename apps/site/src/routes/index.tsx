/**
 * The landing page (IDEA.md, "The Site"): what commitscape is in one line,
 * a box to paste a GitHub link, the three ways to use it, and how to
 * install it. npmx.dev is the model: a big search box, calm around it.
 */
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { TextInput } from "@astryxdesign/core/TextInput";
import { parseGitHub, PRODUCT } from "@commitscape/data";
import { Frame } from "../components/Frame";
import { useBoards } from "./leaderboards";

export const Route = createFileRoute("/")({ component: Landing });

// Each one the Site can build: torvalds/linux is over the Builder's size cap.
const EXAMPLES = ["facebook/react", "BurntSushi/ripgrep", "rust-lang/rust", "vitejs/vite"];

function Landing() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [why, setWhy] = useState<string | null>(null);
  const boards = useBoards();
  const highlights = (boards?.boards ?? []).filter((b) => ["one_person", "active_people", "oldest_code"].includes(b.id) && b.rows.length > 0);
  const go = () => {
    const repo = parseGitHub(text);
    if (!repo) {
      setWhy("Paste a GitHub link, or owner/name, like BurntSushi/ripgrep.");
      return;
    }
    void navigate({ to: "/gh/$owner/$repo", params: { owner: repo.owner, repo: repo.name } });
  };
  return (
    <Frame>
      <section className="hero">
        <Heading level={1} className="hero-title">
          Any repository's story, in a second.
        </Heading>
        <p className="hero-line">
          {PRODUCT} reads a git repository's history and shows who built it, who knows which part, what is fragile, what
          changes together, and what you are about to forget.
        </p>
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <TextInput
            label="A GitHub repository"
            isLabelHidden
            size="lg"
            value={text}
            onChange={(v) => {
              setText(v);
              setWhy(null);
            }}
            placeholder="Paste a GitHub link, or owner/name"
            status={why ? { type: "error", message: why } : undefined}
            hasAutoFocus
            width="100%"
          />
          <Button label="See its story" variant="primary" size="lg" type="submit" />
        </form>
        <p className="examples note">
          Try{" "}
          {EXAMPLES.map((e, i) => (
            <span key={e}>
              {i > 0 && ", "}
              <a href={`/gh/${e}`}>{e}</a>
            </span>
          ))}
          .
        </p>
      </section>

      <section className="ways">
        <Card padding={4}>
          <Heading level={2}>On your machine</Heading>
          <p>In any git repository. It opens in your browser, or the terminal where there is none. Nothing leaves your machine.</p>
          <pre className="command">npx commitscape</pre>
        </Card>
        <Card padding={4}>
          <Heading level={2}>Share from a terminal</Heading>
          <p>On a server with no browser: it uploads a Report locked with a key only its link holds, prints the link, and exits.</p>
          <pre className="command">npx commitscape share</pre>
        </Card>
        <Card padding={4}>
          <Heading level={2}>Here, for any public repository</Heading>
          <p>Paste its link above. GitHub's facts show at once; the full Report follows once its history is read.</p>
          <pre className="command">/gh/owner/name</pre>
        </Card>
      </section>

      {highlights.length > 0 && (
        <section className="highlights">
          <Heading level={2}>
            From the <a href="/leaderboards">Leaderboards</a>
          </Heading>
          <div className="ways">
            {highlights.map((b) => (
              <Card key={b.id} padding={4}>
                <Heading level={3}>{b.title}</Heading>
                <ol className="board-rows">
                  {b.rows.slice(0, 3).map((r) => (
                    <li key={`${r.owner}/${r.name}`}>
                      <a href={`/gh/${r.owner}/${r.name}`}>
                        {r.owner}/{r.name}
                      </a>
                      <span className="board-value">{r.shown}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="install">
        <Heading level={2}>Install</Heading>
        <table className="plain">
          <tbody>
            <tr>
              <td>npm</td>
              <td>
                <code>npx commitscape</code>, or <code>npm install -g commitscape</code>
              </td>
            </tr>
            <tr>
              <td>Homebrew</td>
              <td>
                <code>brew install pixelactstudio/commitscape/commitscape</code>
              </td>
            </tr>
            <tr>
              <td>Nix</td>
              <td>
                <code>nix run github:pixelactstudio/commitscape</code>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </Frame>
  );
}
