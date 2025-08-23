import "dotenv/config";
import { trpc } from "./trpc/trpc.js";

async function main() {
  const res = await trpc.mediaSourcesSettings.get.query();

  console.log("Worker booting...", res);
}

main();
