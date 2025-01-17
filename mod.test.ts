import { fetchEach } from "./mod";

fetchEach(
  ["https://uithub.com/openapi.json", "https://githus.com/openapi.json"],
  {
    apiKey: "SECRECY",
    basePath: "http://localhost:3003", //"https://fetch-each.actionschema.com",
    log: console.log,
  },
).then((result) => {
  console.log({ result });
});
