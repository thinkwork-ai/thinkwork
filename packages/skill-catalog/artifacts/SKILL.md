---
name: artifacts
display_name: Artifacts
description: Create and manage durable markdown-first artifacts. Use when the user asks to create a document, report, summary, or any persistent content.
license: Proprietary
category: productivity
icon: file-text
tags: [artifacts, documents, markdown, content]
execution: script
is_default: true
scripts:
  - name: create_artifact
    path: scripts/artifacts.py
    description: "Create a durable markdown artifact"
  - name: update_artifact
    path: scripts/artifacts.py
    description: "Update an existing artifact"
  - name: list_artifacts
    path: scripts/artifacts.py
    description: "List artifacts with optional filters"
triggers:
  - "create a document"
  - "write a report"
  - "create an artifact"
  - "save this as"
---

# Artifacts

To create a durable markdown artifact that persists beyond the current
conversation, follow these steps:

1. Confirm the user wants persistence — artifacts are saved, not chat-ephemeral
2. Author the content as markdown
3. Call `create_artifact` with a clear title and the markdown body
4. Return the artifact reference so the user can find it later
5. (Optional) Use `update_artifact` to revise; `list_artifacts` to browse

## When this fires

The user asks to create a document, report, summary, or any content
they want to find again later. Single-message answers stay in the
conversation; artifacts persist.

## Tools

- **create_artifact** — Create a new markdown artifact with a title and content.
- **update_artifact** — Update an existing artifact's content.
- **list_artifacts** — List artifacts in the current thread.

## Content Guidelines

- Use markdown formatting — headings, lists, code fences, tables — to give
  the artifact structure a reader can scan
- Give every artifact a clear, descriptive title
- Lead with the conclusion or the most important information
- Cite the data source when an artifact summarizes external content
