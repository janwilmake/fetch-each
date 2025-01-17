import { DurableObject } from "cloudflare:workers";

type QueueEnv = { [name: `QUEUE_${number}`]: Queue };
interface Env extends QueueEnv {
  workflow_durable_object: DurableObjectNamespace<WorkflowDurableObject>;
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
  item: RequestJson | null;
  index: number;
};

type Update = {
  type: "update";
  status: { [key: string]: number };
  done?: number;
  error?: string;
  results?: ResponseItem[];
};

type ResponseItem = {
  id: number;
  headers?: string;
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
  if (attempts > 25) return false;

  if (status >= 500) return true;
  if (status === 429) return true; // Rate limiting
  if (status === 408) return true; // Request timeout
  return false;
};

export default {
  fetch: async (request: Request, env: Env) => {
    // Handle OPTIONS request for CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    try {
      const url = new URL(request.url);
      const apiKey = request.headers
        .get("Authorization")
        ?.slice("Bearer ".length);
      const accept = request.headers.get("Accept");
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

      const QUEUE_COUNT = 1;
      const MAX_BATCH_SIZE = 6;

      // depending on the total requests that need to be done, we want to send so many in a batch
      const chunkSize =
        messages.length / QUEUE_COUNT <= MAX_BATCH_SIZE
          ? MAX_BATCH_SIZE
          : Math.min(100, Math.ceil(messages.length / QUEUE_COUNT));

      // Divide all requests over the queues as quickly and smartly as possible
      let q = 0;
      const promises: Promise<void>[] = [];
      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        const queue: Queue = env[`QUEUE_${q}`];
        promises.push(queue.sendBatch(chunk));
        q = (q + 1) % QUEUE_COUNT;
      }
      console.log("queueing it up");
      // Await for that to be all done
      await Promise.all(promises);
      console.log("queueing done");

      // Create Durable Object
      const doId = env.workflow_durable_object.idFromName(durableObjectName);
      const do_instance = env.workflow_durable_object.get(doId);

      // await the DO until all items are done
      const response = await do_instance.fetch(
        new Request(url.origin + "/?count=" + array.length, {
          method: "GET",
          headers: { accept: accept || "text/event-stream" },
        }),
      );

      console.log("responses ready!");

      return response;
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
        const responseHeaders: { [name: string]: string } = {};

        if (item) {
          try {
            const { url, body, headers, method } = item;
            // execute request
            console.log("fetching", url);
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

            const responseType = response.headers
              .get("content-type")
              ?.split("/")[0];
            if (responseType && ["image", "video"].includes(responseType)) {
              done = true;
              console.log("Responsetype is not waht we like");
              return;
            }
            const text = await response.text();
            console.log("fech-each done", url, done);
            response.headers.forEach(
              (value, key) => (responseHeaders[key] = value),
            );

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
        } else {
          status = 200;
          done = true;
        }

        // retry cetain ones, don't retry other ones
        // add intermediate and final results of the request onto the durable object
        const doId = env.workflow_durable_object.idFromName(durableObjectName);
        const do_instance = env.workflow_durable_object.get(doId);

        const request = new Request("http://something.com/", {
          method: "POST",
          body: JSON.stringify({
            id: index,
            status,
            headers: Object.keys(responseHeaders).length
              ? JSON.stringify(responseHeaders)
              : undefined,
            error,
            result,
            created_at: Date.now(),
            done: done ? 1 : 0,
          } satisfies ResponseItem),
        });

        // submit the value to the sql DO, circumventing it being overloaded
        await fetchWithRetry(do_instance, request);

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

const fetchWithRetry = async (
  stub: DurableObjectStub,
  request: Request,
  maxAttempts = 25,
) => {
  let attempt = 0;
  while (true) {
    try {
      return await stub.fetch(request);
    } catch (e: any) {
      attempt++;
      if (attempt >= maxAttempts || !e.retryable) {
        throw e;
      }
      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 100),
      );
    }
  }
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
          headers TEXT,
          created_at INTEGER
        )
      `);
    } catch (error) {
      console.error("Failed to initialize SQL storage:", error);
      throw error; // Re-throw to prevent silent failure
    }
  }

  async alarm(): Promise<void> {
    // Clean up the DO after all work is done
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      // always stream, for now
      const isStream = request.headers.get("accept") === "text/event-stream";

      if (!isStream) {
        const url = new URL(request.url);
        const count = Number(url.searchParams.get("count"));

        let results;
        let t = 0;

        while (t <= 86400) {
          // count done

          // NB: can be expensive for large responses, so may be better to count statuses and 'done' in a query instead.
          results = this.sql
            .exec<ResponseItem>(`SELECT * FROM responses ORDER BY id ASC`)
            .toArray();

          // Count statuses
          const status: { [key: string]: number } = {};
          results.forEach((r) => {
            status[r.status] = (status[r.status] || 0) + 1;
          });

          const r = results.filter((x) => x.done);

          const newUpdateString = JSON.stringify({
            type: "update",
            status,
            done: r.length,
            results: r,
          } satisfies Update);

          const allDone = results!.filter((x) => x.done).length === count;

          if (allDone) {
            // Set alarm to delete DO after 1 hour
            await this.state.storage.setAlarm(Date.now() + 3600000);
            break;
          }

          t = t + 0.5;
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }

        const finalResults = this.sql
          .exec<ResponseItem>(`SELECT * FROM responses ORDER BY id ASC`)
          .toArray();

        const resultArray = finalResults
          .sort((a, b) => a.id - b.id)
          .map((item) => ({
            status: item.status,
            error: item.error,
            headers: tryParseJson(item.headers) || item.headers || undefined,
            result: tryParseJson(item.result) || item.result || null,
          }));
        return new Response(JSON.stringify(resultArray), { status: 200 });
      }

      // stream
      return new Response(
        new ReadableStream({
          start: async (controller) => {
            try {
              const url = new URL(request.url);
              const count = Number(url.searchParams.get("count"));
              const encoder = new TextEncoder();

              let results;
              let t = 0;
              let updateString;
              let error: string | undefined =
                "Timeout exceeded: max queue time is 1 day";

              while (t <= 86400) {
                // count done

                // NB: can be expensive for large responses, so may be better to count statuses and 'done' in a query instead.
                results = this.sql
                  .exec<ResponseItem>(`SELECT * FROM responses ORDER BY id ASC`)
                  .toArray();

                // Count statuses
                const status: { [key: string]: number } = {};
                results.forEach((r) => {
                  status[r.status] = (status[r.status] || 0) + 1;
                });

                const r = results.filter((x) => x.done);

                const newUpdateString = JSON.stringify({
                  type: "update",
                  status,
                  done: r.length,
                  results: r,
                } satisfies Update);
                if (updateString !== newUpdateString) {
                  controller.enqueue(
                    encoder.encode(
                      `event: update\ndata: ${newUpdateString}\n\n`,
                    ),
                  );
                }

                updateString = newUpdateString;
                const allDone = results!.filter((x) => x.done).length === count;

                if (allDone) {
                  // Set alarm to delete DO after 1 hour
                  await this.state.storage.setAlarm(Date.now() + 3600000);
                  error = undefined;
                  break;
                }

                t = t + 0.5;
                await new Promise<void>((resolve) => setTimeout(resolve, 500));
              }

              const finalResults = this.sql
                .exec<ResponseItem>(`SELECT * FROM responses ORDER BY id ASC`)
                .toArray();

              const resultArray = finalResults
                .sort((a, b) => a.id - b.id)
                .map((item) => ({
                  status: item.status,
                  error: item.error,
                  headers:
                    tryParseJson(item.headers) || item.headers || undefined,
                  result: tryParseJson(item.result) || item.result || null,
                }));

              // Send final result
              controller.enqueue(
                encoder.encode(
                  `event: result\ndata: ${JSON.stringify({
                    type: "result",
                    array: resultArray,
                  })}\n\n`,
                ),
              );

              controller.close();
            } catch (e: any) {
              console.error("crash in stream", e);
              const encoder = new TextEncoder();

              controller.enqueue(
                encoder.encode(
                  `event: result\ndata: ${JSON.stringify({
                    type: "update",
                    error: "Crash in stream" + e.message,
                  })}\n\n`,
                ),
              );

              controller.close();
            }
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        },
      );
    }

    if (request.method === "POST") {
      try {
        const data: ResponseItem = await request.json();

        this.sql.exec(
          `INSERT OR REPLACE INTO responses (id, status, done, error, result, headers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          data.id,
          data.status,
          data.done,
          data.error,
          JSON.stringify(data.result),
          data.headers ? data.headers : null,
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
