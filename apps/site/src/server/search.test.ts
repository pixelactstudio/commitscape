import { describe, expect, test } from "vitest";
import { fakeGitHub, testDb } from "#/test/deps";
import { searchGitHub } from "./search";

const searching = async (fetcher: typeof fetch) => ({ db: await testDb(), github: { api: "http://github.test", fetcher } });

describe("searchGitHub", () => {
  test("finds people and repositories by name", async () => {
    const { fetcher } = fakeGitHub({
      "/search/users": { items: [{ login: "gaearon", avatar_url: "https://a/1", type: "User" }, { login: "facebook", avatar_url: "https://a/2", type: "Organization" }] },
      "/search/repositories": { items: [{ full_name: "gaearon/overreacted.io", description: "A blog", stargazers_count: 7000, language: "JavaScript" }] },
    });
    const found = await searchGitHub(await searching(fetcher), "gaear");
    expect(found.people).toEqual([
      { login: "gaearon", avatar: "https://a/1", organization: false },
      { login: "facebook", avatar: "https://a/2", organization: true },
    ]);
    expect(found.repositories).toEqual([{ owner: "gaearon", name: "overreacted.io", description: "A blog", stars: 7000, language: "JavaScript" }]);
  });

  test("asks only for repositories once an owner is typed", async () => {
    const { asked, fetcher } = fakeGitHub({ "/search/repositories": { items: [] } });
    await searchGitHub(await searching(fetcher), "vercel/ne");
    expect(asked).toEqual(["/search/repositories"]);
  });

  test("asks nothing for a single letter", async () => {
    const { asked, fetcher } = fakeGitHub({});
    expect(await searchGitHub(await searching(fetcher), "a")).toEqual({ people: [], repositories: [] });
    expect(asked).toEqual([]);
  });

  test("answers nothing when GitHub refuses", async () => {
    const { fetcher } = fakeGitHub({});
    expect(await searchGitHub(await searching(fetcher), "nobody-here")).toEqual({ people: [], repositories: [] });
  });
});
