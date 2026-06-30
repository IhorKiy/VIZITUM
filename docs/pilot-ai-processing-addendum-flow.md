# Pilot AI Processing Addendum Flow

This document defines the minimum release-blocking privacy flow for the Vizitum Team Pilot when a tenant uses voice notes, transcription or AI extraction.

## Purpose

The pilot can process:

- employee account data;
- customer contact data;
- commercial visit notes;
- temporary audio;
- temporary transcripts;
- AI-generated draft reports.

Before production pilot access, the company must confirm either a DPA or an AI processing addendum that covers this processing.

## Required Company Admin Step

During pilot onboarding, a Company Admin must confirm:

- they are authorized to accept pilot data-processing terms for the company;
- Vizitum may process temporary audio and transcript data only for transcription, extraction and support of the confirmed report workflow;
- raw audio, transcript and AI draft are temporary processing data;
- confirmed reports are the durable business record;
- temporary processing data may be deleted after confirmation or after the failed retry window;
- users must not record private conversations or unrelated sensitive data.

The confirmation record should store:

- `tenantId`;
- accepting `userId`;
- accepted document code and version;
- accepted timestamp;
- source IP or request metadata where legally appropriate;
- active language.

## Suggested Document Codes

- `pilot-dpa.v1`
- `ai-processing-addendum.v1`
- `voice-recording-notice.v1`

## Backend Implementation Expectation

The backend should eventually expose a tenant-scoped onboarding acceptance endpoint that:

1. requires an authenticated Company Admin;
2. records the accepted document code/version;
3. is auditable;
4. blocks pilot go-live until required acceptances exist;
5. never stores raw audio or transcript content in the acceptance record.

Until that endpoint exists, pilot launch must use a signed external agreement or manually recorded approval in the customer onboarding checklist.

## Field User Notice

Before first voice recording, the app must show a short in-app notice that says:

- voice notes may be transcribed and processed by AI;
- the user should record only visit-relevant business information;
- audio/transcript are temporary processing data;
- the confirmed report is reviewed by the user before becoming official.

The user should acknowledge the notice once per tenant/device session or account, depending on frontend implementation.

## Release Gate

Production pilot cannot start unless:

- company-level DPA or AI processing addendum is accepted;
- first-recording in-app notice is implemented;
- retention behavior matches the LLD;
- support can identify the accepted document version for each pilot tenant.
