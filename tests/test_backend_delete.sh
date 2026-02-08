#!/bin/bash
# Start the worker in the background
# We use a specific port to avoid conflicts
PORT=8788
npx wrangler dev --port $PORT --remote > wrangler.log 2>&1 &
WRANGLER_PID=$!

echo "Starting Wrangler (PID: $WRANGLER_PID)..."
# Wait for it to be ready
sleep 15

# Variables
API_URL="http://localhost:$PORT/api/public-chat/messages"
USERNAME="TestBot"
TEXT="This is a test message to be deleted."

# 1. Post a message
echo "1. Posting message..."
RESPONSE=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"$USERNAME\", \"text\": \"$TEXT\"}")

echo "Response: $RESPONSE"

# Extract ID (simple grep/sed, assuming JSON structure)
MSG_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$MSG_ID" ]; then
  echo "Failed to get Message ID"
  kill $WRANGLER_PID
  exit 1
fi

echo "Message ID: $MSG_ID"

# 2. Verify it exists
echo "2. Verifying message exists..."
LIST_RESPONSE=$(curl -s "$API_URL")
if [[ "$LIST_RESPONSE" == *"$MSG_ID"* ]]; then
  echo "Message found in list."
else
  echo "Message NOT found in list."
  kill $WRANGLER_PID
  exit 1
fi

# 3. Delete the message
echo "3. Deleting message..."
DELETE_RESPONSE=$(curl -s -X DELETE "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$MSG_ID\", \"username\": \"$USERNAME\"}")

echo "Delete Response: $DELETE_RESPONSE"

# 4. Verify it is gone
echo "4. Verifying message is gone..."
LIST_RESPONSE_AGAIN=$(curl -s "$API_URL")
if [[ "$LIST_RESPONSE_AGAIN" == *"$MSG_ID"* ]]; then
  echo "Message STILL found in list (Delete Failed)."
  kill $WRANGLER_PID
  exit 1
else
  echo "Message successfully deleted."
fi

# Cleanup
kill $WRANGLER_PID
exit 0
