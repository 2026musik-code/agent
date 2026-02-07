
import os
from playwright.sync_api import sync_playwright

def verify_styling():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the local HTML file
        file_path = os.path.abspath("src/template.html")
        page.goto(f"file://{file_path}")

        # Wait for the initial message to appear
        page.wait_for_selector(".ai-message")

        # Check computed style of the message text
        # The .ai-message itself has the color property
        color = page.eval_on_selector(".ai-message", "el => getComputedStyle(el).color")
        print(f"Computed color: {color}")

        # rgb(212, 175, 55) is #d4af37
        if color == "rgb(212, 175, 55)":
            print("SUCCESS: Text color is Gold.")
        else:
            print(f"FAILURE: Text color is {color}, expected rgb(212, 175, 55).")

        # Check alignment
        align = page.eval_on_selector(".ai-message", "el => getComputedStyle(el).textAlign")
        print(f"Computed text-align: {align}")

        if align == "left":
             print("SUCCESS: Text align is left.")
        else:
             print(f"FAILURE: Text align is {align}, expected left.")

        # Check for Nano Banana option
        options = page.eval_on_selector_all("#model-select option", "options => options.map(o => o.value)")
        if "nano-banana" in options:
            print("SUCCESS: Nano Banana option found.")
        else:
            print("FAILURE: Nano Banana option missing.")

        # Take screenshot
        page.screenshot(path="verification/gold_styling.png")
        browser.close()

if __name__ == "__main__":
    verify_styling()
