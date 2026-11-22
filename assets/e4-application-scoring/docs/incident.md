# Application Scoring: incident procedure

Test asset. All data is fabricated.

## What counts as an incident

- A run fails, or finishes as `partial`, two days in a row.
- A score cannot be reproduced from its components.
- Applicant data reaches a place it should not.
- The service is unavailable for more than one hour in working time.

## Who to tell, and when

- Contact: the Credit Underwriting Service Owner (role, reachable through the department's service desk).
- Notify within 24 hours of detection. Personal data incidents are passed the same day to the Data Protection Officer.

## Steps

1. Record the time, the run id and what was seen. Do not copy personal data into the report.
2. Contain: remove the daily schedule from `vercel.json` or remove `GEMINI_API_KEY` (the rationale step is then skipped).
3. Read the run (`GET /api/runs/<runId>`) and its steps to find the failing step.
4. Record the cause and the fix, re-run the affected applications, and close the incident with the Service Owner.
