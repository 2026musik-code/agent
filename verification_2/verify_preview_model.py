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

        # Check text content of options
        options_text = select.locator("option").all_text_contents()
        print("Found options text:", options_text)

        # Check values
        options_values = select.evaluate("el => Array.from(el.options).map(o => o.value)")
        print("Found options values:", options_values)

        target_model = "Gemini 3.0 Flash (Preview)"
        target_value = "gemini-3-flash-preview"

        if target_model in options_text and target_value in options_values:
            print(f"Verified: {target_model} ({target_value}) is present")
        else:
            print(f"FAILED: {target_model} or {target_value} is missing")

        # Take a screenshot of the header area where the select is
        header = page.locator("header")
        header.screenshot(path="verification_2/header_models_preview.png")

        browser.close()

if __name__ == "__main__":
    run()
