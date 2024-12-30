import { fetchEach } from "../mod";
const LLM_API_KEY = "YOUR KEY";
const apiKey = "";
const basePath = "https://fetch-each.actionschema.com/ep";

const test = async () => {
  console.time("t");
  const prompts = new Array(1000)
    .fill(null)
    .map(
      (_, i) =>
        `is ${i} even? respond in a JSON codeblock with format {"isEven":boolean}`,
    );
  console.log("starting", prompts.length);
  const { log } = console;
  const results = await fetchEach<{ isEven: boolean }>(
    prompts.map(
      (prompt) =>
        `https://chatcompletions.com/base/https%3A%2F%2Fapi.deepseek.com%2Fv1/model/deepseek-chat/user/${encodeURIComponent(
          prompt,
        )}/codeblock.json?llmApiKey=${LLM_API_KEY}`,
    ),
    {
      // ensure these are made available
      apiKey,
      basePath,
      log,
    },
  );
  console.log(
    "DONE",
    results.map((x) =>
      x.result?.isEven !== undefined ? x.result.isEven : x.status,
    ),
  );
  console.timeEnd("t");
};

test();
