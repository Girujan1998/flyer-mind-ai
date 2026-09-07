import dotenv from 'dotenv';

// Loaded before anything else (see index.js) so server/.env wins over any
// same-named var already exported in the shell — e.g. a stale GEMINI_API_KEY
// in ~/.zshrc. Matches flyer-ocr-extractor's `dotenv.config({ override: true })`.
dotenv.config({override: true, quiet: true});
