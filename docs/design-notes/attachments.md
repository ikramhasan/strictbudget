# Attachments, profile pictures and account logos

## Transaction attachments

- **Photos or PDFs**: an attachment is a photo (jpg, png, webp, avif, gif, svg, heic/heif) or a
  PDF, so the UI says "Attachment" and the View option is "Show Attachments". The type is read from
  the file's bytes (`file-type`), never from the name or the browser's type. A PDF opens in the
  browser's own viewer (Open PDF) rather than inline.
- **15 MB, checked on the server** against the file as uploaded. Photos aren't shrunk in the
  browser first, so a large phone photo can be refused; shrinking before upload is [#114](https://github.com/ikramhasan/strictbudget/issues/114).
- **Storage:** an S3-compatible bucket in production (a Railway Bucket, private; `S3_*` env,
  declared in `.railway/railway.ts`). Without a bucket, development keeps files on disk
  (`STORAGE_DIR`, default `apps/api/.storage`), tests keep them in memory, and production turns
  attachments off (503 `ATTACHMENTS_DISABLED`) rather than writing to a container disk a redeploy
  wipes. Uploads go through the API (bucket CORS for browser uploads isn't documented by Railway);
  downloads redirect to a 5-minute presigned link (bucket egress is free, the service's isn't).
  Served from the API's own disk, files get a sandbox CSP so an SVG's scripts can't run on the
  app's origin.
- **Deleting files:** a trigger queues a deleted attachment's key in `storage_deletion` in the same
  database transaction, so every path (the attachment, its transaction, account, budget or user
  deleted) is covered and a rolled-back delete keeps its file. The `storage.purge` job deletes the
  files: straight away after an attachment delete, every 15 minutes for cascades. An upload whose
  database commit fails after the file was stored leaves an unreferenced file (rare; nothing shows
  it).
- **Transfers:** the attachment hangs off the side it was added on and shows on both. Turning a
  transfer into a plain transaction, or matching an imported row into an entered one, moves it to
  the side that stays.
- **Not yet:** undo of a deleted transaction brings it back without its attachment; Duplicate
  doesn't copy it; no Has Photo / No Photo search ([#115](https://github.com/ikramhasan/strictbudget/issues/115)). Backups don't include attachments
  (files, not JSON).
- **Phones:** a paperclip on the card, and the attachment (add, open, delete) in the edit drawer.

## Profile pictures and account logos

- Cropped in the browser (`react-easy-crop`): a square with a circular highlight for a profile
  picture (shown as a circle), a plain square for a logo; sent as 512/256 px WebP (PNG where WebP
  can't be encoded). The server takes PNG/JPEG/WebP up to 2 MB.
- **Where they live:** files in the same storage; rows in `user_avatar` and `account_logo` with a
  new id per version, so URLs (`?v=`) are cache-safe; replacing or deleting queues the old file
  through the same trigger. A profile picture's URL is also Better Auth's `user.image`, so the
  session carries it.
- **Who sees a picture:** you, and people you share a budget with. Someone who left every shared
  budget falls back to their initial.
- **Sign-up:** there's no session until the email is confirmed, so a picture chosen at sign-up
  waits in that browser's storage and is uploaded on the first signed-in visit there. Confirming
  and signing in on another device loses it (add it in Account settings).
- **Sidebar:** every account gets a leading 20 px tile, its logo or its initial, so names line up.
