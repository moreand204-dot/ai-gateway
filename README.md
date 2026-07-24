# AI Gateway

بوابة AI واحدة، كل بوتاتك (ORACLE, ESCANOR/SAYKO, ...) بتكلمها هي بدل ما كل
بوت يضرب على Groq/Gemini لوحده. المميزات:

- بتدير أكتر من مفتاح Groq/Gemini وتلف عليهم تلقائي (round-robin)
- لو مفتاح رجّع 429 (تعدى الحد)، بيتحط في "استراحة" دقيقة وتتجرب اللي بعده
- لو كل مفاتيح Groq وقعت، بتتحول لـ Gemini، وبعدين لـ pollinations (بدون مفتاح خالص)
- محمية بسر مشترك (`GATEWAY_SECRET`) عشان محدش يستخدمها غيرك

## التنصيب على الاستضافة

```bash
cd ai-gateway
npm install
cp .env.example .env
```

افتح `.env` وحط فيه:
- `GATEWAY_SECRET`: أي نص سري طويل من عندك
- `GROQ_KEYS`: مفاتيح Groq بتاعتك مفصولة بفاصلة (كل ما زودت مفاتيح كل ما الحصة زادت)
- `GEMINI_KEYS`: اختياري

```bash
npm start
```

هيشتغل على البورت المكتوب في `.env` (افتراضيًا 3000). لو الاستضافة بتديك رابط
عام (زي optiklink.net أو Vercel)، هوه ده الرابط اللي بوتاتك هتكلمه.

## طريقة استخدام البوابة من أي بوت

```js
import axios from 'axios';

const GATEWAY_URL = 'https://your-gateway-domain.com/v1/ai';
const GATEWAY_SECRET = 'نفس السر اللي حطيته في .env';

async function askAI(prompt, system) {
    try {
        const res = await axios.post(GATEWAY_URL, { prompt, system }, {
            headers: { Authorization: `Bearer ${GATEWAY_SECRET}` },
            timeout: 25000
        });
        return res.data?.reply || null;
    } catch (e) {
        console.error('[gateway] فشل:', e.response?.data?.error || e.message);
        return null;
    }
}
```

## إضافة/تغيير مفاتيح لاحقًا

عدّل `GROQ_KEYS` أو `GEMINI_KEYS` في `.env` على السيرفر وعمل ريستارت للبوابة.
مفيش أي تعديل مطلوب في كود البوتات نفسها.
