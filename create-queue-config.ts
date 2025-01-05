import * as fs from "fs";

// Basic wrangler config
const baseConfig = `name = "multi-queue-worker"
main = "src/index.ts"
compatibility_date = "2024-01-02"

`;

// Generate queue producer and consumer configurations
const queueConfigs = Array.from(
  { length: 100 },
  (_, i) => `
[[queues.producers]]
queue = "queue-${i}"
binding = "QUEUE_${i}"

[[queues.consumers]]
queue = "queue-${i}"
max_batch_size = 6
max_concurrency = 250`,
).join("\n");

// Combine base config and queue configs
const fullConfig = baseConfig + queueConfigs;

// Write to wrangler.toml
fs.writeFileSync("wrangler123.toml", fullConfig);
