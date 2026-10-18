"""
ClickPulse Sync Service: Cloudflare D1 Batch Extractor
"""

from typing import Any, Dict, List, Optional
import httpx


class D1Extractor:
    def __init__(self, account_id: str, database_id: str, api_token: str):
        self.account_id = account_id
        self.database_id = database_id
        self.api_token = api_token
        self.base_url = (
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
        )
        self.headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }

    def fetch_pending_events(self, limit: int = 5000) -> List[Dict[str, Any]]:
        """Fetches pending events from the D1 buffer table."""
        sql = (
            "SELECT id, created_at, site_id, event_type, visitor_id, session_id, "
            "path, referrer, utm_source, utm_medium, utm_campaign, "
            "utm_term, utm_content, "
            "country, device_type, browser, event_data "
            f"FROM clickpulse_buffer ORDER BY id ASC LIMIT {limit};"
        )
        with httpx.Client(timeout=25.0) as client:
            resp = client.post(self.base_url, headers=self.headers, json={"sql": sql})
            resp.raise_for_status()
            data = resp.json()
            if not data.get("success"):
                raise RuntimeError(f"D1 API error: {data.get('errors')}")
            results = data.get("result", [{}])[0].get("results", [])
            return results

    def delete_processed_events(self, max_id: int) -> int:
        """Deletes processed events from D1 up to max_id."""
        sql = f"DELETE FROM clickpulse_buffer WHERE id <= {max_id};"
        with httpx.Client(timeout=25.0) as client:
            resp = client.post(self.base_url, headers=self.headers, json={"sql": sql})
            resp.raise_for_status()
            data = resp.json()
            if not data.get("success"):
                raise RuntimeError(f"D1 delete error: {data.get('errors')}")
            meta = data.get("result", [{}])[0].get("meta", {})
            return meta.get("changes", 0)
