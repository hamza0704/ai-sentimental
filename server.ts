import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

// Heuristic fallback in case Gemini API key is unconfigured or rate limited
function heuristicAnalyze(text: string) {
  const lower = text.toLowerCase();
  const positiveWords = [
    'great', 'good', 'love', 'amazing', 'excellent', 'wonderful', 'happy', 'best',
    'fantastic', 'awesome', 'brilliant', 'delighted', 'pleased', 'perfect', 'superb',
    'excited', 'impressive', 'enjoy', 'favorite', 'beautiful', 'thank', 'thanks'
  ];
  const negativeWords = [
    'bad', 'terrible', 'horrible', 'hate', 'worst', 'awful', 'poor', 'sad', 'angry',
    'disappointed', 'annoying', 'broken', 'useless', 'disaster', 'fails', 'frustrated',
    'boring', 'slow', 'waste', 'ugly', 'disgusting', 'regret', 'issue', 'problem'
  ];

  let posCount = 0;
  let negCount = 0;
  const matchedPhrases: Array<{ phrase: string; sentiment: string; impact: string }> = [];

  positiveWords.forEach(w => {
    if (lower.includes(w)) {
      posCount++;
      matchedPhrases.push({ phrase: w, sentiment: 'Positive', impact: 'High' });
    }
  });

  negativeWords.forEach(w => {
    if (lower.includes(w)) {
      negCount++;
      matchedPhrases.push({ phrase: w, sentiment: 'Negative', impact: 'High' });
    }
  });

  let sentiment: 'Positive' | 'Negative' | 'Neutral' = 'Neutral';
  let polarity = 0;
  let primaryEmotion = 'Neutral / Objective';

  if (posCount > negCount) {
    sentiment = 'Positive';
    polarity = Math.min(1.0, +(0.3 + posCount * 0.25).toFixed(2));
    primaryEmotion = 'Satisfaction & Joy';
  } else if (negCount > posCount) {
    sentiment = 'Negative';
    polarity = Math.max(-1.0, +(-0.3 - negCount * 0.25).toFixed(2));
    primaryEmotion = 'Dissatisfaction & Frustration';
  } else {
    sentiment = 'Neutral';
    polarity = 0.0;
    primaryEmotion = 'Balanced & Neutral';
  }

  return {
    sentiment,
    primaryEmotion,
    confidence: Math.round(75 + Math.min(20, (posCount + negCount) * 5)),
    polarityScore: polarity,
    subjectivity: (posCount + negCount > 0) ? 'Subjective' : 'Objective',
    explanation: `Heuristic classification based on lexical cues (${posCount} positive, ${negCount} negative tokens detected).`,
    emotions: [
      { emotion: sentiment === 'Positive' ? 'Joy' : sentiment === 'Negative' ? 'Frustration' : 'Curiosity', score: 80 },
      { emotion: sentiment === 'Positive' ? 'Optimism' : sentiment === 'Negative' ? 'Disappointment' : 'Calm', score: 65 },
      { emotion: 'Clarity', score: 70 },
    ],
    keyPhrases: matchedPhrases.length > 0 ? matchedPhrases : [{ phrase: text.slice(0, 30), sentiment: 'Neutral', impact: 'Medium' }],
    suggestions: sentiment === 'Negative' 
      ? 'Consider phrasing critiques constructively with actionable suggestions.' 
      : sentiment === 'Positive'
      ? 'Expressing genuine gratitude reinforces strong engagement.'
      : 'Adding illustrative examples or opinion markers can bring more warmth or clarity.',
    modelSource: 'Local Heuristic (Gemini key not configured or temporarily unavailable)',
  };
}

// API endpoint to analyze sentiment
app.post('/api/analyze', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Please provide a non-empty sentence or text to analyze.' });
  }

  const trimmedText = text.trim();

  if (!ai) {
    // Return heuristic response when no API key is present
    return res.json(heuristicAnalyze(trimmedText));
  }

  const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError: unknown = null;

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `Analyze the sentiment, emotions, and linguistic tones of this sentence/text:\n\n"${trimmedText}"`,
        config: {
          systemInstruction:
            'You are a specialized NLP text sentiment classification engine. ' +
            'Evaluate the input text and return a structured JSON response. ' +
            'The "sentiment" field must be strictly one of: "Positive", "Negative", or "Neutral". ' +
            'Calculate an accurate confidence percentage (0-100), ' +
            'a polarityScore from -1.0 (maximum negative) to +1.0 (maximum positive) where 0.0 is pure neutral, ' +
            'a concise primaryEmotion label, ' +
            'subjectivity ("Objective" or "Subjective"), ' +
            'top 3-4 emotional nuances with intensity scores (0-100), ' +
            'key phrases or tokens with sentiment and impact ("High", "Medium", "Low"), ' +
            'a crisp 1-2 sentence explanation of why this emotion and sentiment was classified, ' +
            'and a constructive suggestion on tone if appropriate.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sentiment: {
                type: Type.STRING,
                description: "Must be strictly 'Positive', 'Negative', or 'Neutral'",
              },
              primaryEmotion: {
                type: Type.STRING,
                description: "Short label for the primary emotion detected (e.g., 'Joy & Gratitude', 'Frustration', 'Impartial Observation')",
              },
              confidence: {
                type: Type.NUMBER,
                description: 'Confidence level from 0 to 100',
              },
              polarityScore: {
                type: Type.NUMBER,
                description: 'Polarity index between -1.00 and 1.00',
              },
              subjectivity: {
                type: Type.STRING,
                description: "'Objective' or 'Subjective'",
              },
              explanation: {
                type: Type.STRING,
                description: 'Concise explanation justifying the sentiment classification',
              },
              emotions: {
                type: Type.ARRAY,
                description: 'Key emotional components and their intensity scores (0 to 100)',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    emotion: { type: Type.STRING },
                    score: { type: Type.NUMBER },
                  },
                  required: ['emotion', 'score'],
                },
              },
              keyPhrases: {
                type: Type.ARRAY,
                description: 'Tokens or sub-phrases heavily influencing sentiment',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    phrase: { type: Type.STRING },
                    sentiment: { type: Type.STRING, description: "'Positive', 'Negative', or 'Neutral'" },
                    impact: { type: Type.STRING, description: "'High', 'Medium', or 'Low'" },
                  },
                  required: ['phrase', 'sentiment', 'impact'],
                },
              },
              suggestions: {
                type: Type.STRING,
                description: 'Helpful rewrite or tone tip',
              },
            },
            required: [
              'sentiment',
              'primaryEmotion',
              'confidence',
              'polarityScore',
              'subjectivity',
              'explanation',
              'emotions',
              'keyPhrases',
            ],
          },
        },
      });

      const rawJson = response.text?.trim() || '{}';
      const parsed = JSON.parse(rawJson);

      // Normalize sentiment value
      let sentiment: 'Positive' | 'Negative' | 'Neutral' = 'Neutral';
      if (parsed.sentiment?.toLowerCase() === 'positive') sentiment = 'Positive';
      else if (parsed.sentiment?.toLowerCase() === 'negative') sentiment = 'Negative';
      else sentiment = 'Neutral';

      return res.json({
        ...parsed,
        sentiment,
        modelSource: `Google Cloud (${model})`,
      });
    } catch (err: unknown) {
      lastError = err;
      console.warn(`Model ${model} failed, trying next...`);
    }
  }

  console.error('All Gemini models failed:', lastError);
  const fallback = heuristicAnalyze(trimmedText);
  return res.json({
    ...fallback,
    warning: 'Processed via fallback engine due to upstream API response delay.',
  });
});

// Setup Vite in development or static serve in production
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Sentiment Analyzer server running on http://localhost:${port}`);
});
