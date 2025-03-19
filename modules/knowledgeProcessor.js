// Knowledge Processor
// Processes and optimizes the crawled knowledge base data for use in AI context
// Implements vector search capabilities using Pinecone for efficient RAG retrieval

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { loadCrawledKnowledgeBase } from './crawlerService.js';
import { vectorSearch, indexOptimizedData, isVectorStoreInitialized } from './vectorStore.js';

// Default paths
const DEFAULT_CRAWLED_DATA_PATH = path.join(process.cwd(), 'knowledge-base/crawled-data.json');
const DEFAULT_OPTIMIZED_DATA_PATH = path.join(process.cwd(), 'knowledge-base/optimized-data.json');

// Simple logger that matches the main service format
const logger = {
  error: (message, data) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message, data) => console.warn(`[WARN] ${message}`, data || ''),
  info: (message, data) => console.log(`[INFO] 🔍 KNOWLEDGE: ${message}`, data ? JSON.stringify(data) : ''),
  debug: (message, data) => console.log(`[DEBUG] 🔍 KNOWLEDGE: ${message}`, data ? JSON.stringify(data) : '')
};

const MAX_CHUNK_SIZE = 800000; // Keep well under OpenAI's limit of 1,048,576

/**
 * Segments text content based on headings
 * @param {string} html - HTML content
 * @returns {Array} Array of section objects
 */
function segmentContentBySections(html) {
  const $ = cheerio.load(html);
  const sections = [];
  
  // Remove unwanted elements
  $('iframe, script, style, img, nav, footer, header, aside, .navbar, .footer, .cookie-banner, .advert, .advertisement').remove();
  
  // First, try to find headings to segment by
  const headings = $('h1, h2, h3, h4');
  
  if (headings.length > 0) {
    headings.each((index, element) => {
      const sectionTitle = $(element).text().trim();
      let sectionText = '';
      let current = $(element).next();
      
      // Collect content until next heading
      while (current.length && !current.is('h1, h2, h3, h4')) {
        // Skip if it's an empty element or just contains whitespace
        const text = current.text().trim();
        if (text) {
          sectionText += text + ' ';
        }
        current = current.next();
      }
      
      // Clean up text
      sectionText = sectionText.trim()
        .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
        .replace(/\n+/g, ' '); // Replace newlines with spaces
      
      if (sectionTitle && sectionText) {
        sections.push({
          section: sectionTitle,
          text: sectionText
        });
      }
    });
  }
  
  // If no headings found, try to extract content by paragraph blocks
  if (sections.length === 0) {
    const paragraphs = $('p');
    let currentSection = null;
    let currentText = '';
    
    paragraphs.each((index, element) => {
      const text = $(element).text().trim();
      
      if (!text) return;
      
      // If first paragraph and no section title yet, use it as a title if it's short
      if (!currentSection && index === 0 && text.length < 100) {
        currentSection = text;
      } else {
        currentText += text + ' ';
        
        // Create section after accumulating multiple paragraphs or at the end
        if (index % 3 === 2 || index === paragraphs.length - 1) {
          if (currentSection && currentText) {
            sections.push({
              section: currentSection,
              text: currentText.trim()
            });
          }
          // Reset for next section
          currentSection = null;
          currentText = '';
        }
      }
    });
    
    // If still no sections, just use the page title and all content
    if (sections.length === 0) {
      const title = $('title').text().trim();
      const content = $('body').text().trim()
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, ' ');
      
      if (content) {
        sections.push({
          section: title || 'Page Content',
          text: content
        });
      }
    }
  }
  
  return sections;
}

/**
 * Process a single article from the knowledge base
 * @param {Object} article - Raw article object
 * @returns {Object} Optimized article object
 */
function processArticle(article) {
  // Basic validation
  if (!article || !article.content) {
    console.log('Skipping article without content');
    return null;
  }
  
  try {
    // Create optimized article structure
    const optimized = {
      url: article.url,
      title: article.title || '',
      description: article.description || '',
      content: segmentContentBySections(article.content)
    };
    
    // Only include articles with actual content
    if (optimized.content && optimized.content.length > 0) {
      return optimized;
    }
    
    return null;
  } catch (error) {
    console.error(`Error processing article ${article.url}: ${error.message}`);
    return null;
  }
}

/**
 * Optimize the crawled knowledge base data for use in AI context
 * @param {string} inputPath - Path to the crawled data file
 * @param {string} outputPath - Path to write the optimized data
 * @returns {Array} Optimized knowledge base data
 */
export async function optimizeKnowledgeBase(
  inputPath = DEFAULT_CRAWLED_DATA_PATH,
  outputPath = DEFAULT_OPTIMIZED_DATA_PATH
) {
  try {
    logger.info(`Starting knowledge base optimization`, { inputPath, outputPath });
    
    // Load the crawled data - either from file if exists, or from crawler
    let data;
    if (fs.existsSync(inputPath)) {
      const rawData = fs.readFileSync(inputPath, 'utf8');
      data = JSON.parse(rawData);
      // Handle different possible structures
      data = data.items || data;
      logger.info(`Loaded data from file`, { itemCount: data.length });
    } else {
      // Use the crawler service to load data
      logger.info(`File not found, loading from crawler service`);
      data = await loadCrawledKnowledgeBase();
    }
    
    if (!data || !Array.isArray(data)) {
      logger.error(`Invalid data format`, { inputPath });
      return [];
    }
    
    logger.info(`Processing articles`, { count: data.length });
    
    // Process each article
    const optimizedData = data
      .map(processArticle)
      .filter(Boolean); // Remove null entries
    
    // Write the optimized data
    fs.writeFileSync(outputPath, JSON.stringify(optimizedData, null, 2));
    
    logger.info(`Optimization complete`, { 
      originalCount: data.length,
      optimizedCount: optimizedData.length, 
      outputPath 
    });
    
    return optimizedData;
  } catch (error) {
    logger.error(`Failed to optimize knowledge base`, {
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

/**
 * Load the optimized knowledge base
 * @param {string} filePath - Path to the optimized data file
 * @returns {Array} Optimized knowledge base data
 */
export async function loadOptimizedKnowledgeBase(filePath = DEFAULT_OPTIMIZED_DATA_PATH) {
  try {
    // Check if optimized file exists
    if (!fs.existsSync(filePath)) {
      logger.info(`Optimized data not found, creating it now`, { path: filePath });
      return await optimizeKnowledgeBase();
    }
    
    // Load the optimized file
    const data = fs.readFileSync(filePath, 'utf8');
    const parsedData = JSON.parse(data);
    
    logger.info(`Successfully loaded optimized knowledge base`, { 
      articleCount: parsedData.length,
      filePath
    });
    
    return parsedData;
  } catch (error) {
    logger.error(`Failed to load optimized knowledge base`, { 
      error: error.message,
      filePath
    });
    return [];
  }
}

/**
 * Get the knowledge base formatted and chunked to fit within size limits
 * @returns {Array<string>} Array of formatted knowledge base chunks
 */
export async function getFormattedKnowledgeBase() {
  try {
    logger.info('Loading complete knowledge base');
    const knowledgeBase = await loadOptimizedKnowledgeBase();
    
    if (!knowledgeBase || knowledgeBase.length === 0) {
      logger.warn('Knowledge base is empty');
      return [''];
    }
    
    logger.info(`Formatting knowledge base`, { articleCount: knowledgeBase.length });
    
    const chunks = ['SXSW 2025 KNOWLEDGE BASE:\n\n'];
    let currentChunk = 0;
    
    // Format each article and its sections
    knowledgeBase.forEach((article, index) => {
      if (!article.content) return;
      
      // Format this article's content
      let articleContent = `ARTICLE ${index + 1}:\n`;
      articleContent += `TITLE: ${article.title}\n`;
      articleContent += `URL: ${article.url}\n`;
      
      article.content.forEach(section => {
        articleContent += `\nSECTION: ${section.section}\n`;
        articleContent += `CONTENT: ${section.text}\n`;
        articleContent += '---\n';
      });
      
      articleContent += '\n';
      
      // Check if adding this article would exceed chunk size
      if (chunks[currentChunk].length + articleContent.length > MAX_CHUNK_SIZE) {
        // Start a new chunk
        currentChunk++;
        chunks[currentChunk] = 'SXSW 2025 KNOWLEDGE BASE (CONTINUED):\n\n';
      }
      
      chunks[currentChunk] += articleContent;
    });
    
    logger.info('Knowledge base chunking complete', {
      totalChunks: chunks.length,
      chunkSizes: chunks.map(chunk => chunk.length)
    });
    
    return chunks;
  } catch (error) {
    logger.error(`Failed to format knowledge base`, {
      error: error.message
    });
    return [''];
  }
}

/**
 * Find relevant context for a query from the knowledge base using vector search
 * @param {string} query - User query
 * @param {number} maxResults - Maximum number of results to return
 * @returns {string} Formatted context string
 */
export async function findRelevantContext(query, maxResults = 3) {
  try {
    if (!query) return '';
    
    logger.info('Finding context for query', { query, maxResults });
    
    // Check if vector store is initialized
    let isVectorized;
    try {
      isVectorized = await isVectorStoreInitialized();
      logger.info('Vector store initialization check result:', { isVectorized });
    } catch (error) {
      logger.error('Error checking vector store initialization:', {
        error: error.message,
        stack: error.stack
      });
      throw error; // Re-throw to prevent silent fallback
    }
    
    // If vector store is initialized, use it
    if (isVectorized) {
      logger.info('Using vector search for query');
      try {
        // Get vector search results
        const vectorResults = await vectorSearch(query, maxResults);
        
        // Format the results into a string
        if (!vectorResults || vectorResults.length === 0) {
          logger.info('No vector search results found');
          return '';
        }
        
        // Log detailed information about what was found
        logger.info('Vector search results detail:', {
          count: vectorResults.length,
          results: vectorResults.map(r => ({
            id: r.id,
            score: r.score,
            metadata: r.metadata,
            namespace: r.namespace
          }))
        });
        
        // Format the results into a readable context string
        let formattedContext = `Here are ${vectorResults.length} relevant documents from the knowledge base:\n\n`;
        
        vectorResults.forEach((result, index) => {
          formattedContext += `DOCUMENT ${index + 1}:\n`;
          
          if (result.metadata) {
            // Extract and format available metadata fields
            const metadataFields = [
              result.metadata.title && `TITLE: ${result.metadata.title}`,
              result.metadata.url && `SOURCE: ${result.metadata.url}`,
              result.metadata.heading && `SECTION: ${result.metadata.heading}`,
              result.metadata.source && `FROM: ${result.metadata.source}`,
              result.namespace && `NAMESPACE: ${result.namespace}`,
              `RELEVANCE: ${(result.score * 100).toFixed(1)}%`
            ].filter(Boolean); // Remove any undefined fields
            
            // Add all available metadata
            formattedContext += metadataFields.join('\n') + '\n';
            
            // Add document content if available
            if (result.metadata.text) {
              formattedContext += `\nCONTENT:\n${result.metadata.text}\n`;
            } else if (result.metadata.content) {
              formattedContext += `\nCONTENT:\n${result.metadata.content}\n`;
            } else {
              formattedContext += `\nCONTENT: [Content not available in vector metadata]\n`;
              logger.warn(`Vector result missing content for id: ${result.id}`);
            }
          } else {
            formattedContext += `[No metadata available for this result]\n`;
            formattedContext += `RELEVANCE: ${(result.score * 100).toFixed(1)}%\n`;
          }
          
          formattedContext += '\n---\n\n';
        });
        
        logger.info(`Found ${vectorResults.length} relevant documents`, {
          docIds: vectorResults.map(r => r.id).join(', ').substring(0, 100)
        });
        logger.debug('Formatted context:', { 
          contextLength: formattedContext.length,
          documentCount: vectorResults.length,
          fullContext: formattedContext.substring(0, 500) + '...' // Log first 500 chars
        });
        
        return formattedContext;
      } catch (error) {
        logger.error('Vector search failed:', {
          error: error.message,
          stack: error.stack
        });
        throw error; // Re-throw to prevent silent fallback
      }
    }
    
    // Only fall back to keyword search if vector store is legitimately not initialized
    logger.info('Vector store not initialized, falling back to keyword search');
    return await keywordSearch(query, maxResults);
  } catch (error) {
    logger.error('Failed to find relevant context', {
      error: error.message,
      query,
      stack: error.stack
    });
    throw error; // Re-throw so the calling code can handle it
  }
}

/**
 * Fallback function that uses keyword matching to find relevant context
 * @param {string} query - User query
 * @param {number} maxResults - Maximum number of results to return
 * @param {number} maxLength - Maximum length of context string
 * @returns {string} Formatted context string
 */
async function keywordSearch(query, maxResults = 3, maxLength = 2000) {
  try {
    if (!query) return '';
    
    const knowledgeBase = await loadOptimizedKnowledgeBase();
    
    if (!knowledgeBase || knowledgeBase.length === 0) {
      logger.warn('Knowledge base is empty');
      return '';
    }
    
    // Prepare search terms
    const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    
    if (searchTerms.length === 0) {
      return '';
    }
    
    logger.debug('Performing keyword search', { 
      terms: searchTerms,
      articleCount: knowledgeBase.length
    });
    
    // Score each section in each article
    const scoredSections = [];
    
    knowledgeBase.forEach(article => {
      if (!article.content) return;
      
      article.content.forEach(section => {
        let score = 0;
        const sectionText = section.text.toLowerCase();
        const sectionTitle = section.section.toLowerCase();
        
        // Check for exact query match
        if (sectionText.includes(query.toLowerCase())) {
          score += 10;
        }
        
        if (sectionTitle.includes(query.toLowerCase())) {
          score += 15;
        }
        
        // Check for individual terms
        searchTerms.forEach(term => {
          if (sectionTitle.includes(term)) score += 5;
          
          // Count matches in section text
          const matches = (sectionText.match(new RegExp(term, 'gi')) || []).length;
          score += matches * 2;
        });
        
        if (score > 0) {
          scoredSections.push({
            articleTitle: article.title,
            url: article.url,
            section: section.section,
            text: section.text,
            score
          });
        }
      });
    });
    
    // Sort by score and get top results
    scoredSections.sort((a, b) => b.score - a.score);
    const topSections = scoredSections.slice(0, maxResults);
    
    logger.info('Keyword search complete', {
      totalMatches: scoredSections.length,
      returnedMatches: topSections.length
    });
    
    // Format the context
    let context = '';
    
    topSections.forEach((section, index) => {
      const sectionContext = `
SOURCE: ${section.articleTitle}
URL: ${section.url}
SECTION: ${section.section}
CONTENT: ${section.text}
---
`;
      
      // Check if adding this section would exceed the max length
      if (context.length + sectionContext.length <= maxLength) {
        context += sectionContext;
      }
    });
    
    return context.trim();
  } catch (error) {
    logger.error('Failed in keyword search', {
      error: error.message,
      query
    });
    return '';
  }
}

/**
 * Initialize the vector database with optimized knowledge base data
 * @param {string} filePath - Path to the optimized data file
 * @param {boolean} forceReindex - Whether to force reindex all articles
 * @returns {Promise<boolean>} Success status
 */
export async function initializeVectorStore(filePath = DEFAULT_OPTIMIZED_DATA_PATH, forceReindex = false) {
  try {
    logger.info('Initializing vector store', { forceReindex });
    
    // Check if vector store is already initialized and we're not forcing reindex
    if (!forceReindex) {
      const isInitialized = await isVectorStoreInitialized();
      
      if (isInitialized) {
        logger.info('Vector store already initialized (use --force-reindex to rebuild)');
        return true;
      }
    } else {
      logger.info('Force reindex requested - will reprocess all content');
    }
    
    // Ensure optimized data exists
    let optimizedData = [];
    if (!fs.existsSync(filePath)) {
      logger.info('Optimized data not found, generating it now', { path: filePath });
      optimizedData = await optimizeKnowledgeBase();
      
      if (!optimizedData || optimizedData.length === 0) {
        logger.error('Failed to generate optimized data');
        return false;
      }
    }
    
    // Index the optimized data in Pinecone
    const start = Date.now();
    logger.info('Starting indexing process with optimized data');
    
    const success = await indexOptimizedData(filePath, forceReindex);
    
    const duration = (Date.now() - start) / 1000; // in seconds
    
    if (success) {
      logger.info('Vector store initialized successfully', { 
        durationSeconds: duration.toFixed(1),
        forceReindex
      });
    } else {
      logger.error('Failed to initialize vector store', {
        durationSeconds: duration.toFixed(1)
      });
    }
    
    return success;
  } catch (error) {
    logger.error('Failed to initialize vector store', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}