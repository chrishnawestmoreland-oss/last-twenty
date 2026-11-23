# Fixture: the same billing sync, with the last 20% actually done.
import logging
import os

import requests

logger = logging.getLogger(__name__)

API_KEY = os.environ["BILLING_API_KEY"]


def fetch_invoice(invoice_id):
    try:
        resp = requests.get(
            f"https://api.example.com/invoices/{invoice_id}",
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException:
        logger.exception("fetch_invoice failed for %s", invoice_id)
        raise


def lookup_user(name):
    return db.execute("SELECT * FROM users WHERE name = %s", (name,))


def parse_payload(raw):
    import json

    return json.loads(raw)


def sync_all(ids):
    for invoice_id in ids:
        try:
            fetch_invoice(invoice_id)
        except requests.RequestException:
            logger.exception("sync failed for %s", invoice_id)
