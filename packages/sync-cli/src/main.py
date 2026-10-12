"""
ClickPulse Sync Service CLI
Drains edge buffer from Cloudflare D1 into ClickHouse / SigNoz.
"""

import argparse
import os
import sys
import time
from d1 import D1Extractor
from clickhouse import ClickHouseIngester


def main():
    parser = argparse.ArgumentParser(description="ClickPulse ETL Sync Engine")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sync_parser = subparsers.add_parser("sync", help="Drain D1 buffer into ClickHouse")
    sync_parser.add_argument("--batch-size", type=int, default=5000, help="Batch size per run")
    sync_parser.add_argument("--dry-run", action="store_true", help="Do not delete processed rows from D1")

    args = parser.parse_args()

    # Environment variables
    cf_account_id = os.environ.get("CF_ACCOUNT_ID")
    cf_database_id = os.environ.get("CF_D1_DATABASE_ID")
    cf_api_token = os.environ.get("CF_API_TOKEN")

    ch_host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    ch_port = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
    ch_database = os.environ.get("CLICKHOUSE_DATABASE", "clickpulse")
    ch_user = os.environ.get("CLICKHOUSE_USER", "default")
    ch_password = os.environ.get("CLICKHOUSE_PASSWORD", "")

    if not (cf_account_id and cf_database_id and cf_api_token):
        print("Error: Missing Cloudflare credentials (CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN)", file=sys.stderr)
        sys.exit(1)

    extractor = D1Extractor(cf_account_id, cf_database_id, cf_api_token)
    ingester = ClickHouseIngester(ch_host, ch_port, ch_database, ch_user, ch_password)

    start_time = time.time()
    events = extractor.fetch_pending_events(limit=args.batch_size)

    if not events:
        print(f"[{time.strftime('%X')}] No pending events found in D1 buffer.")
        sys.exit(0)

    max_id = max(e["id"] for e in events)
    valid_count, rejected_count = ingester.insert_events(events)

    if not args.dry_run:
        deleted = extractor.delete_processed_events(max_id)
        print(
            f"[{time.strftime('%X')}] Synced {valid_count} events to ClickHouse "
            f"({rejected_count} quarantined). Purged {deleted} rows from D1 in {time.time() - start_time:.2f}s."
        )
    else:
        print(
            f"[{time.strftime('%X')}] [DRY RUN] Ingested {valid_count} events, {rejected_count} quarantined. "
            f"Skipped D1 deletion."
        )


if __name__ == "__main__":
    main()
