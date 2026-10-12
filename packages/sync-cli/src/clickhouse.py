"""
ClickPulse Sync Service: ClickHouse Ingester & Quarantine Handler
"""

import json
from typing import Any, Dict, List, Tuple
import httpx


class ClickHouseIngester:
    def __init__(
        self,
        host: str = "localhost",
        port: int = 8123,
        database: str = "clickpulse",
        user: str = "default",
        password: str = "",
    ):
        self.url = f"http://{host}:{port}/"
        self.database = database
        self.auth = (user, password) if password else None

    def insert_events(
        self, events: List[Dict[str, Any]]
    ) -> Tuple[int, int]:
        """
        Inserts valid events into analytics_events.
        Directs malformed rows into events_rejected (quarantine).
        Returns (valid_count, rejected_count).
        """
        valid_rows: List[Dict[str, Any]] = []
        rejected_rows: List[Dict[str, Any]] = []

        for e in events:
            # Basic integrity validation
            if not e.get("site_id") or not e.get("event_type") or not e.get("visitor_id"):
                rejected_rows.append(
                    {
                        "rejected_at": e.get("created_at"),
                        "site_id": str(e.get("site_id") or "unknown"),
                        "raw_payload": json.dumps(e),
                        "rejection_reason": "missing_required_fields",
                        "source_ip_hash": str(e.get("visitor_id") or "0" * 64)[:64],
                    }
                )
                continue

            valid_rows.append(
                {
                    "created_at": e.get("created_at"),
                    "site_id": e.get("site_id"),
                    "event_type": e.get("event_type"),
                    "visitor_id": e.get("visitor_id"),
                    "session_id": e.get("session_id"),
                    "path": e.get("path") or "/",
                    "referrer": e.get("referrer") or "",
                    "utm_source": e.get("utm_source") or "",
                    "utm_medium": e.get("utm_medium") or "",
                    "utm_campaign": e.get("utm_campaign") or "",
                    "country": e.get("country") or "",
                    "device_type": e.get("device_type") or "desktop",
                    "browser": e.get("browser") or "other",
                    "event_data": e.get("event_data") or "{}",
                }
            )

        # Batch insert valid events
        if valid_rows:
            self._post_ndjson(f"{self.database}.analytics_events", valid_rows)

        # Batch insert rejected events to quarantine
        if rejected_rows:
            self._post_ndjson(f"{self.database}.events_rejected", rejected_rows)

        return len(valid_rows), len(rejected_rows)

    def _post_ndjson(self, table: str, rows: List[Dict[str, Any]]) -> None:
        ndjson_body = "\n".join(json.dumps(r) for r in rows)
        params = {"query": f"INSERT INTO {table} FORMAT JSONEachRow"}
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                self.url,
                params=params,
                content=ndjson_body.encode("utf-8"),
                auth=self.auth,
            )
            resp.raise_for_status()
