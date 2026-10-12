# Ops Toolkit

Six small tools for the unglamorous parts of automation work — the things you end up doing by
hand at 11pm because nobody built a tool for them.

**[▶ Live demo](https://realaweayomide.github.io/ops-toolkit/)** · built by [Ayomide Awe](https://github.com/realaweayomide)

Everything runs in your browser. Nothing is uploaded, nothing is stored, no signup, no API key.

## The tools

| Tool | What it solves |
|---|---|
| **Webhook Inspector** | Paste a webhook payload, get every field path and its type — so you know what you can reference downstream |
| **Cron Translator** | Turn `0 8 * * 1-5` into plain English *and* the next 5 real run times |
| **CSV → Clean JSON** | Normalise headers, detect types, flag ragged rows and duplicate columns |
| **Contact Normalizer** | Messy contact list in, E.164 phone numbers and validated emails out |
| **Duplicate Finder** | Fuzzy-match duplicates within a list or across two lists |
| **Template Checker** | See which `{{variables}}` would break *before* you send 500 emails |

## Why these six

They're all jobs I've actually had to do by hand. The webhook inspector exists because the first
thing you do with any new integration is work out what's actually in the payload. The template
checker exists because a missing variable in a mail merge is only discovered after it's gone out.

None of them need AI. That's deliberate — reaching for a model when a regex will do is a habit
worth resisting.

## Run it

Open `index.html`. That's the whole setup — no install, no build step, no dependencies.

Deep links work too: `/#cron` opens the cron translator directly.

## Notes on the implementations

- **Duplicate Finder** uses the Dice coefficient over character bigrams. It's forgiving about
  typos and word order, cheap to compute, and needs no dictionary — `"Acme Corporation"` and
  `"ACME Corp."` score 0.73.
- **Cron Translator** parses the five fields properly (ranges, lists, steps) and then finds the
  next runs by walking forward minute by minute. Brute force, but exact, and it never disagrees
  with the schedule the way a clever approximation would.
- **Contact Normalizer** expands local numbers using a configurable country code — a leading `0`
  is a trunk prefix, not a digit, which is the mistake most naive normalisers make.
- **CSV parser** handles quoted fields and escaped quotes rather than naively splitting on commas.

## License

MIT
