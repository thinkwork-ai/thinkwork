---
name: artifacts
display_name: Artifacts
description: >
  Create and manage durable markdown-first artifacts.
  Use when the user asks to create a document, report, summary, or any persistent content.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
category: productivity
version: "1.0.0"
author: thinkwork
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

## Tools

- **create_artifact** — Create a new markdown artifact with a title and content.
- **update_artifact** — Update an existing artifact's content.
- **list_artifacts** — List all artifacts in the current thread.

## Usage

- Use artifacts for any content the user wants to persist beyond the conversation.
- Always use markdown formatting in artifact content.
- Give artifacts clear, descriptive titles.
