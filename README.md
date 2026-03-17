# bcp47-cli

`bcp47-cli` is a CLI for validating and explaining [BCP 47](https://www.rfc-editor.org/info/bcp47) language tags.

It installs a command, `bcp47`, and supports:

- RFC 5646 well-formedness checks
- Registry-backed validity checks using a IANA Language Subtag Registry snapshot
- Registry-backed explanations of individual tags and subtags
- Dense human-readable output on TTYs
- Compact JSON output for agents and scripts
- Input from arguments, stdin, or a file

## Requirements

You need Node.js 20 or newer.

## Install

From npm:

```bash
npm install --global bcp47-cli
```

That installs the `bcp47` command on your `PATH`.

From this repository:

```bash
npm link
```

That also makes `bcp47` available on your `PATH`.

If you only want to run it locally from the repo:

```bash
node ./bin/bcp47.js --help
```

## Usage

```bash
bcp47
bcp47 <tag...>
bcp47 validate <tag...>
bcp47 explain <tag>
bcp47 --stdin
bcp47 --file <path>
```

### Validation Options

```text
--mode <valid|well-formed>  Validation mode (default: valid)
--stdin                     Read newline-delimited tags from stdin
--file <path>               Read newline-delimited tags from a file
--json                      Force JSON output
--quiet                     Suppress validation output and use exit codes only
-h, --help                  Show help
-v, --version               Show version
```

### Explain Command

```text
bcp47 explain [--json] <tag>
```

`explain` accepts exactly one tag and uses the bundled IANA registry snapshot plus the CLI's existing BCP 47 parser to break the tag down for a user. It does not support `--mode`, `--stdin`, `--file`, or `--quiet`.

With no arguments on a TTY, `bcp47` prints a short quick-start help screen. When stdout is not a TTY, it emits JSON automatically unless `--quiet` is set.

## Examples

To validate a single tag:

```bash
bcp47 en-US
```

To validate several tags at once:

```bash
bcp47 validate en en-BU de-419-DE
```

TTY output is dense and line-oriented:

```text
ok en
ok en-BU warn="region subtag 'BU' is deprecated; prefer 'MM'" preferred=en-MM
fail de-419-DE error="region subtag may appear at most once"
```

You can also stream newline-delimited tags through stdin:

```bash
printf 'en\nen-BU\nen-US-x-twain\n' | bcp47 --stdin
```

Or read them from a file:

```bash
bcp47 --file ./tags.txt
```

If you need machine-readable output, use `--json`, or just pipe the command:

```bash
bcp47 --json en-BU
```

That produces output like this:

```json
{
  "type": "validation",
  "ok": true,
  "exit": 0,
  "mode": "valid",
  "summary": {
    "total": 1,
    "pass": 1,
    "fail": 0,
    "warn": 1
  },
  "results": [
    {
      "tag": "en-BU",
      "ok": true,
      "wellFormed": true,
      "valid": true,
      "kind": "langtag",
      "warnings": [
        "region subtag 'BU' is deprecated; prefer 'MM'"
      ],
      "preferred": "en-MM",
      "deprecated": true
    }
  ]
}
```

Structured command errors also use JSON in script mode:

```json
{
  "type": "error",
  "ok": false,
  "exit": 2,
  "code": "missing_option_value",
  "message": "--mode requires a value",
  "suggestions": [
    "Use --mode valid or --mode well-formed.",
    "Run bcp47 --help to see the full syntax."
  ]
}
```

If you only want to check syntax, switch to `well-formed` mode:

```bash
bcp47 --mode well-formed en-QQ
```

In `well-formed` mode, a tag can pass syntax validation even if it is not valid against the IANA registry.

To explain a normal tag:

```bash
bcp47 explain en-US
```

TTY output is sectioned and user-facing:

```text
tag
  input: en-US
status
  ok: true
  wellFormed: true
  valid: true
  kind: langtag
subtags
  1. language: en
     registry: language
     descriptions: English
     suppress-script: Latn
     note: Primary language subtag.
  2. region: US
     registry: region
     descriptions: United States
     note: Region subtag.
guidance
  - Keep tags as short as possible; only add subtags that add useful distinction.
  - Region subtags are only useful when geographic variation needs to be distinguished.
```

Examples for other explanation cases:

```bash
bcp47 explain zh-yue
bcp47 explain de-DE-u-co-phonebk
bcp47 explain en-US-x-twain
bcp47 explain i-klingon
```

If you want machine-readable explanation output, use `--json` or pipe the command:

```bash
bcp47 explain --json zh-yue
```

That produces output like this:

```json
{
  "type": "explanation",
  "ok": true,
  "exit": 0,
  "tag": "zh-yue",
  "wellFormed": true,
  "valid": true,
  "kind": "langtag",
  "deprecated": true,
  "preferred": "yue",
  "subtags": [
    {
      "kind": "language",
      "value": "zh",
      "displayValue": "zh",
      "notes": [
        "Primary language subtag.",
        "This is a macrolanguage covering multiple more specific languages."
      ],
      "registryType": "language",
      "descriptions": [
        "Chinese"
      ],
      "scope": "macrolanguage"
    },
    {
      "kind": "extlang",
      "value": "yue",
      "displayValue": "yue",
      "notes": [
        "Extended language subtag.",
        "Registered prefix: 'zh'.",
        "The standalone language subtag 'yue' is usually preferred over 'zh-yue'."
      ],
      "registryType": "extlang",
      "descriptions": [
        "Yue Chinese",
        "Cantonese"
      ],
      "preferredValue": "yue",
      "prefixes": [
        "zh"
      ],
      "macrolanguage": "zh"
    }
  ],
  "guidance": [
    "Keep tags as short as possible; only add subtags that add useful distinction.",
    "Language subtag 'zh' is a macrolanguage; a more specific encompassed language may be better for new tags, but established usage can still favor the macrolanguage.",
    "The standalone language subtag 'yue' is usually preferred over the extlang form 'zh-yue'.",
    "The exact tag 'zh-yue' is deprecated in the registry; prefer 'yue'."
  ],
  "warnings": [
    "tag 'zh-yue' is deprecated; prefer 'yue'",
    "extended language form 'zh-yue' is valid but 'yue' is preferred"
  ]
}
```

## Validation Behavior

`bcp47` distinguishes between two concepts. A tag is `well-formed` when it matches BCP 47 syntax. A tag is `valid` when it is well-formed and its language, extlang, script, region, and variant subtags are known in the IANA registry.

Beyond that basic distinction, the CLI rejects duplicate variants and duplicate extension singletons, enforces extlang prefix rules, accepts deprecated but still-valid tags while reporting preferred replacements when available, validates extensions structurally without implementing extension-specific subtag semantics, and treats variant registry prefixes as advisory warnings rather than hard failures. Singleton subtags MUST NOT be repeated. For example, `en-a-bbb-a-ccc` is invalid because the singleton subtag `a` appears twice.

## Explanation Behavior

`bcp47 explain` is always registry-backed. For well-formed tags it breaks the input into ordered subtags, attaches any available registry metadata, and adds concise guidance derived from the registry.

Malformed tags still produce an explanation payload, but they do not include a subtag breakdown because the tag could not be parsed structurally. Registry-invalid but well-formed tags still include their parsed subtags plus the validation errors.

## Exit Codes

- `0`: validation or explanation succeeded
- `1`: the checked tag or at least one checked tag failed explanation or validation
- `2`: CLI usage or input error, such as an unknown option or missing tags
- `3`: I/O error while reading a file or stdin
- `4`: unexpected internal error

## Data Source

The repository vendors the IANA Language Subtag Registry in:

- `data/iana-language-subtag-registry.txt`
- `data/registry.json`

The current bundled snapshot is dated `2025-08-25`.

## Development

To run tests:

```bash
npm test
```

To refresh the vendored registry snapshot and generated JSON:

```bash
npm run update-registry
```

If you already have a raw registry file and only want to regenerate the JSON bundle from it:

```bash
node ./scripts/update-registry.mjs --from-file ./data/iana-language-subtag-registry.txt
```

## License

This project uses the W3C® Software and Document License.
