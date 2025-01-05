/**
 * Fetch without hitting fetch concurrency limits by fetching via a queue. Array must be an array of URLs or RequestJson's for it to be executed
 */
export const fetchEachMultiple = async <U = any>(
  /** JSON serializable array */
  array: (string | any | null)[],
  /** Pass a logger to view updates */
  config: {
    apiKey: string;
    basePath: string;
    log?: (log: string) => void;
    /** max amount of requests per workflow. To determine the right number, it's useful to know your input and output size can be maximum 100 MB, and the workflow can not handle more than 1000 requests per second. */
    maxBatchSize?: number;
  },
) => {
  /**
  TODO: divide into multiple workflows to avoid too many messages in a DO

  Our bottlenecks are: 
  1. max 100MB body size input+output, of all requests --> max 100K rows of 1KB
  2. max 1000 RPS into a DO --> 1 fetch-each is 1 DO... 100 queues provide max concurrency of 100*250*6=150000
  3. if we use this in a worker itself, we are bound to the max concurrency of the workflow, which is 6 for cloudflare. but we may use it elsewhere where it's 100 (e.g. in deno), or have a callback or 202/200 functionality in the future.

  Example:

  To scrape all of hackernews we need to do 42 million requests. Input body size is about 5GB total, but output body size is ±10GB total, and therefore needs minimum 100 separate requests of 420K requests each (may be more)

  Conclusion: we need an ability to put this into a scheduled message that can then be polled. This is actually a great useful feature. This way we can do many of these workflows in a workflow and then poll for its responses.

  */

  const maxBatchSize = 100000;
};
