# SXSW 2025 Agent Commands and Guidelines

## Build & Development Commands
```bash
# Start the server
npm start

# Run crawler to generate knowledge base (with all options)
node crawl-knowledge-base.js --crawl --force-reindex --verbose

# Basic knowledge base indexing (no crawling)
node crawl-knowledge-base.js

# Force reindex all content 
node crawl-knowledge-base.js --force-reindex

# Show help information
node crawl-knowledge-base.js --help
```

## Knowledge Base Options
- `--crawl, -c` - Run web crawler to gather fresh content
- `--force-reindex, -f` - Force reindex all content (ignore content hash checks)  
- `--verbose, -v` - Show detailed logging
- `--help, -h` - Show help message

## Required Environment Variables
- `OPENAI_API_KEY` - OpenAI API key for embeddings and chat
- `DEEPGRAM_API_KEY` - Deepgram API key for speech recognition
- `PINECONE_API_KEY` - Pinecone API key for vector storage

## Code Style Guidelines

### Formatting & Structure
- 2-space indentation
- ES Modules format (import/export)
- No trailing semicolons in code
- JSDoc comments for function documentation

### Naming Conventions
- camelCase for variables and functions
- PascalCase for classes
- UPPER_SNAKE_CASE for constants and environment variables

### Error Handling
- Use try/catch blocks for async operations
- Log errors with detailed context (message, stack trace)
- Use custom logger abstraction with different log levels

### Imports Organization
1. External packages first (alphabetical)
2. Internal modules second (alphabetical)

### Tech Stack
- Node.js with ES Modules
- Fastify for web server
- Twilio for telephony
- OpenAI and Deepgram for AI services
- Pinecone for vector embeddings
- Crawlee for web crawling

## Pinecone Vector Store Notes

### Namespaces
The application is configured to use the 'sxsw-2025' namespace in Pinecone, but vectors may sometimes be stored in the default namespace (empty string '') depending on how the upsert operation is performed. The code has been updated to check for vectors in both namespaces.

If you need to explicitly move vectors between namespaces:
1. Query vectors from the default namespace
2. Upsert them to the 'sxsw-2025' namespace
3. Delete vectors from the default namespace if needed

### Troubleshooting
- If the system reports that the vector store is not initialized despite successful indexing, check the namespaces in the Pinecone index stats.
- Use the Pinecone dashboard to verify vector counts across different namespaces.
- When reindexing, use the `--force-reindex` flag to ensure fresh data is uploaded to the correct namespace.