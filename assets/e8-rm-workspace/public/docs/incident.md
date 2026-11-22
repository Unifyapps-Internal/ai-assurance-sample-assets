# Incident procedure: RM Workspace

Test asset. All data is fabricated.

1. Anyone who suspects a data, security or AI incident reports it at once to the SME Banking Duty Manager (the
   incident contact in `assurance.json`).
2. The duty manager records the time, what was seen and who is affected, and contains it: sign-ins are revoked by
   rotating `SESSION_SECRET`; the AI summary is switched off by removing `GEMINI_API_KEY`; a stricter gate policy
   is pushed, or the last one restored through `/_assurance/rollback`.
3. The Head of SME Relationship Management (owner) and the data steward are told within 4 hours.
4. The governance office is notified within 24 hours of detection, with the datasets and fields involved.
5. Logs are kept masked for 30 days and are reviewed for the period of the incident.
6. A written review with the cause and the change made closes the incident within 10 working days.
