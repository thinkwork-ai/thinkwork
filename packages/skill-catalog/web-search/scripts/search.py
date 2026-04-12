"""Web search skill — provider-agnostic entry points backed by Exa or SerpAPI.

Provider is selected via WEB_SEARCH_PROVIDER env var (default: "exa"). Each
provider class implements the same interface: search(), read(), research().
Adding a new provider = one new class + one line in _get_provider().
"""

import json
import os
import urllib.parse
import urllib.request


# ---------------------------------------------------------------------------
# Provider interface
# ---------------------------------------------------------------------------


class _Provider:
    name: str

    def search(self, query: str, num_results: int, **opts) -> list[dict]:
        raise NotImplementedError

    def read(self, urls: list[str]) -> list[dict]:
        raise NotImplementedError

    def research(self, company: str) -> dict:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Exa
# ---------------------------------------------------------------------------


class ExaProvider(_Provider):
    name = "exa"
    BASE = "https://api.exa.ai"

    def __init__(self) -> None:
        key = os.environ.get("EXA_API_KEY", "")
        if not key:
            raise RuntimeError("EXA_API_KEY not set — web search unavailable")
        self.key = key

    def _request(self, path: str, body: dict) -> dict:
        req = urllib.request.Request(
            f"{self.BASE}{path}",
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.key,
                "User-Agent": "Thinkwork/1.0",
            },
        )
        return json.loads(urllib.request.urlopen(req, timeout=15).read())

    def search(self, query: str, num_results: int, **opts) -> list[dict]:
        body: dict = {
            "query": query,
            "type": "auto",
            "numResults": num_results,
            "contents": {"highlights": {"maxCharacters": 4000}},
        }
        if opts.get("category"):
            body["category"] = opts["category"]
        if opts.get("start_published_date"):
            body["startPublishedDate"] = opts["start_published_date"]
        if opts.get("include_domains"):
            body["includeDomains"] = opts["include_domains"]
        if opts.get("exclude_domains"):
            body["excludeDomains"] = opts["exclude_domains"]
        data = self._request("/search", body)
        return [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "published_date": r.get("publishedDate", ""),
                "highlights": r.get("highlights", []),
                "score": r.get("score", 0),
            }
            for r in data.get("results", [])
        ]

    def read(self, urls: list[str]) -> list[dict]:
        data = self._request("/contents", {"urls": urls, "text": {"maxCharacters": 10000}})
        return [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "text": r.get("text", ""),
                "published_date": r.get("publishedDate", ""),
            }
            for r in data.get("results", [])
        ]

    def research(self, company: str) -> dict:
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

        def _one(item):
            key, body = item
            try:
                data = self._request("/search", body)
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
            results = dict(pool.map(_one, searches.items()))
        results["company"] = company
        return results


# ---------------------------------------------------------------------------
# SerpAPI
# ---------------------------------------------------------------------------


class SerpApiProvider(_Provider):
    name = "serpapi"
    BASE = "https://serpapi.com/search.json"

    def __init__(self) -> None:
        key = os.environ.get("SERPAPI_KEY", "")
        if not key:
            raise RuntimeError("SERPAPI_KEY not set — web search unavailable")
        self.key = key

    def _request(self, params: dict) -> dict:
        params = {**params, "api_key": self.key, "engine": params.get("engine", "google")}
        url = f"{self.BASE}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Thinkwork/1.0"})
        return json.loads(urllib.request.urlopen(req, timeout=15).read())

    def search(self, query: str, num_results: int, **opts) -> list[dict]:
        params = {"q": query, "num": num_results}
        if opts.get("start_published_date"):
            # SerpAPI uses tbs=cdr:1,cd_min:MM/DD/YYYY
            try:
                from datetime import datetime

                dt = datetime.fromisoformat(opts["start_published_date"])
                params["tbs"] = f"cdr:1,cd_min:{dt.strftime('%m/%d/%Y')}"
            except Exception:
                pass
        data = self._request(params)
        results = []
        for r in data.get("organic_results", [])[:num_results]:
            results.append(
                {
                    "title": r.get("title", ""),
                    "url": r.get("link", ""),
                    "published_date": r.get("date", ""),
                    "highlights": [r.get("snippet", "")] if r.get("snippet") else [],
                    "score": 0,
                }
            )
        return results

    def read(self, urls: list[str]) -> list[dict]:
        # SerpAPI has no page-reader endpoint; fall back to naive HTTP fetch.
        results = []
        for url in urls[:5]:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Thinkwork/1.0"})
                raw = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="ignore")
                results.append({"title": "", "url": url, "text": raw[:10000], "published_date": ""})
            except Exception as e:
                results.append({"title": "", "url": url, "text": "", "error": str(e)})
        return results

    def research(self, company: str) -> dict:
        out = {"company": company}
        out["profile"] = self.search(company, 3)
        out["news"] = self.search(f"{company} latest news", 5)
        out["people"] = self.search(f"{company} founders executives leadership", 5)
        return out


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


_PROVIDERS = {
    "exa": ExaProvider,
    "serpapi": SerpApiProvider,
}


def _get_provider() -> _Provider:
    slug = os.environ.get("WEB_SEARCH_PROVIDER", "exa").lower()
    cls = _PROVIDERS.get(slug)
    if not cls:
        raise RuntimeError(f"Unknown WEB_SEARCH_PROVIDER '{slug}' — expected one of {list(_PROVIDERS)}")
    return cls()


# ---------------------------------------------------------------------------
# Public tool functions (agent-facing contract unchanged)
# ---------------------------------------------------------------------------


def web_search(
    query: str,
    num_results: int = 5,
    category: str = "",
    start_published_date: str = "",
    include_domains: list[str] | None = None,
    exclude_domains: list[str] | None = None,
) -> str:
    """Search the web for current information.

    Args:
        query: The search query.
        num_results: Number of results (1-10, default 5).
        category: Optional filter — company, research_paper, news, github, tweet. (Exa only.)
        start_published_date: Filter results after this date (ISO 8601).
        include_domains: Only include results from these domains. (Exa only.)
        exclude_domains: Exclude results from these domains. (Exa only.)

    Returns:
        JSON array of search results with title, url, highlights, and score.
    """
    provider = _get_provider()
    results = provider.search(
        query,
        max(1, min(num_results, 10)),
        category=category,
        start_published_date=start_published_date,
        include_domains=include_domains,
        exclude_domains=exclude_domains,
    )
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
    return json.dumps(_get_provider().read(urls), indent=2)


def company_research(company: str) -> str:
    """Research a company by name or URL — profile, news, people, databases.

    Args:
        company: Company name or website URL (e.g., "Stripe" or "stripe.com").

    Returns:
        JSON object with sections keyed by search type.
    """
    return json.dumps(_get_provider().research(company), indent=2)
