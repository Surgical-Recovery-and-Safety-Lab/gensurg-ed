#!/usr/bin/env python3
"""
Set up Cloudflare Access to restrict GOG-NOTES to specific reviewer emails.

Creates an Access Application + email allowlist policy so only the listed
addresses can view the deployed Pages site (one-time email code, no password).

Usage
-----
  python3 scripts/setup_access.py \
    --account-id  YOUR_CLOUDFLARE_ACCOUNT_ID \
    --api-token   YOUR_API_TOKEN \
    --domain      gensurg-ed-XXXX.pages.dev \
    --emails      chris@example.com greg@example.com reviewer3@example.com

How to get your credentials
---------------------------
Account ID  : Cloudflare dashboard → right sidebar on any zone page, or
              Workers & Pages overview URL: dash.cloudflare.com/<ACCOUNT_ID>
API Token   : dash.cloudflare.com/profile/api-tokens → Create Token →
              Use template "Zero Trust Read/Write" (or create custom token with
              Access: Apps and Policies → Edit permission for your account)

Domain      : The .pages.dev URL shown after your first Pages deployment.
              e.g.  gensurg-ed-a1b2c3d4.pages.dev
              You can also use a custom domain if you've added one.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


API_BASE = "https://api.cloudflare.com/client/v4"


def cf(method: str, path: str, token: str, body: dict | None = None) -> dict:
    url = f"{API_BASE}/{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode()
        print(f"\nHTTP {exc.code} from Cloudflare API:")
        try:
            errors = json.loads(error_body).get("errors", [])
            for e in errors:
                print(f"  {e.get('code')}: {e.get('message')}")
        except Exception:
            print(f"  {error_body}")
        sys.exit(1)

    if not result.get("success"):
        for e in result.get("errors", []):
            print(f"  API error {e.get('code')}: {e.get('message')}")
        sys.exit(1)

    return result["result"]


def find_existing_app(account_id: str, token: str, domain: str) -> str | None:
    apps = cf("GET", f"accounts/{account_id}/access/apps", token)
    for app in apps:
        if app.get("domain") == domain:
            return app["id"]
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--account-id", required=True, help="Cloudflare account ID")
    parser.add_argument("--api-token", required=True, help="Cloudflare API token")
    parser.add_argument("--domain", required=True, help="Pages domain, e.g. gensurg-ed-abc123.pages.dev")
    parser.add_argument("--emails", nargs="+", required=True, metavar="EMAIL", help="Reviewer email addresses")
    parser.add_argument("--session-duration", default="24h", help="Login session length (default: 24h)")
    parser.add_argument("--update", action="store_true", help="Update an existing application instead of creating a new one")
    args = parser.parse_args()

    account_id = args.account_id
    token = args.api_token
    domain = args.domain.lstrip("https://").rstrip("/")

    # ── Application ──────────────────────────────────────────────────────────
    existing_id = find_existing_app(account_id, token, domain)

    if existing_id and not args.update:
        print(f"Access application already exists for {domain} (id: {existing_id})")
        print("Re-run with --update to overwrite its policy.")
        app_id = existing_id
    else:
        app_payload = {
            "name": "GOG-NOTES",
            "domain": domain,
            "type": "self_hosted",
            "session_duration": args.session_duration,
            "auto_redirect_to_identity": True,
            "http_only_cookie_attribute": True,
            "same_site_cookie_attribute": "lax",
        }
        if existing_id:
            app = cf("PUT", f"accounts/{account_id}/access/apps/{existing_id}", token, app_payload)
            print(f"Updated Access application: {app['id']}")
        else:
            app = cf("POST", f"accounts/{account_id}/access/apps", token, app_payload)
            print(f"Created Access application: {app['id']}")
        app_id = app["id"]

    # ── Policy ───────────────────────────────────────────────────────────────
    # Delete any existing policies so we start clean
    existing_policies = cf("GET", f"accounts/{account_id}/access/apps/{app_id}/policies", token)
    for p in existing_policies:
        cf("DELETE", f"accounts/{account_id}/access/apps/{app_id}/policies/{p['id']}", token)
        print(f"Removed old policy: {p['name']}")

    policy = cf(
        "POST",
        f"accounts/{account_id}/access/apps/{app_id}/policies",
        token,
        {
            "name": "Reviewer allowlist",
            "decision": "allow",
            "precedence": 1,
            "include": [{"email": {"email": email}} for email in args.emails],
            "require": [],
            "exclude": [],
        },
    )
    print(f"Created policy: {policy['id']}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n✓  Cloudflare Access is active on https://{domain}")
    print(f"   Session duration : {args.session_duration}")
    print(f"   Allowed reviewers:")
    for email in args.emails:
        print(f"     • {email}")
    print()
    print("   Reviewers visit the URL, enter their email, and receive a one-time code.")
    print("   Anyone else gets a Cloudflare Access block page.")
    print()
    print("To add or remove reviewers later, re-run this script with the full --emails list.")


if __name__ == "__main__":
    main()
