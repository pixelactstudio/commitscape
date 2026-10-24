import { rangeOf, type GitTree } from "@commitscape/data";

export type TreeNode = {
  path: string;
  name: string;
  dir: boolean;
  lo: number;
  hi: number;
  children: TreeNode[];
};

export type Row = { node: TreeNode; depth: number; open: boolean };

/** The files of a tree as folders and files, folders first, a chain of folders holding one folder each shown as one: `src/main/java`. */
export function nodesOf(paths: readonly string[]): TreeNode {
  const root: TreeNode = { path: "", name: "", dir: true, lo: 0, hi: paths.length, children: [] };
  const made = new Map<string, TreeNode>([["", root]]);
  paths.forEach((path, i) => {
    let parent = root;
    for (let s = path.indexOf("/"); s !== -1; s = path.indexOf("/", s + 1)) {
      const dir = path.slice(0, s + 1);
      let node = made.get(dir);
      if (!node) {
        node = { path: dir, name: dir.slice(parent.path.length, -1), dir: true, lo: i, hi: i + 1, children: [] };
        made.set(dir, node);
        parent.children.push(node);
      } else node.hi = i + 1;
      parent = node;
    }
    parent.children.push({ path, name: path.slice(parent.path.length), dir: false, lo: i, hi: i + 1, children: [] });
  });
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => (a.dir === b.dir ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.dir ? -1 : 1));
    for (const c of node.children) if (c.dir) sort(c);
  };
  sort(root);
  const fold = (node: TreeNode) => {
    for (const c of node.children) {
      while (c.dir && c.children.length === 1 && c.children[0]?.dir) {
        const only = c.children[0];
        c.name = `${c.name}/${only.name}`;
        c.path = only.path;
        c.children = only.children;
      }
      if (c.dir) fold(c);
    }
  };
  fold(root);
  return root;
}

/** The rows on screen for the folders that are open, in order. */
export function rowsOf(root: TreeNode, open: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const walk = (node: TreeNode, depth: number) => {
    for (const c of node.children) {
      const isOpen = c.dir && open.has(c.path);
      rows.push({ node: c, depth, open: isOpen });
      if (isOpen) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** The folders to open to show a path: every folder above it, as the tree names them. */
export function ancestorsOf(root: TreeNode, path: string): string[] {
  const found: string[] = [];
  let node = root;
  for (;;) {
    const next = node.children.find((c) => c.dir && path.startsWith(c.path) && c.path !== path);
    if (!next) return found;
    found.push(next.path);
    node = next;
  }
}

/** The index of a file in a tree, or -1. */
export function indexOfPath(tree: GitTree, path: string): number {
  const [lo, hi] = rangeOf(tree.paths, path);
  return hi - lo === 1 && tree.paths[lo] === path ? lo : tree.paths.indexOf(path);
}

const score = (text: string, q: string): number | null => {
  let at = 0;
  let total = 0;
  let run = 0;
  for (const ch of q) {
    const j = text.indexOf(ch, at);
    if (j === -1) return null;
    run = j === at ? run + 1 : 0;
    total += 1 + run * 2 + (j === 0 || "/._-".includes(text[j - 1] ?? "") ? 4 : 0);
    at = j + 1;
  }
  return total;
};

/** Paths that contain the letters typed in order, best first: a match in the file's own name, a run of letters, the start of a word and a short name score higher. */
export function find(paths: readonly string[], query: string, limit: number): number[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const scored: [number, number][] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = (paths[i] as string).toLowerCase();
    const name = p.slice(p.lastIndexOf("/") + 1);
    const inName = score(name, q);
    const inPath = inName === null ? score(p, q) : null;
    if (inName === null && inPath === null) continue;
    const bonus = inName === null ? 0 : 20 + inName * 3 + (name.startsWith(q) ? 10 : 0);
    scored.push([i, (inName === null ? (inPath as number) : 0) + bonus - name.length * 0.3 - p.length * 0.05]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, limit).map(([i]) => i);
}
