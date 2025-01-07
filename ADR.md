# scheduling with delay ratelimits?

we could also circumvent ratelimits in this fetch each, but the problem is that we quickly get very long-running requests and this is not good practice. also the max delay for a queue message is 12 hours so it would be limited.

instead it is probably better to do this with a function like i was trying at `boncron.m` that immediately returns 202 and redirects to the result.
