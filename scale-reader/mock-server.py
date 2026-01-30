#!/usr/bin/env python3
"""
Mock Scale Reader Server
Simulates the scale reader backend for testing without Node.js
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import time
import math
import os
from urllib.parse import urlparse, parse_qs

# Configuration
PORT = 3000
TARGET_WEIGHT = 5.0

# State
current_weight = 0.0
is_connected = True
start_time = time.time()

class ScaleHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        # API endpoint
        if parsed.path == '/api/weight':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            # Simulate weight cycling: 0 -> 5 -> 0 (15 second cycle)
            elapsed = time.time() - start_time
            cycle_position = (elapsed % 15) / 15  # 0 to 1

            if cycle_position < 0.6:
                # Filling phase (0-9 seconds)
                weight = (cycle_position / 0.6) * TARGET_WEIGHT
            else:
                # Emptying phase (9-15 seconds)
                weight = ((1 - cycle_position) / 0.4) * TARGET_WEIGHT

            # Add some realistic fluctuation
            weight += math.sin(elapsed * 2) * 0.05
            weight = max(0, round(weight, 2))

            percent = min(100, round((weight / TARGET_WEIGHT) * 100))

            response = {
                'weight': weight,
                'targetWeight': TARGET_WEIGHT,
                'percentComplete': percent,
                'isConnected': is_connected,
                'timestamp': time.time()
            }

            self.wfile.write(json.dumps(response).encode())
            return

        # Static files
        if parsed.path == '/' or parsed.path == '/index.html':
            self.path = '/public/index.html'
        elif parsed.path.startswith('/'):
            self.path = '/public' + parsed.path

        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        if self.path == '/api/weight':
            # Manual weight override for testing
            content_length = int(self.headers['Content-Length'])
            body = self.rfile.read(content_length)
            data = json.loads(body)

            global current_weight
            if 'weight' in data:
                current_weight = max(0, float(data['weight']))

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'weight': current_weight}).encode())
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        # Suppress most logs, only show API calls
        if '/api/' in args[0]:
            print(f"[{self.log_date_time_string()}] {args[0]}")

def run():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    print("\n" + "="*60)
    print("  Mock Scale Reader Server")
    print("="*60)
    print(f"\n  Server running at: http://localhost:{PORT}")
    print(f"  Open in browser:   http://localhost:{PORT}/\n")
    print("  Simulating weight cycling: 0 -> 5kg -> 0 (15 sec cycle)")
    print("  Press Ctrl+C to stop\n")
    print("="*60 + "\n")

    server = HTTPServer(('localhost', PORT), ScaleHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\n  Shutting down...\n")
        server.shutdown()

if __name__ == '__main__':
    run()
