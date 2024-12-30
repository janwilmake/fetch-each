// Simple way to benchmark multiple LLMs by creating a queue for each model.

import { fetchEach } from "../mod";

export const structuredOutputs = async <T>(
  llmConfig: {
    llmBasePath: string;
    llmApiKey: string;
    llmModelName: string;
  },
  messagesArray: { role: string; content: string }[][],
) =>
  (
    await fetchEach<T>(
      messagesArray.map((messages) => ({
        url: "https://chatcompletions.com/chat/completions",
        method: "POST",
        body: {
          model: llmConfig.llmModelName,
          messages,
        },
        headers: {
          "X-LLM-Base-Path": llmConfig.llmBasePath,
          "X-LLM-API-Key": llmConfig.llmApiKey,
          "X-Output": "codeblock.json",
        },
      })),
      {
        log: (s) => console.log(s, llmConfig),
        apiKey: "YOUR API KEY",
        basePath: "YOUR FETCH_EACH SERVER URL",
      },
    )
  ).map((x) => x.result);

const models = [
  {
    llmApiKey: "",
    llmBasePath: "https://api.openai.com/v1",
    llmModelName: "deepseek-chat",
  },
  {
    llmApiKey: "",
    llmBasePath: "https://api.deepseek.com/v1",
    llmModelName: "gpt-4o",
  },
  {
    llmApiKey: "",
    llmBasePath: "",
    llmModelName: "",
  },
];
export const test = async () => {
  const modelResults = await Promise.all(
    models.map(async (model) => {
      const result = await structuredOutputs<{
        name: string;
        description: string;
        category: string;
        country: string;
      }>(
        {
          llmApiKey: "",
          llmBasePath: "https://api.deepseek.com/v1",
          llmModelName: "deepseek-chat",
        },
        ["cat", "dog"].map((animal) => [
          {
            role: "user",
            content: `Return a name, description, category, and commonly found country for animal: ${animal}
                
        Resond in a JSON codeblock with format {name:string,description:string,category:string,country:string}`,
          },
        ]),
      );
      return { model, result };
    }),
  );

  console.dir(modelResults, { depth: Infinity, length: Infinity });
};

test();
