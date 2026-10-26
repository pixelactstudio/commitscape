import { sentryGlobalFunctionMiddleware, sentryGlobalRequestMiddleware } from "@sentry/tanstackstart-react";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

const named = createMiddleware({ type: "function" }).server(async ({ next, method, serverFnMeta }) => {
  (await import("./server/telemetry")).nameServerFn(method, serverFnMeta.name);
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, sentryGlobalRequestMiddleware],
  functionMiddleware: [sentryGlobalFunctionMiddleware, named],
}));
