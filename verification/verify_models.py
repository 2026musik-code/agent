from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the local HTML file
        file_path = os.path.abspath("src/template.html")
        page.goto(f"file://{file_path}")

        # Wait for the select element
        select = page.locator("#model-select")
        select.wait_for()

        # Click the select to show options (might not work well in headless screenshot, but we can inspect values)
        # Instead, let's get the text content of the select or its options

        options = select.locator("option").all_text_contents()
        print("Found options:", options)

        # Check if new models are present
        expected_models = [
            "Gemini 2.5 Flash",
            "Gemini 2.5 Pro",
            "Gemini 3.0 Flash",
            "Gemini 3.0 Pro"
        ]

        for model in expected_models:
            if model in options:
                print(f"Verified: {model} is present")
            else:
                print(f"FAILED: {model} is missing")

        # Take a screenshot of the header area where the select is
        header = page.locator("header")
        header.screenshot(path="verification/header_models.png")

        browser.close()

if __name__ == "__main__":
    run()
