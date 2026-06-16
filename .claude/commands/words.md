---
# Copyright 2026 Knoban LLC. All rights reserved.
#
# This software is confidential and proprietary, intended for use only by
# Knoban LLC or its authorized users. Unauthorized use, copying, modification,
# distribution of this software, or any part of it, is strictly prohibited and
# may be subject to civil and criminal penalties.
#
# A License Agreement is required to view, use, and/or modify this software.
#
# Disclaimer: This software is provided 'as is' and without any express or
# implied warranties. Knoban LLC is not liable for any damages arising out of
# the use of this software.
#
# For inquiries, contact: alden@knoban.com
---

Run spell-check, collect every unknown word, and add legitimate technical terms
to cspell.json.

1. Run `npm run spell-check 2>&1` and collect all "Unknown word" lines
2. For each flagged word, decide:
   - **Add to cspell.json** if it is a real technical term, library name,
     protocol identifier, variable name pattern, or domain-specific abbreviation
     used in this codebase
   - **Flag for review** if it looks like a typo or misspelling — show it to the
     user and ask before adding
3. Add approved words to the `words` array in `cspell.json`, keeping the array
   alphabetically sorted
4. Re-run `npm run spell-check` to confirm zero issues remain
5. Report how many words were added and list any flagged for user review
