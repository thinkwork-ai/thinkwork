---
name: workspace-memory
display_name: Workspace Memory
description: >
  Read, write, and list workspace memory files (S3-backed).
  Use when the agent needs to remember information between conversations.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
category: productivity
version: "1.0.0"
author: thinkwork
icon: brain
tags: [memory, workspace, notes, persistence]
execution: script
is_default: true
scripts:
  - name: workspace_memory_write
    path: scripts/memory.py
    description: "Write a structured note to workspace memory"
  - name: workspace_memory_read
    path: scripts/memory.py
    description: "Read a file from workspace memory"
  - name: workspace_memory_list
    path: scripts/memory.py
    description: "List all files in workspace memory"
triggers:
  - "remember this"
  - "save to memory"
  - "what did I tell you"
  - "check my notes"
requires_env:
  - WORKSPACE_BUCKET
  - TENANT_ID
  - AGENT_ID
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
