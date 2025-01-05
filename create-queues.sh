# Create a script to generate all 100 queues
for i in {0..99}; do
  npx wrangler queues create "queue-$i"
done