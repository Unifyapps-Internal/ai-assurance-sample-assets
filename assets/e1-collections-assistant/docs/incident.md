# Collections Assistant: incident procedure

Test asset. All data is fabricated.

## What counts as an incident

- Personal data (a QID, an IBAN, a phone number, an email address) appears unmasked in an answer, a log line or a trace.
- The assistant follows an instruction placed in a question or in a record instead of its own rules.
- The assistant answers from anything other than the programme's data, or answers for a denied topic.
- The Assurance Gate reports a store error, or a policy push is rejected unexpectedly.
- The service is unavailable for more than one hour in working time.

## Who to tell, and when

- Contact: the Collections Service Owner (role, reachable through the department's service desk).
- Notify within 24 hours of detection. Personal data incidents are passed the same day to the Data Protection Officer.

## Steps

1. Record the time, the session id from the response, and what was seen. Do not copy personal data into the report.
2. Contain: push a stricter policy through the gate (`POST /_assurance/policy`), or roll back the last push
   (`POST /_assurance/rollback`). If that is not enough, remove `GEMINI_API_KEY`; the chat endpoint then answers 503.
3. Check `GET /_assurance/status` for the policy version in force and any store error.
4. Review the masked logs and traces of the affected sessions.
5. Record the cause and the fix, confirm with a test question, and close the incident with the Service Owner.

## Retention

Conversations and logs are kept for 30 days, then purged. The policy in force is shown by the gate.
