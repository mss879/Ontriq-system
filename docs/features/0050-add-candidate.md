# Add a candidate by hand

`0050_add_candidate.sql`

Staff with `candidates.manage` can add a person on the Candidates page, pick the client they are for, and start the case later. Super Admin, Admin, Operations Manager and Client Relations have that permission.

## How it works

- A person can be verified for several clients, so a client still belongs to a case. `candidates.added_for_client_id` only records who someone was added for, so their first case can start from it.
- The same NIC is the same person. Entering a NIC already on file opens that record and changes nothing, even if a different client was picked.
- Start a case on the candidate's page opens the case form with the person and client filled in. The case uses that same record.
- NIC is optional. Date of birth and gender come from the NIC when one is given, as they do on a case.
- A client that isn't active or a prospect takes no new candidates, the same rule as new cases.
- Clients never see this. The portal reads through its own functions, and none of them return the column.

## Not built

A candidate added by mistake can't be edited or removed until a case exists. Details can be corrected on the case page once one is opened.
