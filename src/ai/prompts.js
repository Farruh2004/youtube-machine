// AI uchun ko'rsatmalar va AI ishlamaganda ishlatiladigan shablonlar.
// Kontent inglizcha bo'ladi (kanallar ingliz tilidagi auditoriyaga mo'ljallangan).

const SEO_RULES = `YouTube SEO rules:
- Titles: max 70 characters, put the strongest keyword first, no ALL CAPS sentences, no misleading claims.
- Description: first 2 lines must hook the viewer and contain the main keywords; then a short paragraph; keep it honest.
- Tags: 10-15 relevant tags, most specific first, no unrelated sports/artists/events.
- Hashtags: exactly 3, relevant.
- thumbnailText: 2-4 punchy words for the thumbnail.`;

export function musicSeoPrompt({ channel, inputs, lyricsLines }) {
  return {
    system: `You are a YouTube growth strategist for the music channel "${channel.name}". The channel publishes AI-generated songs made with Suno. ${SEO_RULES}`,
    prompt: `Create YouTube metadata for a new song.

Song title: ${inputs.songTitle || '(untitled)'}
Genre: ${inputs.genre || 'unknown'}
Mood: ${inputs.mood || 'unknown'}
Lyrics language: ${inputs.lyricsLanguage || 'unknown'}
Lyrics (excerpt):
${lyricsLines.slice(0, 24).join('\n') || '(instrumental)'}

Return JSON:
{
  "titles": ["3 title options for the full lyric video"],
  "shortTitles": ["3 different title options for 30-60s Shorts teasers cut from different parts of the song, each ending with #Shorts"],
  "description": "description for the full video (no hashtags, no links)",
  "shortDescription": "1-2 line description for the Shorts",
  "tags": ["..."],
  "hashtags": ["#...", "#...", "#..."],
  "thumbnailText": "..."
}`,
  };
}

export function musicSeoFallback({ channel, inputs }) {
  const title = inputs.songTitle || 'New Song';
  const genre = inputs.genre ? `${inputs.genre} ` : '';
  const mood = inputs.mood ? `${inputs.mood} ` : '';
  return {
    titles: [`${title} — ${mood}${genre}Song (Lyric Video)`.replace(/\s+/g, ' ').trim()],
    shortTitles: [`${title} 🎧 #Shorts`, `${title} (Lyrics) #Shorts`, `${title} | ${inputs.genre || 'New Song'} #Shorts`],
    description: `${title} — ${mood}${genre}song by ${channel.name}.\nListen to the full song with lyrics and subscribe for a new song every day.`,
    shortDescription: `${title} — listen to the full song with lyrics on the channel.`,
    tags: [title, inputs.genre, inputs.mood, `${inputs.genre || ''} song`.trim(), 'lyric video', 'new song'].filter(Boolean),
    hashtags: ['#music', inputs.genre ? `#${inputs.genre.replace(/\W+/g, '')}` : '#song', '#aimusic'],
    thumbnailText: title.split(/\s+/).slice(0, 4).join(' '),
  };
}

export function fightScriptPrompt({ channel, inputs, durationSec, format, effects = null }) {
  const seconds = Math.round(durationSec);
  const words = Math.max(20, Math.round(seconds * 2.4));
  const kind = format === 'long' ? 'a horizontal breakdown video (up to 10 minutes)' : 'a vertical YouTube Short';
  return {
    system: `You are the head writer of "${channel.name}", a YouTube channel with original, technical fight breakdowns in English. Your commentary must transform the footage: explain WHY things worked (setups, footwork, timing, defense, fight IQ), not just describe what happened. Never invent results, records, quotes or statistics that are not in the notes. ${SEO_RULES}`,
    prompt: `Write ${kind}.

Fighters: ${inputs.fighters || 'unknown'}
Event / context: ${inputs.event || 'unknown'}
Notes from the editor (facts you may use): ${inputs.notes || 'none'}${inputs.clipContext ? `\nClip context: ${inputs.clipContext}` : ''}
Footage length: ${seconds} seconds. The narration must be about ${words} words so it fits the footage.${effects ? `\nEditing: at about ${Math.round(effects.freezeAt)}s the video freezes on the key moment, then shows a slow-motion replay. Time the narration so the key insight lands there (e.g. "Look at this...", "Watch it again in slow motion").` : ''}

Structure for the narration: a 1-sentence hook question, then the breakdown, then a short call-to-action question for comments.

Return JSON:
{
  "hook": "on-screen hook text, max 7 words",
  "narration": "the full spoken English narration, plain text",
  "titles": ["3 title options"],
  "description": "YouTube description (no hashtags)",
  "tags": ["..."],
  "hashtags": ["#...", "#...", "#..."],
  "thumbnailText": "..."
}`,
  };
}

export function fightScriptFallback({ inputs }) {
  const fighters = inputs.fighters || 'This fight';
  return {
    hook: 'Why did this work?',
    narration: (inputs.notes || '').trim(),
    titles: [`${fighters} — Fight Breakdown`],
    description: `${fighters}${inputs.event ? ` at ${inputs.event}` : ''}: a short technical breakdown.`,
    tags: [fighters, inputs.event, 'fight breakdown', 'fight analysis'].filter(Boolean),
    hashtags: ['#fight', '#breakdown', '#shorts'],
    thumbnailText: 'HOW HE DID IT',
  };
}

export function insightsPrompt({ channel, report }) {
  const rows = report.videos
    .slice(0, 40)
    .map((v) => `- [${v.isShort ? 'Short' : 'Long'}] "${v.title}" — ${v.views} views, ${v.likes} likes, ${v.comments} comments, ${v.ageDays} days old`)
    .join('\n');
  return {
    system: 'You are a data-driven YouTube strategist. Base every claim on the numbers given; when the sample is small, say so. Answer in Uzbek (Latin script), but keep video titles and topic ideas in English.',
    prompt: `Channel: ${channel.name} (${channel.type === 'music' ? 'AI music' : 'fight breakdowns'})
Subscribers: ${report.channel.subscribers}
Recent videos:
${rows || '(no videos)'}

Return JSON:
{
  "summary": "2-3 sentence summary of performance",
  "whatWorks": ["observations backed by the numbers"],
  "ideas": [{"title": "English video title idea", "why": "reason in Uzbek"}],
  "titleTips": ["concrete tips"]
}
Give 5 ideas.`,
  };
}

export function needsTranslation(language) {
  const lang = String(language || '').trim();
  return Boolean(lang) && !/^(en|eng|english|ingliz)/i.test(lang);
}

export function translatePrompt(lines, language) {
  return {
    system: 'You translate song lyrics into natural, concise English that reads well as a subtitle under the original line. Keep the meaning and emotion; do not add commentary.',
    prompt: `Translate each of these ${lines.length} ${language || ''} song lyric lines into English.
Return JSON {"lines": [...]} with exactly ${lines.length} strings, in the same order.

${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
  };
}

export function trendsPrompt({ channel, videos }) {
  return {
    system: 'You are a YouTube trend analyst. Base every point on the list given. Answer in Uzbek (Latin script); keep video titles and topic ideas in English.',
    prompt: `Channel: ${channel.name} (${channel.type === 'music' ? 'AI music' : 'fight breakdowns'})
Top videos of the last 7 days in this niche (views per day):
${videos.map((v) => `- [${v.isShort ? 'Short' : 'Long'}] "${v.title}" by ${v.channel} — ${v.viewsPerDay}/day`).join('\n')}

Return JSON:
{
  "summary": "what is trending right now, 2-3 sentences",
  "patterns": ["title/format patterns that repeat among the winners"],
  "ideas": [{"title": "English video idea for our channel", "why": "reason in Uzbek"}]
}
Give 5 ideas that fit our channel (original content, no reuploads).`,
  };
}

export function commentRepliesPrompt({ channel, comments }) {
  return {
    system: `You manage community replies for the YouTube channel "${channel.name}". Write short, warm, human replies in the commenter's language (default English). Never promise anything, never argue, no links. If a comment is spam or hateful, reply with an empty string.`,
    prompt: `Write one reply per comment.
${comments.map((c, i) => `${i + 1}. ${c.author}: ${c.text}`).join('\n')}

Return JSON {"replies": ["..."]} with exactly ${comments.length} strings in the same order.`,
  };
}

const DIAG_RULES = `You are a senior YouTube growth analyst diagnosing a small channel.
Rules:
- Base every claim on the data given. Quote the evidence (numbers, titles, flags). Never invent metrics you were not given (impressions and click-through rate are NOT available unless listed).
- Separate the causes: (1) reach/distribution (the algorithm did not show it), (2) packaging (title + thumbnail did not earn the click), (3) content/retention (people left early), (4) technical/policy (blocked regions, made-for-kids, comments off, wrong format).
- Small channels have small samples: say so when a conclusion is uncertain, and do not over-interpret differences of a few dozen views.
- Prefer concrete, actionable fixes over generic advice. No guarantees of virality.
- Write all explanations in Uzbek (Latin script). Keep video titles and title suggestions in English.`;

const VERDICT_LABEL = { hit: 'HIT', normal: 'normal', flop: 'FLOP', new: 'new', unknown: '?' };

function videoRow(v) {
  const a = v.analytics;
  return `- [${v.isShort ? 'Short' : 'Long'}${v.isVertical === false ? ', horizontal' : ''}, ${v.duration}s] "${v.title}" | ${v.views} views | ${v.perf ?? '?'}x channel median (${VERDICT_LABEL[v.verdict]}) | likes ${v.likes ?? 'hidden'} | comments ${v.comments ?? 'off'} | ${Math.round(v.ageDays)}d old${a ? ` | avg watched ${a.avgPercent}% (${a.avgDuration}s), +${a.subscribers} subs, ${a.shares} shares` : ''}${v.issues.length ? ` | flags: ${v.issues.map((i) => i.code).join(', ')}` : ''}`;
}

export function channelDiagnosisPrompt({ channel, diagnosis: d }) {
  return {
    system: DIAG_RULES,
    prompt: `Channel: ${d.channel.title} (${channel.type === 'music' ? 'AI-generated music made with Suno: lyric videos + Shorts' : 'fight clips with original breakdown commentary'})
Target audience language: ${channel.language || 'en'}
Subscribers: ${d.channel.subscribers}, total views: ${d.channel.views}, videos: ${d.channel.videoCount}
Channel description: ${d.channel.description.slice(0, 400) || '(empty)'}
Median views — Shorts: ${d.medians.short ?? 'n/a'}, long: ${d.medians.long ?? 'n/a'}
Data source: ${d.analyticsAvailable ? 'public stats + YouTube Analytics (watch %, subs gained)' : 'public stats only (no watch-time data)'}

Channel-level flags:
${d.channelIssues.map((i) => `- ${i.code}: ${i.title}`).join('\n') || '- none'}

Videos (newest first):
${d.videos.slice(0, 40).map(videoRow).join('\n')}

Return JSON:
{
  "summary": "3-4 sentences: the real state of the channel and the single biggest reason it is not growing",
  "whyNotGrowing": [{"reason": "...", "evidence": "concrete numbers/titles from the data", "fix": "concrete action", "impact": "yuqori|o'rta|past"}],
  "winningPatterns": ["what the best performers have in common (or say the sample is too small)"],
  "actionPlan": [{"step": "action for the next 2 weeks", "why": "..."}],
  "titleFormula": "a title template that fits this channel, with an English example",
  "thumbnailAdvice": ["..."],
  "nextVideos": [{"title": "English title idea", "why": "reason in Uzbek"}]
}
Rank whyNotGrowing by impact (max 6). actionPlan max 6 steps. nextVideos: 5.`,
  };
}

export function videoDiagnosisPrompt({ channel, diagnosis: d, video: v, retention, traffic, hits, hasImage }) {
  const median = v.isShort ? d.medians.short : d.medians.long;
  return {
    system: DIAG_RULES,
    prompt: `Diagnose why this video performed as it did on "${d.channel.title}" (${channel.type === 'music' ? 'AI music channel' : 'fight breakdown channel'}, ${d.channel.subscribers} subscribers).
${hasImage ? 'The attached image is the video thumbnail as viewers see it. Judge it at phone size: readability, focal point, emotion, contrast, whether it matches the title.' : 'No thumbnail image is available.'}

Video: "${v.title}"
Format: ${v.isShort ? 'Short' : 'long video'}, ${v.duration}s, ${v.isVertical === false ? 'horizontal' : v.isVertical ? 'vertical' : 'orientation unknown'}
Published ${Math.round(v.ageDays)} days ago. Views: ${v.views} (channel median for this format: ${median ?? 'n/a'}; ratio ${v.perf ?? '?'}x → ${VERDICT_LABEL[v.verdict]})
Likes: ${v.likes ?? 'hidden'}, comments: ${v.comments ?? 'disabled'}, like rate ${v.likeRate != null ? `${(v.likeRate * 100).toFixed(1)}%` : 'n/a'} (channel median ${d.medians.likeRate != null ? `${(d.medians.likeRate * 100).toFixed(1)}%` : 'n/a'})
${v.analytics ? `Analytics: average watched ${v.analytics.avgPercent}% (${v.analytics.avgDuration}s), +${v.analytics.subscribers} subscribers, ${v.analytics.shares} shares` : 'No watch-time analytics available.'}
${retention ? `Audience retention (% of viewers still watching at % of video): ${retention.map((r) => `${r.at}%→${r.stillWatching}%`).join(', ')}` : ''}
${traffic?.length ? `Traffic sources (views): ${traffic.map((t) => `${t.source} ${t.views}`).join(', ')}` : ''}
Tags: ${v.tags.slice(0, 20).join(', ') || '(none)'}
Description (start): ${v.description.slice(0, 500) || '(empty)'}
Rule-based flags: ${v.issues.map((i) => `${i.code} (${i.title})`).join('; ') || 'none'}
Best performing videos on this channel for contrast: ${hits.map((h) => `"${h.title}" (${h.views} views)`).join('; ') || 'none yet'}

Return JSON:
{
  "verdict": "1-2 sentences in Uzbek: the most likely reason",
  "reasons": [{"reason": "...", "evidence": "...", "confidence": "yuqori|o'rta|past"}],
  "thumbnail": "critique of the thumbnail and exactly what to change (or say it is not available)",
  "hook": "what the first 1-3 seconds should do differently",
  "betterTitles": ["3 English title options, max 60 characters each"],
  "fixes": ["ordered list of concrete actions"],
  "reupload": "should the user re-edit/re-upload this as a new video? yes/no + why, in Uzbek"
}`,
  };
}

// ---------- Raqobatchilar, g'oyalar, ssenariylar ----------
const IDEA_RULES = `Rules:
- Learn from what demonstrably works (outliers = videos with many times the channel's median views), but NEVER copy a competitor's title or script verbatim. Transfer the underlying pattern (curiosity gap, framing, structure) to a new topic or angle.
- Facts must be accurate. For health, science or history topics, do not exaggerate or invent claims; clickable framing is fine, misinformation is not.
- No misleading titles: the video must deliver what the title and thumbnail promise.
- Explanations for the user (why, angle, analysis) in Uzbek (Latin script). Titles, hooks, scripts and on-screen text in the target channel's language.`;

function compBrief(c) {
  const s = c.stats;
  const top = c.videos.filter((v) => s.topIds.includes(v.id)).sort((a, b) => b.outlier - a.outlier).slice(0, 12);
  return `### ${c.title} (${c.subscribers} subscribers, ${c.videoCount} videos, median ${s.medianViews} views per video)
Uploads: ${s.uploadsLast30} in the last 30 days, every ~${s.medianGapDays ?? '?'} days. Best length: ${s.bestBucket ? `${s.bestBucket.label} (avg ${s.bestBucket.avgOutlier}x median)` : 'n/a'}. Shorts ${s.shortsCount} / long ${s.longCount}.
Title habits (top quarter vs all): numbers ${s.titles.number.top}% vs ${s.titles.number.all}%, "you/your" ${s.titles.you.top}% vs ${s.titles.you.all}%, questions ${s.titles.question.top}% vs ${s.titles.question.all}%, CAPS word ${s.titles.caps.top}% vs ${s.titles.caps.all}%.
${c.ai?.formula ? `Formula found earlier: ${c.ai.formula}\n` : ''}Top outliers:
${top.map((v) => `- "${v.title}" — ${v.views} views (${v.outlier}x), ${Math.round(v.duration / 60 * 10) / 10} min, ${v.isShort ? 'Short' : 'long'}`).join('\n')}`;
}

export function competitorAnalysisPrompt({ comp, top, images }) {
  const s = comp.stats;
  const bottom = comp.videos.filter((v) => v.outlier != null && v.ageDays >= 7).sort((a, b) => a.outlier - b.outlier).slice(0, 8);
  return {
    system: `You are a YouTube strategist who reverse-engineers successful channels. ${IDEA_RULES}`,
    prompt: `Analyze this competitor channel and explain what makes its winners work.
${images ? `The ${images} attached images are thumbnails of its top outlier videos, in order. Describe the thumbnail system (character, composition, text, colors, arrows, emotions).` : 'No thumbnails attached.'}

Channel: ${comp.title} (${comp.handle || ''})
Description: ${comp.description || '(none)'}
Subscribers: ${comp.subscribers}, total views: ${comp.views}, videos: ${comp.videoCount}, analyzed: ${s.analyzed}
Median views: ${s.medianViews} (Shorts ${s.medianShorts ?? 'n/a'}, long ${s.medianLong ?? 'n/a'})
Duration buckets: ${s.buckets.map((b) => `${b.label}: ${b.count} videos, avg ${b.avgOutlier}x`).join('; ')}
Cadence: ${s.uploadsLast30} uploads in 30 days, median gap ${s.medianGapDays} days, most common weekday ${s.topWeekday}
Frequent openers: ${s.openers.map((o) => `"${o.opener}…" x${o.count} (avg ${o.avgOutlier}x)`).join('; ') || 'none'}
Keywords over-represented in winners: ${s.keywords.map((k) => `${k.word} (lift ${k.lift})`).join(', ') || 'none'}

Top outliers:
${top.slice(0, 15).map((v) => `- "${v.title}" — ${v.views} views, ${v.outlier}x median, ${v.duration}s, ${Math.round(v.ageDays)} days old`).join('\n')}

Weakest videos (for contrast):
${bottom.map((v) => `- "${v.title}" — ${v.views} views, ${v.outlier}x`).join('\n') || '- n/a'}

Return JSON:
{
  "summary": "3-4 sentences in Uzbek: who the channel is for and why it grows",
  "formula": "one paragraph in Uzbek: the repeatable recipe (topic type + title frame + thumbnail + length + pacing)",
  "titlePatterns": [{"pattern": "template like 'Signs You're a ___'", "example": "existing title", "why": "Uzbek"}],
  "thumbnailStyle": ["Uzbek observations"],
  "topicClusters": [{"topic": "...", "examples": ["..."], "performance": "Uzbek"}],
  "whatToCopy": ["principles to adopt (Uzbek)"],
  "whatToAvoid": ["Uzbek"],
  "gaps": ["topics/angles their audience wants that they have not covered yet (Uzbek, with English topic names)"]
}`,
  };
}

const TYPE_BRIEF = {
  music: 'AI-generated songs made with Suno, published as lyric videos (16:9) plus 30-60s Shorts cut from the strongest part.',
  fight: 'Fight clips (MMA/boxing) with original English technical breakdown narration, freeze-frames and slow-motion replays; mostly vertical Shorts.',
  explainer: 'Faceless animated explainer videos: a simple recurring mascot character in flat illustrations, a friendly voice-over, 3-6 minute videos plus Shorts.',
  other: 'General YouTube content.',
};

export function ideasPrompt({ target, comps, count, format, notes, own }) {
  return {
    system: `You are the head of content for a YouTube channel. ${IDEA_RULES}`,
    prompt: `Generate video ideas for OUR channel, based on competitor evidence.

Our channel: ${target.name} (${target.kind === 'planned' ? 'planned, not launched yet' : 'existing'})
What we make: ${TYPE_BRIEF[target.type] || TYPE_BRIEF.other}
Niche/topic: ${target.niche || ''}
${target.audience ? `Audience: ${target.audience}\n` : ''}${target.style ? `Style notes: ${target.style}\n` : ''}Language of titles/scripts: ${target.language || 'en'}
${own ? `Our hits: ${own.hits.join('; ') || 'none yet'}\nOur flops: ${own.flops.join('; ') || 'none'}\n` : ''}Format wanted: ${format === 'short' ? 'Shorts only' : format === 'long' ? 'long videos only' : 'mix of long videos and Shorts'}
${notes ? `Extra wishes from the owner: ${notes}\n` : ''}
Competitors:
${comps.map(compBrief).join('\n\n')}

Return JSON:
{
  "ideas": [{
    "title": "final title in our language, max 60 characters",
    "hook": "first 3-5 seconds, word for word",
    "angle": "Uzbek: what makes it fresh vs the competitor",
    "format": "short|long",
    "lengthSec": 0,
    "thumbnailText": "2-4 words",
    "thumbnailConcept": "Uzbek: what the thumbnail shows",
    "inspiredBy": "which competitor title/pattern it builds on",
    "why": "Uzbek: evidence it can work (outlier numbers, pattern)",
    "potential": 1
  }]
}
Give exactly ${count} ideas, ranked by potential (1-10, be honest).`,
  };
}

export function scriptPrompt({ idea, target, comps }) {
  const formula = comps.map((c) => c.ai?.formula).filter(Boolean).join(' | ');
  const common = `Idea: "${idea.title}" (${idea.format === 'short' ? 'Short' : 'long video'}, ~${idea.lengthSec || (idea.format === 'short' ? 45 : 240)} seconds)
Hook: ${idea.hook}
Angle: ${idea.angle}
Thumbnail: ${idea.thumbnailText} — ${idea.thumbnailConcept}
Our channel: ${target.name}. ${TYPE_BRIEF[target.type] || TYPE_BRIEF.other} ${target.niche || ''} ${target.style ? `Style: ${target.style}` : ''}
Language: ${target.language || 'en'}
${formula ? `Competitor formula to learn from (do not copy): ${formula}` : ''}`;

  if (target.type === 'music') {
    return {
      system: `You are a hit songwriter and YouTube music producer. ${IDEA_RULES}`,
      prompt: `Write the full script for a new song video.
${common}

Return JSON:
{
  "title": "final YouTube title",
  "songConcept": "Uzbek: story and emotion of the song",
  "sunoStyle": "Suno style prompt (genre, mood, tempo, vocals, instruments), max 200 characters",
  "lyrics": "full lyrics with [Verse], [Pre-Chorus], [Chorus], [Bridge] tags, chorus strong and repeatable",
  "visualConcept": "Uzbek: cover art / background idea",
  "shortsMoments": ["which lines make the best Shorts and why (Uzbek)"],
  "thumbnailText": "...",
  "description": "YouTube description",
  "tags": ["..."]
}`,
    };
  }
  return {
    system: `You are a top YouTube scriptwriter for ${target.type === 'fight' ? 'fight breakdown' : 'faceless animated explainer'} videos. Write tight, spoken, punchy scripts with a strong curiosity loop and payoff. ${IDEA_RULES}`,
    prompt: `Write the full script for this video.
${common}

${target.type === 'fight'
  ? 'For each section, "visual" says which moment of the fight footage to show and any freeze-frame/slow-motion/zoom.'
  : 'For each section, "visual" is an illustration prompt for one scene in the channel style (recurring mascot character, simple flat cartoon, clear pose and emotion, props, short on-screen text if any). Keep the character consistent.'}
Write roughly 150 spoken words per minute.

Return JSON:
{
  "title": "final YouTube title",
  "hook": "first lines, word for word",
  ${target.type === 'fight' ? '"clipToFind": "Uzbek: which fight/moment footage to look for",\n  ' : ''}"sections": [{"heading": "short label", "narration": "exact voice-over text", "visual": "..."}],
  "cta": "closing line",
  "estimatedSeconds": 0,
  "thumbnailText": "...",
  "thumbnailConcept": "Uzbek",
  "description": "YouTube description (no hashtags)",
  "tags": ["..."]
}`,
  };
}

// ---------- Tushuntiruvchi kanal: personaj va ssenariy ----------
export function characterPrompt() {
  return {
    system: 'You are a character designer writing a model sheet so other illustrators can redraw a mascot consistently.',
    prompt: `Describe the character in the attached image so it can be redrawn identically in any pose.
Cover: body shape and proportions, head, face (eyes, glasses, mouth), colors (with hex guesses), outline thickness and style, clothing/accessories, overall art style. Do not invent details that are not visible.
Return JSON: {"description": "one dense English paragraph, max 90 words"}`,
  };
}

const SCENE_EXTRAS = (sfxNames) => `- "label": a punchy 2-4 word caption shown at the top of the frame for the whole scene (e.g. "TINY CHEMICAL ATTACK", "TEARS = FLUSH SYSTEM"). Not a copy of the narration.
- "highlight": 1-2 words that appear in that scene's narration and carry the meaning; they will be shown in yellow capitals in the subtitles.
- "sfx": one short sound effect that fits the moment, preferably one of: ${sfxNames.join(', ') || 'whoosh, pop, ding, click, thud, rise, boing'}. Use "" when silence is better; don't put the same effect on every scene.
- "voiceStyle": only when the line needs a special tone (whisper, shocked, laughing); otherwise "".`;

export function explainerScriptPrompt({ channel, project, seconds, sceneSeconds, character, sfxNames = [] }) {
  const scenes = Math.max(4, Math.round(seconds / sceneSeconds));
  const words = Math.round(seconds * 2.5);
  return {
    system: `You are the head writer of a hit faceless animated explainer channel (in the spirit of channels like Pele Explains): one recurring mascot character, simple flat illustrations, friendly curious voice, a strong curiosity loop from the first line, fast pacing, light humor, and a satisfying payoff. ${IDEA_RULES}`,
    prompt: `Write the full video script, split into illustrated scenes.

Channel: ${channel.name}. Topic area: ${channel.niche || 'curious facts about the human body, habits, nature and everyday life'}.
${channel.style ? `Visual style notes: ${channel.style}\n` : ''}Mascot: ${character || 'the channel mascot'}.
Video idea from the owner: ${project.inputs.idea}
${project.inputs.notes ? `Extra wishes: ${project.inputs.notes}\n` : ''}Format: ${project.format === 'short' ? 'vertical YouTube Short' : 'horizontal YouTube video'}, about ${seconds} seconds (~${words} spoken words).
Language: ${channel.language || 'en'}

Requirements:
- Scene 1 is the hook: a surprising question or claim that creates a curiosity gap in the first 3 seconds. No "hello guys", no channel intro.
- About ${scenes} scenes, each ~${sceneSeconds} seconds of narration (1-3 short sentences). Every scene must change the picture.
- "visual" describes ONE simple illustration with the mascot: pose, emotion, props, small background elements, optional red arrow or a 1-3 word label. Keep the mascot central and consistent.
- Facts must be accurate and not exaggerated; if something is a common myth, say so.
- The last scene is a short payoff + soft call to action (subscribe / next video), not a long outro.
${SCENE_EXTRAS(sfxNames)}

Return JSON:
{
  "title": "YouTube title, max 60 characters, curiosity driven, not misleading",
  "voiceStyle": "one line: how the narrator sounds overall (e.g. upbeat, curious, playful, medium-fast)",
  "scenes": [{"narration": "exact voice-over text", "visual": "illustration description", "label": "2-4 WORD TOP LABEL", "highlight": ["1-2 key words from narration"], "sfx": "one sound effect", "voiceStyle": "optional tone for this line"}],
  "thumbnailText": "2-4 words, the thumbnail headline",
  "thumbnailConcept": "what the thumbnail illustration shows (mascot pose + 1-2 props), in English",
  "description": "YouTube description, 2-4 sentences, no hashtags",
  "hashtags": ["#...", "#...", "#..."],
  "tags": ["10-15 tags"]
}`,
  };
}

/** Tayyor sahnalarga (o'zingiz yasagan rasm/ovoz) yorliq, effekt va SEO qo'shish. */
export function annotateScenesPrompt({ channel, project, scenes, sfxNames = [] }) {
  return {
    system: `You are the editor of a hit faceless animated explainer channel. You add on-screen labels, subtitle highlights and sound effects to an existing script, and write its YouTube metadata. ${IDEA_RULES}`,
    prompt: `Annotate these scenes of a ${project.format === 'short' ? 'vertical YouTube Short' : 'horizontal YouTube video'}.

Channel: ${channel.name}. Topic area: ${channel.niche || 'curious explainers'}.
Idea: ${project.inputs.idea || project.title}
Language: ${channel.language || 'en'}

Scenes (narration):
${scenes.map((s, i) => `${i + 1}. ${s.narration || '(no narration)'}`).join('\n')}

Rules:
${SCENE_EXTRAS(sfxNames)}
- Return exactly ${scenes.length} scene objects, in the same order.

Return JSON:
{
  "title": "YouTube title, max 60 characters, curiosity driven, not misleading",
  "scenes": [{"label": "...", "highlight": ["..."], "sfx": "..."}],
  "thumbnailText": "2-4 words",
  "thumbnailConcept": "what the thumbnail illustration shows, in English",
  "description": "YouTube description, 2-4 sentences, no hashtags",
  "hashtags": ["#...", "#...", "#..."],
  "tags": ["10-15 tags"]
}`,
  };
}
