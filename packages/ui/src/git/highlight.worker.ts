import type { Answered, Asked } from "./highlight";
import { tokenize } from "../code/syntax";

self.onmessage = (e: MessageEvent<Asked>) => {
  const ask = e.data;
  tokenize(ask.code, ask.lang)
    .then((marked) => self.postMessage({ id: ask.id, marked } satisfies Answered))
    .catch(() => self.postMessage({ id: ask.id, marked: null } satisfies Answered));
};
