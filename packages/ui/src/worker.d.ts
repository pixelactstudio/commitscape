declare module "*?worker&inline" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

declare module "*.woff?inline" {
  const dataUrl: string;
  export default dataUrl;
}
