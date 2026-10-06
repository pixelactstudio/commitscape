import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useEffect, useRef, useState } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PRODUCT } from "@commitscape/data";
import { ACHIEVEMENT_CARD_SIZE, ARCHETYPE_CARD_SIZE, CARDS, compact, Face, grouped, Page, PageHead, parseStyle, PERSON_CARDS, STANDING_CARD_SIZE, styleQuery } from "@commitscape/ui";
import { ICON } from "@commitscape/ui/design";
import { Section } from "#/components/Boundary";
import { CardStudio, type CardChoice, type StudioState } from "#/components/CardStudio";
import { Missing } from "#/components/Missing";
import { cardGalleryQuery, profileLookupQuery } from "#/lib/queries";

type Search = { card?: string; preset?: string; accent?: string; bg?: string; corner?: string; mode?: "light" | "dark" };

export const Route = createFileRoute("/u/$login_/cards")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const text = (k: string) => (typeof s[k] === "string" && (s[k] as string).length <= 40 ? (s[k] as string) : undefined);
    const style = parseStyle(s);
    return {
      ...(text("card") ? { card: text("card") } : {}),
      ...(style.preset !== "classic" ? { preset: style.preset } : {}),
      ...(style.accent ? { accent: style.accent.slice(1) } : {}),
      ...(style.background ? { bg: style.background } : {}),
      ...(style.corner ? { corner: style.corner } : {}),
      ...(s.mode === "light" || s.mode === "dark" ? { mode: s.mode } : {}),
    };
  },
  loader: async ({ params, context }) => ({ lookup: await context.queryClient.ensureQueryData(profileLookupQuery(params.login)), origin: context.origin ?? "", mode: context.mode }),
  head: ({ params }) => ({ meta: [{ title: `@${params.login}'s Cards · ${PRODUCT}` }] }),
  component: Gallery,
});

function Gallery() {
  const { login } = Route.useParams();
  const { data: lookup } = useSuspenseQuery(profileLookupQuery(login));
  if (lookup.status === "hidden") return <Missing title="No Cards here" words="This person has chosen to stay out, so they have no Cards." />;
  if (lookup.status !== "ok") return <Missing title={`No one called @${login}`} words="GitHub has no person by that name." />;
  const name = lookup.identity.name ?? lookup.identity.login;
  return (
    <Page className="pb-section">
      <PageHead
        media={<Face login={lookup.identity.login} name={name} size={48} />}
        eyebrow={
          <a href={`/u/${lookup.identity.login}`} className="inline-flex items-center gap-1 text-secondary no-underline hover:text-primary">
            <ArrowLeft size={ICON.sm} aria-hidden /> {name}
          </a>
        }
        title={lookup.self ? "Your Cards" : `${name}'s Cards`}
        description="For a README, a post, a self-review or a client. Pick one, make it yours, and copy it out. Every number on a Card is the one on the Profile."
      />
      <Section fallback={<StudioSkeleton />}>
        <Studio login={lookup.identity.login} name={name} />
      </Section>
    </Page>
  );
}

function StudioSkeleton() {
  return (
    <div className="grid gap-gutter lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-gutter">
        <Skeleton height={380} radius={4} />
        <Skeleton height={190} radius={4} />
      </div>
      <div className="flex flex-col gap-gutter">
        <Skeleton height={300} radius={4} />
        <Skeleton height={420} radius={4} />
      </div>
    </div>
  );
}

function Studio({ login, name }: { login: string; name: string }) {
  const search = Route.useSearch();
  const { origin, mode: siteMode } = Route.useLoaderData();
  const first = useSuspenseQuery(cardGalleryQuery(login)).data;
  const waiting = !first.card;
  const live = useQuery({ ...cardGalleryQuery(login), refetchInterval: waiting ? 4000 : false, enabled: waiting });
  const data = live.data ?? first;
  if (!data.card)
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-surface px-6 py-band text-center">
        <Spinner size="md" />
        <p className="m-0 type-panel">Reading @{login} from GitHub</p>
        <p className="m-0 type-description">Their Cards appear here on their own within a minute.</p>
      </div>
    );
  const card = data.card;
  const base = `/api/cards/u/${login}`;
  const profile = `/u/${login}`;
  const share: Record<(typeof PERSON_CARDS)[number], string> = {
    totals: `My work on GitHub: ${grouped(card.totals.prsMerged)} pull requests merged, ${grouped(card.totals.reviews)} reviews given.`,
    survival: card.engine ? `${compact(card.engine.surviving)}${card.engine.added ? ` of the ${compact(card.engine.added)}` : ""} lines I wrote still run.` : "The lines I wrote that still run.",
    repositories: "Where my work is.",
    calendar: "My last year on GitHub, a square a day.",
    languages: "What I wrote in, year by year.",
    preview: `${name} on ${PRODUCT}.`,
  };
  const choices: CardChoice[] = [
    ...PERSON_CARDS.map((kind) => {
      const spec = CARDS[kind];
      return { id: kind, title: spec.title, about: spec.about, url: `${base}/${kind}`, ...spec.size(card), link: profile, share: share[kind], alt: `${name}: ${spec.title}`, group: "Profile" };
    }),
    { id: "archetype", title: data.archetype ? data.archetype.title : "Archetype", about: data.archetype?.rule ?? "None of the rules fits yet.", url: `${base}/archetype`, ...ARCHETYPE_CARD_SIZE, link: profile, share: data.archetype ? `My Archetype: ${data.archetype.title}.` : "My Archetype.", alt: `${name}'s Archetype`, group: "Profile" },
    ...data.achievements.map((a) => ({ id: `achievement-${a.id}`, title: a.title, about: a.rule, url: `${base}/achievement-${a.id}`, ...ACHIEVEMENT_CARD_SIZE, link: profile, share: `${a.title}.`, alt: `${name}: ${a.title}`, group: "Achievements" })),
    ...data.standings.map((r) => ({ id: `standing-${r.owner}/${r.name}`, title: `${r.owner}/${r.name}`, about: CARDS.standing.about, url: `/api/cards/u/${login}/${r.owner}/${r.name}/standing`, ...STANDING_CARD_SIZE, link: `/u/${login}/${r.owner}/${r.name}`, share: `Where I stand in ${r.owner}/${r.name}.`, alt: `${name} in ${r.owner}/${r.name}`, group: "Where you stand" })),
  ];
  return <Chosen choices={choices} origin={origin} first={{ card: search.card ?? "totals", style: parseStyle(search as Record<string, unknown>), mode: search.mode ?? (siteMode === "light" ? "light" : "dark") }} />;
}

function Chosen({ choices, origin, first }: { choices: CardChoice[]; origin: string; first: StudioState }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const [state, setState] = useState(first);
  const initial = useRef(state);
  useEffect(() => {
    if (state === initial.current) return;
    const t = setTimeout(() => {
      const q = Object.fromEntries(new URLSearchParams(styleQuery(state.style)));
      void navigate({ search: { ...(state.card !== "totals" ? { card: state.card } : {}), ...q, mode: state.mode }, replace: true, resetScroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [state, navigate]);
  return <CardStudio choices={choices} state={state} origin={origin} onChange={setState} />;
}
