import _ from 'lodash';
import * as fs from 'fs/promises';
import { fetch } from 'undici';
import type { Heading, Content, Text, Paragraph } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { OpenAPIV3 } from "openapi-types";

const API_MARKDOWN_URL = 'https://raw.githubusercontent.com/ipfs/ipfs-docs/main/docs/reference/kubo/rpc.md';
const DOCS_BASE_URL = `https://docs.ipfs.tech/reference/kubo/rpc/`;

const markdownResponse = await fetch(API_MARKDOWN_URL);
if (!markdownResponse.ok) throw new Error(`Markdown response was ${markdownResponse.status}`);

const markdownText = await markdownResponse.text();

const markdownAST = fromMarkdown(markdownText);

const endpointStartHeader = markdownAST.children.findIndex(child =>
    child.type === 'heading' &&
    child.depth === 2 &&
    child.children[0].type === 'text' &&
    child.children[0].value === 'RPC commands'
);

if (endpointStartHeader === -1) throw new Error('Could not find start of endpoint headers');

// -------------------------------------------------------------------------------------
// Step 1: we build up a list of endpoints, simply mapping the endpoint path (taken from
// the header directly) to a list of the markdown AST nodes relevant to that endpoint.
// -------------------------------------------------------------------------------------

const endpointsMarkdownFlatAST = markdownAST.children.slice(endpointStartHeader + 1);

let endpointsMarkdown: { [endpointPath: string]: Content[] } = {};
let currentEndpointPath: string;
let currentEndpointContent: Content[] = [];

function isHeader(node: Content, level: number, contentTest: (v: string) => boolean): node is Heading & {
    children: Heading['children'] & { 0: Text }
} {
    return node.type === 'heading' &&
        node.depth === level &&
        node.children[0].type === 'text' &&
        contentTest(node.children[0].value);
}

for (let node of endpointsMarkdownFlatAST) {
    if (isHeader(node, 2, v => v.startsWith('/api/'))) {
        // Start collecting the content of the next endpoint
        if (currentEndpointPath) {
            endpointsMarkdown[currentEndpointPath] = currentEndpointContent;
            currentEndpointContent = [];
        }

        currentEndpointPath = node.children[0].value;
    } else if (!currentEndpointPath) {
        // If we didn't find a header, and there's no header set, then we're right at the start and
        // it's not an endpoint, so something has gone horribly wrong. Fail early.
        throw new Error(`Couldn't find first endpoint header, instead found ${JSON.stringify(node)}`);
    } else {
        currentEndpointContent.push(node);
    }
}

// -------------------------------------------------------------------------------------
// Step 2: we parse the endpoint for each node, building a map from endpoint path to the
// parsed details for each endpoint (the description, parameters, etc)
// -------------------------------------------------------------------------------------
interface EndpointData {
    path: string;
    description: string;
    warning: 'deprecated' | 'experimental' | undefined;
    parameters: Array<EndpointParameter>;
    requestBodyDescription: string | undefined;
    responseBodyExample: EndpointRespnseExample | undefined;
    docsUrl: string;
}

interface EndpointParameter {
    name: string;
    description: string;
    type: string;
    defaultValue?: string;
    required: boolean;
    warning: 'deprecated' | 'experimental' | undefined;
}

type EndpointRespnseExample = { [key: string]: unknown } | Array<unknown>

// Given a list of nodes (raw nodes, in order & unfiltered from the original markdown), returns
// the raw markdown that generated this content. This is useful as some formatting details are
// awkward to reverse, so it's much nicer to just grab from the original text.
function getRawMarkdown(nodes: Content[]) {
    if (nodes.length === 0) return '';

    // Note that all positions here are ONE-INDEXED. Line 1 is the first line, column 1 is the
    // first column, etc.
    const start = nodes[0].position!.start;
    const end = nodes[nodes.length - 1].position!.end;

    const markdownLines = markdownText.split('\n');

    const relevantLines = markdownLines.slice(start.line - 1, end.line); // 1-indexed -> end inclusive

    return [
        relevantLines[0].slice(start.column - 1),
        ...relevantLines.slice(1, -1),
        ...(relevantLines.length > 1
            ? [relevantLines.slice(-1)[0].slice(0, end.column - 1)]
            : []
        )
    ].join('\n');
}

function parseIntroNodes(endpoint: string, nodes: Content[]): Pick<EndpointData, 'description' | 'warning'> {
    if (nodes.some(n => n.type !== 'paragraph')) {
        throw new Error(`Intro nodes for ${endpoint} are not all paragraphs`);
    }
    const paragraphs = nodes as Paragraph[];

    let warning: 'deprecated' | 'experimental' | undefined;
    const warningEndIndex = paragraphs.findIndex(n =>
        n.children[0].type === 'text' && n.children[0].value === ':::'
    );
    if (warningEndIndex !== -1) {
        // We must have a warning! Parse the warning value:
        const warningParagraph = paragraphs[0];
        const warningText = (warningParagraph.children[0] as Text).value;
        if (warningText === '::: warning DEPRECATED') {
            warning = 'deprecated';
        } else if (warningText === '::: warning EXPERIMENTAL') {
            warning = 'experimental';
        } else {
            throw new Error(`Unexpected intro warning for ${endpoint}: ${
                JSON.stringify(warningParagraph.children)
            }`);
        }
    }

    const descriptionNodes = paragraphs.slice(warningEndIndex + 1);
    const description = getRawMarkdown(descriptionNodes);
    return { description, warning };
}

function parseArguments(endpoint: string, node: Content | undefined): Array<EndpointParameter> {
    if (!node) return [];

    if (node.type === 'paragraph') {
        if (node.children[0].type === 'text' && node.children[0].value === 'This endpoint takes no arguments.') {
            return [];
        } else {
            throw new Error(`Unexpected argument paragraph for ${endpoint}: ${JSON.stringify(node)}`);
        }
    }

    if (node.type !== 'list') {
        throw new Error(`Unexpected argument node type for ${endpoint}: ${node.type}`);
    }

    return node.children.map((child, i) => {
        if (child.children.some(c => c.type !== 'paragraph')) {
            throw new Error(`Unexpected types for ${endpoint} arg line ${i}: ${
                child.children.map(c => c.type).join(', ')
            }`);
        }

        const argParts = child.children.flatMap((c: Paragraph) => c.children);

        const nameChild = argParts[0];
        if (nameChild.type !== 'inlineCode') {
            throw new Error(`Unexpected type for ${endpoint} arg ${i} name: ${nameChild.type}`);
        }
        const name = nameChild.value;

        const descriptionChildren = argParts.slice(1);
        const fullDefinition = descriptionChildren.map((descriptionPart) => {
            if (descriptionPart.type === 'strong') {
                return descriptionPart.children.map((c: Text) => {
                    if (c.type !== 'text') {
                        throw new Error(`Unexpected type for ${endpoint} arg ${i} strong description part: ${
                            descriptionPart.children.map(c => c.type).join(', ')
                        }`);
                    } else {
                        return c.value;
                    }
                }).join('');
            } else if (descriptionPart.type === 'text' || descriptionPart.type === 'inlineCode') {
                return descriptionPart.value;
            } else {
                throw new Error(`Unexpected type for ${endpoint} arg ${i} description: ${
                    descriptionChildren.map(c => c.type).join(', ')
                }`);
            }
        }).join('').trim();

        // This regex handles a few tricky cases - notably including some bits of markdown that repeat the
        // default value (Default: X, Default: X.) and defaults that include spaces, colons and newlines. Tricky.
        const matchDefinition = /^\[(\w+)\]: (.*?\.)(?: Default: (.*?)\.)*(?: Required: (\w+)\.)?$/s
            .exec(fullDefinition);

        if (!matchDefinition) {
            throw new Error(`Unexpected format for ${endpoint} arg ${i}: ${fullDefinition}`);
        }
        const [, type, description, defaultValue, isRequired] = matchDefinition;

        return {
            name,
            description,
            type,
            defaultValue,
            required: isRequired === 'yes',
            warning:
                description.toLowerCase().includes('deprecated')
                    ? 'deprecated'
                : description.toLowerCase().includes('experimental')
                    ? 'experimental'
                : undefined
        };
    });
}

function parseResponseInfo(endpoint: string, nodes: Content[]): EndpointRespnseExample | undefined {
    if (nodes.length !== 2) {
        throw new Error(`Unexpected number of response info nodes for ${endpoint}: ${JSON.stringify(nodes)}`);
    }

    const introNode = nodes[0];

    if (
        introNode.type !== 'paragraph' ||
        introNode.children[0].type !== 'text' ||
        introNode.children[0].value !== 'On success, the call to this endpoint will return with 200 and the following body:'
    ) {
        throw new Error(`Unexpected response info intro for ${endpoint}: ${JSON.stringify(introNode)}`);
    }

    const codeNode = nodes[1];

    if (codeNode.type !== 'code') {
        throw new Error(`Unusual response info code block for ${endpoint}: ${JSON.stringify(codeNode)}`);
    }

    if (codeNode.value === 'This endpoint returns a `text/plain` response body.') {
        // This is a placeholder value that means nothing/unstructured data.
        return undefined;
    } else {
        // Otherwise, this data should be JSON, so parse & return the raw data:
        try {
            return JSON.parse(codeNode.value);
        } catch (e) {
            throw new Error(`Failed to parse JSON response example for ${endpoint}: ${codeNode.value}`);
        }
    }
}

const endpointData: { [path: string]: EndpointData } = _.mapValues(endpointsMarkdown, (nodes, endpoint) => {
    try {
        const argumentsHeaderIndex = nodes.findIndex(node => isHeader(node, 3, v => v === 'Arguments'));
        if (argumentsHeaderIndex === -1) throw new Error(`No arguments header found for ${endpoint}`);

        const introNodes = nodes.slice(0, argumentsHeaderIndex);
        const { description, warning } = parseIntroNodes(endpoint, introNodes);

        const requestBodyIndex = nodes.findIndex(node => isHeader(node, 3, v => v === 'Request Body'));
        const responseIndex = nodes.findIndex(node => isHeader(node, 3, v => v === 'Response'));
        if (responseIndex === -1) throw new Error(`No response header found for ${endpoint}`);

        const endOfArgumentsIndex = requestBodyIndex !== -1 ? requestBodyIndex : responseIndex;
        const argumentNodesCount = endOfArgumentsIndex - argumentsHeaderIndex - 1;
        if (argumentNodesCount > 1) {
            throw new Error(`Unexpected argument node length for ${endpoint}: ${
                argumentNodesCount
            } (from ${argumentsHeaderIndex} to ${endOfArgumentsIndex})`);
        }
        const argumentNode = argumentNodesCount ? nodes[argumentsHeaderIndex + 1] : undefined;
        const parameters = parseArguments(endpoint, argumentNode);

        const requestBodyNodes = requestBodyIndex !== -1
            ? nodes.slice(requestBodyIndex + 1, responseIndex)
            : [];
        const requestBodyDescription = getRawMarkdown(requestBodyNodes).trim() || undefined;

        const endIndex = nodes.findIndex(node => isHeader(node, 3, v => v === 'cURL Example'));
        if (endIndex === -1) throw new Error(`No end header found for ${endpoint}`);

        const responseInfoNodes = nodes.slice(responseIndex + 1, endIndex);
        const responseBodyExample = parseResponseInfo(endpoint, responseInfoNodes);

        return {
            path: endpoint,
            description,
            warning,
            parameters,
            requestBodyDescription,
            responseBodyExample,
            docsUrl: `${DOCS_BASE_URL}#${endpoint.slice(1).replace(/\//g, '-')}`
        }
    } catch (e) {
        console.log(JSON.stringify(nodes, null, 2));
        throw e;
    }
});


// -------------------------------------------------------------------------------
// Step 3: Turn the parsed structured endpoint data into a full OpenAPI schema:
// -------------------------------------------------------------------------------

function getJsonSchemaForIpfsType(type: string):
    | { type: 'boolean' | 'string' | 'integer' }
    | { type: 'array', items: { type: 'string' } }
{
    if (type === 'array') {
        return { type: 'array', items: { type: 'string' } };
    };

    const jsonSchemaType = ({
        'bool': 'boolean',
        'string': 'string',
        'int': 'integer',
        'uint': 'integer',
        'int64': 'integer',
    } as const)[type];

    if (!jsonSchemaType) {
        throw new Error(`Unrecognized parameter type: ${type}`);
    }

    return { type: jsonSchemaType };
}

const spec: OpenAPIV3.Document = {
    openapi: '3.0.0',
    info: {
        title: 'IPFS RPC API',
        version: 'v0',
        description: '',
        ...({
            'x-providerName': 'IPFS',
            'x-logo': {
                url: 'https://raw.githubusercontent.com/ipfs/ipfs-docs/55fe8bc6a53ba3b9023951fb4b432efbbc81fba5/docs/.vuepress/public/images/ipfs-logo.svg' // TODO: Does this work? Good option?
            }
        } as any)
    },
    externalDocs: {
        url: DOCS_BASE_URL
    },
    paths: _.mapValues(endpointData, (endpoint) => {
        const operation: OpenAPIV3.OperationObject = {
            operationId: endpoint.path, // Safe, as this is no REST API - all POST, one method per path
            description: endpoint.description,
            externalDocs: { url: endpoint.docsUrl },
            deprecated: endpoint.warning === 'deprecated' ? true : undefined,
            parameters: endpoint.parameters.map(param => ({
                name: param.name,
                in: 'query',
                description: param.description,
                required: param.required ? true : undefined,
                deprecated: param.warning === 'deprecated' ? true : undefined,
                schema: {
                    ...getJsonSchemaForIpfsType(param.type),
                    default: param.defaultValue
                }
            })),
            requestBody: endpoint.requestBodyDescription
                ? {
                    description: endpoint.requestBodyDescription,
                    content: {}
                }
                : undefined,
            responses: {
                200: {
                    description: 'Successful response',
                    content: endpoint.responseBodyExample ?
                        {
                            'application/json': {
                                example: endpoint.responseBodyExample
                            }
                        }
                        : undefined
                }
            }
        };

        return {
            post: operation
        }
    })
};

await fs.writeFile('./ipfs-openapi.json', JSON.stringify(spec, null, 2));