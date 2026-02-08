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

        target_model_1 = "Nano Banana (Gemini 2.5 Image)"
        target_value_1 = "gemini-2.5-flash-image"

        target_model_2 = "Nano Banana Pro (Gemini 3 Pro Image)"
        target_value_2 = "gemini-3-pro-image-preview"

        if target_model_1 in options_text and target_value_1 in options_values:
            print(f"Verified: {target_model_1} ({target_value_1}) is present")
        else:
            print(f"FAILED: {target_model_1} or {target_value_1} is missing")

        if target_model_2 in options_text and target_value_2 in options_values:
            print(f"Verified: {target_model_2} ({target_value_2}) is present")
        else:
            print(f"FAILED: {target_model_2} or {target_value_2} is missing")

        # Take a screenshot of the header area where the select is
        header = page.locator("header")
        header.screenshot(path="verification_3/header_models_image.png")

        browser.close()

if __name__ == "__main__":
    run()
