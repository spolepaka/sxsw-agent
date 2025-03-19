// Vector Store Module
// Handles embedding generation, storage, and retrieval using Pinecone
// Implements efficient processing, caching, and error handling

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

// Constants
const EMBEDDING_MODEL = 'text-embedding-3-large';
const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'sxsw-knowledge';
const NAMESPACE = ''; // Using default namespace for both indexing and searching
const DIMENSION = 3072; // Dimension of text-embedding-3-large
const DEFAULT_OPTIMIZED_DATA_PATH = path.join(process.cwd(), 'knowledge-base/optimized-data.json');
const DEFAULT_TOP_K = 5;
const BATCH_SIZE = 20; // Number of embeddings to process in one batch
const EMBEDDING_CACHE_PATH = path.join(process.cwd(), 'knowledge-base/embedding-cache.json');
const METADATA_PATH = path.join(process.cwd(), 'knowledge-base/vector-metadata.json');
const MAX_RETRY_ATTEMPTS = 3;
const RATE_LIMIT_DELAY = 1000; // 1 second delay between retries

/**
 * Load or initialize embedding cache
 * @returns {Object} The embedding cache
 */
function loadEmbeddingCache() {
  try {
    if (fs.existsSync(EMBEDDING_CACHE_PATH)) {
      const cacheData = fs.readFileSync(EMBEDDING_CACHE_PATH, 'utf8');
      return JSON.parse(cacheData);
    } else {
      return {};
    }
  } catch (error) {
    console.warn(`Could not load embedding cache: ${error.message}`);
    return {};
  }
}

/**
 * Save embedding cache to file
 * @param {Object} cache - The embedding cache to save
 */
function saveEmbeddingCache(cache) {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(EMBEDDING_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(EMBEDDING_CACHE_PATH, JSON.stringify(cache));
  } catch (error) {
    console.error(`Error saving embedding cache: ${error.message}`);
  }
}

/**
 * Generate a consistent hash for a text string
 * @param {string} text - The text to hash
 * @returns {string} The hash of the text
 */
function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Create embeddings for a text using OpenAI's embedding model with caching
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} The embedding vector
 */
async function createEmbedding(text) {
  try {
    // Check cache first
    const cache = loadEmbeddingCache();
    const textHash = hashText(text);
    
    if (cache[textHash]) {
      console.log(`[VECTOR] Using cached embedding for text hash: ${textHash.substring(0, 8)}...`);
      return cache[textHash];
    }
    
    // Not in cache, create the embedding with retry logic
    let attempts = 0;
    let lastError = null;
    
    while (attempts < MAX_RETRY_ATTEMPTS) {
      try {
        const response = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: text,
          encoding_format: 'float'
        });
        
        // Cache the result
        const embedding = response.data[0].embedding;
        cache[textHash] = embedding;
        
        // Periodically save the cache (every 10 new embeddings)
        if (Object.keys(cache).length % 10 === 0) {
          saveEmbeddingCache(cache);
        }
        
        return embedding;
      } catch (error) {
        lastError = error;
        attempts++;
        
        // If it's a rate limit error, wait before retrying
        if (error.status === 429) {
          console.warn(`Rate limit hit, waiting before retry (attempt ${attempts})`);
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY * attempts));
        } else {
          // For other errors, just throw
          throw error;
        }
      }
    }
    
    // If all attempts failed
    console.error(`Failed to create embedding after ${MAX_RETRY_ATTEMPTS} attempts`);
    throw lastError;
  } catch (error) {
    console.error(`Error creating embedding: ${error.message}`);
    throw error;
  }
}

/**
 * Create embeddings for multiple texts in a batch with caching
 * @param {string[]} texts - The texts to embed
 * @returns {Promise<number[][]>} The embedding vectors
 */
async function createEmbeddingsBatch(texts) {
  try {
    // Check which texts are already cached
    const cache = loadEmbeddingCache();
    const results = [];
    const uncachedTexts = [];
    const uncachedIndices = [];
    
    // First check the cache
    for (let i = 0; i < texts.length; i++) {
      const textHash = hashText(texts[i]);
      
      if (cache[textHash]) {
        // Use cached embedding
        results[i] = cache[textHash];
      } else {
        // Mark for embedding creation
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }
    
    // If all texts were cached, return immediately
    if (uncachedTexts.length === 0) {
      return results;
    }
    
    // Create embeddings for uncached texts with retry logic
    let attempts = 0;
    let lastError = null;
    
    while (attempts < MAX_RETRY_ATTEMPTS) {
      try {
        const response = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: uncachedTexts,
          encoding_format: 'float'
        });
        
        // Store the new embeddings in the results array and update the cache
        for (let i = 0; i < response.data.length; i++) {
          const embedding = response.data[i].embedding;
          const originalIndex = uncachedIndices[i];
          results[originalIndex] = embedding;
          
          // Update cache
          const textHash = hashText(texts[originalIndex]);
          cache[textHash] = embedding;
        }
        
        // Save the updated cache
        saveEmbeddingCache(cache);
        
        return results;
      } catch (error) {
        lastError = error;
        attempts++;
        
        // If it's a rate limit error, wait before retrying
        if (error.status === 429) {
          console.warn(`Rate limit hit, waiting before retry (attempt ${attempts})`);
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY * attempts));
        } else {
          // For other errors, just throw
          throw error;
        }
      }
    }
    
    // If all attempts failed
    console.error(`Failed to create batch embeddings after ${MAX_RETRY_ATTEMPTS} attempts`);
    throw lastError;
  } catch (error) {
    console.error(`Error creating batch embeddings: ${error.message}`);
    throw error;
  }
}

/**
 * Ensure the Pinecone index exists
 */
async function ensureIndex() {
  try {
    // Check if index already exists
    const indexList = await pinecone.listIndexes();
    
    // Handle the correct response structure
    let indexExists = false;
    if (indexList && indexList.indexes) {
      indexExists = indexList.indexes.some(index => index.name === INDEX_NAME);
    }

    if (!indexExists) {
      console.log(`Creating Pinecone index: ${INDEX_NAME}`);
      
      // Create the index with serverless spec using us-east-1 region
      await pinecone.createIndex({
        name: INDEX_NAME,
        dimension: DIMENSION,
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'  // Changed from us-west-2 to us-east-1
          }
        }
      });

      // Wait for the index to be ready
      console.log('Waiting for index to be ready...');
      let isReady = false;
      while (!isReady) {
        const indexDescription = await pinecone.describeIndex(INDEX_NAME);
        isReady = indexDescription.status?.ready;
        if (!isReady) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    return pinecone.index(INDEX_NAME);
  } catch (error) {
    console.error(`Error ensuring index: ${error.message}`);
    throw error;
  }
}

/**
 * Load or initialize vector metadata
 * @returns {Object} The vector metadata
 */
function loadVectorMetadata() {
  try {
    if (fs.existsSync(METADATA_PATH)) {
      const metadataStr = fs.readFileSync(METADATA_PATH, 'utf8');
      return JSON.parse(metadataStr);
    } else {
      // Initialize metadata structure
      const initialMetadata = {
        lastUpdated: new Date().toISOString(),
        articles: {},
        vectorCount: 0
      };
      return initialMetadata;
    }
  } catch (error) {
    console.warn(`Could not load vector metadata: ${error.message}`);
    return {
      lastUpdated: new Date().toISOString(),
      articles: {},
      vectorCount: 0
    };
  }
}

/**
 * Save vector metadata to file
 * @param {Object} metadata - The metadata to save
 */
function saveVectorMetadata(metadata) {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(METADATA_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Update last modified time
    metadata.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error(`Error saving vector metadata: ${error.message}`);
  }
}

/**
 * Process an article into section vectors
 * @param {Object} article - The article to process
 * @param {number} articleIndex - The index of the article
 * @param {boolean} forceReindex - Whether to force reindex
 * @returns {Array} The section vectors
 */
async function processArticle(article, articleIndex, forceReindex = false) {
  try {
    if (!article || !article.title || !article.content || !Array.isArray(article.content)) {
      console.error(`[VECTOR] Invalid article format at index ${articleIndex}`);
      return [];
    }
    
    // Create a unique ID for this article based on content hash
    const articleHash = hashText(article.title + (article.url || ''));
    
    // Create cache key for quick change detection
    const cacheKey = `article:${articleHash}`;
    
    // Check cache
    const cache = loadEmbeddingCache();
    
    if (cache[cacheKey] && !forceReindex) {
      console.log(`[VECTOR] Article unchanged, using cached vectors: ${article.title}`);
      return [];
    }
    
    const sectionVectors = [];
    
    // Process content sections
    for (let i = 0; i < article.content.length; i++) {
      const section = article.content[i];
      
      if (!section || !section.text || section.text.trim().length === 0) {
        continue;
      }
      
      // Generate a stable ID for this section
      const sectionHash = hashText(article.title + section.section + i);
      const id = `${articleHash}-${sectionHash}`;
      
      // Prepare metadata - CRITICALLY include the actual text content
      const metadata = {
        title: article.title,
        url: article.url || '',
        source: article.source || 'sxsw',
        heading: section.section || '',
        order: i,
        articleIndex: articleIndex,
        type: article.type || 'article',
        // Add the actual text content in the metadata
        text: section.text
      };
      
      console.log(`[VECTOR] Creating vector for section with id: ${id}, namespace: ${NAMESPACE}`);
      
      // Add to section vectors
      sectionVectors.push({
        id,
        text: section.text,
        metadata
      });
    }
    
    // Update cache
    cache[cacheKey] = { timestamp: Date.now(), count: sectionVectors.length };
    saveEmbeddingCache(cache);
    
    return sectionVectors;
  } catch (error) {
    console.error(`[VECTOR] Error processing article: ${error.message}`);
    return [];
  }
}

/**
 * Index all optimized articles in Pinecone with incremental updates and error recovery
 * @param {string} filePath - Path to the optimized data file
 * @param {boolean} forceReindex - Whether to force reindex all articles even if unchanged
 */
export async function indexOptimizedData(filePath = DEFAULT_OPTIMIZED_DATA_PATH, forceReindex = false) {
  try {
    console.log(`[VECTOR] Indexing optimized data from ${filePath}`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`[VECTOR] File not found: ${filePath}`);
      return false;
    }
    
    // Load the optimized data
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (!Array.isArray(data)) {
      console.error(`[VECTOR] Invalid data format: expected array`);
      return false;
    }
    
    console.log(`[VECTOR] Processing ${data.length} articles for vectorization`);
    
    // Ensure Pinecone index exists
    const index = await ensureIndex();
    
    // Load metadata to track changes
    const metadata = loadVectorMetadata();
    let articlesChanged = 0;
    let sectionsProcessed = 0;
    let sectionsSkipped = 0;
    
    // Create a checkpoint file to enable resuming process if interrupted
    const checkpointPath = path.join(process.cwd(), 'knowledge-base/indexing-checkpoint.json');
    let checkpoint = { lastCompletedArticle: -1 };
    
    // Check if there's an existing checkpoint
    if (fs.existsSync(checkpointPath)) {
      try {
        checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
        console.log(`[VECTOR] Found checkpoint: last completed article index ${checkpoint.lastCompletedArticle}`);
      } catch (error) {
        console.warn(`[VECTOR] Error reading checkpoint file: ${error.message}. Starting from beginning.`);
      }
    }
    
    // Process all articles into section vectors with incremental processing
    const allSectionVectors = [];
    for (let i = 0; i < data.length; i++) {
      // Skip already processed articles if resuming
      if (i <= checkpoint.lastCompletedArticle && !forceReindex) {
        console.log(`[VECTOR] Skipping article ${i} (already processed in previous run)`);
        continue;
      }
      
      console.log(`[VECTOR] Processing article ${i + 1}/${data.length}: ${data[i].title}`);
      
      try {
        const articleVectors = await processArticle(data[i], i, forceReindex);
        
        if (articleVectors.length > 0) {
          allSectionVectors.push(...articleVectors);
          articlesChanged++;
          sectionsProcessed += articleVectors.length;
        } else {
          sectionsSkipped++;
        }
        
        // Save checkpoint after each article
        checkpoint.lastCompletedArticle = i;
        fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint));
      } catch (articleError) {
        console.error(`[VECTOR] Error processing article ${i}: ${articleError.message}`);
        // Continue with next article instead of failing the entire process
      }
    }
    
    console.log(`[VECTOR] Generated ${allSectionVectors.length} section vectors (${articlesChanged} articles changed, ${sectionsSkipped} sections unchanged)`);
    
    // Check if we have any vectors to process
    if (allSectionVectors.length === 0) {
      console.log(`[VECTOR] No changes detected, index is up to date`);
      
      // Clear the checkpoint since processing is complete
      if (fs.existsSync(checkpointPath)) {
        fs.unlinkSync(checkpointPath);
      }
      
      return true;
    }
    
    // Group section vectors into batches for efficient processing
    const batches = [];
    for (let i = 0; i < allSectionVectors.length; i += BATCH_SIZE) {
      batches.push(allSectionVectors.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`[VECTOR] Processing ${batches.length} batches of embeddings`);
    
    let successfulBatches = 0;
    let failedBatches = 0;
    
    // Process each batch with error handling
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[VECTOR] Processing batch ${i + 1}/${batches.length} with ${batch.length} items`);
      
      try {
        // Create embeddings for all texts in the batch
        const batchTexts = batch.map(vector => vector.text);
        const batchEmbeddings = await createEmbeddingsBatch(batchTexts);
        
        // Create upsert records
        const records = batch.map((vector, j) => ({
          id: vector.id,
          values: batchEmbeddings[j],
          metadata: vector.metadata
        }));
        
        // Upsert to Pinecone with retry logic
        let upsertAttempts = 0;
        let upsertSuccess = false;
        
        while (upsertAttempts < MAX_RETRY_ATTEMPTS && !upsertSuccess) {
          try {
            console.log(`[VECTOR] Upserting batch ${i + 1} with namespace: ${NAMESPACE} (vectors: ${records.length})`);
            
            // Debug log
            console.log(`[VECTOR] First record in batch:`, JSON.stringify(records[0]));
            
            // Update: Use the correct format for upsert - directly pass the records array
            await index.upsert(records, { namespace: NAMESPACE });
            
            console.log(`[VECTOR] Successfully upserted vectors to namespace: ${NAMESPACE}`);
            upsertSuccess = true;
          } catch (upsertError) {
            upsertAttempts++;
            console.warn(`[VECTOR] Batch ${i + 1} upsert failed (attempt ${upsertAttempts}): ${upsertError.message}`);
            console.error(`[VECTOR] Full error:`, upsertError);
            
            // On specific iteration error, try alternative format
            if (upsertError.message === 'records is not iterable' && upsertAttempts === 1) {
              try {
                console.log(`[VECTOR] Attempting alternative format for Pinecone upsert`);
                // Check if records array is valid
                if (!Array.isArray(records)) {
                  throw new Error('Records is not an array');
                }
                
                // Make sure each record has the required fields
                const validRecords = records.map(record => {
                  if (!record.id || !record.values || !Array.isArray(record.values)) {
                    console.error(`[VECTOR] Invalid record format:`, record);
                    throw new Error('Invalid record format');
                  }
                  return {
                    id: record.id,
                    values: record.values,
                    metadata: record.metadata || {}
                  };
                });
                
                // Try the upsert with alternative format
                await index.upsert(validRecords, { namespace: NAMESPACE });
                
                console.log(`[VECTOR] Successfully upserted vectors with alternative format`);
                upsertSuccess = true;
                continue;
              } catch (altError) {
                console.error(`[VECTOR] Alternative format failed:`, altError);
              }
            }
            
            // Try a third format if second attempt
            if (upsertError.message === 'records is not iterable' && upsertAttempts === 2) {
              try {
                console.log(`[VECTOR] Attempting third format for Pinecone upsert`);
                
                // Create individual upsert requests for each record
                let succeeded = 0;
                
                for (const record of records) {
                  try {
                    // Try upserting one record at a time
                    await index.upsert([record], { namespace: NAMESPACE });
                    succeeded++;
                  } catch (singleError) {
                    console.error(`[VECTOR] Error upserting record ${record.id}:`, singleError.message);
                  }
                }
                
                if (succeeded > 0) {
                  console.log(`[VECTOR] Successfully upserted ${succeeded}/${records.length} vectors individually`);
                  upsertSuccess = true;
                  continue;
                } else {
                  throw new Error('All individual upserts failed');
                }
              } catch (thirdFormatError) {
                console.error(`[VECTOR] Third format failed:`, thirdFormatError);
              }
            }
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY * upsertAttempts));
            
            // If this is the last attempt and it failed, throw the error
            if (upsertAttempts >= MAX_RETRY_ATTEMPTS) {
              throw upsertError;
            }
          }
        }
        
        // Update metadata after successful batch
        metadata.vectorCount += batch.length;
        saveVectorMetadata(metadata);
        
        console.log(`[VECTOR] Upserted batch ${i + 1}/${batches.length}`);
        successfulBatches++;
      } catch (batchError) {
        console.error(`[VECTOR] Error processing batch ${i + 1}: ${batchError.message}`);
        failedBatches++;
        // Continue with next batch instead of failing the entire process
      }
    }
    
    // Clear the checkpoint since processing is complete
    if (fs.existsSync(checkpointPath)) {
      fs.unlinkSync(checkpointPath);
    }
    
    const success = failedBatches === 0;
    if (success) {
      console.log(`[VECTOR] Successfully indexed all data in Pinecone (${successfulBatches} batches)`);
    } else {
      console.log(`[VECTOR] Finished with errors: ${successfulBatches} batches succeeded, ${failedBatches} batches failed`);
    }
    
    return success;
  } catch (error) {
    console.error(`[VECTOR] Error indexing data: ${error.message}`, error);
    return false;
  }
}

/**
 * Perform vector search using Pinecone
 * @param {string} query - The query string to search for
 * @param {number} topK - Number of results to return
 * @returns {Promise<Object[]>} Search results with similarity scores and metadata
 */
export async function vectorSearch(query, topK = DEFAULT_TOP_K) {
  try {
    console.log(`[VECTOR] Searching for "${query}" (topK: ${topK})`);
    
    // Create embedding for the query
    const queryEmbedding = await createEmbedding(query);
    
    // Get Pinecone index
    const index = pinecone.index(INDEX_NAME);
    
    // Determine which namespaces to use based on where vectors are actually stored
    const stats = await index.describeIndexStats();
    const availableNamespaces = Object.keys(stats.namespaces || {});
    console.log(`[VECTOR] Available namespaces for search:`, availableNamespaces);
    
    // Collect results from all relevant namespaces
    let allResults = [];
    let namespacesToSearch = [];
    
    // Check if our configured namespace has vectors
    if (stats.namespaces?.[NAMESPACE]?.vectorCount > 0 || stats.namespaces?.[NAMESPACE]?.recordCount > 0) {
      namespacesToSearch.push(NAMESPACE);
    }
    
    // Check if default namespace has vectors
    if (stats.namespaces?.['']?.vectorCount > 0 || stats.namespaces?.['']?.recordCount > 0) {
      namespacesToSearch.push('');
    }
    
    // If no specific namespaces have vectors, search the whole index
    if (namespacesToSearch.length === 0) {
      namespacesToSearch.push(null); // null means search all namespaces
    }
    
    console.log(`[VECTOR] Searching in namespaces:`, namespacesToSearch);
    
    // Search in each namespace and collect results
    for (const ns of namespacesToSearch) {
      try {
        console.log(`[VECTOR] Querying in namespace: ${ns || 'default (all)'}`);
        
        // Using the index.namespace() method for specific namespaces
        const namespaceIndex = ns !== null ? index.namespace(ns) : index;
        
        const queryResults = await namespaceIndex.query({
          vector: queryEmbedding,
          topK: topK,
          includeMetadata: true
        });
        
        console.log(`[VECTOR] Found ${queryResults.matches?.length || 0} results in namespace "${ns || 'default'}"`);
        
        // Add results to the collection
        if (queryResults.matches && queryResults.matches.length > 0) {
          const formattedResults = queryResults.matches.map(match => ({
            id: match.id,
            score: match.score,
            metadata: match.metadata,
            namespace: ns || 'default' // Track which namespace this result came from
          }));
          
          allResults = [...allResults, ...formattedResults];
        }
      } catch (nsError) {
        console.error(`[VECTOR] Error searching in namespace "${ns || 'default'}":`, nsError.message);
        // Continue with other namespaces even if one fails
      }
    }
    
    // Sort all results by score and limit to topK
    allResults.sort((a, b) => b.score - a.score);
    allResults = allResults.slice(0, topK);
    
    console.log(`[VECTOR] Total results across all namespaces: ${allResults.length}`);
    
    return allResults;
  } catch (error) {
    console.error(`[VECTOR] Search error: ${error.message}`, error);
    // Return empty results on error
    return [];
  }
}

/**
 * Check if the vector store has been initialized
 * @returns {Promise<boolean>} True if the vector store has been initialized
 */
export async function isVectorStoreInitialized() {
  try {
    console.log(`[VECTOR] Checking if vector store is initialized (index: ${INDEX_NAME}, namespace: ${NAMESPACE})`);
    
    // Check if index exists
    const indexList = await pinecone.listIndexes();
    
    // Handle the correct response structure
    let indexExists = false;
    if (indexList && indexList.indexes) {
      indexExists = indexList.indexes.some(index => index.name === INDEX_NAME);
      console.log(`[VECTOR] Found indexes:`, indexList.indexes.map(i => i.name));
    } else {
      console.log(`[VECTOR] Unexpected indexList structure:`, indexList);
    }
    
    if (!indexExists) {
      console.log(`[VECTOR] Index ${INDEX_NAME} not found`);
      return false;
    }
    
    // Check if there's data in the index
    const index = pinecone.index(INDEX_NAME);
    
    // Log the status of the index
    console.log(`[VECTOR] DEBUG: Looking for vectors in index ${INDEX_NAME}`);
    
    const stats = await index.describeIndexStats();
    
    console.log(`[VECTOR] Raw index stats:`, stats);
    
    // Get all available namespaces
    const availableNamespaces = Object.keys(stats.namespaces || {});
    console.log(`[VECTOR] Available namespaces:`, availableNamespaces);
    
    // Log detailed stats about each namespace
    if (stats.namespaces) {
      for (const [ns, details] of Object.entries(stats.namespaces)) {
        console.log(`[VECTOR] Namespace '${ns}' stats:`, details);
      }
    }
    
    // Check for vectors in ANY namespace - we'll search them all
    let hasVectorsInAnyNamespace = false;
    let totalVectorCount = 0;
    
    // Check all namespaces for vectors/records
    if (stats.namespaces) {
      for (const [ns, details] of Object.entries(stats.namespaces)) {
        const nsVectorCount = details.vectorCount || details.recordCount || 0;
        totalVectorCount += nsVectorCount;
        
        if (nsVectorCount > 0) {
          hasVectorsInAnyNamespace = true;
          console.log(`[VECTOR] Found ${nsVectorCount} vectors/records in namespace '${ns}'`);
        }
      }
    }
    
    // Also check index-level counts
    const indexLevelVectorCount = stats.totalVectorCount || stats.totalRecordCount || 0;
    if (indexLevelVectorCount > 0) {
      hasVectorsInAnyNamespace = true;
      console.log(`[VECTOR] Found ${indexLevelVectorCount} total vectors/records at index level`);
    }
    
    // Check fullness as last resort
    const hasFullness = stats.indexFullness && parseFloat(stats.indexFullness) > 0;
    if (hasFullness) {
      hasVectorsInAnyNamespace = true;
      console.log(`[VECTOR] Index fullness indicates data is present: ${stats.indexFullness}`);
    }
    
    // Comprehensive logging
    console.log(`[VECTOR] Vector store initialization status:`, {
      indexExists,
      hasVectorsInAnyNamespace,
      totalVectorCount,
      indexFullness: stats.indexFullness,
      namespaceCount: availableNamespaces.length
    });
    
    return hasVectorsInAnyNamespace;
  } catch (error) {
    console.error(`[VECTOR] Error checking vector store:`, {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    throw error;  // Throw the error instead of silently failing
  }
}