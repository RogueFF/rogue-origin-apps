#!/bin/bash
# Build an embedded version of the comms dashboard with data inlined
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
SITE="$DIR/site"

# Extract fresh data
node "$DIR/extract-comms.js"

# Build embedded HTML
DATA=$(cat "$SITE/comms-data.json")
{
  # Insert data script before </body>
  sed '/<\/body>/i <script>var EMBEDDED_DATA = __DATA_PLACEHOLDER__;</script>' "$SITE/comms-dashboard.html" | \
    python3 -c "
import sys
content = sys.stdin.read()
import json
with open('$SITE/comms-data.json') as f:
    data = f.read().strip()
print(content.replace('__DATA_PLACEHOLDER__', data))
"
} > "$SITE/comms-dashboard-embedded.html"

echo "Built: $SITE/comms-dashboard-embedded.html"
echo "Size: $(wc -c < "$SITE/comms-dashboard-embedded.html") bytes"
