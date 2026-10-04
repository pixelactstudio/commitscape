import { Banner } from "@astryxdesign/core/Banner";
import { Heading } from "@astryxdesign/core/Heading";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { ACHIEVEMENT_CARD_SIZE, ARCHETYPE_CARD_SIZE, CARDS, compact, grouped, PERSON_CARDS, STANDING_CARD_SIZE } from "@commitscape/ui";
import { Section } from "#/components/Boundary";
import { CardBox } from "#/components/CardBox";
import { cardGalleryQuery, profileLookupQuery } from "#/lib/queries";

export const Route = createFileRoute("/u/$login_/cards")({
  loader: ({ params, context }) => context.queryClient.ensureQueryData(profileLookupQuery(params.login)),
  head: ({ params }) => ({ meta: [{ title: `@${params.login}'s Cards on ${PRODUCT}` }] }),
  component: Gallery,
});

function Gallery() {
  const { login } = Route.useParams();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status !== "ok") return <Banner status="warning" title={lookup.status === "hidden" ? "This person has chosen to stay out, so they have no Cards." : "GitHub has no person by that name."} />;
  const name = lookup.identity.name ?? lookup.identity.login;
  return (
    <div className="cards-page">
      <header className="repo-head">
        <div className="min-w-0 flex-1">
          <Heading level={1} className="repo-title">
            <a href={`/u/${lookup.identity.login}`}>{name}</a>'s Cards
          </Heading>
          <p className="repo-facts note small">
            <span>For your README, a self-review, a client, or a post. Each comes light and dark; the README Markdown follows the reader's theme.</span>
          </p>
        </div>
      </header>
      <Section fallback={<Skeleton height={900} />}>
        <Boxes login={lookup.identity.login} name={name} />
      </Section>
    </div>
  );
}

function Boxes({ login, name }: { login: string; name: string }) {
  const { data } = useSuspenseQuery(cardGalleryQuery(login));
  if (!data.card) return <Banner status="info" title={`Reading @${login} from GitHub. The Cards fill in within a minute; reload then.`} />;
  const card = data.card;
  const link = `${data.origin}/u/${login}`;
  const share: Record<(typeof PERSON_CARDS)[number], string> = {
    totals: `My work on GitHub: ${grouped(card.totals.prsMerged)} pull requests merged, ${grouped(card.totals.reviews)} reviews given.`,
    survival: card.engine ? `${compact(card.engine.surviving)}${card.engine.added ? ` of the ${compact(card.engine.added)}` : ""} lines I wrote still run.` : "The lines I wrote that still run.",
    repositories: "Where my work is.",
    calendar: "My last year on GitHub, a square a day.",
    languages: "What I wrote in, year by year.",
    preview: `${name} on ${PRODUCT}.`,
  };
  return (
    <>
      {PERSON_CARDS.map((kind) => {
        const spec = CARDS[kind];
        const size = spec.size(card);
        return <CardBox key={kind} title={spec.title} about={spec.about} url={`${data.origin}/api/cards/u/${login}/${kind}`} alt={`${name}: ${spec.title}`} link={link} share={share[kind]} {...size} />;
      })}
      <CardBox
        title={data.archetype ? `Archetype: ${data.archetype.title}` : "Archetype"}
        about={data.archetype ? data.archetype.rule : "None of the rules fits yet; the Card says so."}
        url={`${data.origin}/api/cards/u/${login}/archetype`}
        alt={`${name}'s Archetype`}
        link={link}
        share={data.archetype ? `My Archetype: ${data.archetype.title}.` : "My Archetype."}
        {...ARCHETYPE_CARD_SIZE}
      />
      {data.achievements.map((a) => (
        <CardBox key={a.id} title={`Achievement: ${a.title}`} about={a.rule} url={`${data.origin}/api/cards/u/${login}/achievement-${a.id}`} alt={`${name}: ${a.title}`} link={link} share={`${a.title}.`} {...ACHIEVEMENT_CARD_SIZE} />
      ))}
      {data.standings.map((r) => (
        <CardBox
          key={`${r.owner}/${r.name}`}
          title={`You in ${r.owner}/${r.name}`}
          about={CARDS.standing.about}
          url={`${data.origin}/api/cards/u/${login}/${r.owner}/${r.name}/standing`}
          alt={`${name} in ${r.owner}/${r.name}`}
          link={`${data.origin}/u/${login}/${r.owner}/${r.name}`}
          share={`Where I stand in ${r.owner}/${r.name}.`}
          {...STANDING_CARD_SIZE}
        />
      ))}
    </>
  );
}
