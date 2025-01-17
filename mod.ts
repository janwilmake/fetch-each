// export { fetchLoop } from "./fetchLoop";

type ResponseItem = {
  id: number;
  headers?: string;
  status: number;
  error?: string;
  result?: any;
  done: number;
  created_at: number;
};

type Update = {
  type: "update";
  status: { [key: string]: number };
  done?: number;
  error?: string;
  results?: ResponseItem[];
};
/**
 * Do a single workflow
 */
export const fetchEach = async <U = any>(
  /** JSON serializable array */
  array: (string | any | null)[],
  /** Pass a logger to view updates */
  config: {
    apiKey: string;
    basePath: string;
    log?: (log: Update) => void;
  },
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
  console.log({ requestJsons, config });
  const response = await fetch(config.basePath, {
    method: "POST",
    body: JSON.stringify(requestJsons),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      //Accept: "text/event-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`fetch-each failed: ${await response.text()}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  // const reader = response.body.getReader();
  // const decoder = new TextDecoder();
  // let buffer = "";
  // let resultBuffer = "";
  // let collectingResult = false;

  // // while (true) {
  // //   const { done, value } = await reader.read();
  // //   if (done) break;

  // //   buffer += decoder.decode(value, { stream: true });
  // //   const lines = buffer.split("\n");
  // //   buffer = lines.pop() || "";

  // //   for (const line of lines) {
  // //     if (line.startsWith("event: ")) {
  // //       const eventType = line.slice(7).trim();

  // //       if (eventType === "result") {
  // //         collectingResult = true;
  // //         continue;
  // //       }

  // //       if (eventType === "update") {
  // //         const data = lines[lines.indexOf(line) + 1];
  // //         if (!data?.startsWith("data: ")) continue;
  // //         if (config.log) {
  // //           const result: Update = JSON.parse(data.slice(6));
  // //           config.log(result);
  // //         }
  // //       }
  // //     }

  // //     if (collectingResult && line.startsWith("data: ")) {
  // //       resultBuffer += line.slice(6);
  // //       try {
  // //         const parsed = JSON.parse(resultBuffer);
  // //         return parsed.array;
  // //       } catch {
  // //         // Keep collecting if JSON is incomplete
  // //         continue;
  // //       }
  // //     }
  // //   }
  // // }
  return await response.json();
  // throw new Error("Stream ended without complete result");
};
