# Market Discovery Agent

## Overview

The Market Discovery Agent uses AI embeddings to automatically find equivalent markets for arbitrage opportunities. It scans all active markets, uses semantic similarity to identify equivalent propositions, and updates `config/market-mappings.json` automatically.

## How It Works

1. **Market Scanning**: Fetches all active markets from Gamma API
2. **Embedding Generation**: Uses OpenAI embeddings to convert market questions + outcomes into semantic vectors
3. **Similarity Matching**: Compares all market pairs using cosine similarity
4. **Match Classification**:
   - **Equivalent**: Same proposition, different markets (e.g., "Biden wins" vs "Biden victory")
   - **Parity**: Same market, complementary outcomes (e.g., "Biden wins" vs "Biden loses")
5. **Mapping Update**: Adds new matches to `config/market-mappings.json`

## Setup

### 1. Get OpenAI API Key

1. Sign up at https://platform.openai.com
2. Create an API key
3. Add to `.env`:
   ```bash
   OPENAI_API_KEY=sk-...
   ```

### 2. Run Discovery

```bash
# Run discovery (uses OPENAI_API_KEY from .env)
pnpm --filter bot dev discover:markets

# Or specify key directly
pnpm --filter bot dev discover:markets --openai-key sk-...
```

## Configuration

### Similarity Threshold

Controls how similar markets must be to be considered equivalent:

- **Higher (0.85-0.90)**: More conservative, fewer false positives
- **Lower (0.75-0.82)**: More aggressive, finds more matches but may include false positives

Default: `0.82`

```bash
# Use custom threshold
pnpm --filter bot dev discover:markets --similarity-threshold 0.85
```

Or set in `.env`:
```bash
MARKET_DISCOVERY_SIMILARITY_THRESHOLD=0.85
```

## Usage

### Daily Run

Run once per day (markets don't change frequently):

```bash
# Manual run
pnpm --filter bot dev discover:markets

# Or schedule with cron
# Add to crontab: 0 2 * * * cd /path/to/pm-bot && pnpm --filter bot dev discover:markets
```

### What Gets Updated

The agent:
- Scans all active markets
- Finds equivalent/parity matches
- Adds new mappings to `config/market-mappings.json`
- Skips duplicates (won't add same mapping twice)
- Preserves existing mappings

### Output

Example output:
```
=== Market Discovery Results ===
Markets scanned: 1247
Matches found: 23
Mappings added: 18
Mappings skipped (duplicates): 5
Total mappings: 45

=== Top Matches ===
[equivalent] 0.891: "Will Biden win 2024 election?" (Yes) <-> "Biden 2024 victory?" (Yes)
[parity] 0.876: "Team A vs Team B" (Team A wins) <-> "Team A vs Team B" (Team B wins)
...
```

## Cost Estimation

Using OpenAI `text-embedding-3-small`:
- ~$0.02 per 1M tokens
- Typical scan: ~500-2000 markets = ~50k-200k tokens
- Cost per scan: ~$0.001-0.004
- Daily cost: ~$0.001-0.004
- Monthly cost: ~$0.03-0.12

Very affordable for daily runs!

## How Matches Are Determined

### Equivalent Markets

Two different markets representing the same proposition:

**Example**:
- Market 1: "Will Biden win the 2024 election?" → "Yes"
- Market 2: "Biden 2024 victory?" → "Yes"
- **Match**: High similarity (0.85+), different markets

### Parity Markets

Same market, complementary outcomes:

**Example**:
- Market: "Team A vs Team B"
- Outcome 1: "Team A wins"
- Outcome 2: "Team B wins"
- **Match**: Same market, opposite outcomes

## Validation

The agent includes basic validation:
- Only includes matches above similarity threshold
- Skips duplicate mappings
- Preserves existing mappings
- Logs all matches for review

### Manual Review

After running, review `config/market-mappings.json`:
- Check that matches make logical sense
- Remove any false positives
- Adjust similarity threshold if needed

## Troubleshooting

### "OpenAI API key required"

Set `OPENAI_API_KEY` in `.env` or use `--openai-key` flag.

### Too Many False Positives

Increase similarity threshold:
```bash
pnpm --filter bot dev discover:markets --similarity-threshold 0.88
```

### Too Few Matches

Decrease similarity threshold:
```bash
pnpm --filter bot dev discover:markets --similarity-threshold 0.78
```

### API Rate Limits

OpenAI has rate limits. If you hit them:
- Wait a few minutes and retry
- The agent includes delays between batches
- Consider running less frequently

## Best Practices

1. **Run Daily**: Markets don't change frequently, daily is sufficient
2. **Review Results**: Check top matches to ensure quality
3. **Tune Threshold**: Adjust based on your market types
4. **Monitor Costs**: Check OpenAI usage dashboard
5. **Backup Mappings**: Keep a backup of `market-mappings.json`

## Future Enhancements

Potential improvements:
- Use local embeddings (no API costs)
- Add confidence scores to mappings
- Historical validation (check if matches would have worked)
- Price correlation validation
- Manual review queue for low-confidence matches

