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
export const fetchEach = async <T, U = any>(
  /** JSON serializable array */
  array: (string | RequestJson)[],
  /** Pass a logger to view updates */
  config: { apiKey: string; basePath: string; log?: (log: string) => void },
): Promise<
  { result: U; status: number; headers?: { [name: string]: string } }[]
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

  const result: {
    result: U;
    status: number;
    headers: { [name: string]: string };
  }[] = await response.json();
  return result;
};
