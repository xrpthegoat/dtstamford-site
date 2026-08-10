/* RETIRED 2026-08-09 — replaced by Cloudflare Web Analytics.

   This file posted every pageview and click to a Supabase project
   (ltihgxyzmgrikonlcrhy.supabase.co) that no longer resolves in DNS — the project was
   deleted, most likely after idling out on the free tier. It had been failing on every
   page load of all 4,498 pages, logging "[track] web_events write FAILED — HTTP 0" and
   recording nothing, so the site had NO analytics at all.

   Analytics is now the Cloudflare Web Analytics beacon, injected before </body> by
   idx-sync/genlistings.py and seo-engine/retheme-blog.mjs. Nothing loads this file.

   If per-click tracking is ever wanted again (it fed Hive Mind), the git history of this
   file has the full implementation — but pair it with a check that alerts when writes
   stop, because the silent failure above went unnoticed for weeks.
*/
