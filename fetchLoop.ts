import { fetchEach } from "./mod";

/** This function recursively goes into the queue as long as the resulting responses have more to do that wasn't already done */
export const fetchLoop = async <T>(context: {
  urls: string[];
  maxDepth?: number;
  maxCount?: number;
  prefix?: string;
  proxy: string;
  headers?: { [name: string]: string };
  getResultRequests: (result: T) => string[];
  onResult?: (result: T) => void;
}): Promise<void> => {
  let already: string[] = [];
  let urls = context.urls;

  const config = { apiKey: "", basePath: "" };
  let depth = 0;
  while (true) {
    depth += 1;

    if (context.maxDepth && depth >= context.maxDepth) {
      // base case 1: max depth
      break;
    }

    const requests = urls.map((url) => ({
      url: `${context.proxy}/${encodeURIComponent(url)}`,
      headers: context.headers,
    }));
    const results = await fetchEach<T>(requests, config);

    // we have now done these urls
    already = already.concat(urls);

    if (context.maxCount && already.length >= context.maxCount) {
      // base case 2: max count
      break;
    }

    // go again with all links we found that we haven't searched yet
    const searchableUrls = results
      .map((item) =>
        item.result
          ? (context
              .getResultRequests(item.result)
              .filter(
                (url: string) =>
                  !context.prefix || url.startsWith(context.prefix),
              ) as string[])
          : [],
      )
      .flat()
      .filter(Boolean);

    urls = Array.from(
      new Set(...searchableUrls.filter((url) => !already.includes(url))),
    );

    if (urls.length === 0) {
      // basecase 3: there's nothing left to scrape
      break;
    }
  }
};

// With fetch-loop we can build powerful primitives like this
// But also dereferencing is likely a powerful thing that's possible
type ProxyResult = { markdown: string; links: string[] };
const myScraperProxy = "https://r.jina.ai";
const scrapeFromPrefix = (
  prefix: string,
  onResult: (result: ProxyResult) => void,
) => {
  return fetchLoop<ProxyResult>({
    urls: [prefix],
    proxy: myScraperProxy,
    // headers: {Authorization: `Bearer ${apiKey}`},
    maxCount: 1000,
    prefix,
    getResultRequests: (result) => result.links,
    onResult,
  });
};
