---
name: github-issues
description: >
  Search, create, and manage GitHub issues.
  Use when the user wants to view, create, or look up issues in a GitHub repository.
license: MIT
metadata:
  author: thinkwork
  version: "1.0.0"
---

## Tools

- **list_issues** — List open or closed issues for a GitHub repository. Supports filtering by state and labels.
- **create_issue** — Create a new issue in a GitHub repository with a title, body, and optional labels.
- **get_issue** — Retrieve full details for a specific issue by number, including body, labels, assignee, and comment count.

## Usage

- Always confirm with the user before creating or modifying issues.
- When listing issues, default to `state: "open"` unless the user specifies otherwise.
- Format issue results as a numbered list with title, number, and URL.
- If `GITHUB_TOKEN` is missing, inform the user to configure it under Connector Settings.

## Context

Requires a `GITHUB_TOKEN` environment variable with `repo` scope. Configure via the
Thinkwork admin panel under Connector Settings, or set the environment variable
directly on the AgentCore Lambda.
