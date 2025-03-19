// Script to update twilio-service.js with the vector search integration
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the Twilio service file
const filePath = path.join(__dirname, 'twilio-service.js');

// Read the current file
let content = fs.readFileSync(filePath, 'utf8');

// Add the required import at the top of the file
if (!content.includes('import { findRelevantContext')) {
  content = content.replace(
    'import fetch from \'node-fetch\';',
    'import fetch from \'node-fetch\';\nimport { findRelevantContext, initializeVectorStore } from \'./modules/knowledgeProcessor.js\';'
  );
}

// Add the vector store initialization
if (!content.includes('Initialize the knowledge base')) {
  content = content.replace(
    'logger.info(`Starting Twilio Test Service with log level: ${Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === logLevel)}`);',
    'logger.info(`Starting Twilio Test Service with log level: ${Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === logLevel)}`);\n\n' +
    '// Initialize the knowledge base\n' +
    'let knowledgeBaseLoaded = false;\n' +
    '(async () => {\n' +
    '  try {\n' +
    '    logger.info(\'Loading and optimizing knowledge base...\');\n' +
    '    await initializeVectorStore();\n' +
    '    knowledgeBaseLoaded = true;\n' +
    '    logger.info(\'Knowledge base loaded and vector store initialized!\');\n' +
    '  } catch (error) {\n' +
    '    logger.error(\'Failed to initialize knowledge base\', {\n' +
    '      error: error.message,\n' +
    '      stack: error.stack\n' +
    '    });\n' +
    '  }\n' +
    '})();'
  );
}

// Update the processBufferedTranscription function to use vector search
const oldProcessingCode = `  try {
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
          content: systemPrompt + "\\n\\nREMINDER: Format your response as a valid JSON object with 'response' and 'end_conversation' fields."
        },
        ...chatHistory
      ];`;

const newProcessingCode = `  try {
    // Set response in progress flag to prevent concurrent responses
    responseInProgress = true;
    
    // First, find relevant context from the knowledge base
    let knowledgeContext = '';
    if (knowledgeBaseLoaded) {
      logger.info('Retrieving relevant knowledge base context for query...');
      try {
        knowledgeContext = await findRelevantContext(query);
        logger.debug('Retrieved knowledge context', {
          contextLength: knowledgeContext.length,
          hasContent: knowledgeContext.length > 0 ? 'Yes' : 'No'
        });
      } catch (contextError) {
        logger.error('Error retrieving knowledge context', {
          error: contextError.message
        });
      }
    } else {
      logger.info('Knowledge base not loaded yet, proceeding without context');
    }
    
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
      
      // Prepare the system prompt with knowledge context if available
      let enhancedSystemPrompt = systemPrompt;
      if (knowledgeContext) {
        enhancedSystemPrompt += \`\\n\\nRELEVANT KNOWLEDGE BASE INFORMATION:\\n\${knowledgeContext}\\n\\nUse the information above to answer the user's query accurately and naturally. Cite specific details from the knowledge base when appropriate.\`;
        logger.info('Enhanced system prompt with knowledge context');
      }
      
      // Create messages array with system prompt
      const messages = [
        { 
          role: 'system', 
          content: enhancedSystemPrompt + "\\n\\nREMINDER: Format your response as a valid JSON object with 'response' and 'end_conversation' fields."
        },
        ...chatHistory
      ];`;

content = content.replace(oldProcessingCode, newProcessingCode);

// Write the updated file
fs.writeFileSync(filePath, content);
console.log('Successfully updated twilio-service.js with vector search capabilities');