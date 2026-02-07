import html from './template.html';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve the frontend
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Proxy the API request
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const { prompt, model } = await request.json();

        if (!prompt) {
             return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Determine target URL based on model selection
        // Default to copilot-think if not specified or unknown
        // Currently, only copilot-think is verified working reliably.
        // We will map all selections to it for stability, but log the intent.

        let apiPath = 'copilot-think';

        // Future proofing: If other endpoints become available, map them here.
        if (model === 'gpt-4o') {
            // apiPath = 'gpt-4o'; // Uncomment if confirmed working
            console.log("User requested GPT-4o, falling back to copilot-think for stability");
        } else if (model === 'deepseek-r1') {
            // apiPath = 'deepseek-r1'; // Uncomment if confirmed working
            console.log("User requested DeepSeek R1, falling back to copilot-think for stability");
        }

        const targetUrl = new URL(`https://magma-api.biz.id/ai/${apiPath}`);
        targetUrl.searchParams.set('prompt', prompt);

        // Fetch from the external API
        const apiResponse = await fetch(targetUrl.toString(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Agent007/1.0; +https://example.com)'
          }
        });

        if (!apiResponse.ok) {
            throw new Error(`API responded with status ${apiResponse.status}`);
        }

        const data = await apiResponse.json();

        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Worker Error:', err);
        return new Response(JSON.stringify({
            status: false,
            result: { response: 'System Malfunction. Unable to contact HQ.' },
            error: err.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
