#!/usr/bin/env python3
import os, sys
from pathlib import Path

root = Path(__file__).parent.parent
os.chdir(root)
sys.argv = ["http.server", "8765"]
import http.server
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=8765)
