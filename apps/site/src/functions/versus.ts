import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { versusFullOf } from "#/server/versus";
import { profileDeps, publicReader } from "#/server/viewer";

const login = z.string().min(1).max(39);

/** Two people side by side, in full. */
export const getVersus = createServerFn({ method: "GET" })
  .validator(z.object({ a: login, b: login }))
  .handler(({ data }) => versusFullOf(profileDeps(), data.a, data.b, publicReader(getRequest())));
