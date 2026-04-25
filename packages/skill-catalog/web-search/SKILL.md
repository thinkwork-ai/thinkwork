---
name: web-search
display_name: Web Search
description: >
  Search the web, read pages, and research companies via Exa API.
  Use when the user needs current information, wants to look something up, or asks about a company.
license: Proprietary
metadata:
  author: thinkwork
  version: "1.0.0"
category: research
version: "1.2.0"
author: thinkwork
icon: search
tags: [search, web, research, exa, serpapi]
execution: script
is_default: false
scripts:
  - name: web_search
    path: scripts/search.py
    description: "Search the web for current information"
  - name: web_read
    path: scripts/search.py
    description: "Read the full text content of web pages"
  - name: company_research
    path: scripts/search.py
    description: "Research a company — profile, news, people, databases"
triggers:
  - "search the web"
  - "look up"
  - "research"
  - "find information"
  - "what is"
requires_env:
  - WEB_SEARCH_PROVIDER
  - EXA_API_KEY
  - SERPAPI_KEY
---

## Tools

- **web_search** — Search the web for a query. Returns titles, URLs, and snippets.
- **web_read** — Read and extract content from a specific URL.
- **company_research** — Research a company by name or domain. Returns structured company info.

## Usage

- For general queries, use `web_search` with a clear, specific query.
- If the user provides a URL, use `web_read` to extract its content.
- For company-specific research, prefer `company_research` over generic search.
- Always cite sources with URLs when presenting search results.
