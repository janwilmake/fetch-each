import { DurableObject } from "cloudflare:workers";

interface Env {
  workflow_durable_object: DurableObjectNamespace<WorkflowDurableObject>;
  workflow_queue: Queue;
  SECRET: string;
}

export type RequestJson = {
  url: string;
  body?: string | object;
  /** defaults to post if body is given, get otherwise */
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  headers?: { [name: string]: string };
};

type FetchItem = {
  durableObjectName: string;
  item: RequestJson;
  index: number;
};

type ResponseItem = {
  id: number;
  status: number;
  error?: string;
  result?: any;
  done: number;
  created_at: number;
};

const tryParseJson = (data: any) => {
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
};

const shouldRetry = (status: number, attempts: number): boolean => {
  // Retry on server errors (5xx) and certain client errors
  if (attempts > 10) return false;
  if (status >= 500) return true;
  if (status === 429) return true; // Rate limiting
  if (status === 408) return true; // Request timeout
  return false;
};

export default {
  fetch: async (request: Request, env: Env) => {
    if (request.method !== "POST") {
      return new Response("Usage: POST / ({array,code}) => any[]");
    }

    try {
      const url = new URL(request.url);
      const apiKey = request.headers
        .get("Authorization")
        ?.slice("Bearer ".length);

      if (!apiKey || apiKey !== env.SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      const array: any[] = await request.json();

      if (!Array.isArray(array)) {
        return new Response("No array passed as input JSON", { status: 400 });
      }

      const durableObjectName = crypto.randomUUID();
      console.log({ durableObjectName, length: array.length });
      // If not, enqueue everything
      const messages: Array<MessageSendRequest<FetchItem>> = array.map(
        (item, index) => ({
          body: { item, index, durableObjectName },
        }),
      );

      // Send messages to queue in chunks of 100
      for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        await env.workflow_queue.sendBatch(chunk);
      }

      // Create Durable Object
      const doId = env.workflow_durable_object.idFromName(durableObjectName);
      const do_instance = env.workflow_durable_object.get(doId);

      // await the DO until all items are done
      const response = await do_instance.fetch(
        new Request(url.origin + "/?count=" + array.length, { method: "GET" }),
      );

      const result = await response.json();

      return new Response(JSON.stringify(result, undefined, 2), {
        status: response.status,
      });
    } catch (e: any) {
      console.error("Something went wrong", e);
      return new Response("Something went wrong: " + e.message, {
        status: 500,
      });
    }
  },

  queue: async (batch: MessageBatch<FetchItem>, env: Env): Promise<void> => {
    await Promise.all(
      batch.messages.map(async (message) => {
        // each message is a request

        const { index, item, durableObjectName } = message.body;
        let done = false;
        let status;
        let error;
        let result;
        try {
          const { url, body, headers, method } = item;
          // execute request
          const response = await fetch(url, {
            method: method ? method : body ? "POST" : "GET",
            headers,
            body:
              typeof body === "string"
                ? body
                : typeof body === "object"
                ? JSON.stringify(body)
                : undefined,
          });

          done =
            response.status === 200 ||
            !shouldRetry(response.status, message.attempts);

          status = response.status;
          const text = await response.text();

          if (response.status === 200) {
            result = tryParseJson(text) || text || undefined;
          } else {
            error = text;
          }
        } catch (e: any) {
          done = false;
          status = 500;
          error = e.message;
        }

        // retry cetain ones, don't retry other ones
        // add intermediate and final results of the request onto the durable object
        const doId = env.workflow_durable_object.idFromName(durableObjectName);
        const do_instance = env.workflow_durable_object.get(doId);

        // submit the value to the sql DO
        await do_instance.fetch(
          new Request("http://something.com/", {
            method: "POST",
            body: JSON.stringify({
              id: index,
              status,
              error,
              result,
              created_at: Date.now(),
              done: done ? 1 : 0,
            } satisfies ResponseItem),
          }),
        );

        if (done) {
          message.ack();
        } else {
          // Exponential backoff
          // Max 10 minutes
          const delaySeconds = Math.min(Math.pow(2, message.attempts), 600);
          message.retry({ delaySeconds });
        }
      }),
    );
  },
};

export class WorkflowDurableObject extends DurableObject<Env> {
  private state: DurableObjectState;
  //private env: Env;
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);

    this.state = state;

    try {
      this.sql = this.state.storage.sql;

      // Add error handling for SQL initialization
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS responses (
          id TEXT PRIMARY KEY,
          status INTEGER,
          done INTEGER,
          error TEXT,
          result TEXT,
          created_at INTEGER
        )
      `);
    } catch (error) {
      console.error("Failed to initialize SQL storage:", error);
      throw error; // Re-throw to prevent silent failure
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      try {
        const url = new URL(request.url);
        const count = Number(url.searchParams.get("count"));

        let t = 0;
        let error: string | undefined =
          "Timeout exceeded: max queue time is 1 day";
        while (t <= 86400) {
          // wait until all is done
          // TODO: see if i can actually use a promise such that i don't need to run the query every 500ms
          const { done } = this.sql
            .exec<{ done: number }>(
              `SELECT COUNT(*) AS done FROM responses WHERE done=1`,
            )
            .one();

          const allDone = done === count;

          if (allDone) {
            error = undefined;
            break;
          }
          t = t + 0.5;
          await new Promise<void>((resolve) =>
            setTimeout(() => resolve(), 500),
          );
        }

        const results = this.sql
          .exec<ResponseItem>(`SELECT * FROM responses ORDER BY id ASC`)
          .toArray();

        const resultArray = results
          .sort((a, b) => a.id - b.id)
          .map((item) => tryParseJson(item.result) || item.result || null);
        console.log("resss", results, resultArray);

        return new Response(
          error || JSON.stringify(resultArray, undefined, 2),
          {
            status: error ? 400 : 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      } catch (e: any) {
        return new Response("Something went wrong: " + e.message, {
          status: 500,
        });
      }
    }

    if (request.method === "POST") {
      try {
        const data: ResponseItem = await request.json();

        this.sql.exec(
          `INSERT OR REPLACE INTO responses (id, status, done, error, result, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          data.id,
          data.status,
          data.done,
          data.error,
          JSON.stringify(data.result),
          data.created_at,
        );

        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ success: false }), {
          status: 500,
        });
      }
    }

    return new Response(JSON.stringify({ success: false }), { status: 405 });
  }
}
