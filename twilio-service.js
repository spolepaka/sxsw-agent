import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormBody from '@fastify/formbody';
import dotenv from 'dotenv';
import twilio from 'twilio';
import OpenAI from 'openai';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { FormData } from 'formdata-node';
import { Blob } from 'buffer';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import fetch from 'node-fetch';

// Helper function to convert stream to audio buffer
async function getAudioBuffer(response) {
  const reader = response.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const dataArray = chunks.reduce(
    (acc, chunk) => Uint8Array.from([...acc, ...chunk]),
    new Uint8Array(0)
  );

  return Buffer.from(dataArray.buffer);
}

// Direct TTS API call using Deepgram
async function textToSpeechDirect(text, options = {}) {
  logger.debug('Converting text to speech using direct API call', { 
    text: text?.substring(0, 50) + (text?.length > 50 ? '...' : ''), 
    textLength: text?.length 
  });
  
  if (!text || text.trim().length === 0) {
    logger.warn('Empty text provided to TTS, skipping');
    return Buffer.alloc(0);
  }
  
  try {
    // Configure TTS options
    const ttsConfig = {
      model: options.model || "aura-asteria-en",
      encoding: options.encoding || "mulaw",
      container: "none",
      sample_rate: options.sampleRate || 8000
    };
    
    logger.debug('Making Deepgram TTS request', { 
      config: ttsConfig,
      textLength: text.length
    });
    
    // Make the request using the Deepgram SDK
    const response = await deepgram.speak.request(
      { text: text },
      ttsConfig
    );
    
    // Get the audio stream
    const stream = await response.getStream();
    
    // Convert stream to buffer
    const reader = stream.getReader();
    const chunks = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const dataArray = chunks.reduce(
      (acc, chunk) => Uint8Array.from([...acc, ...chunk]),
      new Uint8Array(0)
    );
    
    const buffer = Buffer.from(dataArray.buffer);
    
    logger.debug('TTS API call successful', { 
      responseSize: buffer.length,
      inputTextLength: text?.length,
      hasAudio: buffer.length > 0
    });
    
    return buffer;
  } catch (error) {
    logger.error('Error in direct TTS API call', { 
      error: error.message,
      stack: error.stack?.substring(0, 200),
      text: text?.substring(0, 100) + (text?.length > 100 ? '...' : '')
    });
    throw error;
  }
}

// Function to convert text to speech using Deepgram API
async function textToSpeech(text, options = {}) {
  logger.debug('Converting text to speech', { text, length: text.length });
  
  if (!text || text.trim().length === 0) {
    logger.warn('Empty text provided to TTS, skipping');
    return Buffer.alloc(0);
  }
  
  try {
    // Use the direct API call for TTS
    return await textToSpeechDirect(text, options);
  } catch (error) {
    logger.error('Error in textToSpeech', { error: error.message, text });
    throw error;
  }
}

// Load environment variables
dotenv.config();

// Configure logging
const LOG_LEVELS = {
  ERROR: 0,   // Only errors
  WARN: 1,    // Errors and warnings
  INFO: 2,    // Normal operational messages (default)
  DEBUG: 3,    // Detailed debugging information
  TRACE: 4    // Very verbose, includes all data
};

// Set the default log level to INFO (2)
const logLevel = process.env.LOG_LEVEL ? 
  (LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] || LOG_LEVELS.INFO) : 
  LOG_LEVELS.INFO;

// Logging utility
const logger = {
  error: (message, data) => {
    if (logLevel >= LOG_LEVELS.ERROR) {
      console.error(`[ERROR] ${message}`, data || '');
    }
  },
  warn: (message, data) => {
    if (logLevel >= LOG_LEVELS.WARN) {
      console.warn(`[WARN] ${message}`, data || '');
    }
  },
  info: (message, data) => {
    if (logLevel >= LOG_LEVELS.INFO) {
      console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : '');
    }
  },
  debug: (message, data) => {
    if (logLevel >= LOG_LEVELS.DEBUG) {
      console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
    }
  },
  trace: (message, data) => {
    if (logLevel >= LOG_LEVELS.TRACE) {
      console.log(`[TRACE] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }
};

// Debug log environment variables
logger.debug('Environment variables loaded', {
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY ? 'Set' : 'Not set',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'Set' : 'Not set'
});

logger.info(`Starting Twilio Test Service with log level: ${Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === logLevel)}`);

const VoiceResponse = twilio.twiml.VoiceResponse;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
// Initialize Deepgram client
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const fastify = Fastify({
  logger: true
});

// Register plugins
await fastify.register(fastifyWebsocket);
await fastify.register(fastifyFormBody);

// Helper function to optimize text for natural-sounding TTS
function optimizeTextForSpeech(text) {
  if (!text || text.trim().length === 0) {
    return text;
  }

  // SXSW-specific term handling
  text = text.replace(/\bSXSW\b/g, 'South by Southwest');
  text = text.replace(/\bAI\b/g, 'A.I.');
  text = text.replace(/\bUI\/UX\b/gi, 'U.I. U.X.');
  text = text.replace(/\bWeb3\b/gi, 'Web Three');
  
  // Add pauses after important terms
  const importantTerms = [
    'keynote',
    'performance',
    'panel',
    'workshop',
    'showcase',
    'premiere',
    'festival',
    'conference',
    'session'
  ];
  
  const termPattern = new RegExp(`\\b(${importantTerms.join('|')})\\b`, 'gi');
  text = text.replace(termPattern, '$1...');

  // Ensure proper spacing after punctuation
  text = text.replace(/([.,!?])([^\s])/g, '$1 $2');
  
  // Clean up any double commas
  text = text.replace(/,\s*,/g, ',');
  
  // Ensure natural breaks for numerical information
  text = text.replace(/(\d+)([.,])(\d+)/g, '$1$2 $3');
  
  // Break up very long sentences
  const maxSentenceLength = 100;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  let result = '';
  
  for (const sentence of sentences) {
    if (sentence.length > maxSentenceLength) {
      // Find a natural breaking point near the middle
      const midPoint = Math.floor(sentence.length / 2);
      const breakPoint = sentence.indexOf(' ', midPoint);
      
      if (breakPoint !== -1) {
        const firstHalf = sentence.substring(0, breakPoint);
        const secondHalf = sentence.substring(breakPoint + 1);
        result += `${firstHalf}... ${secondHalf} `;
        continue;
      }
    }
    result += sentence + ' ';
  }
  
  // Add slight pauses for lists
  text = text.replace(/,\s*and\s/g, '... and ');
  
  // Ensure natural rhythm for time expressions
  text = text.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi, '$1... $2... $3');
  
  return result.trim() || text.trim();
}

// Store conversation history
const conversationHistory = new Map();

// Initialize the enhanced system prompt for more natural conversation
const systemPrompt = `You are an enthusiastic, friendly, and knowledgeable assistant for SXSW 2025, the premier event celebrating innovation in technology, film, music, and culture in Austin, Texas.

RESPONSE FORMAT (STRICT JSON):
You MUST format ALL responses as valid JSON objects with the following structure:
{
  "response": "your actual response text here",
  "end_conversation": boolean
}

IMPORTANT: 
- The response MUST be a valid JSON object
- Do NOT include any text outside the JSON structure
- Do NOT include markdown or other formatting
- Include all punctuation and formatting within the "response" string
- The "end_conversation" boolean must be true or false

Example valid response:
{
  "response": "Hey there! I'd love to tell you about the AI events at SXSW 2025. What specific aspects interest you the most?",
  "end_conversation": false
}

Set "end_conversation" to true when:
- The user explicitly says goodbye or indicates they're done
- The user has no more questions after you've answered their query
- You've provided all requested information and the user seems satisfied
- Natural conversation end point is reached

CONVERSATIONAL STYLE GUIDELINES:
1. Start by asking short, clarifying questions to clearly understand what the user is looking for.
2. Validate the user's intent clearly before providing detailed information.
3. After providing information, validate again by asking if the response answered their question.
4. Use a casual, upbeat, and engaging tone—think friendly festival guide.
5. Include natural pauses using commas and ellipses (. . .) to mimic conversational rhythm.
6. Break responses into short, digestible sentences.
7. Use contractions (I'm, you're, let's) to maintain a relaxed, conversational feel.
8. Highlight exciting events, keynotes, performances, and interactive experiences at SXSW 2025.
9. Use exclamation marks sparingly to emphasize particularly exciting or unique events.
10. Avoid overly complex punctuation or jargon that doesn't translate well to speech.
11. Insert occasional verbal fillers like "um," "uh," "well," or "you know" to sound more human.

When ending the conversation:
- Provide a contextual goodbye based on what was discussed
- Thank the user for their interest
- Wish them a great time at SXSW 2025
- Keep the farewell message concise and friendly

KEY SXSW 2025 HIGHLIGHTS:
- Interactive Track: AI & emerging tech showcases
- Film & TV Festival: Premieres and screenings
- Music Festival: Live performances across Austin
- Keynote speakers and industry leaders
- Networking events and creative meetups
- Innovation awards and competitions
- Special focus on sustainability and future tech

Provide concise, helpful, and engaging information about SXSW 2025 events, speakers, performances, venues, and Austin's local attractions relevant to attendees.`;

// Global state for transcription and processing
const transcriptionBuffer = {
  text: '',
  lastUpdateTime: Date.now(),
  processingTimer: null
};

// Add a set to track previously processed queries
const previousQueries = new Set();

// Track global call timing
let callStartTime = Date.now();

// Constants for transcription processing
const TRANSCRIPTION_TIMEOUT = 2000; // 2 seconds of silence to consider a thought complete
const SENTENCE_ENDINGS = ['.', '?', '!'];
const MINIMUM_QUERY_LENGTH = 3; // Words
const ENERGY_THRESHOLD = 0.2; // Energy threshold for VAD
const SPEECH_FRAMES_THRESHOLD = 3; // Number of frames needed to detect speech
const MINIMUM_COMPLETE_SENTENCE_LENGTH = 5; // Minimum words for a confident complete sentence
const INTERRUPTION_GRACE_PERIOD = 1000; // 1 second grace period before allowing interruptions

// Voice activity detection state
const vadState = {
  isSpeaking: false,
  speechFrames: 0,
  silenceFrames: 0,
  lastSpeechTime: Date.now()
};

// Track last time user was speaking to manage interruptions
let lastUserSpeechTime = Date.now();
let isResponding = false;
let responseInProgress = false; // Add lock for active responses

// Transcription buffer to accumulate user speech

// Helper function to determine if we should process immediately
function shouldProcessTranscription(text) {
  // Check for complete sentences in the text
  const containsCompleteSentence = SENTENCE_ENDINGS.some(ending => {
    // Look for sentence endings not at the very end of the text
    const lastIndex = text.lastIndexOf(ending);
    return lastIndex !== -1 && lastIndex >= MINIMUM_COMPLETE_SENTENCE_LENGTH && lastIndex < text.length - 1;
  });
  
  // Check if ends with a sentence terminator
  const endsWithSentenceMarker = SENTENCE_ENDINGS.some(ending => text.trim().endsWith(ending));
  
  // Check if it's a substantial query (contains enough words)
  const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
  
  // Process if it's a complete sentence or a substantial query
  return (endsWithSentenceMarker || containsCompleteSentence) && wordCount >= MINIMUM_QUERY_LENGTH;
}

// Function to detect voice activity from audio data
function detectVoiceActivity(audioBuffer) {
  // Simple energy-based VAD
  let energy = 0;
  const samples = new Int16Array(audioBuffer.buffer);
  
  // Calculate energy
  for (let i = 0; i < samples.length; i++) {
    energy += Math.abs(samples[i]) / samples.length;
  }
  
  // Normalize energy to 0-1 range (16-bit audio)
  const normalizedEnergy = energy / 32768;
  
  // Return true if energy is above threshold
  return normalizedEnergy > ENERGY_THRESHOLD;
}

// Add SXSW-specific logging categories
const SXSW_CATEGORIES = {
  INTERACTIVE: ['tech', 'ai', 'web3', 'startup', 'innovation', 'digital'],
  FILM: ['movie', 'film', 'premiere', 'screening', 'director', 'actor'],
  MUSIC: ['concert', 'performance', 'band', 'artist', 'music', 'live'],
  CONFERENCE: ['keynote', 'panel', 'speaker', 'session', 'workshop'],
  NETWORKING: ['meetup', 'party', 'networking', 'social', 'mixer'],
  VENUE: ['location', 'venue', 'center', 'hall', 'stage', 'room']
};

// Helper function to categorize SXSW queries
function categorizeSXSWQuery(query) {
  const categories = new Set();
  const lowercaseQuery = query.toLowerCase();
  
  Object.entries(SXSW_CATEGORIES).forEach(([category, keywords]) => {
    if (keywords.some(keyword => lowercaseQuery.includes(keyword))) {
      categories.add(category);
    }
  });
  
  return Array.from(categories);
}

// Add global flags to track state
let callTerminationInProgress = false;
let connectionClosed = false;

// Improved closeConnectionSafely function to better handle race conditions
function closeConnectionSafely(socket, streamSid, deepgramLive, startTime, packetCount) {
  // Use a static variable to ensure we only close once per streamSid
  closeConnectionSafely.closedConnections = closeConnectionSafely.closedConnections || new Set();
  
  // Check if this specific connection has already been closed
  if (closeConnectionSafely.closedConnections.has(streamSid)) {
    logger.debug('Connection for streamSid already closed, skipping', { streamSid });
    return;
  }
  
  // Mark this connection as closed
  closeConnectionSafely.closedConnections.add(streamSid);
  
  // Schedule cleanup of the closedConnections set to prevent memory leaks
  setTimeout(() => {
    closeConnectionSafely.closedConnections.delete(streamSid);
  }, 60000); // Clean up after 1 minute
  
  try {
    // Clean up Deepgram if needed
    if (deepgramLive && !deepgramLive.isClosed) {
      try {
        deepgramLive.finish();
        deepgramLive.isClosed = true;
        logger.info('Deepgram connection closed');
      } catch (e) {
        logger.error('Error closing Deepgram connection', { error: e.message });
      }
    }
    
    // Log call statistics
    const duration = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
    logger.info('Call completed', { 
      streamSid, 
      callDuration: `${duration}s`,
      audioPackets: packetCount || 0
    });
    
    // Close WebSocket connection if not already closed
    if (socket && socket.readyState !== 3) { // 3 = CLOSED
      socket.close();
      logger.info('WebSocket connection closed');
    }
  } catch (err) {
    logger.error('Error during connection closure', { error: err.message });
  }
}

// Updated terminateCall function
async function terminateCall(socket, streamSid, deepgramLive, startTime, packetCount) {
  try {
    // Send stop event to Twilio
    socket.send(JSON.stringify({
      event: 'stop',
      streamSid: streamSid
    }));
    
    // Send mark event to signal call termination to Twilio
    socket.send(JSON.stringify({
      event: 'mark',
      streamSid: streamSid,
      mark: {
        name: 'terminate_call'
      }
    }));
    
    logger.info('Call termination signals sent', { streamSid });
    
    // Wait a moment to ensure messages are sent before closing
    setTimeout(() => {
      closeConnectionSafely(socket, streamSid, deepgramLive, startTime, packetCount);
    }, 2000);
  } catch (error) {
    logger.error('Error terminating call', {
      error: error.message,
      streamSid
    });
    // Still try to close the connection
    closeConnectionSafely(socket, streamSid, deepgramLive, startTime, packetCount);
  }
}

// Updated sendFinalGreetingAndTerminateCall function
async function sendFinalGreetingAndTerminateCall(socket, streamSid, finalMessage, deepgramLive, startTime, packetCount) {
  try {
    // Prevent duplicate termination
    if (callTerminationInProgress) {
      logger.info('Call termination already in progress, skipping duplicate request');
      return;
    }
    
    callTerminationInProgress = true;
    logger.info('Sending final greeting before termination', { 
      message: finalMessage?.substring(0, 100),
      streamSid 
    });

    // Optimize text for speech
    const optimizedText = optimizeTextForSpeech(finalMessage);
    
    // Convert final message to speech
    const ttsConfig = {
      model: "aura-asteria-en",
      encoding: "mulaw",
      container: "none",
      sample_rate: 8000
    };
    
    const response = await deepgram.speak.request(
      { text: optimizedText },
      ttsConfig
    );
    
    const stream = await response.getStream();
    const audioBuffer = await getAudioBuffer(stream);
    
    // Send final audio in chunks
    const chunkSize = 1600;
    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.slice(i, i + chunkSize);
      socket.send(JSON.stringify({
        event: 'media',
        streamSid: streamSid,
        media: {
          payload: chunk.toString('base64')
        }
      }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Wait a moment to ensure audio is played
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Terminate the call
    await terminateCall(socket, streamSid, deepgramLive, startTime, packetCount);
  } catch (error) {
    logger.error('Error in final greeting and termination', {
      error: error.message,
      streamSid
    });
    // Attempt to terminate call even if there was an error
    await terminateCall(socket, streamSid, deepgramLive, startTime, packetCount);
  } finally {
    callTerminationInProgress = false;
  }
}

// Update the processBufferedTranscription function to avoid duplicate final greeting
async function processBufferedTranscription(socket, sid, chatHistory, deepgramLive, startTime, packetCount) {
  const query = transcriptionBuffer.text.trim();
  
  // Skip if already processed
  if (previousQueries.has(query)) {
    logger.info('Skipping duplicate query', { query });
    return;
  }
  
  // Enhanced SXSW-specific logging
  const queryCategories = categorizeSXSWQuery(query);
  logger.info('Processing SXSW query', { 
    query,
    categories: queryCategories,
    timestamp: new Date().toISOString(),
    sessionDuration: Math.round((Date.now() - callStartTime) / 1000)
  });
  
  // Skip if response in progress
  if (responseInProgress) {
    logger.info('Response in progress, queuing query', { 
      query,
      categories: queryCategories
    });
    return;
  }
  
  // Add this query to the set of processed queries
  previousQueries.add(query);
  
  logger.info('Processing complete user query', { query });
  
  // Add user's query to conversation history
  chatHistory.push({ role: 'user', content: query });
  
  try {
    // Set response in progress flag to prevent concurrent responses
    responseInProgress = true;
    
    // Get response from ChatGPT
    logger.info('Requesting ChatGPT response');
    const chatStartTime = Date.now();
    
    try {
      // Set the responding flag to true AFTER a short delay to avoid false interruptions
      await new Promise(resolve => setTimeout(resolve, 500));
      isResponding = true;
      
      // Check again if we've been interrupted during the delay
      if (!isResponding) {
        logger.info('Response interrupted during startup delay');
        responseInProgress = false;
        return;
      }
      
      // Create messages array with system prompt
      const messages = [
        { 
          role: 'system', 
          content: systemPrompt + "\n\nREMINDER: Format your response as a valid JSON object with 'response' and 'end_conversation' fields."
        },
        ...chatHistory
      ];
      
      logger.debug('Sending request to OpenAI', { messageCount: messages.length });
      
      const openAIStream = await openai.chat.completions.create({
        model: 'gpt-4-1106-preview',  // Updated to latest model that supports JSON mode
        messages: messages,
        max_tokens: 250,
        temperature: 0.8,
        stream: true,
        presence_penalty: 0.6,
        frequency_penalty: 0.5,
        response_format: { type: "json_object" },  // This enforces JSON output
        seed: 42  // Optional: for more consistent responses
      });

      let fullResponse = '';
      let accumulatedText = '';
      let sentenceBuffer = '';
      let jsonBuffer = '';
      const MINIMUM_CHUNK_SIZE = 50;

      for await (const chunk of openAIStream) {
        if (!isResponding) {
          logger.info('Response interrupted by user during streaming');
          await stopTTSAndClearAudio(socket, sid);
          break;
        }
        
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          jsonBuffer += content;
          
          // Try to parse complete JSON objects as they come in
          try {
            // Check if we have a complete JSON object
            const parsedJson = JSON.parse(jsonBuffer);
            if (parsedJson && parsedJson.response) {
              // If we have a valid response, update the sentence buffer with just the response text
              sentenceBuffer += parsedJson.response;
              // Clear the JSON buffer since we've processed it
              jsonBuffer = '';
            }
          } catch (e) {
            // Not a complete JSON object yet, continue collecting
          }
          
          logger.debug('Received content chunk', { content });
          
          // Process complete sentences for TTS
          if (
            sentenceBuffer.includes('.') || 
            sentenceBuffer.includes('?') || 
            sentenceBuffer.includes('!') || 
            sentenceBuffer.length > MINIMUM_CHUNK_SIZE
          ) {
            const textToProcess = sentenceBuffer.trim();
            if (textToProcess.length > 0) {
              try {
                const audioBuffer = await textToSpeechDirect(textToProcess);
                if (audioBuffer.length > 0) {
                  const chunkSize = 1600;
                  for (let i = 0; i < audioBuffer.length && isResponding; i += chunkSize) {
                    const chunk = audioBuffer.slice(i, i + chunkSize);
                    socket.send(JSON.stringify({
                      event: 'media',
                      streamSid: sid,
                      media: {
                        payload: chunk.toString('base64')
                      }
                    }));
                    await new Promise(resolve => setTimeout(resolve, 100));
                  }
                }
              } catch (ttsError) {
                logger.error('Error in TTS streaming', { error: ttsError });
                await stopTTSAndClearAudio(socket, sid);
              }
            }
            sentenceBuffer = '';
          }
        }
      }

      // Process the complete response
      try {
        const parsedResponse = JSON.parse(fullResponse);
        logger.info('Parsed ChatGPT response', { 
          response: parsedResponse.response?.substring(0, 100) + '...',
          end_conversation: parsedResponse.end_conversation 
        });

        // Add assistant's response to conversation history
        chatHistory.push({ role: 'assistant', content: parsedResponse.response });
        
        // If conversation should end, directly terminate the call without
        // sending an additional final greeting (since we already streamed the farewell)
        if (parsedResponse.end_conversation) {
          logger.info('Conversation end detected, initiating termination');
          
          // Wait a moment to ensure the audio finishes playing
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Terminate call directly without sending additional greeting
          await terminateCall(socket, sid, deepgramLive, startTime, packetCount);
        }
      } catch (parseError) {
        logger.error('Error parsing ChatGPT response as JSON', {
          error: parseError.message,
          response: fullResponse?.substring(0, 200)
        });
        // Continue without terminating if parsing fails
      }

      // Reset response flags
      isResponding = false;
      responseInProgress = false;

      logger.debug('ChatGPT response time', { ms: Date.now() - chatStartTime });
    } catch (error) {
      logger.error('Error in ChatGPT streaming', { error });
      // Make sure to reset responseInProgress in case of errors
      isResponding = false;
      responseInProgress = false;
      // Clear any audio on error
      await stopTTSAndClearAudio(socket, sid);
      
      logger.error('Error in ChatGPT streaming', { error });
    }
  } catch (error) {
    // Reset the locks
    isResponding = false;
    responseInProgress = false;
    
    // Clear any audio on error
    await stopTTSAndClearAudio(socket, sid);
    
    logger.error('Error in processBufferedTranscription', {
      error: error.message,
      stack: error.stack
    });
  } finally {
    // Reset the transcription buffer after processing
    transcriptionBuffer.text = '';
    transcriptionBuffer.lastUpdateTime = Date.now();
    if (transcriptionBuffer.processingTimer) {
      clearTimeout(transcriptionBuffer.processingTimer);
      transcriptionBuffer.processingTimer = null;
    }
    logger.debug('Transcription buffer reset');
  }
}

// Helper function to stop any ongoing TTS processing and clear audio buffers
async function stopTTSAndClearAudio(socket, streamSid) {
  // Send clear message to Twilio to immediately stop audio playback
  if (socket && streamSid) {
    socket.send(JSON.stringify({
      event: 'clear',
      streamSid: streamSid
    }));
    logger.info('Sent clear message to stop Twilio audio playback', { streamSid });
  }
}

// Root endpoint
fastify.get('/', async (request, reply) => {
  return { message: 'Twilio Test Service is running!' };
});

// Handle incoming calls
fastify.post('/incoming-call', async (request, reply) => {
  logger.info('Call received', { from: request.body.From, to: request.body.To });
  const twiml = new VoiceResponse();
  
  // Set up WebSocket connection for media
  const connect = twiml.connect();
  const streamUrl = `wss://${request.headers.host}/media-stream`;
  connect.stream({ url: streamUrl });

  // Store initial greeting in conversation history for this call
  const callId = request.body.CallSid;
  conversationHistory.set(callId, [
    { role: 'system', content: 'You are a knowledgeable Austin tourism assistant. Provide helpful, concise information about attractions, events, food, and activities in Austin, Texas. Keep responses brief and engaging.' },
    { role: 'assistant', content: 'Hello! How can I help you explore Austin today?' }
  ]);

  logger.info('TwiML response generated', { streamUrl });
  reply.header('Content-Type', 'application/xml');
  return twiml.toString();
});

// WebSocket endpoint for media streaming
fastify.get('/media-stream', { websocket: true }, (connection, req) => {
  logger.info('WebSocket connection established');
  let streamSid = null;
  let audioPacketCount = 0;
  let isProcessingResponse = false;
  let audioQueue = []; // Queue to store audio packets before Deepgram is ready
  callStartTime = Date.now(); // Reset call start time for new connections
  let lastTranscriptionTime = null;
  let initialGreetingSent = false;
  callTerminationInProgress = false; // Reset termination flag for new connections
  connectionClosed = false; // Reset connection closed flag

  // Initialize conversation history for this connection
  const chatHistory = [
    { role: 'system', content: systemPrompt }
  ];
  
  // Function to send the initial greeting - defined inside WebSocket handler
  async function sendInitialGreeting(sid) {
    if (!sid || initialGreetingSent) return;
    
    // Choose one of these creative SXSW 2025 greetings
    const greetingOptions = [
      'Hey there! Welcome to SXSW 2025. What can I help you discover today?',
      'Hi! I\'m your SXSW 2025 guide. What part of the festival are you curious about?',
      'Welcome to South by Southwest 2025! What brings you to the festival?',
      'Hey festival-goer! Your SXSW 2025 assistant here. What can I help you with?',
      'Hello! Ready to explore SXSW 2025? What are you interested in checking out?'
    ];
    
    // Select a random greeting from the options
    const greeting = greetingOptions[Math.floor(Math.random() * greetingOptions.length)];
    
    logger.info('Sending initial greeting');
    try {
      const ttsConfig = {
        model: "aura-asteria-en",
        encoding: "mulaw",
        container: "none",
        sample_rate: 8000
      };
      
      const response = await deepgram.speak.request(
        { text: greeting },
        ttsConfig
      );
      
      const stream = await response.getStream();
      const audioBuffer = await getAudioBuffer(stream);
      
      // Send greeting audio in chunks
      const chunkSize = 1600;
      for (let i = 0; i < audioBuffer.length; i += chunkSize) {
        const chunk = audioBuffer.slice(i, i + chunkSize);
        connection.socket.send(JSON.stringify({
          event: 'media',
          streamSid: sid,
          media: {
            payload: chunk.toString('base64')
          }
        }));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      initialGreetingSent = true;
      
      // Add greeting to chat history
      chatHistory.push({ role: 'assistant', content: greeting });
      logger.info('Initial greeting sent successfully');
      
    } catch (error) {
      logger.error('Error sending initial greeting', {
        message: error.message,
        stack: error.stack
      });
    }
  }

  // Set up initial message handling for before Deepgram is ready
  connection.socket.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      // Log non-media events
      if (data.event !== 'media') {
        logger.debug('WebSocket event (pre-Deepgram)', { event: data.event });
      }

      if (data.event === 'start') {
        streamSid = data.streamSid;
        logger.info('Stream started (pre-Deepgram)', { streamSid });
        // Send initial greeting even if Deepgram isn't ready yet
        await sendInitialGreeting(streamSid);
      }
      
      // Queue audio data until Deepgram is ready
      if (data.event === 'media' && data.media && data.media.payload) {
        const audioData = Buffer.from(data.media.payload, 'base64');
        audioQueue.push(audioData);
        
        if (audioQueue.length % 500 === 0) {
          logger.debug('Audio packets queued', { count: audioQueue.length });
        }
      }
    } catch (error) {
      logger.error('Error in initial message processing', { error: error.message });
    }
  });

  logger.info('Initializing Deepgram');
  // Set up Deepgram connection with detailed configuration
  const deepgramConfig = {
    model: "nova-3",  // Upgraded from nova-2 for better accuracy
    smart_format: true,
    encoding: "mulaw",
    sample_rate: 8000,
    channels: 1,
    punctuate: true,
    interim_results: false
  };
  
  const deepgramLive = deepgram.listen.live(deepgramConfig);
  logger.debug('Deepgram configuration', deepgramConfig);

  // Handle Deepgram connection open
  deepgramLive.addListener(LiveTranscriptionEvents.Open, () => {
    logger.info('Deepgram connection opened');

    // Process any queued audio packets
    if (audioQueue.length > 0) {
      logger.info(`Processing queued audio packets`, { count: audioQueue.length });
      audioQueue.forEach(audioData => {
        deepgramLive.send(audioData);
      });
      audioQueue = []; // Clear the queue
    }

    // Now that Deepgram is ready, set up WebSocket message handling
    connection.socket.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        
        // Log non-media events
        if (data.event !== 'media') {
          logger.debug('WebSocket event received', { event: data.event });
        }

        if (data.event === 'start') {
          streamSid = data.streamSid;
          logger.info('Stream started', { streamSid });
          // Send initial greeting using Deepgram TTS
          await sendInitialGreeting(streamSid);
        }
        
        // Handle media events from the user
        if (data.event === 'media' && data.media && data.media.payload) {
          audioPacketCount++;
          
          // Log audio packet information periodically at DEBUG level
          if (audioPacketCount % 500 === 0) {
            logger.debug('Audio packets processed', { 
              count: audioPacketCount, 
              callDuration: `${Math.round((Date.now() - callStartTime) / 1000)}s` 
            });
          }
          
          // Send the audio data to Deepgram for transcription
          const audioData = Buffer.from(data.media.payload, 'base64');
          
          // Perform voice activity detection
          const isSpeechDetected = detectVoiceActivity(audioData);
          
          // Update VAD state
          if (isSpeechDetected) {
            vadState.speechFrames++;
            vadState.silenceFrames = 0;
            vadState.lastSpeechTime = Date.now();
            lastUserSpeechTime = Date.now(); // Update last user speech time
            
            // Detect start of speech
            if (!vadState.isSpeaking && vadState.speechFrames >= SPEECH_FRAMES_THRESHOLD) {
              vadState.isSpeaking = true;
              logger.debug('Speech detected');
              
              // Check if system is currently responding and user is interrupting
              if (isResponding) {
                // Only treat as interruption if sufficient time has passed since the user last spoke
                const timeSinceLastSpeech = Date.now() - lastUserSpeechTime;
                if (timeSinceLastSpeech > INTERRUPTION_GRACE_PERIOD) {
                  logger.info('User interruption detected');
                  
                  // Cancel the current response
                  isResponding = false;
                  responseInProgress = false; // Also reset the response lock
                  
                  // Stop TTS and clear audio buffers
                  await stopTTSAndClearAudio(connection.socket, streamSid);
                  
                  // Log that we're stopping the response
                  logger.info('Response interrupted by user');
                  
                  // Clear any processing timers
                  if (transcriptionBuffer.processingTimer) {
                    clearTimeout(transcriptionBuffer.processingTimer);
                    transcriptionBuffer.processingTimer = null;
                  }
                } else {
                  logger.debug('Speech detected but within grace period, not treating as interruption');
                }
              }
            }
          } else {
            vadState.silenceFrames++;
            vadState.speechFrames = 0;
            
            // Detect end of speech
            if (vadState.isSpeaking && Date.now() - vadState.lastSpeechTime > TRANSCRIPTION_TIMEOUT) {
              vadState.isSpeaking = false;
              logger.debug('Silence detected');
              
              // If we have buffered text and no timer is set, start one
              if (transcriptionBuffer.text && !transcriptionBuffer.processingTimer) {
                logger.debug('Starting processing timer due to silence detection');
                transcriptionBuffer.processingTimer = setTimeout(async () => {
                  // Only process if there's been no new transcription for a while
                  if (Date.now() - transcriptionBuffer.lastUpdateTime >= TRANSCRIPTION_TIMEOUT) {
                    await processBufferedTranscription(connection.socket, streamSid, conversationHistory.get(streamSid) || [], deepgramLive, callStartTime, audioPacketCount);
                  }
                  transcriptionBuffer.processingTimer = null;
                }, TRANSCRIPTION_TIMEOUT / 2); // Use a shorter timeout when VAD detects silence
              }
            }
          }
          
          // Send the audio to Deepgram for transcription
          deepgramLive.send(audioData);
        }
        
        // Handle stop event
        if (data.event === 'stop') {
          logger.info('Stream stopped', { 
            streamSid, 
            duration: `${Math.round((Date.now() - callStartTime) / 1000)}s`,
            audioPackets: audioPacketCount 
          });
          deepgramLive.finish();
        }
      } catch (error) {
        logger.error('Error processing WebSocket message', { 
          message: error.message, 
          stack: error.stack 
        });
      }
    });

    // Handle transcription results
    deepgramLive.addListener(LiveTranscriptionEvents.Transcript, async (transcription) => {
      logger.debug('Transcription received');
      logger.trace('Raw transcription data', transcription);
      
      if (!transcription.channel?.alternatives?.length) {
        logger.warn('Empty transcription received');
        return;
      }
      
      const transcript = transcription.channel.alternatives[0].transcript;
      const confidence = transcription.channel.alternatives[0].confidence || 0;
      
      if (transcript) {
        lastTranscriptionTime = Date.now();
        logger.info('Transcription', { 
          text: transcript, 
          confidence: confidence.toFixed(2),
          isFinal: transcription.is_final ? 'Yes' : 'No' 
        });
        
        // Add to buffer with a space if needed
        if (transcriptionBuffer.text) {
          transcriptionBuffer.text += ' ' + transcript;
        } else {
          transcriptionBuffer.text = transcript;
        }
        transcriptionBuffer.lastUpdateTime = Date.now();
        
        // Check if we should process now
        const shouldProcessNow = shouldProcessTranscription(transcriptionBuffer.text);
        
        // Clear any existing timer
        if (transcriptionBuffer.processingTimer) {
          clearTimeout(transcriptionBuffer.processingTimer);
          transcriptionBuffer.processingTimer = null;
        }
        
        if (shouldProcessNow) {
          // Process immediately if it's a complete thought and has sufficient length
          const wordCount = transcriptionBuffer.text.split(' ').length;
          if (wordCount >= MINIMUM_COMPLETE_SENTENCE_LENGTH) {
            // Process with higher confidence
            await processBufferedTranscription(connection.socket, streamSid, conversationHistory.get(streamSid) || [], deepgramLive, callStartTime, audioPacketCount);
          } else {
            // Short sentence - wait a bit longer to see if more words come in
            const originalText = transcriptionBuffer.text.trim();
            transcriptionBuffer.processingTimer = setTimeout(async () => {
              // Only process if text hasn't changed
              const currentText = transcriptionBuffer.text.trim();
              if (currentText === originalText) {
                await processBufferedTranscription(connection.socket, streamSid, conversationHistory.get(streamSid) || [], deepgramLive, callStartTime, audioPacketCount);
              }
            }, 500); // Short wait for possible continuation
          }
        } else {
          // Set a timer to process after a pause
          transcriptionBuffer.processingTimer = setTimeout(async () => {
            // Only process if there's been no new transcription for a while
            if (Date.now() - transcriptionBuffer.lastUpdateTime >= TRANSCRIPTION_TIMEOUT) {
              await processBufferedTranscription(connection.socket, streamSid, conversationHistory.get(streamSid) || [], deepgramLive, callStartTime, audioPacketCount);
            }
            transcriptionBuffer.processingTimer = null;
          }, TRANSCRIPTION_TIMEOUT);
        }
      }
    });
  });

  // Handle Deepgram errors with detailed logging
  deepgramLive.addListener('error', (error) => {
    logger.error('Deepgram error', {
      message: error.message || error,
      stack: error.stack
    });
  });

  // Handle Deepgram close
  deepgramLive.addListener(LiveTranscriptionEvents.Close, () => {
    logger.info('Deepgram connection closed');
  });

  // Handle WebSocket close
  connection.socket.on('close', () => {
    logger.info('WebSocket connection closed by client');
    closeConnectionSafely(connection.socket, streamSid, deepgramLive, callStartTime, audioPacketCount);
  });

  // Add handler for Twilio mark events
  connection.socket.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      // Handle mark events from Twilio
      if (data.event === 'mark' && data.mark && data.mark.name === 'call_ended') {
        logger.info('Received call_ended mark from Twilio', { streamSid: data.streamSid });
        // Close resources using our coordinated function
        closeConnectionSafely(connection.socket, data.streamSid, deepgramLive, callStartTime, audioPacketCount);
      }
      
      // ... rest of the existing message handler ...
    } catch (error) {
      logger.error('Error processing WebSocket message', { error: error.message });
    }
  });
});

// Start the server
try {
  const port = process.env.PORT || 5050;
  await fastify.listen({ port, host: '0.0.0.0' });
  logger.info(`Server is running on port ${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
