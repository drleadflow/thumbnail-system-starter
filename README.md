# AI Thumbnail & Script System — Starter

The working code behind the guide at **[marketing.doctorleadflow.com/thumbnail-system](https://marketing.doctorleadflow.com/thumbnail-system/)** — a complete YouTube research, thumbnail, and script system you run yourself:

- **Research Library** — search any topic, get the top videos with real view counts, each **outlier-scored** (views ÷ that channel's own median — the 1of10 signal). Saved forever; never research the same thing twice.
- **Channel Watchlist** — track competitors; every upload auto-scored against that channel's own normal via YouTube's free RSS feed. Refreshes itself.
- **Use as reference** — one click pulls any winning thumbnail in as a style reference for generation.
- **Avatar likeness bundle** — multiple photos per person; generations get several angles of the *same* face so likeness holds. Person-tagged, so client photos never mix with yours.
- **Hook Lab** — read the actual spoken openings (the full first minute) of the winners in a transcript reader, then rebuild your hook on their mechanics — never their words.
- **Script Analyzer** — scores your script (hook strength, specificity, open loops, payoff, voice) against the real transcripts of the topic's outliers, and tells you concretely what the winners do that yours doesn't.
- **Voice note → script** — talk through an idea; get back titles, grounded hook variants, a beat outline, and a draft built from *your* sentences.
- **Generate + iterate** — multiple AI thumbnail versions per run, one-click "Tweak this" on any image, full history with reusable setups.

## Setup (15 minutes, no code changes needed)

### 1. Get your keys

| Key | Where | Cost |
|---|---|---|
| Supabase URL + service role key | [supabase.com](https://supabase.com) → new project → Project Settings → API | Free tier is plenty |
| `SCRAPECREATORS_API_KEY` | [scrapecreators.com](https://scrapecreators.com) — YouTube search with real view counts + channel ids + transcripts | Paid credits, cheap; transcripts cached forever |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) — one key for the LLM calls AND gpt-image-2 image generation | Pay per use |
| `GROQ_API_KEY` *(optional)* | [console.groq.com](https://console.groq.com) — Whisper transcription for voice notes | Free tier |

### 2. Create the database

In your Supabase project: **SQL Editor → New query → paste the contents of [`setup.sql`](./setup.sql) → Run.** That's the entire schema.

### 3. Configure and run

```bash
cp .env.example .env.local   # fill in your keys
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Search a topic → you should see thumbnails with outlier badges within a few seconds. That's the system working.

### 4. First-session checklist

1. Search 2–3 topics in your niche → hit **+ Track** on the channels that matter → your watchlist starts maintaining itself
2. Upload 2–3 cutout photos of yourself in the Avatars section (tick **Use my face** to see it) → mark 👁 on your best angles
3. Go to **Scripts** → set a topic → **Find top videos → Get their hooks** → click **Read their full opening** on any winner → write a rough hook → **Optimize my hook** → **Analyze my script**
4. Or just hit **🎙 Voice note → draft** and talk through your next video idea

## How the outlier score works

`views ÷ the channel's own median views` — computed from YouTube's free RSS feed (`youtube.com/feeds/videos.xml?channel_id=…`, last ~15 uploads with view counts, no API key). A 100K-view video is noise from a 10M-sub channel and a monster from a 5K one. Sort by outliers, not raw views — the small channel doing 100x teaches you more than the big channel doing 1x.

## The rules that make the AI parts work

These are baked into the prompts (see `app/api/hook-optimize` and `app/api/voice-draft`) — keep them if you customize:

- **Steal mechanics, never words.** Hooks borrow the curiosity gap / receipts / contrarian structure of winners — never their sentences or claims.
- **Never invent claims.** Every statement in an optimized hook must come from *your* draft. No fabricated numbers, results, or credentials.
- **Preserve the speaker's voice.** Voice-note drafts are built from your sentences — reordered and tightened, never rewritten into AI-speak. Raw transcripts accumulate into a voice corpus that anchors every future generation.
- **Same-person-only likeness.** The avatar bundle never mixes photos of two different people.

## Customizing

- **LLM model**: set `LLM_MODEL` in `.env.local` (any OpenRouter model id; default `anthropic/claude-sonnet-4.5`).
- **Image model**: edit `lib/imageGen.ts` — anything that accepts **multiple reference images** works; single-reference models break the likeness bundle.
- **Free YouTube search**: swap `lib/scrapeCreators.ts` for the YouTube Data API v3 — just make sure whatever you use returns numeric view counts **and** channel IDs, or outlier scoring silently dies.

---

Built by [Dr. Emeka Ajufo](https://www.skool.com/aiceolab). For the full walkthrough of *why* each part exists, read [the guide](https://marketing.doctorleadflow.com/thumbnail-system/). More systems like this inside the [AI CEO Lab](https://www.skool.com/aiceolab).
