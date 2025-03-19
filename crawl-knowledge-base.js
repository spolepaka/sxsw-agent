// Crawl Knowledge Base Script
// Manually runs the crawler to build the knowledge base, optimize the data, and initialize vector store
// Includes incremental updates, caching, and error recovery

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { startCrawler, loadCrawledKnowledgeBase } from './modules/crawlerService.js';
import { optimizeKnowledgeBase, initializeVectorStore } from './modules/knowledgeProcessor.js';

// Load environment variables from .env file
dotenv.config();

// Parse command line arguments
function parseArgs() {
  const args = {
    crawl: false,
    forceReindex: false,
    verbose: false,
    help: false
  };
  
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i].toLowerCase();
    if (arg === '--crawl' || arg === '-c') {
      args.crawl = true;
    } else if (arg === '--force-reindex' || arg === '-f') {
      args.forceReindex = true;
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  
  return args;
}

/**
 * Display help information
 */
function showHelp() {
  console.log(`
SXSW 2025 Knowledge Base Tool

Usage: node crawl-knowledge-base.js [options]

Options:
  --crawl, -c            Run web crawler to gather fresh content
  --force-reindex, -f    Force reindex all content (ignore content hash checks)
  --verbose, -v          Show detailed logging
  --help, -h             Show this help message

Examples:
  node crawl-knowledge-base.js -c         Run crawler and index
  node crawl-knowledge-base.js            Only optimize and index existing data
  node crawl-knowledge-base.js -f         Force reindex all content
  `);
}

/**
 * Main function to run the crawler, optimize the knowledge base, and initialize vector store
 */
async function main() {
  try {
    const args = parseArgs();
    
    if (args.help) {
      showHelp();
      return;
    }
    
    console.log('=== SXSW 2025 KNOWLEDGE BASE PROCESSOR ===');
    
    // Set log level
    process.env.LOG_LEVEL = args.verbose ? 'DEBUG' : 'INFO';
    
    // Check if we have PINECONE_API_KEY
    if (!process.env.PINECONE_API_KEY) {
      console.error('Error: PINECONE_API_KEY environment variable is not set.');
      console.error('Please set it in your .env file to use vector search capabilities.');
      return;
    }
    
    // Check if we need to run the crawler
    if (args.crawl) {
      console.log('Starting crawler to build knowledge base...');
      
      // Start the crawler
      const articles = await startCrawler();
      
      console.log(`\nCrawling completed successfully!`);
      console.log(`Total articles crawled: ${articles.length}`);
      
      // Print a sample of the crawled articles
      if (articles.length > 0 && args.verbose) {
        console.log('\nSample of crawled articles:');
        articles.slice(0, 3).forEach((article, index) => {
          console.log(`\nArticle ${index + 1}: ${article.title}`);
          console.log(`URL: ${article.url}`);
          console.log(`Description: ${article.description}`);
          console.log(`Content snippet: ${article.content.substring(0, 150)}...`);
        });
      }
    }
    
    // Optimize the knowledge base for use with AI context
    console.log('\nOptimizing the knowledge base for AI context...');
    const optimizedData = await optimizeKnowledgeBase();
    
    console.log(`\nOptimization complete! ${optimizedData.length} articles processed for AI context`);
    
    // Initialize the vector store with the optimized data
    console.log('\nInitializing vector store for semantic search...');
    console.log(args.forceReindex ? 
      '(Forcing reindex of all content)' : 
      '(Using incremental updates - only changed content will be reindexed)');
    
    const vectorStoreInitialized = await initializeVectorStore(undefined, args.forceReindex);
    
    if (vectorStoreInitialized) {
      console.log('\nVector store initialized successfully!');
      console.log('Semantic search is now available for efficient knowledge retrieval');
    } else {
      console.log('\nNote: Vector store initialization failed.');
      console.log('The system will fall back to keyword search.');
    }
    
    console.log('\nKnowledge base is ready to use!');
    console.log('You can now start the main application with: npm start');
  } catch (error) {
    console.error(`Error processing knowledge base: ${error.message}`);
    console.error(error.stack);
  }
}

// Run the main function
main();