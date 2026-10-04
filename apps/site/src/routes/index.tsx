import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { TextInput } from "@astryxdesign/core/TextInput";
import { createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { Face } from "@commitscape/ui";
import { signIn } from "#/lib/auth-client";
import { goTo } from "#/lib/target";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: `${PRODUCT}: what you have built, in numbers worth sharing` }] }),
  component: Landing,
});

const EXAMPLES: [string, string][] = [
  ["gaearon", "React, then Bluesky"],
  ["BurntSushi", "ripgrep, regex and more"],
  ["sindresorhus", "a thousand small packages"],
  ["torvalds", "Linux and git"],
];

const REPOSITORIES = ["facebook/react", "BurntSushi/ripgrep", "vitejs/vite"];

function Landing() {
  const navigate = useNavigate();
  const { user } = useRouteContext({ from: "__root__" });
  const [text, setText] = useState("");
  const [why, setWhy] = useState<string | null>(null);
  return (
    <>
      <section className="hero">
        <Heading level={1} className="hero-title">
          What you've built, in numbers worth sharing.
        </Heading>
        <p className="hero-line">
          {PRODUCT} reads your pull requests, reviews and git history, shows how you stand next to the people you work with, and turns it into cards for your
          README, LinkedIn and X.
        </p>
        <form
          className="lookup"
          onSubmit={(e) => {
            e.preventDefault();
            if (!goTo(text, navigate)) setWhy("Type a GitHub username, like gaearon, or a repository, like facebook/react.");
          }}
        >
          <TextInput
            label="A GitHub username or repository"
            isLabelHidden
            size="lg"
            value={text}
            onChange={(v) => {
              setText(v);
              setWhy(null);
            }}
            placeholder="A GitHub username, or owner/repo"
            status={why ? { type: "error", message: why } : undefined}
            hasAutoFocus
            width="100%"
          />
          <Button label="Show me" variant="primary" size="lg" type="submit" />
        </form>
        <div className="hero-own">
          {user ? (
            <Button label={`See your own Profile, ${user.login}`} variant="secondary" href={`/u/${user.login}`} />
          ) : (
            <Button label="See your own: sign in with GitHub" variant="secondary" onClick={() => signIn("/you")} />
          )}
        </div>
      </section>

      <section className="examples-grid" aria-label="Example Profiles">
        {EXAMPLES.map(([login, words]) => (
          <a key={login} className="example" href={`/u/${login}`}>
            <Face login={login} name={login} size={48} />
            <span>
              <strong>{login}</strong>
              <span className="note small">{words}</span>
            </span>
          </a>
        ))}
      </section>

      <section className="ways">
        <div className="way">
          <Heading level={2}>Your Profile</Heading>
          <p>Pull requests merged, reviews given, the lines of yours that still run, and where your work is. Read from GitHub at once.</p>
        </div>
        <div className="way">
          <Heading level={2}>Where you stand</Heading>
          <p>In each repository you work on, next to everyone else in it, view by view. Never one score, and you can hide.</p>
        </div>
        <div className="way">
          <Heading level={2}>Cards to share</Heading>
          <p>For your README, a self-review, a client, or a post. Light and dark, animated where GitHub allows it.</p>
        </div>
      </section>

      <section className="install">
        <Heading level={2}>Or look at a repository, or run it on your own machine</Heading>
        <p className="note">
          Any public repository:{" "}
          {REPOSITORIES.map((r, i) => (
            <span key={r}>
              {i > 0 && ", "}
              <a href={`/gh/${r}`}>{r}</a>
            </span>
          ))}
          . Nothing leaves your machine with the command line:
        </p>
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
            <tr>
              <td>Share from a server</td>
              <td>
                <code>npx commitscape share</code> prints a link that only its holder can open
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
