// Vite builds `?worker&inline` imports into the page's own script.
declare module "*?worker&inline" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
