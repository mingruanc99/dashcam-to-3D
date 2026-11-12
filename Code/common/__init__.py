import sys

# Windows: khi stdout bị pipe/redirect, Python dùng cp1252 -> in tiếng Việt bị UnicodeEncodeError (BUG_LOG B15).
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure") and (_s.encoding or "").lower() not in ("utf-8", "utf8"):
        _s.reconfigure(encoding="utf-8", errors="replace")
