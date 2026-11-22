# Statement Reconciliation: incident procedure

Test asset. All data is fabricated.

## What counts as an incident

- An IBAN or any other personal data appears unmasked in a log line.
- A run matches a statement line to the wrong repayment, or accepts a row with a code outside the reference lists.
- Runs or logs older than the retention period (30 days) are still returned.
- The daily run does not happen, or the service is unavailable for more than one hour in working time.

## Who to tell, and when

- Contact: the Finance Operations Service Owner (role, reachable through the department's service desk).
- Notify within 24 hours of detection. Personal data incidents are passed the same day to the Data Protection Officer.

## Steps

1. Record the time, the run id and what was seen. Do not copy personal data into the report.
2. Contain: disable the schedule in the hosting project until the cause is known.
3. Review the run (`GET /api/runs/:id`) and its masked logs (`GET /api/logs?runId=`).
4. Record the cause and the fix, confirm with a manual run, and close the incident with the Service Owner.
