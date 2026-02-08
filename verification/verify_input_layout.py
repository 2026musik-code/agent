import time
import json
import os
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    # Simulate mobile device
    context = browser.new_context(
        viewport={'width': 375, 'height': 667},
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
    )
    page = context.new_page()

    # Mock API routes
    page.route("**/api/public-chat/messages", lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps([])))
    page.route("**/api/public-chat/users", lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps([])))
    page.route("**/api/public-chat/heartbeat", lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({"success": True})))
    page.route("**/api/history**", lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps([])))

    # Catch errors
    page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
    page.on("pageerror", lambda err: print(f"Browser Error: {err}"))

    # Navigate to server
    page.goto("http://localhost:8081/template.html")

    # Interaction Steps
    print("Page loaded.")

    # 1. Open Sidebar
    page.click("#menu-btn")
    time.sleep(0.5)

    # 2. Click Public Chat
    page.click(".public-chat-btn")
    time.sleep(0.5)

    # 3. Enter Nickname
    page.fill("#chat-nickname", "TestUser")
    page.click("text=Join Room")
    time.sleep(1) # Wait for mock fetch and render

    # 4. Find input area
    input_area = page.locator(".chat-room-input")
    input_area.screenshot(path="verification/chat_input_mobile.png")
    print("Screenshot taken: verification/chat_input_mobile.png")

    # Also verify bounding boxes
    text_input = page.locator("#room-input")
    send_btn = page.locator("#room-send-btn")

    bbox_input = text_input.bounding_box()
    bbox_send = send_btn.bounding_box()

    print(f"Input BBox: {bbox_input}")
    print(f"Send BBox: {bbox_send}")

    browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
