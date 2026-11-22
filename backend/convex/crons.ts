import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Deletes bookmarks that have been in the trash for more than 30 days.
crons.cron("purge trash", "17 3 * * *", internal.bookmarks.purgeTrash, {});

// Queues the metadata fetch again for bookmarks stuck in `pending`.
crons.interval("retry stuck metadata", { hours: 1 }, internal.metadata.retryStuck, {});

export default crons;
