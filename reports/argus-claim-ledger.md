# Claim Ledger

**Generated:** 2026-07-29 · **Certifications:** 3 · **Claims:** 30

Every factual assertion Argus has extracted, across every draft. This is the record that makes
"the drafts are usually right" a checkable statement instead of an impression.

## Claims by type

| type | count | falsifiable |
|---|---|---|
| `inference` | 10 | no |
| `implementation-detail` | 5 | yes |
| `platform-behaviour` | 4 | yes |
| `recommendation` | 4 | no |
| `observation` | 3 | no |
| `opinion` | 2 | no |
| `best-practice` | 2 | no |

## Every claim

| draft | id | claim | type | evidence | conf |
|---|---|---|---|---|---|
| `d_eef1e76628fc_m` | `c1` | If the user did not set up the website, then someone else—a freelancer, agency, or friend—set it up. | inference | reasoned-inference | high |
| `d_eef1e76628fc_m` | `c2` | If someone else set up the site, the hosting account is probably registered under their name rather than the user's name. | inference | operator-experience | medium |
| `d_eef1e76628fc_m` | `c3` | An account registered under someone else's name is a fundamentally different situation from an attacker gaining unauthorized access to the user's own account. | observation | reasoned-inference | high |
| `d_eef1e76628fc_m` | `c4` | A WordPress 'I don't have any websites' message indicates the user is logged into a WordPress account not linked to the particular site they are checking. | platform-behaviour | operator-experience | medium |
| `d_eef1e76628fc_m` | `c5` | A 'I don't have any websites' message in WordPress is not proof that the site has been deleted or removed. | inference | reasoned-inference | high |
| `d_eef1e76628fc_m` | `c6` | The 'I don't have any websites' message is consistent with the scenario where the site is associated with someone else's account. | inference | reasoned-inference | high |
| `d_eef1e76628fc_m` | `c7` | ionos support can provide the name of the account holder on file, the account creation date, and records of login and password-reset activity. | observation | widely-accepted-practice | high |
| `d_eef1e76628fc_m` | `c8` | Information from ionos support about account holder identity, creation date, and login activity will indicate whether the situation is a legitimate account registered by someone else or an actual unauthorized compromise. | inference | operator-experience | medium |
| `d_fee0044a496c_m` | `c1` | Some WordPress plugins, exemplified by WebP Express, keep original image files in place and serve converted webp versions conditionally at request time | implementation-detail | operator-experience | high |
| `d_fee0044a496c_m` | `c10` | Conditional serving is simpler than file replacement | opinion | reasoned-inference | medium |
| `d_fee0044a496c_m` | `c11` | Conditional serving carries lower risk than file replacement | opinion | reasoned-inference | medium |
| `d_fee0044a496c_m` | `c12` | Conditional serving should be chosen if the priority is faster page loads and original files do not need to be deleted | recommendation | reasoned-inference | high |
| `d_fee0044a496c_m` | `c13` | When choosing a plugin that replaces files, its documentation should be checked for bulk convert-and-replace functionality | recommendation | operator-experience | high |
| `d_fee0044a496c_m` | `c14` | Bulk conversion features should be verified to work on existing media files, not only on newly uploaded media | recommendation | operator-experience | high |
| `d_fee0044a496c_m` | `c15` | Several free-tier plugins mentioned in this thread only process newly uploaded images, not existing media | observation | community-knowledge | medium |
| `d_fee0044a496c_m` | `c2` | Conditional webp serving uses rewrite rules or PHP fallback mechanisms to determine which format to serve | implementation-detail | reasoned-inference | medium |
| `d_fee0044a496c_m` | `c3` | Conditional webp serving makes format decisions based on the visitor's browser support | platform-behaviour | widely-accepted-practice | high |
| `d_fee0044a496c_m` | `c4` | When conditional serving is used, the WordPress media library continues to display the original image files | implementation-detail | reasoned-inference | high |
| `d_fee0044a496c_m` | `c5` | Conditional serving does not delete or replace source image files | implementation-detail | reasoned-inference | high |
| `d_fee0044a496c_m` | `c6` | Some WordPress plugins actually regenerate and replace the original image files with webp versions | implementation-detail | community-knowledge | high |
| `d_fee0044a496c_m` | `c7` | File replacement is required if downstream applications or services read files directly from the uploads folder | inference | reasoned-inference | high |
| `d_fee0044a496c_m` | `c8` | File replacement is required if the goal is to eventually delete the original JPEG/PNG source files | inference | reasoned-inference | high |
| `d_fee0044a496c_m` | `c9` | WebP and other modern image formats provide faster page load times | platform-behaviour | widely-accepted-practice | high |
| `d_e3f85c727608_m` | `c1` | LiteSpeed includes an X-LiteSpeed-Cache response header on each request indicating whether the response is a cache hit or miss | platform-behaviour | primary-documentation | high |
| `d_e3f85c727608_m` | `c2` | Cache hit/miss data can be extracted from server access logs via X-LiteSpeed-Cache header values | inference | reasoned-inference | high |
| `d_e3f85c727608_m` | `c3` | Comparing cache miss rates before and after enabling a preloader is a valid method to measure whether the preloader improves performance | best-practice | reasoned-inference | high |
| `d_e3f85c727608_m` | `c4` | Long-tail pages warrant particular attention when measuring a cache preloader's effectiveness | recommendation | reasoned-inference | medium |
| `d_e3f85c727608_m` | `c5` | Subjective statements like 'the site feels faster' or 'seems to work well' are insufficient to validate that a software feature works | best-practice | widely-accepted-practice | high |
| `d_e3f85c727608_m` | `c6` | Subjective evidence cannot be reliably evaluated or reproduced by others | inference | reasoned-inference | high |
| `d_e3f85c727608_m` | `c7` | Repository reviewers expect quantitative cache performance data from a preloader plugin before accepting it for merge | inference | community-knowledge | medium |
