# validate-bcp47

`validate-bcp47` is a CLI for validating [BCP 47](https://www.rfc-editor.org/info/bcp47) language tags.

It installs a command, `bcp47`, and supports:

- RFC 5646 well-formedness checks
- Registry-backed validity checks using a IANA Language Subtag Registry snapshot
- Human-readable output by default
- JSON output for scripts
- Input from arguments, stdin, or a file

## Requirements

You need Node.js 20 or newer.

## Install

From this repository:

```bash
npm link
```

That will make `bcp47` available on your `PATH`.

If you only want to run it locally from the repo:

```bash
node ./bin/bcp47.js --help
```

## Usage

```bash
bcp47 <tag>
bcp47 validate <tag...>
bcp47 --stdin
bcp47 --file <path>
```

### Options

```text
--mode <valid|well-formed>  Validation mode (default: valid)
--stdin                     Read newline-delimited tags from stdin
--file <path>               Read newline-delimited tags from a file
--json                      Emit JSON output
--quiet                     Suppress normal output and use exit codes only
-h, --help                  Show help
-v, --version               Show version
```

## Examples

To validate a single tag:

```bash
bcp47 en-US
```

To validate several tags at once:

```bash
bcp47 validate en en-BU de-419-DE
```

The default output is designed to be readable in a terminal:

```text
OK en
OK en-BU: region subtag 'BU' is deprecated; prefer 'MM'; preferred: en-MM
INVALID de-419-DE: region subtag may appear at most once
```

You can also stream newline-delimited tags through stdin:

```bash
printf 'en\nen-BU\nx-private\n' | bcp47 --stdin
```

Or read them from a file:

```bash
bcp47 --file ./tags.txt
```

If you need machine-readable output, use JSON mode:

```bash
bcp47 --json en-BU
```

That produces output like this:

```json
{
  "ok": true,
  "mode": "valid",
  "results": [
    {
      "input": "en-BU",
      "mode": "valid",
      "ok": true,
      "wellFormed": true,
      "valid": true,
      "errors": [],
      "warnings": [
        "region subtag 'BU' is deprecated; prefer 'MM'"
      ],
      "preferredTag": "en-MM",
      "deprecated": true,
      "kind": "langtag"
    }
  ]
}
```

If you only want to check syntax, switch to `well-formed` mode:

```bash
bcp47 --mode well-formed en-QQ
```

In `well-formed` mode, a tag can pass syntax validation even if it is not valid against the IANA registry.

## Validation Behavior

`bcp47` distinguishes between two concepts. A tag is `well-formed` when it matches BCP 47 syntax. A tag is `valid` when it is well-formed and its language, extlang, script, region, and variant subtags are known in the IANA registry.

Beyond that basic distinction, the CLI rejects duplicate variants and duplicate extension singletons, enforces extlang prefix rules, accepts deprecated but still-valid tags while reporting preferred replacements when available, validates extensions structurally without implementing extension-specific subtag semantics, and treats variant registry prefixes as advisory warnings rather than hard failures.

## Exit Codes

- `0`: every checked tag passed the selected validation mode
- `1`: at least one checked tag failed validation
- `2`: CLI usage or input error, such as an unknown option or unreadable file

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
