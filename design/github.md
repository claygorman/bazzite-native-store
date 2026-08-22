repo: claygorman/bazzite-native-store
branch: main
path: (whole repo — docs only, no app code yet)

## Last sync

date: 2026-08-21T01:22:00Z

### Updated in this project
- Pruned the design file to the current direction only: an immersive, controller-first home and a three-screen details page. Earlier exploration turns were deleted.
- Home screen is live: dpad/arrows move tile to tile, LB/RB jump shelf to shelf, LT/RT page across a shelf; a readout shows position, last input and pad connection.
- Details page now covers reviews with the store's filter set, demo and playtest, DLC and bundles, achievements and curators.
- Purchase never happens in-app — every CTA reads "Open in Steam", matching the repo's hard rule.

## Screen map

| Project screen | Repo source |
|---|---|
| 5a live immersive home (dpad + LB/RB + LT/RT, ambient art wash) | README.md §5 milestone; CLAUDE.md input notes (gilrs, dpad repeat feel) |
| 5b search + on-screen keyboard | private/STEAM-ENDPOINTS.md (SearchApps; search/results caveats) |
| 6a details — trailer, facts, ProtonDB/Deck badges, editions, announcements | private/STEAM-ENDPOINTS.md (appdetails); private/VIDEO-TRAILERS.md |
| 6b details — About, system requirements, ProtonDB verdict, More Like This | private/STEAM-ENDPOINTS.md (appdetails) |
| 6c details — reviews + filters, demo/playtest, DLC, achievements, curators | private/STEAM-ENDPOINTS.md (appreviews, apphoverpublic) |
| Trailer muted on tile focus; X to unmute only on the details page | private/VIDEO-TRAILERS.md (two-tier: microtrailer.webm vs libmpv) |
| "Open in Steam" CTAs in place of cart/checkout | README.md §3; CLAUDE.md hard rules |

## Open gaps vs the brief

- Frames are authored at 1920×1080; the target box is 4K at couch distance. Type scales 2× cleanly but should be judged on the TV.
- Deck compatibility status shown on the details page has no verified endpoint yet (it is in the STEAM-ENDPOINTS queue). ProtonDB tier is used as the primary compatibility signal instead.
- Wishlist affordances are shown but are not reachable anonymously (README §3) — either drop them or source from local Steam client data.
- Not yet designed: franchise/publisher collection strip, awards, related news, loading/offline/endpoint-failure states.
