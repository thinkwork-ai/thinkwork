"""Web search via Exa API — replaces the web-search MCP server."""

import json
import os
import urllib.request
import urllib.error

EXA_BASE = "https://api.exa.ai"


def _exa_request(path: str, body: dict) -> dict:
    """Make authenticated request to Exa API."""
    api_key = os.environ.get("EXA_API_KEY", "")
    if not api_key:
        raise RuntimeError("EXA_API_KEY not set — web search unavailable")
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{EXA_BASE}{path}",
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "User-Agent": "Thinkwork/1.0",
        },
    )
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read())


def web_search(
    query: str,
    num_results: int = 5,
    category: str = "",
    start_published_date: str = "",
    include_domains: list[str] | None = None,
    exclude_domains: list[str] | None = None,
) -> str:
    """Search the web for current information with highlights from matching pages.

    Args:
        query: The search query.
        num_results: Number of results (1-10, default 5).
        category: Optional filter — company, research_paper, news, github, tweet.
        start_published_date: Filter results after this date (ISO 8601).
        include_domains: Only include results from these domains.
        exclude_domains: Exclude results from these domains.

    Returns:
        JSON array of search results with title, url, highlights, and score.
    """
    body: dict = {
        "query": query,
        "type": "auto",
        "numResults": max(1, min(num_results, 10)),
        "contents": {"highlights": {"maxCharacters": 4000}},
    }
    if category:
        body["category"] = category
    if start_published_date:
        body["startPublishedDate"] = start_published_date
    if include_domains:
        body["includeDomains"] = include_domains
    if exclude_domains:
        body["excludeDomains"] = exclude_domains

    data = _exa_request("/search", body)
    results = [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "published_date": r.get("publishedDate", ""),
            "highlights": r.get("highlights", []),
            "score": r.get("score", 0),
        }
        for r in data.get("results", [])
    ]
    return json.dumps(results, indent=2)


def web_read(urls: list[str]) -> str:
    """Read the full text content of one or more web pages.

    Args:
        urls: List of URLs to read (max 5).

    Returns:
        JSON array of page contents with title, url, and text.
    """
    if len(urls) > 5:
        urls = urls[:5]

    data = _exa_request("/contents", {
        "urls": urls,
        "text": {"maxCharacters": 10000},
    })
    results = [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "text": r.get("text", ""),
            "published_date": r.get("publishedDate", ""),
        }
        for r in data.get("results", [])
    ]
    return json.dumps(results, indent=2)


def company_research(company: str) -> str:
    """Research a company by name or URL. Returns profile, news, people, and database links.

    Args:
        company: Company name or website URL (e.g., "Stripe" or "stripe.com").

    Returns:
        JSON object with profile, news, people, and databases sections.
    """
    import concurrent.futures

    searches = {
        "profile": {"query": company, "type": "auto", "category": "company", "numResults": 3,
                     "contents": {"highlights": {"maxCharacters": 2000}}},
        "news": {"query": f"{company} latest news", "type": "auto", "category": "news", "numResults": 5,
                 "contents": {"highlights": {"maxCharacters": 2000}}},
        "people": {"query": f"{company} founders executives leadership", "type": "auto", "numResults": 5,
                   "contents": {"highlights": {"maxCharacters": 2000}}},
        "databases": {"query": company, "type": "auto", "numResults": 5,
                      "includeDomains": ["crunchbase.com", "pitchbook.com", "linkedin.com"],
                      "contents": {"highlights": {"maxCharacters": 2000}}},
    }

    def _search(key_body):
        key, body = key_body
        try:
            data = _exa_request("/search", body)
            return key, [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "published_date": r.get("publishedDate", ""),
                    "highlights": r.get("highlights", []),
                    "score": r.get("score", 0),
                }
                for r in data.get("results", [])
            ]
        except Exception as e:
            return key, [{"error": str(e)}]

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = dict(pool.map(_search, searches.items()))

    results["company"] = company
    return json.dumps(results, indent=2)
