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
      return handleChatProxy(request, env);
    }

    // --- API: History Management (R2) ---
    if (url.pathname.startsWith('/api/history')) {
        if (!env.VPSAI) {
            return new Response(JSON.stringify({ error: 'Storage not configured' }), { status: 503 });
        }
        return handleHistory(request, env, url);
    }

    // --- API: Serve Image ---
    if (url.pathname.startsWith('/api/image/')) {
        if (!env.VPSAI) {
            return new Response(JSON.stringify({ error: 'Storage not configured' }), { status: 503 });
        }
        return handleServeImage(request, env, url);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// --- Helper Functions ---

async function handleChatProxy(request, env) {
    try {
        const { prompt, model, selectedRepo, githubToken, image } = await request.json();
        const requestUrl = new URL(request.url);
        const origin = requestUrl.origin;

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

                // Handle Image Upload if present
                if (image) {
                    try {
                        // Expecting 'image' to be base64 string (data:image/png;base64,...)
                        const parts = image.split(',');
                        if (parts.length === 2) {
                            const mimeMatch = parts[0].match(/:(.*?);/);
                            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                            const base64Data = parts[1];
                            const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

                            // Generate ID
                            const imageId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                            const extension = mimeType.split('/')[1] || 'png';
                            const key = `uploads/${imageId}.${extension}`;

                            // Save to R2
                            if (env.VPSAI) {
                                await env.VPSAI.put(key, buffer, {
                                    httpMetadata: { contentType: mimeType }
                                });

                                // Generate URL
                                const imageUrl = `${origin}/api/image/${key}`;
                                targetUrl.searchParams.set('url', imageUrl);
                            }
                        }
                    } catch (uploadErr) {
                        console.error("Image Upload Error:", uploadErr);
                        // Proceed without image url if upload fails, or fail?
                        // Better to proceed so user sees error from API or at least chat continues
                    }
                }

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
                    const fileList = treeData.tree
                        .filter(item => item.type === 'blob')
                        .slice(0, 50)
                        .map(item => `- ${item.path}`)
                        .join('\n');

                    const contextHeader = `[System: You are analyzing the GitHub repository '${selectedRepo.full_name}'.\nFile Structure (partial):\n${fileList}\n\nUse this context to answer the user's request.]\n\n`;
                    finalPrompt = contextHeader + prompt;
                }
            } catch (repoErr) {
                console.error("Repo Context Error:", repoErr);
            }
        }

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
    const chatId = pathParts[3];

    const MANIFEST_KEY = `users/${userId}/manifest.json`;

    try {
        if (request.method === 'GET') {
            if (chatId) {
                const object = await env.VPSAI.get(`chats/${userId}/${chatId}.json`);
                if (!object) return new Response('Chat not found', { status: 404 });
                const data = await object.json();
                return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
            } else {
                const object = await env.VPSAI.get(MANIFEST_KEY);
                const list = object ? await object.json() : [];
                return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        if (request.method === 'POST' && chatId) {
            const { messages, title } = await request.json();
            await env.VPSAI.put(`chats/${userId}/${chatId}.json`, JSON.stringify({ messages, title, updatedAt: Date.now() }));

            const object = await env.VPSAI.get(MANIFEST_KEY);
            let list = object ? await object.json() : [];

            const existingIndex = list.findIndex(c => c.id === chatId);
            const metadata = {
                id: chatId,
                title: title || 'New Operation',
                timestamp: Date.now()
            };

            if (existingIndex >= 0) {
                list[existingIndex] = metadata;
            } else {
                list.unshift(metadata);
            }

            await env.VPSAI.put(MANIFEST_KEY, JSON.stringify(list));

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (request.method === 'DELETE' && chatId) {
            await env.VPSAI.delete(`chats/${userId}/${chatId}.json`);
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

async function handleServeImage(request, env, url) {
    try {
        // Path format: /api/image/uploads/filename.png
        // R2 Key: uploads/filename.png
        // Extract key from path.
        // url.pathname starts with /api/image/
        const key = url.pathname.replace('/api/image/', '');

        if (!key) {
            return new Response('Image not specified', { status: 400 });
        }

        const object = await env.VPSAI.get(key);
        if (!object) {
            return new Response('Image Not Found', { status: 404 });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);

        return new Response(object.body, {
            headers,
        });

    } catch (err) {
        console.error("Serve Image Error:", err);
        return new Response('Internal Server Error', { status: 500 });
    }
}
