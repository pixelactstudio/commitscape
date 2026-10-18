import { createFileRoute, notFound } from "@tanstack/react-router";
import { PRODUCT } from "@commitscape/data";
import { NotFound } from "#/components/States";

export const Route = createFileRoute("/$")({
  beforeLoad: () => {
    throw notFound();
  },
  head: () => ({ meta: [{ title: `Not found · ${PRODUCT}` }, { name: "robots", content: "noindex" }] }),
  notFoundComponent: NotFound,
});
