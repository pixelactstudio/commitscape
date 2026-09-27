import type { BuildFailure, BuildStep } from "./builds";

export type Facts = {
  fullName: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  defaultBranch: string;
  license: string | null;
  topics: string[];
  archived: boolean;
  createdAt: string;
  pushedAt: string | null;
  languages: { name: string; bytes: number }[];
  contributors: { login: string; avatar: string; contributions: number }[];
  releases: { name: string; tag: string; at: string | null }[];
};

export type Lookup = {
  id: string;
  owner: string;
  name: string;
  status: "ok" | "not_found" | "private";
  facts: Facts | null;
  report: { at: number; bytes: number; lines: boolean } | null;
  build: {
    id: string;
    state: "queued" | "running" | "done" | "failed";
    step: BuildStep | null;
    reason: BuildFailure | null;
    requestedAt: number;
  } | null;
  stale: boolean;
  canBuild: boolean;
  access: "public" | "signed_out" | "denied" | "not_connected" | "allowed";
};
