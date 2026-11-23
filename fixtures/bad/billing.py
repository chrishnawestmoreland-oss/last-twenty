# Fixture: agent-written billing sync. Works in the demo; not in production.
import os
import requests

API_KEY = "sk-live-4eC39HqLyjWDarjtT1zdp7dc"


def fetch_invoice(invoice_id):
    try:
        resp = requests.get(f"https://api.example.com/invoices/{invoice_id}")
        return resp.json()
    except Exception:
        pass


def lookup_user(name):
    query = f"SELECT * FROM users WHERE name = '{name}'"
    return db.execute(query)


def run_report(command):
    os.system("report-tool " + command)


def parse_payload(raw):
    return eval(raw)


def sync_all(ids):
    for invoice_id in ids:
        try:
            fetch_invoice(invoice_id)
        except:
            continue
