# Sample data

All people, numbers and emails are fictional. Phone numbers use the 555-01xx range, which is
reserved for fiction and never connects to a real line. Emails use example.com/.net/.org.

| File | What it is |
|---|---|
| `leads.csv` | 15 outbound test leads. `consent` = yes/no. Upload it on the dashboard's Outbound page. |
| `do-not-call.csv` | 2 suppressed numbers (Hannah Kowalski and Liam O'Connor have consent but are on this list, so they must be skipped). Loaded by `npm run seed`, or uploaded on the Outbound page. |

Mock calendar slots are generated from each profile's opening hours for a rolling 7 days
(about 30% pre-booked, deterministic), so the demo week never goes stale.

Expected result of running the list with both files loaded (inside 8am-9pm business time):
4 skipped for no consent (Tom, Victor, Sofia, Noah), 2 skipped for do-not-call (Hannah, Liam),
9 ready to call. Chloe Dubois consents but has a commercial roof, so the agent should
qualify her as "not a fit" during the call.
