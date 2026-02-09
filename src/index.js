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

    // --- API: Public Chat ---
    if (url.pathname.startsWith('/api/public-chat/')) {
        if (!env.VPSAI) {
             return new Response(JSON.stringify({ error: 'Storage not configured' }), { status: 503 });
        }
        return handlePublicChat(request, env, url);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// --- Helper Functions ---

async function handlePublicChat(request, env, url) {
    const path = url.pathname.replace('/api/public-chat/', '');

    // --- GET /messages (Fetch recent messages) ---
    if (path === 'messages' && request.method === 'GET') {
        try {
            // List messages from R2. Key format: public_chat/msgs/{timestamp}_{random}.json
            const listed = await env.VPSAI.list({ prefix: 'public_chat/msgs/', limit: 500 });

            // Filter messages older than 24h (86400000 ms)
            const now = Date.now();
            const cutoff = now - 86400000;

            const processMsg = async (object) => {
                // Extract timestamp from key: public_chat/msgs/1715..._xyz.json
                const filename = object.key.split('/').pop();
                const timestamp = parseInt(filename.split('_')[0]);

                if (timestamp < cutoff) {
                    return { action: 'delete', key: object.key };
                } else {
                    // Fetch content for valid messages
                    const msgObj = await env.VPSAI.get(object.key);
                    if (msgObj) {
                        const msgData = await msgObj.json();
                        return { action: 'keep', data: msgData };
                    }
                }
                return null;
            };

            const results = await Promise.all(listed.objects.map(processMsg));

            const messages = results.filter(r => r && r.action === 'keep').map(r => r.data);
            const deleteKeys = results.filter(r => r && r.action === 'delete').map(r => r.key);

            // Cleanup old messages asynchronously (fire and forget)
            if (deleteKeys.length > 0) {
                 env.VPSAI.delete(deleteKeys).catch(console.error);
            }

            // Sort by time
            messages.sort((a, b) => a.timestamp - b.timestamp);

            return new Response(JSON.stringify(messages), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    // --- POST /messages (Send message) ---
    if (path === 'messages' && request.method === 'POST') {
        try {
            const { username, text, image, voice } = await request.json(); // voice is base64 string

            if (!username) return new Response('Username required', { status: 400 });

            const timestamp = Date.now();
            const id = `${timestamp}_${Math.random().toString(36).substr(2, 5)}`;
            const key = `public_chat/msgs/${id}.json`;

            const messageData = {
                id,
                username,
                text: text || '',
                image: image || null, // Base64 or URL
                voice: voice || null, // Base64
                timestamp
            };

            await env.VPSAI.put(key, JSON.stringify(messageData));

            // Update user status implicitly
            await env.VPSAI.put(`public_chat/users/${username}.json`, JSON.stringify({ last_seen: timestamp }));

            return new Response(JSON.stringify({ success: true, message: messageData }), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    // --- DELETE /messages (Delete message) ---
    if (path === 'messages' && request.method === 'DELETE') {
        try {
            const { id, username } = await request.json();

            if (!id || !username) return new Response('ID and Username required', { status: 400 });

            const key = `public_chat/msgs/${id}.json`;
            const msgObj = await env.VPSAI.get(key);

            if (!msgObj) {
                return new Response('Message not found', { status: 404 });
            }

            const msgData = await msgObj.json();

            if (msgData.username !== username) {
                return new Response('Unauthorized', { status: 403 });
            }

            await env.VPSAI.delete(key);

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    // --- POST /heartbeat (Update online status) ---
    if (path === 'heartbeat' && request.method === 'POST') {
        try {
            const { username } = await request.json();
            if (username) {
                await env.VPSAI.put(`public_chat/users/${username}.json`, JSON.stringify({ last_seen: Date.now() }));
            }
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    // --- GET /users (Get online users) ---
    if (path === 'users' && request.method === 'GET') {
        try {
            const listed = await env.VPSAI.list({ prefix: 'public_chat/users/' });
            const now = Date.now();
            const activeThreshold = 5 * 60 * 1000; // 5 minutes

            let onlineUsers = [];
            let inactiveKeys = [];

            for (const object of listed.objects) {
                // Fetch user data to check timestamp
                const userObj = await env.VPSAI.get(object.key);
                if (userObj) {
                    const userData = await userObj.json();
                    if (now - userData.last_seen < activeThreshold) {
                         const username = object.key.split('/').pop().replace('.json', '');
                         onlineUsers.push(username);
                    } else {
                        // Mark for cleanup if very old (e.g. > 1 hour to keep list clean)
                        if (now - userData.last_seen > 3600000) {
                            inactiveKeys.push(object.key);
                        }
                    }
                }
            }

            if (inactiveKeys.length > 0) {
                env.VPSAI.delete(inactiveKeys).catch(console.error);
            }

            return new Response(JSON.stringify(onlineUsers), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
             return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    return new Response('Method Not Allowed', { status: 405 });
}

async function handleChatProxy(request, env) {
    try {
        const { prompt, model, selectedRepo, githubToken, image, geminiKey, gptLogicKey } = await request.json();
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

        // Force AI to output filenames in a parseable format for auto-saving
        const fileSystemInstruction = `
[System: When generating code files, you MUST prefix every code block with its filename in this exact format:
**File: path/to/filename.ext**
\`\`\`language
code content...
\`\`\`
Do not use any other format for filenames. This allows the system to auto-deploy the files to GitHub.]
`;

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
                    finalPrompt = fileSystemInstruction + contextHeader + prompt;
                } else {
                    finalPrompt = fileSystemInstruction + prompt;
                }
            } catch (repoErr) {
                console.error("Repo Context Error:", repoErr);
                finalPrompt = fileSystemInstruction + prompt;
            }
        } else {
            finalPrompt = fileSystemInstruction + prompt;
        }

        // --- ChatGPT Logic (Ferdev API) ---
        if (model === 'gpt-logic') {
            if (!gptLogicKey) {
                return new Response(JSON.stringify({
                    status: false,
                    result: { response: '⚠️ **Missing API Key**\n\nPlease enter your ChatGPT Logic API Key in Settings.' }
                }), { headers: { 'Content-Type': 'application/json' } });
            }

            try {
                // Default logic if not provided by user context (which it isn't yet)
                const logic = "You are a helpful and logical AI assistant.";

                const targetUrl = new URL('https://api.ferdev.my.id/ai/gptlogic');
                targetUrl.searchParams.set('prompt', finalPrompt);
                targetUrl.searchParams.set('logic', logic);
                targetUrl.searchParams.set('apikey', gptLogicKey);

                const apiResponse = await fetch(targetUrl.toString(), {
                    headers: { 'User-Agent': 'Agent007-Worker' }
                });

                if (!apiResponse.ok) {
                    throw new Error(`API responded with status ${apiResponse.status}`);
                }

                const data = await apiResponse.json();

                // Response format: { success: true, status: 200, author: "Feri", message: "..." }
                if (data.message) {
                    return new Response(JSON.stringify({
                        status: true,
                        result: {
                            model: model,
                            response: data.message
                        }
                    }), { headers: { 'Content-Type': 'application/json' } });
                } else {
                     throw new Error('Invalid response structure from ChatGPT Logic API');
                }

            } catch (err) {
                console.error("ChatGPT Logic Error:", err);
                return new Response(JSON.stringify({
                    status: false,
                    result: { response: `⚠️ **ChatGPT Logic Error**\n\n${err.message}` }
                }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        // --- Execute Gemini (if selected) ---
        if (model.startsWith('gemini-')) {
             if (!geminiKey) {
                return new Response(JSON.stringify({
                    status: false,
                    result: { response: '⚠️ **Missing API Key**\n\nPlease enter your Gemini API Key in Settings.' }
                }), { headers: { 'Content-Type': 'application/json' } });
            }

            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

                const parts = [{ text: finalPrompt }];

                // Add image if present (Text-and-Image input)
                if (image) {
                    try {
                        const base64Data = image.split(',')[1];
                        const mimeMatch = image.match(/:(.*?);/);
                        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                        parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
                    } catch (e) {
                        console.error("Failed to parse image for Gemini:", e);
                    }
                }

                const payload = {
                    contents: [{ parts: parts }]
                };

                const geminiRes = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': geminiKey
                    },
                    body: JSON.stringify(payload)
                });

                if (!geminiRes.ok) {
                    const errText = await geminiRes.text();
                    throw new Error(`Gemini API Error (${geminiRes.status}): ${errText}`);
                }

                const geminiData = await geminiRes.json();

                // Extract text and images from Gemini response structure
                let responseText = "";
                const candidates = geminiData.candidates || [];

                if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
                    for (const part of candidates[0].content.parts) {
                        if (part.text) {
                            responseText += part.text;
                        }
                        if (part.inline_data) {
                            // Convert received image back to Markdown display
                            responseText += `\n\n![Generated Image](data:${part.inline_data.mime_type};base64,${part.inline_data.data})\n\n`;
                        }
                    }
                } else {
                    responseText = "No response content.";
                }

                return new Response(JSON.stringify({
                    status: true,
                    result: {
                        model: model,
                        response: responseText
                    }
                }), { headers: { 'Content-Type': 'application/json' } });

            } catch (geminiErr) {
                console.error("Gemini Error:", geminiErr);
                return new Response(JSON.stringify({
                    status: false,
                    result: { response: `⚠️ **Gemini Error**\n\n${geminiErr.message}` }
                }), { headers: { 'Content-Type': 'application/json' } });
            }
        }

        // --- Execute Magma API (Default) ---
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
