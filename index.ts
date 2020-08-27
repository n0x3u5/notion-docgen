#!/usr/bin/env ts-node-script

import { stat, readdir, readFile, writeFile, ensureFile, copy } from 'fs-extra';
import type { Stats } from 'fs-extra';
import { URL } from 'url';
import { resolve, extname, basename, sep, parse } from 'path';
import slugify from 'slugify';
import remark from 'remark';
import toc from 'mdast-util-toc';
import map from 'unist-util-map';
import visit from 'unist-util-visit';
import {
  html,
  image,
  strong,
  text,
  paragraph,
  brk,
  list,
  listItem,
  root,
  link,
} from 'mdast-builder';
import { Parent } from 'unist';

interface Item {
  path: string;
  stat: Stats;
}

interface ItemsGroupedByType {
  dirs: Item[];
  files: Item[];
}

interface ItemsGroupedByIsToC {
  tocItems: Item[];
  nonToCItems: Item[];
}

interface ItemsGroupedByIsMarkdown {
  markdownItems: Item[];
  nonMarkdownItems: Item[];
}

interface DirectoryContent {
  items: Item[];
  path: string;
}

interface Ret {
  docFileMap: [string, string][];
  toc?: [string, Parent][];
}

const sourceDir = resolve('notion-md-export');
const outDir = resolve('docs');
const sidebarFile = resolve(outDir, '_sidebar.md');

const trimLastWord = (s: string) => s.split(' ').slice(0, -1).join(' ');

const groupByIsToCItem = (
  files: Item[],
  contentfulSubDirsContents: DirectoryContent[]
) => {
  return files.reduce<ItemsGroupedByIsToC>(
    (acc, item) => {
      const x = contentfulSubDirsContents.find((contentfulSubDirContents) =>
        item.path.includes(contentfulSubDirContents.path)
      );

      if (x != null && x.items.length > 0 && isMarkdownFile(item)) {
        acc.tocItems.push(item);
      } else if (!isDotFile(item)) {
        acc.nonToCItems.push(item);
      }

      return acc;
    },
    { tocItems: [], nonToCItems: [] }
  );
};

async function readDir(absoluteDirPath: string) {
  const barePaths = await readdir(absoluteDirPath);

  const contentPaths = barePaths.map((barePath) =>
    resolve(absoluteDirPath, barePath)
  );

  const contentStats = await Promise.all(
    contentPaths.map((contentPath) => stat(contentPath))
  );

  return contentStats.map<Item>((stat, idx) => ({
    stat,
    path: contentPaths[idx],
  }));
}

async function readDirs(
  absoluteDirPaths: string[]
): Promise<DirectoryContent[]> {
  const dirsItems = await Promise.all(
    absoluteDirPaths.map((absoluteDirPath) => readDir(absoluteDirPath))
  );

  return dirsItems.map((items, idx) => ({
    items,
    path: absoluteDirPaths[idx],
  }));
}

async function readUTF8Files(absoluteFilePaths: string[]) {
  const itemContents = await Promise.all(
    absoluteFilePaths.map((path) => readFile(path, { encoding: 'utf-8' }))
  );

  return itemContents.map((content, idx) => ({
    content,
    path: absoluteFilePaths[idx],
  }));
}

function groupByIsDirectory(items: Item[]): ItemsGroupedByType {
  return items.reduce<ItemsGroupedByType>(
    (acc, item) => {
      if (item.stat.isDirectory()) {
        acc.dirs.push(item);
      } else {
        acc.files.push(item);
      }

      return acc;
    },
    { dirs: [], files: [] }
  );
}

function isMarkdownFile({ stat, path }: Item): boolean {
  return !stat.isDirectory() && extname(path) === '.md';
}

function isDotFile({ stat, path }: Item): boolean {
  return !stat.isDirectory() && basename(path).startsWith('.');
}

function normalizePathToken(pathToken: string, idx: number, arr: string[]) {
  if (idx === arr.length - 1) {
    const { name, ext } = parse(pathToken);

    let dehashifiedPathToken = pathToken;

    if (ext === '') {
      dehashifiedPathToken = trimLastWord(pathToken);
    } else if (ext === '.md') {
      dehashifiedPathToken = `${trimLastWord(name)}${ext}`;
    }

    return slugify(dehashifiedPathToken, { lower: true });
  } else {
    return slugify(trimLastWord(pathToken), { lower: true });
  }
}

function normalizePath(path: string): string {
  return path
    .substring(sourceDir.length + 1)
    .split(sep)
    .map(normalizePathToken)
    .join(sep);
}

function groupByIsMarkdown(items: Item[]) {
  return items.reduce<ItemsGroupedByIsMarkdown>(
    (acc, item) => {
      isMarkdownFile(item)
        ? acc.markdownItems.push(item)
        : acc.nonMarkdownItems.push(item);

      return acc;
    },
    { markdownItems: [], nonMarkdownItems: [] }
  );
}

async function y(srcDirectory: string): Promise<Ret> {
  const dirItems = await readDir(srcDirectory);

  const { files, dirs: subDirs } = groupByIsDirectory(dirItems);

  const subDirsContents = await readDirs(subDirs.map(({ path }) => path));

  const contentfulSubDirsContents = subDirsContents.filter(
    (subDirContent) => subDirContent.items.filter(isMarkdownFile).length > 0
  );

  const { tocItems, nonToCItems } = groupByIsToCItem(
    files,
    contentfulSubDirsContents
  );

  const {
    markdownItems: nonToCMarkdownItems,
    nonMarkdownItems: nonToCNonMarkdownItems,
  } = groupByIsMarkdown(nonToCItems);

  const [nonToCMarkdownItemContents, tocItemContents] = await Promise.all([
    readUTF8Files(nonToCMarkdownItems.map(({ path }) => path)),
    readUTF8Files(tocItems.map(({ path }) => path)),
    Promise.all(
      nonToCMarkdownItems.map(({ path }) =>
        ensureFile(resolve(outDir, normalizePath(path)))
      )
    ),
    Promise.all(
      nonToCNonMarkdownItems.map(({ path }) =>
        copy(path, resolve(outDir, normalizePath(path)))
      )
    ),
  ]);

  nonToCMarkdownItemContents.forEach(({ content, path }) => {
    const r = remark();

    const tree = r.parse(content);

    const t = map(tree, (node) => {
      if (
        node.type === 'text' &&
        typeof node.value === 'string' &&
        node.value.toLowerCase().includes('le of co')
      ) {
        const tocTree = toc(tree, { skip: 'Side Effects', tight: true });

        return tocTree.map == null
          ? node
          : paragraph([strong(text('Table of Contents')), brk, tocTree.map]);
      } else if (node.type === 'image' && typeof node.url === 'string') {
        const normalizedPath = decodeURI(node.url)
          .split(sep)
          .map(normalizePathToken)
          .join(sep);

        return image(normalizedPath, undefined, normalizedPath);
      } else if (node.type === 'link' && typeof node.url === 'string') {
        try {
          const { hostname, pathname } = new URL(node.url);
          if (hostname === 'codepen.io' && pathname.includes('/pen/')) {
            const pathnameTokens = pathname.split('/').slice(1);

            return html(
              `<div><iframe height='670' scrolling='no' src='//codepen.io/${pathnameTokens[0]}/embed/preview/${pathnameTokens[2]}/?height=670&theme-id=light&editable=true' frameborder='no' title='codepen embed' allowtransparency='true' allowfullscreen='true' style='width: 100%;'></iframe></div>`
            );
          } else {
            return node;
          }
        } catch {
          return node;
        }
      } else {
        return node;
      }
    });

    writeFile(resolve(outDir, normalizePath(path)), r.stringify(t));
  });

  const nonToCMarkdownFileMapEntries = nonToCMarkdownItems.map(({ path }): [
    string,
    string
  ] => {
    const { name } = parse(path);
    return [slugify(name), resolve(outDir, normalizePath(path))];
  });

  if (subDirs.length === 0) {
    return {
      docFileMap: nonToCMarkdownFileMapEntries,
    };
  } else {
    const rets = await Promise.all(subDirs.map(({ path }) => y(path)));

    const x = rets
      .map(({ toc }) => toc)
      .filter((ret): ret is [string, Parent][] => ret != null);

    const curDirToCs = tocItemContents.map(({ path, content }) => {
      let tocHeading: string = '';
      const tocEntries: { url: string; value: string }[] = [];

      visit(remark().parse(content), ['link', 'heading'], (node) => {
        if (node.type === 'heading' && node.depth === 1) {
          visit(node, 'text', (textNode) => {
            if (typeof textNode.value === 'string') {
              tocHeading = textNode.value;
            }
          });
        } else if (node.type === 'link') {
          visit(node, 'text', (textNode) => {
            if (
              typeof textNode.value === 'string' &&
              typeof node.url === 'string'
            )
              tocEntries.push({ url: node.url, value: textNode.value });
          });
        }
      });

      return {
        path,
        heading: tocHeading,
        entries: tocEntries,
      };
    });

    const toc = curDirToCs.map<[string, Parent]>(
      ({ path, heading, entries }, i) => {
        const { dir, name } = parse(path);
        const barePath = dir + sep + name;

        return [
          heading,
          list(
            'unordered',
            entries.map(({ url, value }) => {
              const { name } = parse(url);
              const href = normalizePath(barePath + sep + decodeURI(name));

              if (x[i]) {
                const j = x[i].findIndex(([s]) => s === value);
                if (x[i][j]) {
                  return listItem([paragraph([text(value)]), x[i][j][1]]);
                } else {
                  return listItem([
                    paragraph([link(href, undefined, [text(value)])]),
                  ]);
                }
              } else {
                return listItem([
                  paragraph([link(href, undefined, [text(value)])]),
                ]);
              }
            })
          ),
        ];
      }
    );

    const dfm = rets
      .map(({ docFileMap }) => docFileMap)
      .reduce<[string, string][]>(
        (acc, subDirFileMap) => acc.concat(subDirFileMap),
        []
      )
      .concat(nonToCMarkdownFileMapEntries);

    return {
      toc,
      docFileMap: dfm,
    };
  }
}

(async function x() {
  const { toc: sideBarToC, docFileMap: filesMap } = await y(sourceDir);

  const fileHashMap = Object.fromEntries(filesMap);

  const fileContents = await readUTF8Files(
    filesMap.map(([_, filePath]) => filePath)
  );

  const r = remark();

  fileContents.forEach(({ content, path }) => {
    const t = map(r.parse(content), (node) => {
      if (node.type === 'link' && typeof node.url === 'string') {
        try {
          const { hostname, pathname } = new URL(node.url);
          const pathnameParts = pathname.split('/');

          if (
            hostname.includes('notion.so') &&
            fileHashMap[pathnameParts[pathnameParts.length - 1]]
          ) {
            let linkText = '';

            visit(node, 'text', (node) => {
              if (typeof node.value === 'string') linkText = node.value;
            });

            return link(
              fileHashMap[pathnameParts[pathnameParts.length - 1]].substring(
                outDir.length + 1
              ),
              linkText
            );
          } else {
            return node;
          }
        } catch {
          return node;
        }
      } else {
        return node;
      }
    });

    writeFile(path, r.stringify(t));
  });

  writeFile(
    sidebarFile,
    remark().stringify(root(sideBarToC?.map(([_, tree]) => tree)))
  );
})();
