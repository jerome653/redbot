# Operator Review Package — `d_cff7a2fef080_mrvwror4`

**Thread:** Spam Activity and Bots on Multiple Websites
**Verdict:** ⛔ **REJECT**
**Certified:** 2026-07-23 16:07 · model claude-haiku-4-5-20251001

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

⛔ **RESOLVED** — the asker declared this resolved — 1 signal(s) from the original poster

- `post-body` **(original poster)** — "EDIT:"
  - post carries an EDIT/SOLVED marker: …estions that may help get to the source. Thanks in advance! EDIT: The spam is just found in high-traffic spikes, with countri…

## 2. Verdict reasons

- **thread-resolved** — the asker declared this resolved — 1 signal(s) from the original poster — certification stopped before claim extraction

## 3. Claims — 0

_No claims extracted._

## 4. What this reply actually concludes

_No terminal claims._



## 5. Known uncertainties

_Every claim states a provenance._



## 6. Contradictions — 0

_No contradiction survived the refutation pass._

---

## 7. The draft, last

> Before doing the log cross-reference, check one thing in GA4 first: Reports > Tech > Platform/device (or add the "Hostname" dimension in an Explore report) for the sessions in that spike window. If the hostname on those sessions is blank, "(not set)", or something that isn't your actual domain, that traffic never touched your website at all — it's fake hits sent straight at your Measurement ID (ghost/referral spam via the API). In that case your server access logs will show nothing for those IPs, and no amount of WAF or plugin work will touch it. The fix there is a GA4-side data filter (Admin > Data Settings > Data Filters, or a custom Explore filter) that excludes hits where hostname doesn't match your domain.
> 
> If the hostname does match your domain, then it's real requests hitting your server and the access-log approach makes sense: pull WPEngine's access logs for one spike day (available from the WPEngine User Portal under your site's "Logs" section, or via SFTP/SSH gateway if you have raw access) and look at what's hammering you during the spike window, e.g.:
> 
> ```
> awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -20
> ```
> 
> Run a whois/ASN lookup on the top IPs — if they cluster in a handful of hosting/datacenter ASNs rather than residential ISPs in Singapore/Hong Kong, that confirms scripted traffic rather than real visitors.
> 
> On blocking: WPEngine's managed plan generally won't let you install a WAF plugin like Wordfence, but they do maintain their own firewall and can add IP/range blocks on request — open a support ticket with the offending IPs/ASNs and ask them to block at the edge. That's usually more effective than a plugin anyway since it stops requests before they hit PHP.

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
