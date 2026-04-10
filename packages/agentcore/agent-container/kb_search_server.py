"""
Knowledge Base Search MCP Tool Server

Lightweight HTTP server that exposes a knowledge_base_search tool for the
agent container. Reads KB config from environment, calls Bedrock Retrieve API,
and returns formatted chunks with source citations.

Started by server.py when knowledge_bases are present in the payload.
"""
import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import boto3

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
KB_CONFIG_PATH = os.environ.get("KB_CONFIG_PATH", "/tmp/kb_config.json")
KB_SEARCH_PORT = int(os.environ.get("KB_SEARCH_PORT", "8181"))

_bedrock_client = None


def _get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None:
        _bedrock_client = boto3.client("bedrock-agent-runtime", region_name=AWS_REGION)
    return _bedrock_client


def _load_kb_config() -> list[dict]:
    """Load KB config from JSON file written by server.py."""
    try:
        with open(KB_CONFIG_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _search_kb(kb_id: str, query: str, max_results: int = 5, score_threshold: float = 0.0) -> list[dict]:
    """Call Bedrock Retrieve API for a single KB."""
    client = _get_bedrock_client()
    try:
        params = {
            "knowledgeBaseId": kb_id,
            "retrievalQuery": {"text": query},
            "retrievalConfiguration": {
                "vectorSearchConfiguration": {
                    "numberOfResults": max_results,
                },
            },
        }
        if score_threshold > 0:
            params["retrievalConfiguration"]["vectorSearchConfiguration"]["overrideSearchType"] = "HYBRID"

        resp = client.retrieve(**params)
        results = []
        for item in resp.get("retrievalResults", []):
            content = item.get("content", {}).get("text", "")
            score = item.get("score", 0)
            location = item.get("location", {})
            source = ""
            if location.get("type") == "S3":
                uri = location.get("s3Location", {}).get("uri", "")
                source = uri.split("/")[-1] if uri else ""

            if score_threshold > 0 and score < score_threshold:
                continue

            results.append({
                "content": content,
                "score": round(score, 4),
                "source": source,
            })
        return results
    except Exception as e:
        logger.error("Bedrock Retrieve failed for KB %s: %s", kb_id, e)
        return [{"content": f"Error retrieving from knowledge base: {e}", "score": 0, "source": ""}]


def handle_tool_call(tool_name: str, arguments: dict) -> dict:
    """Process a tool call and return the result."""
    if tool_name != "knowledge_base_search":
        return {"error": f"Unknown tool: {tool_name}"}

    query = arguments.get("query", "")
    kb_name = arguments.get("kb_name")
    max_results = arguments.get("max_results", 5)

    if not query:
        return {"error": "query is required"}

    kbs = _load_kb_config()
    if not kbs:
        return {"error": "No knowledge bases configured"}

    # Filter to specific KB if requested
    if kb_name:
        kbs = [kb for kb in kbs if kb.get("name", "").lower() == kb_name.lower()]
        if not kbs:
            available = ", ".join(kb.get("name", "") for kb in _load_kb_config())
            return {"error": f"Knowledge base '{kb_name}' not found. Available: {available}"}

    all_results = []
    for kb in kbs:
        kb_id = kb.get("awsKbId", "")
        if not kb_id:
            continue
        search_config = kb.get("searchConfig") or {}
        threshold = search_config.get("scoreThreshold", 0)
        per_kb_max = search_config.get("maxResults", max_results)
        results = _search_kb(kb_id, query, per_kb_max, threshold)
        for r in results:
            r["knowledgeBase"] = kb.get("name", kb_id)
        all_results.extend(results)

    # Sort by score descending, limit total
    all_results.sort(key=lambda x: x.get("score", 0), reverse=True)
    all_results = all_results[:max_results]

    if not all_results:
        return {"result": "No relevant results found in knowledge bases."}

    # Format for the agent
    formatted = []
    for i, r in enumerate(all_results, 1):
        source_info = f" (source: {r['source']})" if r.get("source") else ""
        kb_info = f" [KB: {r['knowledgeBase']}]" if len(kbs) > 1 else ""
        formatted.append(f"[{i}]{kb_info}{source_info}\n{r['content']}")

    return {"result": "\n\n---\n\n".join(formatted)}


class KbSearchHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.info(fmt, *args)

    def do_POST(self):
        if self.path == "/tool":
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                self._respond(400, {"error": "invalid json"})
                return

            tool_name = payload.get("name", "")
            arguments = payload.get("arguments", {})
            result = handle_tool_call(tool_name, arguments)
            self._respond(200, result)

        elif self.path == "/tools":
            # Return tool schema (MCP-compatible)
            kbs = _load_kb_config()
            kb_names = [kb.get("name", "") for kb in kbs if kb.get("name")]
            kb_desc = f" Available KBs: {', '.join(kb_names)}" if kb_names else ""

            tools = [{
                "name": "knowledge_base_search",
                "description": f"Search the agent's knowledge bases for relevant information.{kb_desc} Use this to find answers from uploaded documents, SOPs, policies, and other reference material.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query — describe what information you're looking for",
                        },
                        "kb_name": {
                            "type": "string",
                            "description": "Optional: search a specific knowledge base by name. If omitted, searches all assigned KBs.",
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of results to return (default: 5)",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            }]
            self._respond(200, {"tools": tools})
        else:
            self._respond(404, {"error": "not found"})

    def do_GET(self):
        if self.path == "/ping":
            self._respond(200, {"status": "ok"})
        else:
            self._respond(404, {"error": "not found"})

    def _respond(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    port = KB_SEARCH_PORT
    server = HTTPServer(("127.0.0.1", port), KbSearchHandler)
    logger.info("KB Search MCP server listening on port %d", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
