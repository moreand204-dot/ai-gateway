
import express from 'express';
import axios from 'axios';
import 'dotenv/config';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || '';
const GROQ_KEYS = (process.env.GROQ_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const GEMINI_KEYS = (process.env.GEMINI_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const OPENAI_KEYS = (process.env.OPENAI_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const keyState = new Map();

const isKeyCool = (key) => {
    const st = keyState.get(key);
    return st && st.cooldownUntil > Date.now();
};

const coolDownKey = (key, ms = 60_000) => {
    keyState.set(key, { cooldownUntil: Date.now() + ms });
};

let groqPtr = 0;
let geminiPtr = 0;
let openaiPtr = 0;

const nextUsableKey = (keys, ptrRef) => {
    for (let i = 0; i < keys.length; i++) {
        const idx = (ptrRef.i + i) % keys.length;
        if (!isKeyCool(keys[idx])) {
            ptrRef.i = (idx + 1) % keys.length;
            return keys[idx];
        }
    }
    return null;
};

const askGroq = async (prompt, system) => {
    const ptrRef = { i: groqPtr };
    const key = nextUsableKey(GROQ_KEYS, ptrRef);
    groqPtr = ptrRef.i;
    if (!key) return null;

    try {
        const messages = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content: prompt });

        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            { model: GROQ_MODEL, messages, temperature: 0.9, max_tokens: 800 },
            { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 20000 }
        );
        return res.data?.choices?.[0]?.message?.content || null;
    } catch (e) {
        const status = e.response?.status;
        if (status === 429 || status === 401 || status === 403) coolDownKey(key, 60_000);
        console.error('[gateway] Groq key فشل:', status, e.response?.data?.error?.message || e.message);
        return null;
    }
};

const askGemini = async (prompt, system) => {
    const ptrRef = { i: geminiPtr };
    const key = nextUsableKey(GEMINI_KEYS, ptrRef);
    geminiPtr = ptrRef.i;
    if (!key) return null;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
        const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
        const res = await axios.post(url, {
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { temperature: 0.9, topK: 40, topP: 0.95, maxOutputTokens: 1024 }
        }, { timeout: 20000 });

        return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (e) {
        const status = e.response?.status;
        if (status === 429 || status === 401 || status === 403) coolDownKey(key, 60_000);
        console.error('[gateway] Gemini key فشل:', status, e.response?.data?.error?.message || e.message);
        return null;
    }
};

const askOpenAI = async (prompt, system) => {
    const ptrRef = { i: openaiPtr };
    const key = nextUsableKey(OPENAI_KEYS, ptrRef);
    openaiPtr = ptrRef.i;
    if (!key) return null;

    try {
        const messages = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content: prompt });

        const res = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            { model: OPENAI_MODEL, messages, temperature: 0.9, max_tokens: 800 },
            { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, timeout: 25000 }
        );
        return res.data?.choices?.[0]?.message?.content || null;
    } catch (e) {
        const status = e.response?.status;
        if (status === 429 || status === 401 || status === 403) coolDownKey(key, 60_000);
        console.error('[gateway] OpenAI key فشل:', status, e.response?.data?.error?.message || e.message);
        return null;
    }
};

const askPollinations = async (prompt, system) => {
    const models = ['openai', 'mistral', 'deepseek'];
    for (const model of models) {
        try {
            const messages = [];
            if (system) messages.push({ role: 'system', content: system });
            messages.push({ role: 'user', content: prompt });

            const res = await axios.post('https://text.pollinations.ai/', {
                messages, model, seed: Math.floor(Math.random() * 99999)
            }, { headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 });

            if (typeof res.data === 'string' && res.data.length > 3) return res.data;
            if (res.data?.choices?.[0]?.message?.content) return res.data.choices[0].message.content;
        } catch (e) {
            const code = e.response?.status;
            if (code === 429 || code === 402) continue;
        }
    }
    return null;
};

app.post('/v1/ai', async (req, res) => {
    if (GATEWAY_SECRET) {
        const auth = req.headers.authorization || '';
        if (auth !== `Bearer ${GATEWAY_SECRET}`) {
            return res.status(401).json({ error: 'unauthorized' });
        }
    }

    const { prompt, system } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'prompt is required' });
    }

    const reply = (await askGroq(prompt, system))
        || (await askGemini(prompt, system))
        || (await askOpenAI(prompt, system))
        || (await askPollinations(prompt, system));

    if (!reply) return res.status(503).json({ error: 'all_providers_failed' });
    res.json({ reply });
});

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        groqKeys: GROQ_KEYS.length,
        geminiKeys: GEMINI_KEYS.length,
        openaiKeys: OPENAI_KEYS.length
    });
});

app.listen(PORT, () => {
    console.log(`✅ AI Gateway شغال على البورت ${PORT}`);
    console.log(`   Groq keys: ${GROQ_KEYS.length} | Gemini keys: ${GEMINI_KEYS.length} | OpenAI keys: ${OPENAI_KEYS.length}`);
});
