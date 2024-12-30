# 2024-12-29

made the first version called `dmap` at https://github.com/codefromanywhere/actionschema.dmap

# 2024-12-30

✅ decided to leave behind dmap and create something similar but purely focused around requests called `fetch-each`.

✅ dmap support for string[] and RequestJson[] and with that, default (simple) retry behaviour.

✅ allow dmap worker accept header with 'text/event-stream' and if so, last update being full JSON, and update each 500ms. use this in dmap fn and add logging.

✅ in the intermediate updates, show status counts and status counts with retry, and total done %

✅ resolve small error that caused the result not to be captured entirely

✅ ensure chatcomletions post also parses and returns codeblocks

create a wrapper around fetchEach to easily do LLM prompts with POST to catch the codeblock

create a benchmark for complex structured output in codeblock across various LLMs with 1000 tries.

ensure the durable objects and queues get cleaned up nicely

🤔 may be nice? `fetchEach` with instant 202 and callback
