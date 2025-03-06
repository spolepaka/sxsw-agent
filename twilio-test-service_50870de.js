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

  // Ensure proper spacing after punctuation
  text = text.replace(/([.,!?])([^\s])/g, '$1 $2');
  
  // Clean up any double commas that might have been created
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
        result += `${firstHalf}. ${secondHalf} `;
        continue;
      }
    }
    result += sentence + ' ';
  }
  
  return result.trim();
}

// Store conversation history
const conversationHistory = new Map();

// Initialize the enhanced system prompt for more natural conversation
const systemPrompt = `You are a friendly and conversational Austin tourism assistant. 
When responding, use natural speech patterns with appropriate pauses and rhythm.

FORMATTING GUIDELINES FOR SPEECH:
1. Use contractions (I'm, you're, let's) for a casual tone.
2. Include thoughtful pauses using commas and ellipses (...) where appropriate.
3. Break long answers into shorter sentences of varying lengths.
4. Use question marks for engaging the user with genuine-sounding questions.
5. For lists, separate items with commas and pause before the final item.
6. Use exclamation marks sparingly to show enthusiasm for particularly exciting attractions.
7. Avoid complex punctuation that doesn't translate well to speech (e.g., parentheses).
8. End sentences with periods to create natural breaks.
9. Insert occasional verbal fillers like "hmm," "well," or "you know" to sound more human.

Provide helpful, concise information about attractions, events, food, and activities in Austin, Texas.`;

// Global state for transcription and processing
const transcriptionBuffer = {
  text: '',
  lastUpdateTime: Date.now(),
  processingTimer: null
};

// Add a set to track previously processed queries
const previousQueries = new Set();

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

// Process the buffered transcription
async function processBufferedTranscription(socket, sid, chatHistory) {
  const query = transcriptionBuffer.text.trim();
  
  // Only skip if we've already processed this exact query
  if (previousQueries.has(query)) {
    logger.info('Skipping duplicate query', { query });
    return;
  }
  
  // Skip if another response is already in progress
  if (responseInProgress) {
    logger.info('Response already in progress, skipping query', { query });
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
        { role: 'system', content: systemPrompt },
        ...chatHistory
      ];
      
      logger.debug('Sending request to OpenAI', { messageCount: messages.length });
      
      const openAIStream = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: messages,
        max_tokens: 200,
        temperature: 0.7,
        stream: true
      });

      let fullResponse = '';
      let accumulatedText = '';
      let sentenceBuffer = '';
      const MINIMUM_CHUNK_SIZE = 50;

      for await (const chunk of openAIStream) {
        // Check if user interrupted
        if (!isResponding) {
          logger.info('Response interrupted by user during streaming');
          // Make sure to stop any ongoing audio processing
          await stopTTSAndClearAudio(socket, sid);
          break;
        }
        
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          sentenceBuffer += content;
          logger.debug('Received content chunk', { content });
          
          // Check if we have a complete sentence or enough text
          if (
            sentenceBuffer.includes('.') || 
            sentenceBuffer.includes('?') || 
            sentenceBuffer.includes('!') || 
            sentenceBuffer.length > MINIMUM_CHUNK_SIZE
          ) {
            // Process the complete sentence
            const textToProcess = sentenceBuffer.trim();
            if (textToProcess.length > 0) {
              logger.debug('Streaming chunk to TTS', { text: textToProcess });
              
              try {
                // Convert text to speech using Deepgram TTS directly
                const ttsConfig = {
                  model: "aura-asteria-en",
                  encoding: "mulaw",
                  container: "none",
                  sample_rate: 8000
                };
                
                const response = await deepgram.speak.request(
                  { text: textToProcess },
                  ttsConfig
                );
                
                const stream = await response.getStream();
                const audioBuffer = await getAudioBuffer(stream);
                
                if (audioBuffer.length > 0) {
                  // Send chunks of audio data
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
                // Make sure to stop any ongoing audio processing on TTS error
                await stopTTSAndClearAudio(socket, sid);
              }
            }
            
            // Reset the sentence buffer
            sentenceBuffer = '';
          }
        }
      }

      // Process any remaining text in the buffer
      if (sentenceBuffer.trim().length > 0) {
        logger.debug('Processing remaining text', { text: sentenceBuffer });
        
        try {
          const audioBuffer = await textToSpeechDirect(sentenceBuffer.trim());
          
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
          // Make sure to stop any ongoing audio processing on TTS error
          await stopTTSAndClearAudio(socket, sid);
        }
      }

      // Process the complete response
      logger.info('ChatGPT response received', { text: fullResponse });

      // Add assistant's response to conversation history
      chatHistory.push({ role: 'assistant', content: fullResponse });
      
      // Set responding flag to false
      isResponding = false;
      responseInProgress = false; // Also reset the response lock

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
  let callStartTime = Date.now();
  let lastTranscriptionTime = null;
  let initialGreetingSent = false;

  // Initialize conversation history for this connection
  const chatHistory = [
    { role: 'system', content: systemPrompt }
  ];
  
  // Function to send the initial greeting - defined inside WebSocket handler
  async function sendInitialGreeting(sid) {
    if (!sid || initialGreetingSent) return;
    
    const greeting = 'Hello! How can I help you explore Austin today?';
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
                    await processBufferedTranscription(connection.socket, streamSid, chatHistory);
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
            await processBufferedTranscription(connection.socket, streamSid, chatHistory);
          } else {
            // Short sentence - wait a bit longer to see if more words come in
            const originalText = transcriptionBuffer.text.trim();
            transcriptionBuffer.processingTimer = setTimeout(async () => {
              // Only process if text hasn't changed
              const currentText = transcriptionBuffer.text.trim();
              if (currentText === originalText) {
                await processBufferedTranscription(connection.socket, streamSid, chatHistory);
              }
            }, 500); // Short wait for possible continuation
          }
        } else {
          // Set a timer to process after a pause
          transcriptionBuffer.processingTimer = setTimeout(async () => {
            // Only process if there's been no new transcription for a while
            if (Date.now() - transcriptionBuffer.lastUpdateTime >= TRANSCRIPTION_TIMEOUT) {
              await processBufferedTranscription(connection.socket, streamSid, chatHistory);
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
    logger.info('WebSocket connection closed', {
      callDuration: `${Math.round((Date.now() - callStartTime) / 1000)}s`,
      audioPackets: audioPacketCount
    });
    
    // Clear the previousQueries set to avoid accumulation across different calls
    previousQueries.clear();
    
    deepgramLive.finish();
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
