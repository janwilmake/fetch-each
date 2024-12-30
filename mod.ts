export type RequestJson = {
  url: string;
  body?: string | object;
  /** defaults to post if body is given, get otherwise */
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  headers?: { [name: string]: string };
};

/**
 * Fetch without hitting fetch concurrency limits by fetching via a queue. Array must be an array of URLs or RequestJson's for it to be executed
 */
export const fetchEach = async <U = any>(
  /** JSON serializable array */
  array: (string | RequestJson)[],
  /** Pass a logger to view updates */
  config: { apiKey: string; basePath: string; log?: (log: string) => void },
): Promise<
  {
    result?: U;
    error?: string;
    status: number;
    headers: { [name: string]: string };
  }[]
> => {
  const requestJsons = array.map((item) =>
    typeof item === "string" ? { url: item } : item,
  );
  const response = await fetch(config.basePath, {
    method: "POST",
    body: JSON.stringify(requestJsons),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "text/event-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`dmap failed: ${await response.text()}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let resultBuffer = "";
  let collectingResult = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        const eventType = line.slice(7).trim();

        if (eventType === "result") {
          collectingResult = true;
          continue;
        }

        if (eventType === "update") {
          const data = lines[lines.indexOf(line) + 1];
          if (!data?.startsWith("data: ")) continue;
          if (config.log) {
            config.log(data.slice(6));
          }
        }
      }

      if (collectingResult && line.startsWith("data: ")) {
        resultBuffer += line.slice(6);
        try {
          const parsed = JSON.parse(resultBuffer);
          return parsed.array;
        } catch {
          // Keep collecting if JSON is incomplete
          continue;
        }
      }
    }
  }

  throw new Error("Stream ended without complete result");
};
