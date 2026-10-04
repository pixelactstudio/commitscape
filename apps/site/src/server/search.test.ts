import { describe, expect, test } from "vitest";
import { fakeGitHub } from "#/test/deps";
import { searchGitHub } from "./search";

const gh = { api: "http://github.test" };

describe("searchGitHub", () => {
  test("finds people and repositories by name", async () => {
    const { fetcher } = fakeGitHub({
      "/search/users": { items: [{ login: "gaearon", avatar_url: "https://a/1", type: "User" }, { login: "facebook", avatar_url: "https://a/2", type: "Organization" }] },
      "/search/repositories": { items: [{ full_name: "gaearon/overreacted.io", description: "A blog", stargazers_count: 7000, language: "JavaScript" }] },
    });
    const found = await searchGitHub(gh, "gaear", fetcher);
    expect(found.people).toEqual([
      { login: "gaearon", avatar: "https://a/1", organization: false },
      { login: "facebook", avatar: "https://a/2", organization: true },
    ]);
    expect(found.repositories).toEqual([{ owner: "gaearon", name: "overreacted.io", description: "A blog", stars: 7000, language: "JavaScript" }]);
  });

  test("asks only for repositories once an owner is typed", async () => {
    const { asked, fetcher } = fakeGitHub({ "/search/repositories": { items: [] } });
    await searchGitHub(gh, "vercel/ne", fetcher);
    expect(asked).toEqual(["/search/repositories"]);
  });

  test("asks nothing for a single letter", async () => {
    const { asked, fetcher } = fakeGitHub({});
    expect(await searchGitHub(gh, "a", fetcher)).toEqual({ people: [], repositories: [] });
    expect(asked).toEqual([]);
  });

  test("answers nothing when GitHub refuses", async () => {
    const { fetcher } = fakeGitHub({});
    expect(await searchGitHub(gh, "nobody-here", fetcher)).toEqual({ people: [], repositories: [] });
  });
});
