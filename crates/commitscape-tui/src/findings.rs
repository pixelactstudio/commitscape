use commitscape_metrics::{
    Analysis, ChangeGroup, Churn, CodeMap, CommitCounts, CommitsByPerson, Contribution,
    Contributor, Coupling, Hotspot, Languages, LargeFile, MapNode, Ownership, Pulse, QuarterAge,
    Silo, Staleness, SuspectedDuplicate, Totals, Window,
};

pub(crate) const PEOPLE_SHOWN: usize = 5;

pub(crate) struct Findings {
    pub generation: u32,
    pub window: Window,
    pub counts: CommitCounts,
    pub totals: Totals,
    pub languages: Languages,
    pub pulse: Pulse,
    pub contributors: Vec<Contributor>,
    pub bots: Vec<Contributor>,
    pub contributions: Vec<Contribution>,
    pub lines_by_person: Vec<(
        commitscape_core::AuthorId,
        commitscape_metrics::LinesChanged,
    )>,
    pub churn: Vec<Churn>,
    pub hotspots: Vec<Hotspot>,
    pub largest: Vec<LargeFile>,
    pub coupling: Coupling,
    pub ownership: Ownership,
    pub staleness: Staleness,
    pub code_age: Vec<QuarterAge>,
    pub duplicates: Vec<SuspectedDuplicate>,
    pub groups: Vec<ChangeGroup>,
    pub silos: Vec<Silo>,
    pub by_person: CommitsByPerson,
    pub map: Option<CodeMap>,
}

impl Findings {
    pub fn of(analysis: &Analysis<'_>) -> Findings {
        let mut f = Findings {
            map: Some(analysis.code_map()),
            ..Findings::without_map(analysis)
        };
        f.pulse.work = analysis.work(None);
        f
    }

    pub fn without_map(analysis: &Analysis<'_>) -> Findings {
        let mut f = std::thread::scope(|s| {
            let ownership = s.spawn(|| {
                let o = analysis.ownership();
                let silos = analysis.silos_in(&o);
                (o, silos)
            });
            let coupling = s.spawn(|| {
                let c = analysis.coupling();
                let groups = analysis.change_groups_in(&c);
                (c, groups)
            });
            let languages = s.spawn(|| analysis.languages());
            let duplicates = s.spawn(|| analysis.suspected_duplicates());
            let lines = s.spawn(|| analysis.lines_by_person());
            let pulse = analysis.pulse_in_time(None);
            let contributors = analysis.contributors();
            let by_person = analysis.commits_by_person_in(&pulse, &contributors, PEOPLE_SHOWN);
            let (window, counts, totals, bots) = (
                analysis.window(),
                analysis.commits(),
                analysis.totals(),
                analysis.bots(),
            );
            let (churn, hotspots, largest) =
                (analysis.churn(), analysis.hotspots(), analysis.largest());
            let (staleness, code_age) = (analysis.staleness(), analysis.code_age());
            let (ownership, silos) = joined(ownership);
            let (coupling, groups) = joined(coupling);
            Findings {
                generation: 0,
                window,
                counts,
                totals,
                pulse,
                contributors,
                bots,
                contributions: Vec::new(),
                groups,
                silos,
                by_person,
                churn,
                hotspots,
                largest,
                coupling,
                staleness,
                code_age,
                map: None,
                ownership,
                languages: joined(languages),
                duplicates: joined(duplicates),
                lines_by_person: joined(lines),
            }
        });
        f.contributions =
            commitscape_metrics::combine(&f.contributors, &f.ownership, &f.lines_by_person);
        f
    }

    pub fn nodes(&self) -> &[MapNode] {
        self.map.as_ref().map_or(&[], |m| &m.nodes)
    }

    pub fn files(&self) -> u32 {
        self.staleness.buckets.iter().map(|b| b.files).sum()
    }
}

fn joined<T>(handle: std::thread::ScopedJoinHandle<'_, T>) -> T {
    handle
        .join()
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
}
