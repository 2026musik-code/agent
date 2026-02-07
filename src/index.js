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
        const { prompt } = await request.json();

        if (!prompt) {
             return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Construct the target URL with query params
        // The user provided: https://magma-api.biz.id/ai/copilot-think?prompt=Halo
        const targetUrl = new URL('https://magma-api.biz.id/ai/copilot-think');
        targetUrl.searchParams.set('prompt', prompt);

        // Fetch from the external API
        // Note: fetch automatically follows redirects
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
