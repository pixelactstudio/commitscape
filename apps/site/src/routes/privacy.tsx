import { createFileRoute } from "@tanstack/react-router";
import { Heading } from "@astryxdesign/core/Heading";
import { PRODUCT } from "@commitscape/data";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: `What ${PRODUCT} keeps` }] }),
  component: Privacy,
});

function Privacy() {
  return (
    <>
      <article className="prose">
        <Heading level={1}>What {PRODUCT} keeps, and who can read it</Heading>
        <p>
          The {PRODUCT} command reads repositories on your own machine and sends nothing anywhere unless you ask it to. This page is about the Site: what it shows about
          people, what it stores, and how to stay out.
        </p>

        <Heading level={2}>Profiles</Heading>
        <ul>
          <li>
            <strong>What:</strong> anyone's Profile at <code>/u/login</code> is built from what GitHub shows anyone: their name, picture, bio, followers, public pull requests,
            reviews and contributions, and the repositories those are in. Private work GitHub reports only as a count is counted in the totals and never named.
          </li>
          <li>
            <strong>Your own private work:</strong> when you are signed in and look at your own Profile, it is read with your own GitHub sign-in, so it can name your private
            repositories, to you alone, marked as such. It names them for everyone only if you choose so in Settings.
          </li>
          <li>
            <strong>From the repositories we have read:</strong> your commits, the lines you changed, and the lines of yours still at a repository's head (Surviving Lines),
            under every address you commit with. Email addresses are used inside the reading and never shown.
          </li>
          <li>
            <strong>Where and how long:</strong> a copy of each Profile in our database, read again from GitHub when it is a day old and someone looks.
          </li>
        </ul>

        <Heading level={2}>Comparisons, and staying out</Heading>
        <ul>
          <li>
            People are compared view by view: in each repository (Standings), two at a time (Versus), on the Leaderboards, and in Races and Crews. Never with one combined
            score.
          </li>
          <li>
            <strong>Staying out:</strong> sign in and turn on "Stay out of comparisons" in Settings. You then appear in no one else's Standings, Versus, Leaderboards, Races or
            Crews, and your Profile shows others only that it is hidden.
          </li>
          <li>
            <strong>Private repositories:</strong> their Standings are shown only to people GitHub says can see the repository, checked on every view.
          </li>
          <li>
            <strong>Races and Crews</strong> include you only after you accept an invitation, and leaving takes you out at once.
          </li>
        </ul>

        <Heading level={2}>Cards</Heading>
        <ul>
          <li>
            Cards are images of a Profile's numbers, for READMEs and posts. They show only what the Profile shows anyone, are stored as images, and are refreshed at most
            every six hours; a hidden person has none.
          </li>
        </ul>

        <Heading level={2}>Repositories you look up</Heading>
        <ul>
          <li>
            <strong>What:</strong> the repository's Report (its numbers, file paths, the names and GitHub logins of the people who committed, and each commit's subject line),
            its pull requests and reviews (who, when, how big, the title), and the facts GitHub shows anyone. Never an email address.
          </li>
          <li>
            <strong>Where:</strong> the Report in Cloudflare R2, the rest in a database on our own server. The history is read on our server too, from a clone kept to make
            the next update quick.
          </li>
          <li>
            <strong>How long:</strong> while people look at it; it is rebuilt when it is more than a day old and someone asks.
          </li>
          <li>
            <strong>The Leaderboards:</strong> each night our server also reads a budgeted number of the most starred public repositories, and ranks repositories, and the
            people in them who have not chosen to stay out.
          </li>
        </ul>

        <Heading level={2}>Shared Reports</Heading>
        <ul>
          <li>
            <strong>What:</strong> a Report your own machine built, locked with AES-256-GCM before it was uploaded. The key
            exists only in the link <code>{`${PRODUCT} share`}</code> printed, after the <code>#</code>, which browsers never
            send to a server. We store the locked bytes, their size, when they expire, and a hash of the Delete Token.
          </li>
          <li>
            <strong>Where:</strong> the locked bytes in Cloudflare R2, the rest in our database.
          </li>
          <li>
            <strong>How long:</strong> 4 hours unless you chose otherwise, 12 at most; then it answers "gone" and is removed.
            The page's Delete button, or <code>{`${PRODUCT} share --delete`}</code>, removes it at once.
          </li>
          <li>
            <strong>Who can read it:</strong> whoever has the link. We cannot: we never have the key.
          </li>
        </ul>

        <Heading level={2}>Signing in with GitHub</Heading>
        <ul>
          <li>
            <strong>What:</strong> your GitHub account's id, login, name, picture and email address, your sessions, the
            token GitHub gave the sign-in (encrypted, to read GitHub for you and ask which repositories you may see), your choices in Settings, and which repositories
            you chose in {PRODUCT}'s GitHub App, which can only read. For a repository you chose, its Report, as above. The
            short-lived tokens a Build reads a repository with are never stored.
          </li>
          <li>
            <strong>Where:</strong> our database and R2. A private repository's history is cloned onto our server for its
            Build, and the clone and everything read from it are deleted when the Build ends; only the Report is kept, which
            Cloudflare encrypts at rest.
          </li>
          <li>
            <strong>How long:</strong> a chosen repository's Report is deleted after 30 days without a view. Removing the App
            from a repository on GitHub deletes its Report. "Delete my data" deletes your account, sessions, choices, your own copy of your Profile and those Reports at once.
          </li>
          <li>
            <strong>Who can read it:</strong> a private repository's Report is shown only to people GitHub says can see the
            repository, checked again on every view.
          </li>
        </ul>

        <Heading level={2}>Everyone</Heading>
        <ul>
          <li>
            To stop abuse, the Site counts how many lookups, Builds and Shared Reports each address starts in an hour (an IPv6
            address counts with its neighbours in the same /64). It keeps a hash of the address, never the address, and deletes
            the count when the hour ends.
          </li>
          <li>Our server keeps logs of requests, as any host does.</li>
          <li>
            Errors in the Site are reported to Sentry, without the request's body or cookies. Pages viewed are
            counted with PostHog, which honours your browser's Do Not Track setting and is never told who you are. No
            advertising.
          </li>
        </ul>
        <p className="note">
          The Site's code is open: <a href="https://github.com/pixelactstudio/commitscape">github.com/pixelactstudio/commitscape</a>.
        </p>
      </article>
    </>
  );
}
