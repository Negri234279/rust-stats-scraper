// Manual check for the dynamic filter reads. Run: npx tsx scripts/test-filters.mts
import { mooseProvider } from "../src/providers/moose/index.js";

const filters = await mooseProvider.listFilters();
console.log("SERVERS (" + filters.servers.length + "):", filters.servers);
console.log("TABS (" + filters.tabs.length + "):", filters.tabs);

const weeks = await mooseProvider.listWeeks("US Monthly (Premium)");
console.log("WEEKS for US Monthly (Premium) (" + weeks.length + "):", weeks);
