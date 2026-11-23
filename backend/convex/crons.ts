import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Deletes bookmarks that have been in the trash for more than 30 days.
crons.cron("purge trash", "17 3 * * *", internal.bookmarks.purgeTrash, {});

// Queues the metadata fetch again for bookmarks stuck in `pending`.
crons.interval("retry stuck metadata", { hours: 1 }, internal.metadata.retryStuck, {});

// Starts the link check for bookmarks not checked in the last 7 days, a batch a day.
crons.cron("check links", "47 4 * * *", internal.linkCheck.checkDue, {});

export default crons;
