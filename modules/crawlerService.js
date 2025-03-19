// Crawler Service
// Uses Crawlee to crawl websites and generate a knowledge base

import fs from 'fs';
import path from 'path';
import { HttpCrawler, Dataset } from 'crawlee';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get crawler configuration from environment variables
const CRAWL_MIN_DATE = process.env.CRAWL_MIN_DATE ? new Date(process.env.CRAWL_MIN_DATE) : null;
const CRAWL_MAX_PAGES = process.env.CRAWL_MAX_PAGES ? parseInt(process.env.CRAWL_MAX_PAGES) : 500;
const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === 'true';

// Simple logger that matches the main service format
const logger = {
  error: (message, data) => console.error(`[ERROR] ${message}`, data || ''),
  warn: (message, data) => console.warn(`[WARN] ${message}`, data || ''),
  info: (message, data) => console.log(`[INFO] 🕸️ CRAWLER: ${message}`, data ? JSON.stringify(data) : ''),
  debug: (message, data) => {
    if (VERBOSE_LOGGING) {
      console.log(`[DEBUG] 🕸️ CRAWLER: ${message}`, data ? JSON.stringify(data) : '');
    }
  }
};

// Load crawlee configuration
let crawleeConfig;
try {
  const configPath = path.join(process.cwd(), 'crawlee.json');
  if (fs.existsSync(configPath)) {
    const configData = fs.readFileSync(configPath, 'utf8');
    crawleeConfig = JSON.parse(configData);
    
    logger.debug('Loaded configuration', crawleeConfig);
  } else {
    logger.warn('crawlee.json not found, using default configuration');
    crawleeConfig = {
      startUrls: [
        "https://www.sxsw.com/", 
        "https://www.sxsw.com/festivals/",
        "https://www.sxsw.com/conference/",
        "https://www.sxsw.com/attend/"
      ],
      maxCrawlDepth: 2,
      maxPagesPerDomain: 20,
      outputPath: './knowledge-base/crawled-data.json',
      excludePatterns: [
        ".*\\.css$",
        ".*\\.js$",
        ".*\\.(jpg|jpeg|png|gif|svg|webp)$",
        ".*\\.(pdf|zip|mp3|mp4)$",
        ".*privacy.*",
        ".*terms.*",
        ".*legal.*",
        ".*archive.*",
        ".*history.*",
        ".*past-events.*"
      ],
      includePatterns: [
        ".*2025.*",
        ".*sxsw.*",
        ".*festival.*",
        ".*event.*",
        ".*schedule.*"
      ]
    };
  }
} catch (error) {
  logger.error(`Failed to load crawlee.json: ${error.message}`);
  crawleeConfig = {
    startUrls: [],
    maxCrawlDepth: 2,
    maxPagesPerDomain: 20,
    outputPath: './knowledge-base/crawled-data.json',
    excludePatterns: [],
    includePatterns: []
  };
}

// Ensure the knowledge-base directory exists
function ensureKnowledgeBaseDirectory() {
  const dir = path.dirname(crawleeConfig.outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.debug(`Created directory: ${dir}`);
  }
}

/**
 * Extract clean text content from HTML
 * @param {string} html - HTML content
 * @returns {string} Clean text content
 */
function extractTextFromHtml(html) {
  const $ = cheerio.load(html);
  
  // Remove script and style elements
  $('script, style, nav, footer, header, aside').remove();
  
  // Get text content
  let text = $('body').text();
  
  // Clean up the text
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Extract metadata from HTML
 * @param {string} html - HTML content
 * @param {string} url - URL of the page
 * @returns {Object} Metadata object
 */
function extractMetadata(html, url) {
  const $ = cheerio.load(html);
  
  return {
    title: $('title').text().trim() || path.basename(url),
    description: $('meta[name="description"]').attr('content') || '',
    keywords: $('meta[name="keywords"]').attr('content') || '',
    url: url
  };
}

/**
 * Start the crawler to generate the knowledge base
 * @returns {Promise<Array>} Array of crawled pages
 */
export async function startCrawler() {
  logger.info('Starting crawler', {
    maxPages: CRAWL_MAX_PAGES,
    minDate: CRAWL_MIN_DATE ? CRAWL_MIN_DATE.toISOString() : 'Not specified'
  });
  
  // Ensure the output directory exists
  ensureKnowledgeBaseDirectory();
  
  // Use the start URLs from the configuration
  const startUrls = crawleeConfig.startUrls;
  
  if (!startUrls || startUrls.length === 0) {
    logger.error('No start URLs provided in configuration');
    return [];
  }
  
  logger.info(`Starting crawl with ${startUrls.length} URLs`);
  
  // Create output directory if it doesn't exist
  const outputDir = path.dirname(crawleeConfig.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Define crawler info output file path
  const crawlerInfoPath = path.join(outputDir, 'crawler-info.md');
  
  // Prepare crawler information for output file
  let crawlerInfo = '# CRAWLER INFORMATION\n\n';
  
  // Add crawler configuration
  crawlerInfo += '## CRAWLER CONFIGURATION\n\n';
  crawlerInfo += `- Minimum Date: ${CRAWL_MIN_DATE ? CRAWL_MIN_DATE.toISOString() : 'Not specified'}\n`;
  crawlerInfo += `- Maximum Pages: ${CRAWL_MAX_PAGES}\n`;
  crawlerInfo += `- Maximum Crawl Depth: ${crawleeConfig.maxCrawlDepth}\n`;
  crawlerInfo += `- Maximum Pages Per Domain: ${crawleeConfig.maxPagesPerDomain}\n\n`;
  
  // Add start URLs
  crawlerInfo += '## START URLS\n\n';
  startUrls.forEach((url, index) => {
    crawlerInfo += `${index + 1}. ${url}\n`;
  });
  crawlerInfo += '\n\n';
  
  // Add include patterns
  crawlerInfo += '## INCLUDE PATTERNS\n\n';
  if (crawleeConfig.includePatterns && crawleeConfig.includePatterns.length > 0) {
    crawleeConfig.includePatterns.forEach((pattern, index) => {
      crawlerInfo += `${index + 1}. ${pattern}\n`;
    });
  } else {
    crawlerInfo += 'No include patterns specified (all URLs will be included)\n';
  }
  crawlerInfo += '\n\n';
  
  // Add exclude patterns
  crawlerInfo += '## EXCLUDE PATTERNS\n\n';
  if (crawleeConfig.excludePatterns && crawleeConfig.excludePatterns.length > 0) {
    crawleeConfig.excludePatterns.forEach((pattern, index) => {
      crawlerInfo += `${index + 1}. ${pattern}\n`;
    });
  } else {
    crawlerInfo += 'No exclude patterns specified\n';
  }
  crawlerInfo += '\n\n';
  
  // Save crawler information to file
  fs.writeFileSync(crawlerInfoPath, crawlerInfo);
  logger.info(`Crawler information saved to: ${crawlerInfoPath}`);
  
  // Create a new crawler
  const crawler = new HttpCrawler({
    maxRequestsPerCrawl: Math.min(CRAWL_MAX_PAGES, crawleeConfig.maxPagesPerDomain * startUrls.length),
    maxConcurrency: 3, // Reduced concurrency for better stability
    navigationTimeoutSecs: 90, // Increase timeout for slow sites
    requestHandlerTimeoutSecs: 90, // Increase handler timeout
    maxRequestRetries: 3, // Retry failed requests
    
    // This function is called for each URL
    async requestHandler({ request, body, log }) {
      try {
        const url = request.url;
        log.info(`Processing ${url}...`);
        
        // Skip non-HTML content
        let contentType = '';
        if (request.headers && request.headers['content-type']) {
          contentType = request.headers['content-type'];
        } else if (request.response && request.response.headers && request.response.headers['content-type']) {
          contentType = request.response.headers['content-type'];
        } else {
          logger.debug('Could not determine content type, assuming HTML');
          contentType = 'text/html';
        }
        
        if (!contentType.includes('text/html')) {
          logger.debug(`Skipping non-HTML content: ${contentType}`);
          return;
        }
        
        // Extract text and metadata
        const html = body.toString();
        const text = extractTextFromHtml(html);
        const metadata = extractMetadata(html, url);
        
        // Skip pages with very little content
        if (text.length < 100) {
          logger.debug(`Skipping page with insufficient content: ${url}`);
          return;
        }
        
        // Get the last modified date from the response headers if available
        let lastModified = null;
        if (request.response && request.response.headers && request.response.headers['last-modified']) {
          lastModified = new Date(request.response.headers['last-modified']);
          logger.debug(`Last modified date from headers: ${lastModified.toISOString()}`);
        }
        
        // Skip pages that are older than the minimum date if specified
        if (CRAWL_MIN_DATE && lastModified && lastModified < CRAWL_MIN_DATE) {
          logger.debug(`Skipping page older than minimum date: ${url}`);
          return;
        }
        
        // Save the data
        await Dataset.pushData({
          url,
          title: metadata.title,
          description: metadata.description,
          keywords: metadata.keywords,
          content: text,
          lastModified: lastModified ? lastModified.toISOString() : null,
          crawledAt: new Date().toISOString()
        });
        
        // Enqueue links for crawling
        if (request.userData.depth < crawleeConfig.maxCrawlDepth) {
          try {
            // Extract links manually using cheerio
            const $ = cheerio.load(html);
            const links = new Set();
            let linkCount = 0;
            
            // Find all links on the page
            $('a[href]').each((index, element) => {
              const href = $(element).attr('href');
              linkCount++;
              
              if (!href) return;
              if (href.startsWith('#')) return;
              if (href.startsWith('javascript:')) return;
              if (href.startsWith('mailto:')) return;
              if (href.startsWith('tel:')) return;
              
              try {
                // Convert relative URLs to absolute
                const absoluteUrl = new URL(href, url).href;
                links.add(absoluteUrl);
              } catch (urlError) {
                // Skip invalid URLs
                logger.debug(`Skipping invalid URL: ${href} - Error: ${urlError.message}`);
              }
            });
            
            logger.debug(`Found ${linkCount} total links, ${links.size} unique valid links`);
            
            // Filter links based on include/exclude patterns
            const filteredLinks = [];
            const excludedLinks = [];
            
            for (const link of links) {
              // Check if link matches any include pattern
              const includeMatch = crawleeConfig.includePatterns.length === 0 || 
                crawleeConfig.includePatterns.some(pattern => {
                  try {
                    return new RegExp(pattern).test(link);
                  } catch (regexError) {
                    logger.error(`Invalid include regex pattern: ${pattern} - Error: ${regexError.message}`);
                    return false;
                  }
                });
              
              // Check if link matches any exclude pattern
              const excludeMatch = crawleeConfig.excludePatterns.some(pattern => {
                try {
                  return new RegExp(pattern).test(link);
                } catch (regexError) {
                  logger.error(`Invalid exclude regex pattern: ${pattern} - Error: ${regexError.message}`);
                  return false;
                }
              });
              
              // Include if it matches include pattern and doesn't match exclude pattern
              if (includeMatch && !excludeMatch) {
                filteredLinks.push(link);
              } else {
                excludedLinks.push(link);
              }
            }
            
            logger.debug(`Found ${filteredLinks.length} links to follow (excluded ${excludedLinks.length})`);
            
            // Add the filtered links to the queue in smaller batches to avoid overwhelming the crawler
            if (filteredLinks.length > 0) {
              // Process links in batches of 50
              const batchSize = 50;
              for (let i = 0; i < filteredLinks.length; i += batchSize) {
                const batch = filteredLinks.slice(i, i + batchSize);
                try {
                  await crawler.addRequests(
                    batch.map(link => ({
                      url: link,
                      userData: {
                        depth: (request.userData.depth || 0) + 1,
                        parentUrl: url
                      }
                    }))
                  );
                } catch (batchError) {
                  logger.error(`Error adding batch: ${batchError.message}`);
                }
              }
            }
          } catch (error) {
            logger.error(`Error enqueueing links: ${error.message}`);
          }
        }
      } catch (error) {
        logger.error(`Error processing ${request.url}: ${error.message}`);
      }
    },
    
    // This function is called for failed requests
    failedRequestHandler({ request, error, log }) {
      logger.error(`Request failed: ${request.url} - ${error.message}`);
      
      // Log additional information about the request
      if (request.userData && request.userData.parentUrl) {
        logger.debug(`This URL was found on page: ${request.userData.parentUrl}`);
      }
    }
  });
  
  // Add start URLs with initial depth of 0
  await crawler.addRequests(
    startUrls.map(url => ({
      url,
      userData: { depth: 0 }
    }))
  );
  
  // Run the crawler
  await crawler.run();
  
  // Get the results
  const dataset = await Dataset.open();
  const items = await dataset.getData();
  
  // Save the results to the output file
  fs.writeFileSync(
    crawleeConfig.outputPath,
    JSON.stringify(items, null, 2)
  );
  
  logger.info('Crawling completed', { 
    pageCount: items.count,
    outputPath: crawleeConfig.outputPath
  });
  
  return items.items;
}

/**
 * Load the crawled knowledge base
 * @returns {Promise<Array>} Array of knowledge base articles
 */
export async function loadCrawledKnowledgeBase() {
  try {
    // Check if the file exists
    if (!fs.existsSync(crawleeConfig.outputPath)) {
      logger.info(`Knowledge base file not found, starting crawler...`);
      return await startCrawler();
    }
    
    // Load the file
    const data = fs.readFileSync(crawleeConfig.outputPath, 'utf8');
    const parsedData = JSON.parse(data);
    
    logger.info(`Loaded knowledge base`, {
      articleCount: parsedData.items?.length || 0,
      path: crawleeConfig.outputPath
    });
    
    return parsedData.items || [];
  } catch (error) {
    logger.error(`Failed to load crawled knowledge base: ${error.message}`);
    return [];
  }
}

/**
 * Search the crawled knowledge base
 * @param {string} query - Search query
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} Array of matching articles
 */
export async function searchCrawledKnowledgeBase(query, limit = 10) {
  try {
    // Load the knowledge base
    const articles = await loadCrawledKnowledgeBase();
    
    if (!articles.length) {
      logger.warn('No articles found in the knowledge base');
      return [];
    }
    
    if (!query || query.trim().length < 3) {
      // Return random articles if query is too short
      return articles
        .sort(() => 0.5 - Math.random())
        .slice(0, limit);
    }
    
    // Prepare search terms
    const searchTerms = query.toLowerCase().split(/\s+/);
    
    // Calculate relevance scores
    const scoredArticles = articles.map(article => {
      const title = article.title.toLowerCase();
      const content = article.content.toLowerCase();
      const description = article.description ? article.description.toLowerCase() : '';
      const keywords = article.keywords ? article.keywords.toLowerCase() : '';
      
      let score = 0;
      
      // Check for exact matches in title (highest weight)
      if (title.includes(query.toLowerCase())) {
        score += 10;
      }
      
      // Check for exact matches in description
      if (description.includes(query.toLowerCase())) {
        score += 5;
      }
      
      // Check for exact matches in keywords
      if (keywords.includes(query.toLowerCase())) {
        score += 5;
      }
      
      // Check for exact matches in content
      if (content.includes(query.toLowerCase())) {
        score += 3;
      }
      
      // Check for individual term matches
      for (const term of searchTerms) {
        if (term.length < 3) continue; // Skip very short terms
        
        if (title.includes(term)) score += 2;
        if (description.includes(term)) score += 1;
        if (keywords.includes(term)) score += 1;
        if (content.includes(term)) score += 0.5;
      }
      
      return {
        ...article,
        score
      };
    });
    
    // Sort by score and limit results
    const results = scoredArticles
      .filter(article => article.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    logger.info(`Search results`, {
      query,
      resultCount: results.length
    });
    
    return results;
  } catch (error) {
    logger.error(`Failed to search knowledge base: ${error.message}`);
    return [];
  }
}

/**
 * Find the best answer for a query
 * @param {string} query - Search query
 * @returns {Promise<Object|null>} Best matching article or null
 */
export async function findBestAnswer(query) {
  try {
    // Search the knowledge base
    const results = await searchCrawledKnowledgeBase(query, 3);
    
    if (!results.length) {
      logger.debug(`No results found for query: "${query}"`);
      return null;
    }
    
    // Get the best match
    const bestMatch = results[0];
    
    // Extract a relevant snippet
    let snippet = bestMatch.content;
    
    // Try to find a more relevant snippet by looking for the query in the content
    const queryLower = query.toLowerCase();
    const contentLower = bestMatch.content.toLowerCase();
    const index = contentLower.indexOf(queryLower);
    
    if (index !== -1) {
      // Extract a snippet around the match
      const start = Math.max(0, index - 150);
      const end = Math.min(bestMatch.content.length, index + queryLower.length + 150);
      snippet = bestMatch.content.substring(start, end);
      
      // Add ellipsis if needed
      if (start > 0) snippet = '...' + snippet;
      if (end < bestMatch.content.length) snippet = snippet + '...';
    } else {
      // If no direct match, just take the first part of the content
      snippet = bestMatch.content.substring(0, 300) + '...';
    }
    
    return {
      title: bestMatch.title,
      url: bestMatch.url,
      snippet,
      relevance: bestMatch.score,
      source: 'crawled'
    };
  } catch (error) {
    logger.error(`Failed to find best answer: ${error.message}`);
    return null;
  }
}