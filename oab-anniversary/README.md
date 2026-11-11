# Organized & Beautiful birthday referral campaign

The public site has two routes:

- `/` is the simple referred-friend claim page. Shared links use `/?code=ISSUED_CODE`.
- `/pastcustomers` is the birthday thank-you and name/code picker for past clients.

The intended custom addresses are `https://anniversary.organizedandbeautiful.com/` and `https://anniversary.organizedandbeautiful.com/pastcustomers`. The same routes also work on the existing Sites hostname. HTML assets use root-relative paths so both direct visits and page refreshes load correctly.

## Sharing and code attribution

Past clients type at least three letters of their name and select their entry. The server resolves the exact issued referral code from the supplied workbook and fills a read-only code field automatically. No manual code entry is required. Name edits clear the prior selection and code. The ready-made text includes the sender’s name, code, and the referral page URL at the root. New URLs use the browser’s current origin, so they adapt when the site runs on the anniversary domain. No host is hardcoded in visitor code. Existing `/referral`, `/referral/`, and `/referral/index.html` links permanently redirect to `/` with all query parameters, including the issued code, preserved. Existing root `?ref=Name` links now directly show the referred-friend page; the friend must enter the issued code. `/pastcustomers/` redirects to `/pastcustomers` without losing query parameters.

The workbook has 14 usable issued codes and one incomplete client row without a phone/code. Its issued values are preserved rather than regenerated from an ambiguous first-name formula. The private directory is stored as a Sites runtime secret and is excluded from public assets and source. New issued codes must be added to that server-side directory; the local workbook is not polled automatically.

## Four-field claim form

The referral popup requires referral code, first name, last name, and phone. It POSTs to the same-origin `/api/referrals` endpoint. A success screen appears only after the tracker confirms the lead. Invalid codes and failures keep the visitor’s inputs. A normalized phone and campaign ID create a stable lead ID, preventing duplicate records from retries or alternate US phone formatting. It does not overwrite an existing claim.

Claims create leads in the existing OAB account in the Called To Build web tracker. Fields include the friend’s name and phone, `source: Referral`, `stage: Not Contacted Yet`, issued `referralCode`, registered `referredBy`, campaign ID, and creation time. The code, referrer, first/last names, and request are also written into the existing Notes column, so the current tracker UI shows attribution without needing a separate app deployment.

Consultations are not marked complete by a form submission. The team must update lead stages and confirm the three completed consultations. The status FAQ opens a ready-made text to OAB; after a client has entered their details it includes their name and code. The site does not display an invented live progress count. Form claims are stored directly in the tracker; automatic email notifications are not configured.

## Current offer

Past clients choose a $150 Amazon gift card or $150 off their next home organizing service after three referred people each complete a free in-person consultation. All three consultations must be scheduled by December 31, 2026. A paid service booking by the friends is not required for that thank-you. Referred friends/family in DFW get $150 off service when they book. Donation drop-off is included with organizing work; measuring, shopping, and product ordering have no additional fee. Clients pay for their chosen products. The offer has no cash value.

## Source and deployment

The source website is in `web/`. `worker/index.js` provides fixed-purpose public endpoints and tracker writes. `scripts/build.sh` embeds only the eleven public page/asset files in the ESM Worker under `dist/server/index.js`. `.openai/hosting.json` retains the existing project ID and public audience. Build output is ignored; private data is never embedded.

Server-only Sites secrets:

- `OAB_CRM_CONFIG`: existing OAB Firebase account UID, project ID, API key, and refresh token. No account password is stored in source or site secrets. Reconnect the account if its refresh token is revoked.
- `OAB_REFERRAL_CODES`: exact issued code directory used for validation and attribution.

The server allows only bounded same-origin JSON POSTs, validates all fields, rejects self-referrals, and uses an in-memory per-IP throttle. It exposes no lead-reading endpoint or full client directory. Name lookup returns at most five matching names and opaque IDs, without phone numbers or codes. Selecting an entry resolves only that client’s issued code. Lookup requests have a separate allowance so typing does not use the claim-submission limit. API responses are not cached. Source code permits only a fixed lead-creation operation in the configured account.

Build: `bash scripts/build.sh`. Validate: `node scripts/validate-artifact.mjs`. Backend tests: `node --test tests/referral-api.test.mjs`. Preview configuration is passed through hidden stdin in memory; preview scripts do not contain credentials.

Real project photos and Shelly B.’s quoted review come from the OAB website and its portfolio. Source photo URLs are retained in asset-sources.json. Campaign terms come from the customer’s screenshots and the supplied referral-code workbook.

## Client name selection

Added same-origin `/api/referral-clients` search and selected-client resolution on `/api/referral-code`. The name picker uses a three-letter minimum, a 300ms debounce, keyboard controls, and cancellation/version checks for stale responses. Clients without an issued code receive a contact-OAB path rather than a generated or empty code. The legacy explicit-code validation remains for older cached pages. API tests cover name matching, accent normalization, result caps, missing-code behavior, and separate throttles.
