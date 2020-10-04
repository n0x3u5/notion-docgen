#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = require("fs-extra");
const url_1 = require("url");
const path_1 = require("path");
const slugify_1 = __importDefault(require("slugify"));
const remark_1 = __importDefault(require("remark"));
const mdast_util_toc_1 = __importDefault(require("mdast-util-toc"));
const unist_util_map_1 = __importDefault(require("unist-util-map"));
const unist_util_visit_1 = __importDefault(require("unist-util-visit"));
const mdast_builder_1 = require("mdast-builder");
const process_1 = require("process");
const yargs_parser_1 = __importDefault(require("yargs-parser"));
const winston_1 = require("winston");
const DOCS_ROOT_NAME = 'public-documentation';
const WARNING_SEPARATOR = '=====================================================================';
const yargv = yargs_parser_1.default(process_1.argv);
const sourceDir = path_1.resolve(typeof yargv.src === 'string' ? yargv.src : 'notion-md-export');
const outDir = path_1.resolve(typeof yargv.out === 'string' ? yargv.out : 'docs');
const sidebarFile = path_1.resolve(outDir, '_sidebar.md');
const logger = winston_1.createLogger({
    format: winston_1.format.combine(winston_1.format.errors({ stack: true }), winston_1.format.colorize(), winston_1.format.simple()),
    transports: new winston_1.transports.Console(),
});
const trimLastWord = (s) => s.split(' ').slice(0, -1).join(' ');
function groupByIsToCItem(files, contentfulSubDirsContents) {
    return files.reduce((acc, item) => {
        const x = contentfulSubDirsContents.find((contentfulSubDirContents) => item.path.includes(contentfulSubDirContents.path));
        if (x != null && x.items.length > 0 && isMarkdownFile(item)) {
            acc.tocItems.push(item);
        }
        else if (!isDotFile(item)) {
            acc.nonToCItems.push(item);
        }
        return acc;
    }, { tocItems: [], nonToCItems: [] });
}
async function readDir(absoluteDirPath) {
    const barePaths = await fs_extra_1.readdir(absoluteDirPath);
    const contentPaths = barePaths.map((barePath) => path_1.resolve(absoluteDirPath, barePath));
    const contentStats = await Promise.all(contentPaths.map((contentPath) => fs_extra_1.stat(contentPath)));
    return contentStats.map((stat, idx) => ({
        stat,
        path: contentPaths[idx],
    }));
}
async function readDirs(absoluteDirPaths) {
    const dirsItems = await Promise.all(absoluteDirPaths.map((absoluteDirPath) => readDir(absoluteDirPath)));
    return dirsItems.map((items, idx) => ({
        items,
        path: absoluteDirPaths[idx],
    }));
}
async function readUTF8Files(absoluteFilePaths) {
    const itemContents = await Promise.all(absoluteFilePaths.map((path) => fs_extra_1.readFile(path, { encoding: 'utf-8' })));
    return itemContents.map((content, idx) => ({
        content,
        path: absoluteFilePaths[idx],
    }));
}
function groupByIsDirectory(items) {
    return items.reduce((acc, item) => {
        if (item.stat.isDirectory()) {
            acc.dirs.push(item);
        }
        else {
            acc.files.push(item);
        }
        return acc;
    }, { dirs: [], files: [] });
}
function isMarkdownFile({ stat, path }) {
    return !stat.isDirectory() && path_1.extname(path) === '.md';
}
function isDotFile({ stat, path }) {
    return !stat.isDirectory() && path_1.basename(path).startsWith('.');
}
function normalizePathToken(pathToken, idx, arr) {
    if (idx === arr.length - 1) {
        const { name, ext } = path_1.parse(pathToken);
        let dehashifiedPathToken = pathToken;
        if (ext === '') {
            dehashifiedPathToken = trimLastWord(pathToken);
        }
        else if (ext === '.md') {
            dehashifiedPathToken = `${trimLastWord(name)}${ext}`;
        }
        return slugify_1.default(dehashifiedPathToken, { lower: true });
    }
    else {
        return slugify_1.default(trimLastWord(pathToken), { lower: true });
    }
}
function normalizePath(path) {
    return [DOCS_ROOT_NAME]
        .concat(path_1.relative(sourceDir, path).split(path_1.sep).slice(1).map(normalizePathToken))
        .join(path_1.sep);
}
function groupByIsMarkdown(items) {
    return items.reduce((acc, item) => {
        isMarkdownFile(item)
            ? acc.markdownItems.push(item)
            : acc.nonMarkdownItems.push(item);
        return acc;
    }, { markdownItems: [], nonMarkdownItems: [] });
}
function ensureFiles(files) {
    return Promise.all(files.map((path) => fs_extra_1.ensureFile(path_1.resolve(outDir, normalizePath(path)))));
}
function isPen(p) {
    return (p.includes('/pen/') ||
        p.includes('/details/') ||
        p.includes('/full/') ||
        p.includes('/debug/') ||
        p.includes('/live/') ||
        p.includes('/collab/') ||
        p.includes('/professor/') ||
        p.includes('/pres/'));
}
function getLinkText(linkNode) {
    let linkText = '';
    unist_util_visit_1.default(linkNode, 'text', ({ value }) => {
        if (typeof value === 'string')
            linkText = value;
    });
    return linkText;
}
function toAbsolute(relativePath, absoluteDirPath) {
    const absoluteDirPathParts = path_1.dirname(absoluteDirPath).split(path_1.sep);
    const relativePathParts = relativePath.split(path_1.sep);
    let dblDotCount = 0;
    relativePathParts.every((part) => {
        const isDblDot = part == '..';
        if (isDblDot)
            dblDotCount++;
        return isDblDot;
    });
    return absoluteDirPathParts
        .concat(relativePathParts.slice(dblDotCount))
        .join(path_1.sep);
}
async function scrape(srcDirectory) {
    const dirItems = await readDir(srcDirectory);
    const { files, dirs: subDirs } = groupByIsDirectory(dirItems);
    const subDirsContents = await readDirs(subDirs.map(({ path }) => path));
    const contentfulSubDirsContents = subDirsContents.filter((subDirContent) => subDirContent.items.filter(isMarkdownFile).length > 0);
    const { tocItems, nonToCItems } = groupByIsToCItem(files, contentfulSubDirsContents);
    const { markdownItems: nonToCMarkdownItems, nonMarkdownItems: nonToCNonMarkdownItems, } = groupByIsMarkdown(nonToCItems);
    const [nonToCMarkdownItemContents, tocItemContents] = await Promise.all([
        readUTF8Files(nonToCMarkdownItems.map(({ path }) => path)),
        readUTF8Files(tocItems.map(({ path }) => path)),
        ensureFiles(nonToCMarkdownItems.map(({ path }) => path)),
        ensureFiles(nonToCNonMarkdownItems.map(({ path }) => path)),
    ]);
    nonToCNonMarkdownItems.forEach((item) => fs_extra_1.copy(item.path, path_1.resolve(outDir, normalizePath(item.path))));
    nonToCMarkdownItemContents.forEach(({ content, path }) => {
        const r = remark_1.default();
        const tree = r.parse(content);
        const outPath = path_1.resolve(outDir, normalizePath(path));
        const t = unist_util_map_1.default(tree, (node) => {
            var _a, _b, _c, _d;
            if (node.type === 'text' &&
                typeof node.value === 'string' &&
                node.value.toLowerCase().includes('table of content')) {
                const tocTree = mdast_util_toc_1.default(tree, { tight: true });
                logger.warn(`File: ${outPath}:${(_b = (_a = node.position) === null || _a === void 0 ? void 0 : _a.start) === null || _b === void 0 ? void 0 : _b.line}:${(_d = (_c = node.position) === null || _c === void 0 ? void 0 : _c.start) === null || _d === void 0 ? void 0 : _d.column}`);
                logger.warn('A stray "Table of Contents" string was found. Check the Notion page for the file above.');
                logger.warn(WARNING_SEPARATOR);
                return tocTree.map == null
                    ? node
                    : mdast_builder_1.paragraph([mdast_builder_1.strong(mdast_builder_1.text('Table of Contents')), mdast_builder_1.brk, tocTree.map]);
            }
            else if (node.type === 'image' && typeof node.url === 'string') {
                const normalizedPath = decodeURI(node.url)
                    .split(path_1.sep)
                    .map(normalizePathToken)
                    .join(path_1.sep);
                return mdast_builder_1.image(normalizedPath, undefined, normalizedPath);
            }
            else if (node.type === 'link' && typeof node.url === 'string') {
                try {
                    const { hostname, pathname } = new url_1.URL(node.url);
                    if (hostname === 'codepen.io' && isPen(pathname)) {
                        const pathnameTokens = pathname.split('/').slice(1);
                        return mdast_builder_1.html(`<div><iframe height='670' scrolling='no' src='//codepen.io/${pathnameTokens[0]}/embed/preview/${pathnameTokens[2]}/?height=670&theme-id=light&editable=true' frameborder='no' title='codepen embed' allowtransparency='true' allowfullscreen='true' style='width: 100%;'></iframe></div>`);
                    }
                    else {
                        return node;
                    }
                }
                catch {
                    return node;
                }
            }
            else {
                return node;
            }
        });
        fs_extra_1.writeFile(outPath, r.stringify(t));
    });
    const nonToCMarkdownFileMapEntries = nonToCMarkdownItems.map(({ path }) => {
        const { name } = path_1.parse(path);
        return [slugify_1.default(name), path_1.resolve(outDir, normalizePath(path))];
    });
    if (subDirs.length === 0) {
        return {
            toc: [],
            docFileMap: nonToCMarkdownFileMapEntries,
        };
    }
    else {
        const rets = await Promise.all(subDirs.map(({ path }) => scrape(path)));
        const x = rets.map(({ toc }) => toc);
        const curDirToCs = tocItemContents.map(({ path, content }) => {
            let tocHeading = '';
            const tocEntries = [];
            unist_util_visit_1.default(remark_1.default().parse(content), ['link', 'heading'], (node) => {
                if (node.type === 'heading' && node.depth === 1) {
                    unist_util_visit_1.default(node, 'text', (textNode) => {
                        if (typeof textNode.value === 'string') {
                            tocHeading = textNode.value;
                        }
                    });
                }
                else if (node.type === 'link') {
                    unist_util_visit_1.default(node, 'text', (textNode) => {
                        if (typeof textNode.value === 'string' &&
                            typeof node.url === 'string')
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
        const toc = curDirToCs.map(({ path, heading, entries }, i) => {
            const { dir, name } = path_1.parse(path);
            const barePath = dir + path_1.sep + name;
            return [
                heading,
                mdast_builder_1.list('unordered', entries.map(({ url, value }) => {
                    const { name } = path_1.parse(url);
                    const href = normalizePath(barePath + path_1.sep + decodeURI(name));
                    if (x[i]) {
                        const j = x[i].findIndex(([s]) => s === value);
                        if (x[i][j]) {
                            return mdast_builder_1.listItem([
                                mdast_builder_1.paragraph([mdast_builder_1.strong(mdast_builder_1.text(value.toUpperCase()))]),
                                x[i][j][1],
                            ]);
                        }
                        else {
                            return mdast_builder_1.listItem([
                                mdast_builder_1.paragraph([mdast_builder_1.link(href, undefined, [mdast_builder_1.text(value)])]),
                            ]);
                        }
                    }
                    else {
                        return mdast_builder_1.listItem([
                            mdast_builder_1.paragraph([mdast_builder_1.link(href, undefined, [mdast_builder_1.text(value)])]),
                        ]);
                    }
                })),
            ];
        });
        const dfm = rets
            .map(({ docFileMap }) => docFileMap)
            .reduce((acc, subDirFileMap) => acc.concat(subDirFileMap), [])
            .concat(nonToCMarkdownFileMapEntries);
        return {
            toc,
            docFileMap: dfm,
        };
    }
}
(async () => {
    const { toc: sideBarToC, docFileMap: filesMap } = await scrape(sourceDir);
    const fileHashMap = Object.fromEntries(filesMap);
    const fileContents = await readUTF8Files(filesMap.map(([_, filePath]) => filePath));
    const r = remark_1.default();
    fileContents.forEach(({ content, path }) => {
        const t = unist_util_map_1.default(r.parse(content), (node) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            if (node.type === 'link' && typeof node.url === 'string') {
                try {
                    const { hostname, pathname } = new url_1.URL(node.url);
                    const pathnameParts = pathname.split('/');
                    if (hostname.includes('notion.so')) {
                        if (fileHashMap[pathnameParts[pathnameParts.length - 1]]) {
                            return mdast_builder_1.link(fileHashMap[pathnameParts[pathnameParts.length - 1]].substring(outDir.length + 1), getLinkText(node));
                        }
                        else {
                            logger.warn(`File: ${path}:${(_b = (_a = node.position) === null || _a === void 0 ? void 0 : _a.start) === null || _b === void 0 ? void 0 : _b.line}:${(_d = (_c = node.position) === null || _c === void 0 ? void 0 : _c.start) === null || _d === void 0 ? void 0 : _d.column}`);
                            logger.warn(`No matching local file found for link with the URL "${node.url}" and text "${getLinkText(node)}". Check the Notion page for the file above.`);
                            logger.warn(WARNING_SEPARATOR);
                            return node;
                        }
                    }
                    else {
                        return node;
                    }
                }
                catch {
                    if (path_1.extname(node.url) === '.md') {
                        const normalizedRelativePath = decodeURI(node.url)
                            .split(path_1.sep)
                            .map((part, idx, arr) => {
                            if (part === '..' || part === '.') {
                                return part;
                            }
                            else {
                                return normalizePathToken(part, idx, arr);
                            }
                        })
                            .join(path_1.sep);
                        return mdast_builder_1.link(toAbsolute(normalizedRelativePath, path).substr(outDir.length), getLinkText(node));
                    }
                    else {
                        const linkText = getLinkText(node);
                        if (node.url === '' || linkText === '') {
                            logger.warn(`File: ${path}:${(_f = (_e = node.position) === null || _e === void 0 ? void 0 : _e.start) === null || _f === void 0 ? void 0 : _f.line}:${(_h = (_g = node.position) === null || _g === void 0 ? void 0 : _g.start) === null || _h === void 0 ? void 0 : _h.column}`);
                            if (node.url === '' && linkText === '') {
                                logger.warn('Both the URL and the text of a link was found to be blank. Check the Notion page for the file above.');
                            }
                            else if (node.url === '') {
                                logger.warn(`The URL of a link with text "${linkText}" was found to be blank. Check the Notion page for the file above.`);
                            }
                            else if (linkText === '') {
                                logger.warn(`The text of a link with URL "${node.url}" was found to be blank. Check the Notion page for the file above.`);
                            }
                            logger.warn(WARNING_SEPARATOR);
                        }
                        return node;
                    }
                }
            }
            else {
                return node;
            }
        });
        fs_extra_1.writeFile(path, r.stringify(t));
    });
    fs_extra_1.writeFile(sidebarFile, remark_1.default().stringify(mdast_builder_1.root(sideBarToC === null || sideBarToC === void 0 ? void 0 : sideBarToC.map(([_, tree]) => tree))));
})();
