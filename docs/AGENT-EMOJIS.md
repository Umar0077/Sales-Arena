# Agent emoji deployment

This is an additive presentation feature. No migration or production import is automatic.

1. Back up PostgreSQL, including media tables. Review migration 011_agent_emojis; it adds assets and assignments without altering sales or financial tables.
2. Build the isolated release and retain the original assets/Emojis of Agents directory (all 19 PNGs). Do not rewrite the images.
3. Apply migrations only after release approval using the existing migration runner and application database role. No filesystem upload directory or nginx change is required: original bytes are stored in PostgreSQL BYTEA and served by immutable SHA-256 URLs. Database backups must include them.
4. In Admin → Celebrations → Agent Emoji Celebrations, run Import supplied originals. This validates each image and matches exact normalized database names. Existing assignments are never overwritten. Unmatched/ambiguous assets remain in the library for explicit assignment. Aliases are not guessed; assign Muhammad Adeel Afzal manually if the database uses Adeel Afzal.
5. Review the displayed per-file import report and all unassigned agents. Uploads support static PNG, JPEG and WebP, maximum 4 MB in the UI; server AGENT_EMOJI_MAX_BYTES defaults to 4 MB and cannot exceed 10 MB. Keep server and UI limits aligned.
6. Preview selected agents and each Arena mode. Teams previews use an explicitly labelled visual-only team override. Live team attribution remains the existing sale-date attribution.
7. Verify one genuine sale (including a fractional carrier) produces its normal popup and original sound once. Verify unavailable media leaves the original popup working.

Rollback: disable agent emojis in Admin first, or roll back the application release. Leave the additive tables and immutable assets intact. No financial restoration or media deletion is required. In-flight popups keep their current image; subsequent popups resolve the latest assignment. Resolver requests time out after 1.5 seconds and never delay the sale queue.

No code here runs production migrations, imports, deployment, or service restarts. Import matching requires access to real agent records at deployment time; the repository's filenames are not verified database identities.
