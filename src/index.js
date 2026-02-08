import html from './template.html';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- Serve Frontend ---
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // --- API: Chat Proxy ---
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      return handleChatProxy(request);
    }

    // --- API: History Management (R2) ---
    // Routes:
    // GET /api/history?userId=...       -> List chats
    // GET /api/history/:id?userId=...   -> Get chat content
    // POST /api/history/:id?userId=...  -> Save chat content & update manifest
    // DELETE /api/history/:id?userId=...-> Delete chat & update manifest

    if (url.pathname.startsWith('/api/history')) {
        if (!env.VPSAI) {
            return new Response(JSON.stringify({ error: 'Storage not configured' }), { status: 503 });
        }
        return handleHistory(request, env, url);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// --- Helper Functions ---

async function handleChatProxy(request) {
    try {
        const { prompt, model, selectedRepo, githubToken } = await request.json();

        if (!prompt) {
             return new Response(JSON.stringify({ error: 'Prompt is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // --- GPT Nano (Edit Image) ---
        if (model === 'gptnano') {
             try {
                const targetUrl = new URL('https://magma-api.biz.id/ai/gptnano');
                targetUrl.searchParams.set('prompt', prompt);

                const apiResponse = await fetch(targetUrl.toString(), {
                    headers: { 'User-Agent': 'Agent007-Worker' }
                });

                if (!apiResponse.ok) {
                    throw new Error(`GPT Nano API responded with status ${apiResponse.status}`);
                }

                const data = await apiResponse.json();

                return new Response(JSON.stringify(data), {
                    headers: { 'Content-Type': 'application/json' }
                });

            } catch (err) {
                console.error("GPT Nano Error:", err);
                return new Response(JSON.stringify({
                    status: false,
                    result: { response: `⚠️ **Edit Failed**\n\nError: ${err.message}` }
                }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        // --- Nano Banana (Image Gen) ---
        if (model === 'nano-banana') {
            try {
                const targetUrl = new URL('https://magma-api.biz.id/edits/generate');
                targetUrl.searchParams.set('prompt', prompt);

                const apiResponse = await fetch(targetUrl.toString(), {
                    headers: { 'User-Agent': 'Agent007-Worker' }
                });

                if (!apiResponse.ok) {
                    throw new Error(`Image API responded with status ${apiResponse.status}`);
                }

                const data = await apiResponse.json();

                if (data.status && data.result && data.result.image) {
                     return new Response(JSON.stringify({
                         status: true,
                         result: {
                             response: `### 🍌 Nano Banana Image\n\n![Generated Image](${data.result.image})`
                         }
                     }), { headers: { 'Content-Type': 'application/json' } });
                } else {
                    throw new Error('Invalid response structure from Image API');
                }
            } catch (imgErr) {
                console.error("Nano Banana Error:", imgErr);
                return new Response(JSON.stringify({
                    status: false,
                    result: { response: `⚠️ **Image Generation Failed**\n\nError: ${imgErr.message}` }
                }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        // --- Context Injection ---
        let finalPrompt = prompt;

        if (selectedRepo && githubToken) {
            try {
                // Fetch repository structure (Tree)
                // Limit to depth 2 or 3 to avoid massive context
                // Use the 'default_branch' if available, otherwise 'main' or 'master'
                const branch = selectedRepo.default_branch || 'main';
                const treeUrl = `https://api.github.com/repos/${selectedRepo.full_name}/git/trees/${branch}?recursive=1`;

                const treeRes = await fetch(treeUrl, {
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'User-Agent': 'Agent007-Worker'
                    }
                });

                if (treeRes.ok) {
                    const treeData = await treeRes.json();
                    // Summarize tree: limit to 50 files to save context window
                    const fileList = treeData.tree
                        .filter(item => item.type === 'blob') // Only files
                        .slice(0, 50)
                        .map(item => `- ${item.path}`)
                        .join('\n');

                    const contextHeader = `[System: You are analyzing the GitHub repository '${selectedRepo.full_name}'.\nFile Structure (partial):\n${fileList}\n\nUse this context to answer the user's request.]\n\n`;
                    finalPrompt = contextHeader + prompt;
                } else {
                    console.warn(`Failed to fetch repo tree: ${treeRes.status}`);
                }
            } catch (repoErr) {
                console.error("Repo Context Error:", repoErr);
                // Continue without context if fails
            }
        }

        // Default to copilot-think for stability
        let apiPath = 'copilot-think';
        if (model === 'gpt-4o') console.log("User requested GPT-4o, falling back to copilot-think");
        if (model === 'deepseek-r1') console.log("User requested DeepSeek R1, falling back to copilot-think");

        const targetUrl = new URL(`https://magma-api.biz.id/ai/${apiPath}`);
        targetUrl.searchParams.set('prompt', finalPrompt);

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

async function handleHistory(request, env, url) {
    const userId = url.searchParams.get('userId');
    if (!userId) {
        return new Response(JSON.stringify({ error: 'Missing userId' }), { status: 400 });
    }

    const pathParts = url.pathname.split('/');
    const chatId = pathParts[3]; // /api/history/:id -> index 3

    const MANIFEST_KEY = `users/${userId}/manifest.json`;

    try {
        // --- GET: List or Retrieve ---
        if (request.method === 'GET') {
            if (chatId) {
                // Get specific chat
                const object = await env.VPSAI.get(`chats/${userId}/${chatId}.json`);
                if (!object) return new Response('Chat not found', { status: 404 });
                const data = await object.json();
                return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
            } else {
                // List chats (from manifest)
                const object = await env.VPSAI.get(MANIFEST_KEY);
                const list = object ? await object.json() : [];
                return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        // --- POST: Save ---
        if (request.method === 'POST' && chatId) {
            const { messages, title } = await request.json();

            // 1. Save Chat Content
            await env.VPSAI.put(`chats/${userId}/${chatId}.json`, JSON.stringify({ messages, title, updatedAt: Date.now() }));

            // 2. Update Manifest
            const object = await env.VPSAI.get(MANIFEST_KEY);
            let list = object ? await object.json() : [];

            const existingIndex = list.findIndex(c => c.id === chatId);
            const metadata = {
                id: chatId,
                title: title || 'New Operation',
                timestamp: Date.now()
            };

            if (existingIndex >= 0) {
                list[existingIndex] = metadata; // Update existing
            } else {
                list.unshift(metadata); // Add new to top
            }

            await env.VPSAI.put(MANIFEST_KEY, JSON.stringify(list));

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        // --- DELETE: Remove ---
        if (request.method === 'DELETE' && chatId) {
            // 1. Delete Chat File
            await env.VPSAI.delete(`chats/${userId}/${chatId}.json`);

            // 2. Update Manifest
            const object = await env.VPSAI.get(MANIFEST_KEY);
            if (object) {
                let list = await object.json();
                list = list.filter(c => c.id !== chatId);
                await env.VPSAI.put(MANIFEST_KEY, JSON.stringify(list));
            }

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response('Method Not Allowed', { status: 405 });

    } catch (err) {
        console.error('R2 Error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
