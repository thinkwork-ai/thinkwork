---
title: Spaces Thread Attachments Requirements
date: 2026-05-26
status: completed
completed_by: "PR #1740"
---

# Spaces Thread Attachments Requirements

## Problem

Users can attach a file in the Spaces thread composer, but after sending, the file is not visible in the thread transcript or the thread Info Panel. This makes the upload feel like it silently failed and prevents collaborators and agents from reliably finding files that belong to the thread.

Thread attachments should behave as durable thread resources: once a file is sent, every participant with access to the thread should be able to see and download it, and future agent turns should be able to discover that the file exists.

## Key Decision

An uploaded file is a Thread resource, not only a message decoration.

Sending a message with an attachment should:

- Upload and finalize the file as a thread attachment.
- Associate the attachment with the sent message so the transcript can show the file chip inline.
- Refresh the thread state so the Info Panel shows the attachment below Progress.
- Make the attachment available to future thread participants and agent turns.

## Actors

- User: uploads, views, and downloads files in a Space thread.
- Collaborator: views and downloads files uploaded by other users in the same thread.
- Agent: can reference uploaded thread files when responding to future user turns.

## Requirements

R1. Sending a message with attached files persists each successful upload as a durable thread attachment.

R2. A sent message that included attachments displays attachment chips in the transcript after the message is sent.

R3. Attachment chips in the transcript support downloading the file.

R4. The thread Info Panel shows an Attachments section below Progress after at least one attachment exists.

R5. The Info Panel does not show an empty Attachments section before any files exist.

R6. The Info Panel attachment list includes enough information for users to recognize the file, at minimum file name and a download affordance.

R7. After a successful send, the thread automatically refreshes so the newly uploaded file appears in both the transcript and Info Panel without a page reload.

R8. If all attachment uploads fail, the app does not silently send a text-only message. It should block the send and show a clear error.

R9. If some attachment uploads fail and at least one succeeds, the app may send the message with successful attachments, but it must clearly surface that some files were not uploaded.

R10. Attachments remain scoped to thread authorization. Users without access to the thread must not be able to download the files.

R11. Agent responses in Spaces threads should not ignore attachment-only or attachment-bearing user messages. If a user says something like "Here are the financials" with a file attached, the agent should have a turn opportunity that can use the file context.

R12. Future agent turns should be able to discover prior thread attachments, not only attachments on the latest message.

## Acceptance Examples

### Send A Spreadsheet

Given a user is viewing a Space thread
And the user attaches `Financial Sample.xlsx`
When the user sends the message "Here's the financials"
Then the sent message shows a `Financial Sample.xlsx` attachment chip
And the Info Panel shows an Attachments section below Progress
And the Attachments section includes `Financial Sample.xlsx`
And selecting the attachment downloads the file.

### Upload Failure

Given a user attaches `Accounts-Payable.xlsx`
And the upload/finalize step fails
When the user sends the message
Then the app shows an upload error
And the app does not make the message look like the file was accepted.

### Agent Access

Given a user sends "Here's the financials" with an attached spreadsheet
When the agent processes the next turn
Then the agent can see that the thread has a newly uploaded spreadsheet
And the agent can use the file when forming its response, subject to existing file access and parsing capabilities.

## Existing Substrate

The codebase already has attachment primitives that should be used rather than introducing a separate storage model:

- `packages/api/src/handlers/thread-attachments-presign.ts`
- `packages/api/src/handlers/thread-attachments-finalize.ts`
- `packages/api/src/handlers/thread-attachment-download.ts`
- `packages/database-pg/src/schema/threads.ts`
- `packages/database-pg/graphql/types/threads.graphql`
- `apps/spaces/src/lib/upload-thread-attachments.ts`

## Scope Boundaries

In scope:

- Persisting and displaying thread attachments in Spaces.
- Showing attachment chips on sent messages.
- Showing an Info Panel attachment list below Progress when files exist.
- Downloading attachments from the transcript and Info Panel.
- Clear user feedback for failed uploads.
- Ensuring attachment-bearing user turns are available to the agent.

Out of scope for this requirements pass:

- Versioning files.
- Editing or deleting uploaded attachments.
- Foldering or tagging attachments.
- Replacing the existing presign/finalize/download architecture.
- Building new document parsing capabilities beyond making uploaded files available to the agent path.

## Implementation Notes For Planning

- The current Spaces composer appears to upload files and send attachment metadata, but persisted attachments are not rendered back into user message bubbles.
- The current Info Panel attachment rendering should be positioned below Progress and shown only when at least one attachment exists.
- Upload errors should become user-visible, especially the all-failed case where the current experience can look like the file disappeared.
- Customer onboarding threads should avoid treating every ordinary user message as fully handled by the onboarding update parser when the message includes attachments or lacks an actionable onboarding update.

## Success Criteria

- A user can upload a file to a Spaces thread and immediately see it in the sent message and Info Panel.
- A second user opening the same thread can see and download the file.
- A user never loses confidence because an attachment silently disappears after send.
- Attachment-bearing messages can reach the agent path when appropriate.
