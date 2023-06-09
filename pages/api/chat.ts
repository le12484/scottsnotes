import type {NextRequest} from 'next/server';
import {createParser, ParsedEvent, ReconnectInterval} from 'eventsource-parser';
import {QueryResult} from '../../types/documents';

if (!process.env.OPENAI_API_KEY)
    console.warn(
        'OPENAI_API_KEY has not been provided in this deployment environment. ' +
            'Will use the optional keys incoming from the client, which is not recommended.',
    );

// definition for OpenAI wire types

interface ChatMessage {
    role: 'assistant' | 'system' | 'user';
    content: string;
}

interface ChatCompletionsRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    max_tokens?: number;
    stream: boolean;
    n: number;
}

interface ChatCompletionsResponseChunked {
    id: string; // unique id of this chunk
    object: 'chat.completion.chunk';
    created: number; // unix timestamp in seconds
    model: string; // can differ from the ask, e.g. 'gpt-4-0314'
    choices: {
        delta: Partial<ChatMessage>;
        index: number; // always 0s for n=1
        finish_reason: 'stop' | 'length' | null;
    }[];
}

async function queryScottsNotes(text: string): Promise<QueryResult | null> {
    console.log('queryScottsNotes', text);
    const data = {
        queries: [
            {
                query: text,
            },
        ],
    };
    const url = 'https://scotts-notes.fly.dev/query'; // Replace this with the URL of the API you want to access
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data),
        });

        if (response.ok) {
            const result = await response.json();
            // const texts = result.results[0].results.map((obj: any) => obj.text);
            return result;
        } else {
            console.error(
                `Request failed with status code: ${response.status}`,
            );
            return null;
        }
    } catch (error) {
        console.error('Fetch error:', error);
        return null;
    }
}

async function OpenAIStream(
    apiKey: string,
    payload: Omit<ChatCompletionsRequest, 'stream' | 'n'>,
): Promise<ReadableStream> {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const streamingPayload: ChatCompletionsRequest = {
        ...payload,
        stream: true,
        n: 1,
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        method: 'POST',
        body: JSON.stringify(streamingPayload),
    });

    let streamedResponse = '';
    const actionRe = new RegExp('Query:\\s*\\[([^\\]]+)\\]');
    return new ReadableStream(
        {
            async start(controller) {
                // handle errors here, to return them as custom text on the stream
                if (!res.ok) {
                    let errorPayload: object = {};
                    try {
                        errorPayload = await res.json();
                    } catch (e) {
                        // ignore
                    }
                    // return custom text
                    controller.enqueue(
                        encoder.encode(
                            `OpenAI API error: ${res.status} ${
                                res.statusText
                            } ${JSON.stringify(errorPayload)}`,
                        ),
                    );
                    return;
                }

                // the first packet will have the model name
                let sentFirstPacket = false;

                // stream response (SSE) from OpenAI may be fragmented into multiple chunks
                // this ensures we properly read chunks and invoke an event for each SSE event stream
                const parser = createParser(
                    async (event: ParsedEvent | ReconnectInterval) => {
                        // ignore reconnect interval
                        if (event.type !== 'event') return;

                        const actions = streamedResponse
                            .split('\n')
                            .map(a => actionRe.exec(a))
                            .filter(match => match !== null);

                        const queryText = actions[0]?.[1];

                        if (queryText) {
                            console.log('queryText', queryText);
                            const queryResult = queryText
                                ? await queryScottsNotes(queryText)
                                : '';

                            const queryResultStr = queryResult
                                ? JSON.stringify(queryResult)
                                : '{}';

                            const encodedQueryResult =
                                encoder.encode(queryResultStr);

                            if (encodedQueryResult) {
                                await controller.enqueue(encodedQueryResult);
                            }
                            controller.close();
                            return;
                        }

                        // https://beta.openai.com/docs/api-reference/completions/create#completions/create-stream
                        if (event.data === '[DONE]') {
                            controller.close();
                            return;
                        }

                        try {
                            const json: ChatCompletionsResponseChunked =
                                JSON.parse(event.data);

                            // ignore any 'role' delta update
                            if (json.choices[0].delta?.role) return;

                            // stringify and send the first packet as a JSON object
                            if (!sentFirstPacket) {
                                sentFirstPacket = true;
                                const firstPacket: ChatApiOutputStart = {
                                    model: json.model,
                                };
                                controller.enqueue(
                                    encoder.encode(JSON.stringify(firstPacket)),
                                );
                            }

                            // transmit the text stream
                            const text = json.choices[0].delta?.content || '';
                            const encodedText = encoder.encode(text);

                            streamedResponse += text;

                            controller.enqueue(encodedText);
                        } catch (e) {
                            // maybe parse error
                            controller.error(e);
                        }
                    },
                );

                // https://web.dev/streams/#asynchronous-iteration
                for await (const chunk of res.body as any)
                    parser.feed(decoder.decode(chunk));
            },
        },
        {highWaterMark: 128 * 1024},
    );
}

// Next.js API route

export interface ChatApiInput {
    apiKey?: string;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
}

/**
 * The client will be sent a stream of words. As an extra (an totally optional) 'data channel' we send a
 * string'ified JSON object with the few initial variables. We hope in the future to adopt a better
 * solution (e.g. websockets, but that will exclude deployment in Edge Functions).
 */
export interface ChatApiOutputStart {
    model: string;
}

export default async function handler(req: NextRequest) {
    // read inputs
    const {
        apiKey: userApiKey,
        model,
        messages,
        temperature = 0.1,
        max_tokens = 2048,
    }: ChatApiInput = await req.json();

    // select key
    const apiKey = userApiKey || process.env.OPENAI_API_KEY || '';
    if (!apiKey)
        return new Response(
            'Error: missing OpenAI API Key. Add it on the client side (Settings icon) or server side (your deployment).',
            {status: 400},
        );

    const stream: ReadableStream = await OpenAIStream(apiKey, {
        model,
        messages,
        temperature,
        max_tokens,
    });

    return new Response(stream);
}

//noinspection JSUnusedGlobalSymbols
export const config = {
    runtime: 'edge',
};
