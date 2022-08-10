import { fromMarkdown } from 'mdast-util-from-markdown';
import { fetch } from 'undici';

const API_MARKDOWN_URL = 'https://raw.githubusercontent.com/ipfs/ipfs-docs/main/docs/reference/kubo/rpc.md';

const markdownResponse = await fetch(API_MARKDOWN_URL);
if (!markdownResponse.ok) throw new Error(`Markdown response was ${markdownResponse.status}`);

const markdownText = await markdownResponse.text();

const markdownAST = fromMarkdown(markdownText);

console.log(JSON.stringify(markdownAST, null, 2));