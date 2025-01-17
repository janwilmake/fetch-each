/** This function recursively goes into the queue as long as the resulting responses have more to do that wasn't already done */
export const fetchLoop = async <T>(context: {
  urls: string[];
  maxDepth?: number;
  maxCount?: number;
  prefix?: string;
  proxy?: string;
  basePath: string;
  apiKey: string;
  headers?: { [name: string]: string };
  getResultRequests: (result: T) => Promise<string[]>;
  onResult: (result: T) => void;
}): Promise<void> => {
  let already: string[] = [];
  let urls = context.urls;

  let depth = 0;
  while (true) {
    depth += 1;

    console.log("urls", urls);

    if (context.maxDepth && depth >= context.maxDepth) {
      // base case 1: max depth
      break;
    }

    const requests = urls.map((url) => ({
      url: context.proxy ? `${context.proxy}/${url}` : url,
      headers: context.headers,
    }));
    const { basePath, apiKey } = context;
    console.log("requests", requests);
    const results = await fetchEach<T>(requests, { basePath, apiKey });

    // return the resultsf
    results.map((result) =>
      result.result ? context.onResult(result.result) : undefined,
    );

    // we have now done these urls
    already = already.concat(urls);

    if (context.maxCount && already.length >= context.maxCount) {
      // base case 2: max count
      break;
    }

    // go again with all links we found that we haven't searched yet
    const searchableUrls = (
      await Promise.all(
        results.map(async (item) =>
          item.result
            ? ((
                await context.getResultRequests(item.result)
              ).filter(
                (url: string) =>
                  !context.prefix ||
                  url.startsWith(context.prefix) ||
                  url.startsWith(new URL(context.prefix).pathname),
              ) as string[])
            : [],
        ),
      )
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
