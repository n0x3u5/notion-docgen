#!/usr/bin/env ts-node-script

import {
  stat,
  readdir,
  readFile,
  writeFile,
  ensureFile,
  copy,
  writeJSON,
  pathExists,
} from 'fs-extra';
import type { Stats } from 'fs-extra';
import { URL } from 'url';
import {
  resolve,
  extname,
  basename,
  sep,
  parse,
  relative,
  dirname,
} from 'path';
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
import { Parent, Node } from 'unist';
import { argv } from 'process';
import yargsParser from 'yargs-parser';
import { createLogger, transports, format } from 'winston';
import findAllBetween from 'unist-util-find-all-between';
import { selectAll } from 'unist-util-select';

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
  toc: [string, Parent][];
}

const DOCS_ROOT_NAME = 'public-documentation';
const WARNING_SEPARATOR =
  '=====================================================================';

const yargv = yargsParser(argv);

const sourceDir = resolve(
  typeof yargv.src === 'string' ? yargv.src : `notion-md-export${sep}docs`
);
const examplesSrcFile = resolve(
  typeof yargv.examples === 'string'
    ? yargv.examples
    : `notion-md-export${sep}examples.md`
);
const outDir = resolve(typeof yargv.out === 'string' ? yargv.out : 'docs');
const examplesOutFile = `${outDir}${sep}examples.json`;
const sidebarFile = resolve(outDir, '_sidebar.md');

const doesExamplesFileExistP = pathExists(examplesSrcFile);

const logger = createLogger({
  format: format.combine(
    format.errors({ stack: true }),
    format.colorize(),
    format.simple()
  ),
  transports: new transports.Console(),
});

const trimLastWord = (s: string) => s.split(' ').slice(0, -1).join(' ');

function groupByIsToCItem(
  files: Item[],
  contentfulSubDirsContents: DirectoryContent[]
) {
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
}

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
  return [DOCS_ROOT_NAME]
    .concat(
      relative(sourceDir, path).split(sep).slice(1).map(normalizePathToken)
    )
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

function ensureFiles(files: string[]) {
  return Promise.all(
    files.map((path) => ensureFile(resolve(outDir, normalizePath(path))))
  );
}

function isPen(p: string) {
  return (
    p.includes('/pen/') ||
    p.includes('/details/') ||
    p.includes('/full/') ||
    p.includes('/debug/') ||
    p.includes('/live/') ||
    p.includes('/collab/') ||
    p.includes('/professor/') ||
    p.includes('/pres/')
  );
}

function getLinkText(linkNode: Node) {
  let linkText = '';

  visit(linkNode, 'text', ({ value }) => {
    if (typeof value === 'string') linkText = value;
  });

  return linkText;
}

function toAbsolute(relativePath: string, absoluteDirPath: string) {
  const absoluteDirPathParts = dirname(absoluteDirPath).split(sep);
  const relativePathParts = relativePath.split(sep);

  let dblDotCount = 0;

  relativePathParts.every((part) => {
    const isDblDot = part == '..';

    if (isDblDot) dblDotCount++;

    return isDblDot;
  });

  return absoluteDirPathParts
    .concat(relativePathParts.slice(dblDotCount))
    .join(sep);
}

async function scrape(srcDirectory: string): Promise<Ret> {
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
    ensureFiles(nonToCMarkdownItems.map(({ path }) => path)),
    ensureFiles(nonToCNonMarkdownItems.map(({ path }) => path)),
  ]);

  nonToCNonMarkdownItems.forEach((item) =>
    copy(item.path, resolve(outDir, normalizePath(item.path)))
  );

  nonToCMarkdownItemContents.forEach(({ content, path }) => {
    const r = remark();

    const tree = r.parse(content);
    const outPath = resolve(outDir, normalizePath(path));

    const t = map(tree, (node) => {
      if (
        node.type === 'text' &&
        typeof node.value === 'string' &&
        node.value.toLowerCase().includes('table of content')
      ) {
        const tocTree = toc(tree, { tight: true });

        logger.warn(
          `File: ${outPath}:${node.position?.start?.line}:${node.position?.start?.column}`
        );
        logger.warn(
          'A stray "Table of Contents" string was found. Check the Notion page for the file above.'
        );
        logger.warn(WARNING_SEPARATOR);

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
          if (hostname === 'codepen.io' && isPen(pathname)) {
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

    writeFile(outPath, r.stringify(t));
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
      toc: [],
      docFileMap: nonToCMarkdownFileMapEntries,
    };
  } else {
    const rets = await Promise.all(subDirs.map(({ path }) => scrape(path)));

    const x = rets.map(({ toc }) => toc);

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
                  return listItem([
                    paragraph([strong(text(value.toUpperCase()))]),
                    x[i][j][1],
                  ]);
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

(async () => {
  const doesExamplesFileExist = await doesExamplesFileExistP;
  const { toc: sideBarToC, docFileMap: filesMap } = await scrape(sourceDir);

  const fileHashMap = Object.fromEntries(filesMap);

  const fileContents = await readUTF8Files(
    filesMap.map(([_, filePath]) => filePath)
  );

  const r = remark();

  if (doesExamplesFileExist) {
    const examplesFileContent = await readFile(examplesSrcFile, {
      encoding: 'utf8',
    });

    const parsedExamplesFileContent = r.parse(examplesFileContent);

    const xs = selectAll('heading[depth=2]', parsedExamplesFileContent).reduce<
      Node[][]
    >((acc, node, idx, arr) => {
      if (idx === 0) return acc;

      acc.push([arr[idx - 1], node]);

      return acc;
    }, []);

    const json = xs.flatMap(([start, end]) => {
      let category = '';
      const paragraphs = findAllBetween(
        parsedExamplesFileContent as Parent,
        start,
        end,
        'paragraph'
      );

      visit(start, 'text', (text) => {
        if (typeof text.value === 'string') category = text.value;
      });

      return paragraphs.flatMap((paragraph) => {
        let link: string = '';

        visit(paragraph, 'link', (linkNode) => {
          if (typeof linkNode.url === 'string') link = linkNode.url;
        });

        return { category, link: link };
      });
    });

    writeJSON(examplesOutFile, json);
  } else {
    logger.warn(`File: ${examplesSrcFile}`);
    logger.warn(
      'The markdown file containing the list of Muze examples could not be found. Is the above file correct?'
    );
    logger.info('Perhaps the "--examples" argument needs to be set correctly.');
    logger.warn(WARNING_SEPARATOR);
  }

  fileContents.forEach(({ content, path }) => {
    const t = map(r.parse(content), (node) => {
      if (node.type === 'link' && typeof node.url === 'string') {
        try {
          const { hostname, pathname } = new URL(node.url);
          const pathnameParts = pathname.split('/');

          if (hostname.includes('notion.so')) {
            if (fileHashMap[pathnameParts[pathnameParts.length - 1]]) {
              return link(
                fileHashMap[pathnameParts[pathnameParts.length - 1]].substring(
                  outDir.length + 1
                ),
                getLinkText(node)
              );
            } else {
              logger.warn(
                `File: ${path}:${node.position?.start?.line}:${node.position?.start?.column}`
              );
              logger.warn(
                `No matching local file found for link with the URL "${
                  node.url
                }" and text "${getLinkText(
                  node
                )}". Check the Notion page for the file above.`
              );
              logger.warn(WARNING_SEPARATOR);

              return node;
            }
          } else {
            return node;
          }
        } catch {
          if (extname(node.url) === '.md') {
            const normalizedRelativePath = decodeURI(node.url)
              .split(sep)
              .map((part, idx, arr) => {
                if (part === '..' || part === '.') {
                  return part;
                } else {
                  return normalizePathToken(part, idx, arr);
                }
              })
              .join(sep);

            return link(
              toAbsolute(normalizedRelativePath, path).substr(outDir.length),
              getLinkText(node)
            );
          } else {
            const linkText = getLinkText(node);

            if (node.url === '' || linkText === '') {
              logger.warn(
                `File: ${path}:${node.position?.start?.line}:${node.position?.start?.column}`
              );
              if (node.url === '' && linkText === '') {
                logger.warn(
                  'Both the URL and the text of a link was found to be blank. Check the Notion page for the file above.'
                );
              } else if (node.url === '') {
                logger.warn(
                  `The URL of a link with text "${linkText}" was found to be blank. Check the Notion page for the file above.`
                );
              } else if (linkText === '') {
                logger.warn(
                  `The text of a link with URL "${node.url}" was found to be blank. Check the Notion page for the file above.`
                );
              }
              logger.warn(WARNING_SEPARATOR);
            }

            return node;
          }
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
