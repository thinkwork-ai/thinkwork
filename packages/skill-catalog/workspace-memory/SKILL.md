---
name: workspace-memory
description: >
  Read, write, and list workspace memory files (S3-backed).
  Use when the agent needs to remember information between conversations.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
---

# Workspace Memory

## Tools

- **workspace_memory_write** — Write a note to memory. Path must start with `memory/`.
- **workspace_memory_read** — Read a file from memory. Path must start with `memory/`.
- **workspace_memory_list** — List all files in the memory folder.

## Usage

- All paths must start with `memory/` (e.g., `memory/lessons.md`, `memory/contacts.md`).
- Content is stored as markdown in S3 under the agent's workspace prefix.
- Memory persists across conversations for the same agent.
- Use descriptive file names to organize notes by topic.
