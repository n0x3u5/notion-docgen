# Notion Docgen
> Generate Muze documentation from Notion exported Markdown

## Usage
- Clone repo
- `cd` into cloned repo
- Run `npm install`
- Export Markdown from Notion including sub pages
- Extract downloaded zip into a directory named `notion-md-export` at the root of the repo
- Run `npm start`
- Visit the URL shown in the terminal

Note: An error stating `TypeError: Cannot read property 'indexOf' of undefined` will be shown in the terminal. It can be safely ignored for now since its fix is incoming in Docsify 5.0. The issue can be tracked here:
https://github.com/docsifyjs/docsify/issues/704 and is fixed in this commit: https://github.com/docsifyjs/docsify/commit/4036bd8388dd7eb8fb841ffeb57dd5a8aca126fb
